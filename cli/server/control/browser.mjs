import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const CHROME_CANDIDATES = [
  process.env.APEX_BROWSER_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);

class CdpConnection {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.waiters = new Set();
    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const entry = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          entry.reject(new Error(message.error.message || "CDP error"));
        } else {
          entry.resolve(message.result ?? {});
        }
        return;
      }
      if (message.method) {
        for (const waiter of [...this.waiters]) {
          if (waiter.method === message.method) {
            this.waiters.delete(waiter);
            waiter.resolve(message.params ?? {});
          }
        }
      }
    });
  }

  static open(url, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          // Ignore.
        }
        reject(new Error("CDP connection timed out"));
      }, timeoutMs);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(new CdpConnection(ws));
      }, { once: true });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("CDP connection failed"));
      }, { once: true });
    });
  }

  send(method, params = {}, timeoutMs = 20000) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  waitFor(method, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const waiter = {
        method,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject,
      };
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`CDP event ${method} timed out`));
      }, timeoutMs);
      this.waiters.add(waiter);
    });
  }

  close() {
    for (const entry of this.pending.values()) {
      entry.reject(new Error("CDP connection closed"));
    }
    this.pending.clear();
    try {
      this.ws.close();
    } catch {
      // Ignore.
    }
  }
}

let browserProcess = null;
let browserOrigin = null;

function browserConfig() {
  return {
    port: Number(process.env.APEX_CDP_PORT || 9223),
    headless: process.env.APEX_BROWSER_HEADLESS === "1",
    attach: process.env.APEX_CDP_URL || "",
  };
}

async function httpJson(base, route, method = "GET") {
  const res = await fetch(`${base}${route}`, { method });
  const text = await res.text();
  if (!res.ok) throw new Error(`Browser endpoint ${res.status}: ${text.slice(0, 160)}`);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function probe(base) {
  try {
    const res = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(1200) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function ensureBrowser() {
  const config = browserConfig();
  if (config.attach) {
    browserOrigin = config.attach.replace(/\/+$/, "");
    if (!(await probe(browserOrigin))) {
      throw new Error(`No CDP endpoint at ${browserOrigin}`);
    }
    return { origin: browserOrigin, launched: false, headless: config.headless };
  }

  browserOrigin = `http://127.0.0.1:${config.port}`;
  if (await probe(browserOrigin)) {
    return { origin: browserOrigin, launched: false, headless: config.headless };
  }

  const executable = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!executable) {
    throw new Error(
      "No Chrome or Edge executable found. Set APEX_BROWSER_PATH or APEX_CDP_URL.",
    );
  }
  const profile = path.join(os.homedir(), ".apex", "browser-profile");
  fs.mkdirSync(profile, { recursive: true });
  const args = [
    `--remote-debugging-port=${config.port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate",
    "--remote-allow-origins=*",
    "--window-size=1440,900",
  ];
  if (config.headless) args.push("--headless=new", "--disable-gpu");
  args.push("about:blank");

  browserProcess = spawn(executable, args, {
    detached: false,
    stdio: "ignore",
    windowsHide: config.headless,
  });
  browserProcess.on("exit", () => {
    browserProcess = null;
  });

  const deadline = Date.now() + 16000;
  while (Date.now() < deadline) {
    if (await probe(browserOrigin)) {
      return { origin: browserOrigin, launched: true, headless: config.headless };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Browser started but CDP did not become available");
}

export async function listTabs({ ensure = true } = {}) {
  if (!ensure) {
    const config = browserConfig();
    const origin = config.attach
      ? config.attach.replace(/\/+$/, "")
      : browserOrigin || `http://127.0.0.1:${config.port}`;
    if (!(await probe(origin))) return [];
    browserOrigin = origin;
  } else {
    await ensureBrowser();
  }
  const origin = browserOrigin;
  const tabs = await httpJson(origin, "/json/list");
  if (!Array.isArray(tabs)) return [];
  return tabs
    .filter((tab) => tab.type === "page")
    .map((tab, index) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      order: index,
    }));
}

export async function newTab(url = "about:blank") {
  if (!/^(https?:|about:blank)/i.test(url)) {
    throw new Error("Browser URLs must start with http://, https:// or about:blank");
  }
  const { origin } = await ensureBrowser();
  let tab;
  try {
    tab = await httpJson(origin, `/json/new?${encodeURIComponent(url)}`, "PUT");
  } catch {
    tab = await httpJson(origin, `/json/new?${encodeURIComponent(url)}`, "GET");
  }
  if (!tab?.id) throw new Error("Browser refused to open a tab");
  await activateTab(tab.id);
  return { id: tab.id, url: tab.url ?? url };
}

