const port = Number(process.env.SOURCESIGHT_DEBUG_PORT || 9223);
const timeoutMs = 90000;

async function main() {
  const page = await waitForPage();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
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

  function send(method, params = {}) {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => pending.set(id, resolve));
  }

  await send("Runtime.enable");
  await send("Page.enable");

  const started = Date.now();
  let result = null;

  while (Date.now() - started < timeoutMs) {
    const response = await send("Runtime.evaluate", {
      expression: `Array.from(document.querySelectorAll('.sourcesight-badge')).map((el) => ({ text: el.textContent, title: el.title, cls: el.className }))`,
      returnByValue: true
    });
    result = response.result.result.value;
    if (Array.isArray(result) && result.length >= 3 && result.every((item) => !/Scanning/.test(item.text))) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(JSON.stringify(result, null, 2));
  ws.close();

  if (!Array.isArray(result) || result.length < 3) {
    throw new Error("Source Sight badges did not appear on the smoke page.");
  }
}

async function waitForPage() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then((res) => res.json());
      const page = targets.find((target) => target.type === "page" && target.url.includes("smoke-page.html"));
      if (page) return page;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Could not find Chrome smoke test page.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
