import { createServer } from "node:http";
import { cpSync, copyFileSync, createReadStream, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const distDir = resolve(root, "dist");
const datasetDir = resolve(process.env.SOURCESIGHT_BENCHMARK_DIR || "benchmarks/dataset");
const chromeBin = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const threshold = 0.65;
const maxImages = Number(process.env.SOURCESIGHT_BENCHMARK_LIMIT || 80);
const timeoutMs = 180_000;
const pathSeparator = process.platform === "win32" ? "\\" : "/";

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"]
]);

const files = {
  real: findImages(join(datasetDir, "real")),
  ai: findImages(join(datasetDir, "ai"))
};
const samples = [...files.real.map((file) => ({ label: "real", file })), ...files.ai.map((file) => ({ label: "ai", file }))];

if (!samples.length) {
  throw new Error(`No images found. Expected ${datasetDir}/real and ${datasetDir}/ai.`);
}
if (samples.length > maxImages) {
  throw new Error(`Found ${samples.length} images, but the extension test limit is ${maxImages}. Set SOURCESIGHT_BENCHMARK_LIMIT or split the dataset into batches.`);
}
if (!statSync(distDir, { throwIfNoEntry: false })) {
  throw new Error("dist/ is missing. Run npm run build first.");
}

const extensionDir = mkdtempSync(join(tmpdir(), "sourcesight-benchmark-ext."));
const profileDir = mkdtempSync(join(tmpdir(), "sourcesight-benchmark-chrome."));
const serverRoot = mkdtempSync(join(tmpdir(), "sourcesight-benchmark-page."));
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
  const file = resolve(serverRoot, pathname === "/" ? "benchmark.html" : pathname.slice(1));
  const relativeFile = relative(serverRoot, file);
  if (relativeFile.startsWith("..") || relativeFile.includes(".." + pathSeparator)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    if (!statSync(file).isFile()) throw new Error("Not a file");
    response.writeHead(200, { "content-type": mimeTypes.get(extname(file)) || "application/octet-stream" });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

cpSync(distDir, extensionDir, { recursive: true });
copyDataset();
writeFileSync(join(serverRoot, "benchmark.html"), makePage(samples));

await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
const port = server.address().port;
const debugPort = await freePort();
const chrome = spawn(chromeBin, [
  `--user-data-dir=${profileDir}`,
  `--remote-debugging-port=${debugPort}`,
  "--headless=new",
  "--no-first-run",
  "--no-default-browser-check",
  `http://127.0.0.1:${port}/benchmark.html`
], { stdio: ["ignore", "ignore", "pipe"] });

chrome.stderr.on("data", (chunk) => {
  const text = String(chunk);
  if (/ERROR:|FATAL:/.test(text)) process.stderr.write(text);
});

try {
  const browser = await wsClient(await waitForBrowser(debugPort));
  const loaded = await browser.send("Extensions.loadUnpacked", { path: extensionDir });
  browser.close();
  if (!loaded.result?.id) throw new Error(`Could not load Source Sight: ${JSON.stringify(loaded)}`);

  await delay(1000);
  const page = await waitForPage(debugPort);
  const client = await wsClient(page.webSocketDebuggerUrl);
  await client.send("Page.enable");
  await client.send("Page.reload", { ignoreCache: true });
  const results = await waitForResults(client);
  client.close();
  console.log(JSON.stringify(score(results), null, 2));
} finally {
  chrome.kill("SIGTERM");
  server.close();
  await waitForExit(chrome).catch(() => undefined);
  for (const path of [extensionDir, profileDir, serverRoot]) safeRm(path);
}

function findImages(directory) {
  if (!statSync(directory, { throwIfNoEntry: false })) return [];
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory() ? findImages(join(directory, entry.name)) : [join(directory, entry.name)])
    .filter((file) => [".jpg", ".jpeg", ".png", ".webp"].includes(extname(file).toLowerCase()));
}

function copyDataset() {
  for (const sample of samples) {
    const target = join(serverRoot, "images", sample.label, relative(join(datasetDir, sample.label), sample.file));
    const parent = target.slice(0, target.lastIndexOf("/"));
    mkdirSync(parent, { recursive: true });
    copyFileSync(sample.file, target);
  }
}

function makePage(items) {
  const tags = items.map((sample, index) => {
    const path = `/images/${sample.label}/${relative(join(datasetDir, sample.label), sample.file).split("\\").join("/")}`;
    return `<img id="sample-${index}" data-expected="${sample.label}" src="${path}" width="640" height="480" alt="benchmark sample ${index}" />`;
  }).join("\n");
  return `<!doctype html><meta charset="utf-8"><title>Source Sight benchmark</title><style>img{width:160px;height:120px;object-fit:cover}</style>${tags}`;
}

async function waitForResults(client) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await client.send("Runtime.evaluate", {
      expression: "Array.from(document.querySelectorAll('.sourcesight-badge')).map((el) => ({ image: el.dataset.imageId, probability: el.dataset.aiProbability, title: el.title, text: el.textContent }))",
      returnByValue: true
    });
    const result = response.result.result.value || [];
    if (result.length >= samples.length && result.every((item) => !/Scanning|Skipped|Unavailable/.test(item.text))) return result;
    await delay(1000);
  }
  throw new Error("Benchmark timed out before all images were analyzed.");
}

function score(results) {
  const rows = results.map((result) => {
    const probability = Number.isFinite(Number(result.probability)) ? Number(result.probability) : Number(result.title.match(/AI probability: (\d+)%/)?.[1] || 0) / 100;
    const expected = result.image?.startsWith("sample-") ? samples[Number(result.image.slice(7))]?.label : undefined;
    return { expected, probability, predicted: probability >= threshold ? "ai" : "real", image: result.image };
  }).filter((row) => row.expected);
  const ai = rows.filter((row) => row.expected === "ai");
  const real = rows.filter((row) => row.expected === "real");
  const aiRecall = ai.filter((row) => row.predicted === "ai").length / Math.max(1, ai.length);
  const realRecall = real.filter((row) => row.predicted === "real").length / Math.max(1, real.length);
  return { threshold, images: rows.length, aiRecall, realRecall, balancedAccuracy: (aiRecall + realRecall) / 2, rows };
}

async function waitForBrowser(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
      if (version.webSocketDebuggerUrl) return version.webSocketDebuggerUrl;
    } catch {}
    await delay(300);
  }
  throw new Error("Chrome did not expose a debugging endpoint.");
}

async function waitForPage(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
    const page = targets.find((target) => target.type === "page" && target.url.includes("benchmark.html"));
    if (page) return page;
    await delay(300);
  }
  throw new Error("Could not find benchmark page.");
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolveProbe) => probe.listen(0, "127.0.0.1", resolveProbe));
  const port = probe.address().port;
  await new Promise((resolveProbe) => probe.close(resolveProbe));
  return port;
}

async function wsClient(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (event) => { const data = JSON.parse(event.data); if (data.id && pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); } });
  return { send(method, params = {}) { const id = nextId++; ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve) => pending.set(id, resolve)); }, close() { ws.close(); } };
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function waitForExit(child) { if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(); return new Promise((resolve) => child.once("exit", resolve)); }
function safeRm(path) { try { rmSync(path, { recursive: true, force: true }); } catch {} }