export async function activateTab(tabId) {
  const { origin } = await ensureBrowser();
  await httpJson(origin, `/json/activate/${encodeURIComponent(tabId)}`);
  return { id: tabId, active: true };
}

export async function closeTab(tabId) {
  const { origin } = await ensureBrowser();
  const result = await httpJson(origin, `/json/close/${encodeURIComponent(tabId)}`);
  return { id: tabId, result };
}

async function pageConnection(tabId) {
  const tabs = await listTabs();
  const tab = tabs.find((item) => item.id === tabId) ?? tabs[0];
  if (!tab) throw new Error("No browser tab is available");
  const { origin } = await ensureBrowser();
  const target = await httpJson(origin, `/json/list`);
  const entry = Array.isArray(target) ? target.find((item) => item.id === tab.id) : null;
  if (!entry?.webSocketDebuggerUrl) throw new Error("Tab has no debugger socket");
  const cdp = await CdpConnection.open(entry.webSocketDebuggerUrl);
  await cdp.send("Page.enable").catch(() => null);
  await cdp.send("Runtime.enable").catch(() => null);
  return { cdp, tab };
}

export async function navigate(tabId, url) {
  if (!/^(https?:|about:blank)/i.test(url)) {
    throw new Error("Browser URLs must start with http://, https:// or about:blank");
  }
  const { cdp, tab } = await pageConnection(tabId);
  try {
    const loaded = cdp.waitFor("Page.loadEventFired", 12000).catch(() => null);
    await cdp.send("Page.navigate", { url }, 15000);
    await loaded;
    await new Promise((resolve) => setTimeout(resolve, 350));
    const result = await cdp.send("Runtime.evaluate", {
      expression: "(() => ({ title: document.title, url: location.href }))()",
      returnByValue: true,
    });
    return { id: tab.id, ...(result.result?.value ?? {}) };
  } finally {
    cdp.close();
  }
}

export async function evaluate(tabId, expression) {
  const { cdp, tab } = await pageConnection(tabId);
  try {
    const result = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      timeout: 15000,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text ||
          "Browser evaluation failed",
      );
    }
    return { id: tab.id, value: result.result?.value ?? null };
  } finally {
    cdp.close();
  }
}

export async function click(tabId, { selector, x, y } = {}) {
  const { cdp, tab } = await pageConnection(tabId);
  try {
    let point = null;
    if (selector) {
      const result = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          el.scrollIntoView({ block: "center", inline: "center" });
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        })()`,
        returnByValue: true,
      });
      point = result.result?.value;
      if (!point) throw new Error(`Selector not found: ${selector}`);
    } else {
      point = { x: Number(x), y: Number(y) };
    }
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    return { id: tab.id, ...point };
  } finally {
    cdp.close();
  }
}

export async function type(tabId, text, selector) {
  const { cdp, tab } = await pageConnection(tabId);
  try {
    if (selector) {
      const focused = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          el.focus();
          return document.activeElement === el;
        })()`,
        returnByValue: true,
      });
      if (!focused.result?.value) throw new Error(`Could not focus: ${selector}`);
    }
    await cdp.send("Input.insertText", { text: String(text) });
    return { id: tab.id, chars: String(text).length };
  } finally {
    cdp.close();
  }
}

export async function press(tabId, keys) {
  const { cdp, tab } = await pageConnection(tabId);
  const key = String(keys).toLowerCase();
  const map = {
    enter: { windowsVirtualKeyCode: 13, key: "Enter", code: "Enter" },
    tab: { windowsVirtualKeyCode: 9, key: "Tab", code: "Tab" },
    escape: { windowsVirtualKeyCode: 27, key: "Escape", code: "Escape" },
  };
  const entry = map[key];
  if (!entry) throw new Error(`Unsupported browser key: ${keys}`);
  try {
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...entry });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...entry });
    return { id: tab.id, key: entry.key };
  } finally {
    cdp.close();
  }
}

export async function screenshot(tabId, { quality = 70 } = {}) {
  const { cdp, tab } = await pageConnection(tabId);
  try {
    const result = await cdp.send("Page.captureScreenshot", {
      format: "jpeg",
      quality,
    });
    return { id: tab.id, base64: result.data };
  } finally {
    cdp.close();
  }
}

export function stopBrowser() {
  if (browserProcess) {
    try {
      browserProcess.kill();
    } catch {
      // Already gone.
    }
    browserProcess = null;
  }
}
