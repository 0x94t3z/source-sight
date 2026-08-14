import { createServer } from "node:http";
import { createReadStream, cpSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const distDir = resolve(root, "dist");
const smokeFile = "/tests/smoke-page.html";
const chromeBin =
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const timeoutMs = 120_000;
const keepOpenMs = Number(process.env.SOURCESIGHT_KEEP_OPEN_MS || 30000);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".wasm", "application/wasm"]
]);

async function main() {
  const extensionDir = mkdtempSync(join(tmpdir(), "sourcesight-ext."));
  const profileDir = mkdtempSync(join(tmpdir(), "sourcesight-chrome."));
  const server = createStaticServer();

  cpSync(distDir, extensionDir, { recursive: true });

  await listen(server);
  const serverPort = server.address().port;
  const debugPort = await freePort();
  const smokeUrl = `http://127.0.0.1:${serverPort}${smokeFile}`;

  const chrome = spawn(
    chromeBin,
    [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${debugPort}`,
      "--no-first-run",
      "--no-default-browser-check",
      smokeUrl
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  chrome.stderr.on("data", (chunk) => {
    const text = String(chunk);
    if (!/ERROR:|FATAL:/.test(text)) return;
    process.stderr.write(text);
  });

  try {
    const browserWsUrl = await waitForBrowser(debugPort);
    const browser = await wsClient(browserWsUrl);
    const loaded = await browser.send("Extensions.loadUnpacked", { path: extensionDir });
    const extensionId = loaded.result?.id;
    browser.close();

    if (!extensionId) {
      throw new Error(`Could not load Source Sight: ${JSON.stringify(loaded)}`);
    }

    await delay(1000);

    const page = await waitForPage(debugPort);
    const client = await wsClient(page.webSocketDebuggerUrl);
    await client.send("Page.enable");
    await client.send("Page.reload", { ignoreCache: true });
    const badges = await waitForBadges(client);
    client.close();

    console.log(`Loaded Source Sight extension: ${extensionId}`);
    console.log(JSON.stringify(badges, null, 2));
    console.log(`Keeping Chrome open for ${keepOpenMs} ms so the results can be inspected.`);
    await delay(keepOpenMs);
  } finally {
    chrome.kill("SIGTERM");
    server.close();
    await waitForExit(chrome).catch(() => undefined);
    safeRm(extensionDir);
    safeRm(profileDir);
  }
}

function createStaticServer() {
  return createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname === "/" ? smokeFile.slice(1) : pathname.slice(1);
    const file = resolve(root, relative);

    if (!file.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    try {
      if (!statSync(file).isFile()) throw new Error("Not a file");
      response.writeHead(200, {
        "content-type": mimeTypes.get(extname(file)) || "application/octet-stream"
      });
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

async function freePort() {
  const server = createServer();
  await listen(server);
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForBrowser(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((res) =>
        res.json()
      );
      if (version.webSocketDebuggerUrl) return version.webSocketDebuggerUrl;
    } catch {
      await delay(300);
    }
  }
  throw new Error("Chrome did not expose a debugging endpoint.");
}

async function waitForPage(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then((res) => res.json());
    const page = targets.find(
      (target) => target.type === "page" && target.url.includes("smoke-page.html")
    );
    if (page) return page;
    await delay(300);
  }
  throw new Error("Could not find Chrome smoke page.");
}

async function waitForBadges(client) {
  const started = Date.now();
  let result = [];

  while (Date.now() - started < timeoutMs) {
    const response = await client.send("Runtime.evaluate", {
      expression:
        "Array.from(document.querySelectorAll('.sourcesight-badge')).map((el) => ({ text: el.textContent, title: el.title, cls: el.className, image: el.dataset.imageId }))",
      returnByValue: true
    });
    result = response.result.result.value || [];
    if (
      result.length >= 2 &&
      result.every((item) => !/Scanning|Skipped|Unavailable/.test(item.text))
    ) {
      return result;
    }
    await delay(1000);
  }

  throw new Error(`Source Sight did not produce result badges: ${JSON.stringify(result)}`);
}

async function wsClient(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    }
  });

  return {
    send(method, params = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve) => pending.set(id, resolve));
    },
    close() {
      ws.close();
    }
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

function safeRm(path) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
  } catch (error) {
    console.warn(`Could not remove temporary path ${path}: ${error.message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
