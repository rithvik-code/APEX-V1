#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  ensureLiveFeed,
  getLiveFrame,
  listWindows,
  liveInfo,
  ocrScreen,
  releaseLive,
  retainLive,
  setLiveFrameHandler,
  stopLiveFeed,
} from "./control/desktop.mjs";
import { listTabs } from "./control/browser.mjs";
import { ControlSession } from "./control/session.mjs";
import { readControlConfig, writeControlConfig } from "./control/files.mjs";
import { checkAction } from "./control/permissions.mjs";
import {
  DEFAULT_ENDPOINT,
  DEFAULT_PLANNER,
  DEFAULT_VISION,
  listModels,
} from "./control/planner.mjs";
import { killAllPowerShell } from "./control/powershell.mjs";
import { stopCommands } from "./control/terminal.mjs";
import { stopBrowser } from "./control/browser.mjs";
import { scanFiles, scanWorkspace } from "./control/workspace.mjs";

const VERSION = "1.4.0";
const PORT = Number(process.env.APEX_CONTROL_PORT || 4317);
const HOST = "127.0.0.1";
const READ_ONLY =
  process.env.APEX_CONTROL_READONLY === "1" || process.argv.includes("--readonly");
const ORIGIN_OK = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i;

let session = null;
let shuttingDown = false;
const clients = new Set();
const screenSubs = new Set();
const pulls = new Map();
const healthCache = { at: 0, value: null };

const MODEL_NAME_OK = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;

function validateModelName(value, field = "model") {
  const model = String(value ?? "").trim();
  if (!MODEL_NAME_OK.test(model)) {
    throw new Error(`Invalid ${field} name`);
  }
  return model;
}

// The daemon only ever answers on loopback. Checking Host as well as Origin
// closes the DNS-rebinding gap, because a rebound name still arrives as Host.
function hostAllowed(req) {
  const raw = String(req.headers.host || "").toLowerCase();
  const name = raw.startsWith("[")
    ? raw.slice(0, raw.indexOf("]") + 1)
    : raw.replace(/:\d+$/, "");
  return name === "127.0.0.1" || name === "localhost" || name === "[::1]";
}

function pushFrame() {
  const frame = getLiveFrame();
  if (!frame?.buffer?.length) return;
  const head = `--apexframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.buffer.length}\r\n\r\n`;
  for (const res of screenSubs) {
    // A stalled viewer must not grow the daemon's write buffer without bound.
    if (res.writableLength > 1_500_000) continue;
    try {
      res.write(head);
      res.write(frame.buffer);
      res.write("\r\n");
    } catch {
      screenSubs.delete(res);
    }
  }
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(body);
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    if (!ORIGIN_OK.test(origin)) return false;
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  return true;
}

function broadcast(state) {
  const payload = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
  for (const client of clients) {
    // Drop a client that cannot keep up; EventSource reconnects automatically.
    if (client.writableLength > 1_000_000) {
      clients.delete(client);
      try {
        client.end();
      } catch {
        // Already gone.
      }
      continue;
    }
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

async function ollamaHealth() {
  if (Date.now() - healthCache.at < 6000 && healthCache.value) return healthCache.value;
  const endpoint = DEFAULT_ENDPOINT;
  try {
    const models = await listModels(endpoint, AbortSignal.timeout(2500));
    healthCache.value = { ok: true, endpoint, models };
  } catch (error) {
    healthCache.value = { ok: false, endpoint, models: [], error: error.message };
  }
  healthCache.at = Date.now();
  return healthCache.value;
}

async function readBody(req, limit = 2_000_000) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be JSON");
  }
}

function requireSession() {
  if (!session) throw new Error("No control session has been created");
  return session;
}

function publicPull(entry) {
  return {
    model: entry.model,
    status: entry.status,
    pct: Math.round(entry.pct * 10) / 10,
    error: entry.error,
    done: entry.done,
  };
}

function startPull(model) {
  // Finished pulls are only kept for status reads; prune old ones so the map
  // cannot grow for the lifetime of the daemon.
  if (pulls.size > 24) {
    for (const [key, item] of pulls) {
      if (item.done) pulls.delete(key);
    }
  }
  const entry = { model, status: "starting", pct: 0, error: "", done: false };
  pulls.set(model, entry);
  const controller = new AbortController();
  entry.controller = controller;
  fetch(`${DEFAULT_ENDPOINT}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({ model, stream: true }),
  })
    .then(async (res) => {
      if (!res.ok || !res.body) throw new Error(`Ollama returned ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let update;
          try {
            update = JSON.parse(line);
          } catch {
            continue;
          }
          if (update.error) throw new Error(update.error);
          if (update.total && update.completed) {
            entry.status = "pulling";
            entry.pct = Math.min(99.9, (update.completed / update.total) * 100);
          } else if (update.status) {
            entry.status = String(update.status).slice(0, 60);
          }
        }
      }
      entry.done = true;
      entry.pct = 100;
      entry.status = entry.error ? "error" : "ready";
      entry.controller = null;
      healthCache.at = 0;
    })
    .catch((error) => {
      entry.done = true;
      entry.status = "error";
      entry.error = String(error?.message || "Pull failed").slice(0, 200);
      entry.controller = null;
    });
  return entry;
}

function activeLike(state) {
  return ["running", "paused", "awaiting"].includes(state?.status);
}

async function route(req, res) {
  if (!hostAllowed(req)) {
    json(res, 403, { error: "Host is not allowed" });
    return;
  }
  if (!cors(req, res)) {
    json(res, 403, { error: "Origin is not allowed" });
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  const routePath = url.pathname;

  if (req.method === "GET" && routePath === "/api/health") {
    const ollama = await ollamaHealth();
    const config = readControlConfig();
    json(res, 200, {
      ok: true,
      daemon: "apex-control",
      version: VERSION,
      host: HOST,
      port: PORT,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      ollama,
      active: session
        ? {
            id: session.id,
            status: session.status,
            step: session.step,
          }
        : null,
      live: liveInfo(),
      defaults: {
        plannerModel: config.plannerModel || DEFAULT_PLANNER,
        visionModel: config.visionModel || DEFAULT_VISION,
        maxSteps: config.maxSteps ?? 20,
        fileRoots: config.fileRoots,
        autoApprove: Boolean(config.autoApprove),
        vision: Boolean(config.vision),
      },
    });
    return;
  }

  if (req.method === "GET" && routePath === "/api/control/state") {
    json(res, 200, session?.publicState() ?? null);
    return;
  }

  if (req.method === "GET" && routePath === "/api/workspace/scan") {
    json(res, 200, scanWorkspace(url.searchParams.get("refresh") === "1"));
    return;
  }

  if (req.method === "GET" && routePath === "/api/workspace/files") {
    json(
      res,
      200,
      scanFiles(url.searchParams.get("limit"), url.searchParams.get("refresh") === "1"),
    );
    return;
  }

  if (req.method === "GET" && routePath === "/api/control/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`retry: 2000\n\n`);
    res.write(`event: state\ndata: ${JSON.stringify(session?.publicState() ?? null)}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "GET" && routePath === "/api/control/screen/stream") {
    res.writeHead(200, {
      "Content-Type": "multipart/x-mixed-replace; boundary=apexframe",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("--apexframe\r\n");
    screenSubs.add(res);
    retainLive();
    const frame = getLiveFrame();
    if (frame?.buffer?.length) {
      try {
        res.write(
          `Content-Type: image/jpeg\r\nContent-Length: ${frame.buffer.length}\r\n\r\n`,
        );
        res.write(frame.buffer);
        res.write("\r\n");
      } catch {
        // The client left before the first frame.
      }
    }
    req.on("close", () => {
      screenSubs.delete(res);
      releaseLive();
    });
    return;
  }

  if (req.method === "GET" && routePath === "/api/control/screenshot") {
    const shot = session?.latestShot;
    if (!shot?.path || !fs.existsSync(shot.path)) {
      json(res, 404, { error: "No screenshot is available yet" });
      return;
    }
    const buffer = fs.readFileSync(shot.path);
    res.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Content-Length": buffer.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(buffer);
    return;
  }

  if (req.method === "GET" && routePath === "/api/control/windows") {
    const windows = await listWindows();
    json(res, 200, { windows });
    return;
  }

  if (req.method === "GET" && routePath === "/api/control/browser/tabs") {
    const tabs = await listTabs({ ensure: false });
    json(res, 200, { tabs });
    return;
  }

  if (req.method === "GET" && routePath === "/api/control/models") {
    try {
      const models = await listModels(DEFAULT_ENDPOINT, AbortSignal.timeout(6000));
      json(res, 200, { endpoint: DEFAULT_ENDPOINT, models });
    } catch (error) {
      json(res, 200, { endpoint: DEFAULT_ENDPOINT, models: [], error: error.message });
    }
    return;
  }

  if (req.method === "GET" && routePath === "/api/control/config") {
    json(res, 200, readControlConfig());
    return;
  }

  if (req.method === "POST" && routePath === "/api/control/config") {
    const body = await readBody(req);
    const current = readControlConfig();
    const next = {
      ...current,
      ...(body.fileRoots ? { fileRoots: current.fileRoots } : {}),
      ...(body.plannerModel ? { plannerModel: validateModelName(body.plannerModel, "planner model") } : {}),
      ...(body.visionModel ? { visionModel: validateModelName(body.visionModel, "vision model") } : {}),
      ...(body.maxSteps !== undefined
        ? { maxSteps: Math.max(1, Math.min(60, Number(body.maxSteps) || 1)) }
        : {}),
      ...(typeof body.autoApprove === "boolean" ? { autoApprove: body.autoApprove } : {}),
      ...(typeof body.vision === "boolean" ? { vision: body.vision } : {}),
      ...(typeof body.ocr === "boolean" ? { ocr: body.ocr } : {}),
    };
    if (Array.isArray(body.fileRoots)) {
      next.fileRoots = body.fileRoots
        .map((root) => path.resolve(String(root)))
        .filter((root) => fs.existsSync(root));
    }
    json(res, 200, writeControlConfig(next));
    return;
  }

  if (req.method === "POST" && routePath === "/api/control/start") {
    const body = await readBody(req);
    if (session && activeLike(session.publicState())) {
      json(res, 409, { error: "A control session is already active. Stop it first." });
      return;
    }
    const config = readControlConfig();
    const goal = String(body.goal || "").trim();
    if (!goal) {
      json(res, 400, { error: "A mission goal is required" });
      return;
    }
    if (goal.length > 4000) {
      json(res, 400, { error: "Mission goal is limited to 4000 characters" });
      return;
    }
    let created;
    try {
      const requestedPermissions = READ_ONLY
        ? {
            screen: true,
            accessibility: true,
            mouse: false,
            keyboard: false,
            apps: false,
            browser: false,
            files: false,
            terminal: false,
          }
        : body.permissions ?? {};
      created = new ControlSession({
        goal,
        permissions: requestedPermissions,
        autoApprove: READ_ONLY
          ? false
          : typeof body.autoApprove === "boolean"
            ? body.autoApprove
            : Boolean(config.autoApprove),
        vision:
          typeof body.vision === "boolean" ? body.vision : Boolean(config.vision),
        ocr: typeof body.ocr === "boolean" ? body.ocr : config.ocr !== false,
        plannerModel: validateModelName(
          body.plannerModel || config.plannerModel || DEFAULT_PLANNER,
          "planner model",
        ),
        visionModel: validateModelName(
          body.visionModel || config.visionModel || DEFAULT_VISION,
          "vision model",
        ),
        endpoint: config.endpoint || DEFAULT_ENDPOINT,
        maxSteps: READ_ONLY
          ? Math.min(3, Number(body.maxSteps) || 3)
          : body.maxSteps || config.maxSteps || 20,
        fileRoots: config.fileRoots,
        onEvent: (state) => {
          if (session?.id === state.id) broadcast(state);
        },
      });
    } catch (error) {
      json(res, 400, { error: error.message });
      return;
    }
    session = created;
    created.start();
    json(res, 202, created.publicState());
    return;
  }

  if (req.method === "POST" && routePath === "/api/control/pause") {
    json(res, 200, requireSession().pause());
    return;
  }

  if (req.method === "POST" && routePath === "/api/control/resume") {
    json(res, 200, requireSession().resume());
    return;
  }

  if (req.method === "POST" && routePath === "/api/control/stop") {
    const body = await readBody(req).catch(() => ({}));
    json(res, 200, requireSession().stop(body.reason || "Stopped from the console"));
    return;
  }

  if (req.method === "POST" && routePath === "/api/control/approve") {
    const body = await readBody(req);
    json(res, 200, requireSession().approve(body.id, body.allow !== false));
    return;
  }

  if (req.method === "POST" && routePath === "/api/control/action") {
    const body = await readBody(req);
    const state = await requireSession().manual(body.name, body.args ?? {});
    json(res, 200, state);
    return;
  }

  if (req.method === "POST" && routePath === "/api/control/undo") {
    const active = requireSession();
    const result = active.fileEngine.undo();
    active.log(
      "state",
      "WRITES ROLLED BACK",
      `${result.restored} restored · ${result.removed} removed`,
      "medium",
    );
    json(res, 200, result);
    return;
  }

  if (req.method === "POST" && routePath === "/api/control/steer") {
    const body = await readBody(req);
    json(res, 200, requireSession().steer(String(body.text ?? "")));
    return;
  }

  if (req.method === "POST" && routePath === "/api/control/ocr") {
    const active = requireSession();
    const gate = checkAction("ocr_screen", active.permissions, { autoApprove: true });
    if (!gate.allowed) {
      json(res, 403, { error: gate.reason });
      return;
    }
    let framePath;
    let scale = 1;
    const frame = getLiveFrame();
    if (frame?.file && frame.ageMs < 3000 && active.screen?.w) {
      framePath = frame.file;
      scale = frame.width / active.screen.w;
    }
    const signal = activeLike(active.publicState()) ? active.abort.signal : undefined;
    const result = await ocrScreen({ screen: active.screen, framePath, scale, signal });
    active.log(
      "ocr",
      "MANUAL OCR",
      `${result.lines.length} text regions · ${result.engine}`,
      "low",
    );
    json(res, 200, result);
    return;
  }

  if (req.method === "GET" && routePath === "/api/control/models/pull") {
    json(res, 200, { pulls: [...pulls.values()].map(publicPull) });
    return;
  }

  if (req.method === "POST" && routePath === "/api/control/models/pull") {
    const body = await readBody(req);
    const model = String(body.model ?? "").trim();
    if (body.cancel) {
      const entry = pulls.get(model);
      if (entry && !entry.done) {
        try {
          entry.controller?.abort();
        } catch {
          // Already finished.
        }
        entry.status = "cancelled";
        entry.done = true;
      }
      json(res, 200, { pull: entry ? publicPull(entry) : null });
      return;
    }
    if (!MODEL_NAME_OK.test(model)) {
      json(res, 400, { error: "Invalid model name" });
      return;
    }
    const existing = pulls.get(model);
    if (existing && !existing.done) {
      json(res, 200, { pull: publicPull(existing) });
      return;
    }
    json(res, 202, { pull: publicPull(startPull(model)) });
    return;
  }

  if (req.method === "GET" && routePath === "/api/control/tabs") {
    json(res, 200, { tabs: await requireSession().refreshBrowserTabs() });
    return;
  }

  json(res, 404, { error: "Unknown endpoint" });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    if (res.destroyed) return;
    if (!res.headersSent) {
      json(res, error.message.includes("No control session") ? 409 : 400, {
        error: error.message,
      });
    } else {
      res.end();
    }
  });
});
server.requestTimeout = 60_000;
server.headersTimeout = 20_000;
server.keepAliveTimeout = 65_000;

server.listen(PORT, HOST, () => {
  setLiveFrameHandler(pushFrame);
  console.log("");
  console.log("  APEX // TAKE CONTROL");
  console.log(`  daemon  http://${HOST}:${PORT}`);
  console.log(`  node    ${process.version} · ${process.platform}`);
  console.log(`  ollama  ${DEFAULT_ENDPOINT}`);
  console.log(`  models  ${DEFAULT_PLANNER} + ${DEFAULT_VISION}`);
  console.log(`  mode    ${READ_ONLY ? "READ-ONLY (screen + accessibility)" : "AUTHORIZED CAPABILITIES"}`);
  console.log("");
  console.log("  Loopback only. Arm capabilities from the APEX console.");
  console.log("  Ctrl+C stops the daemon and any running control session.");
  console.log("");
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`  Port ${PORT} is already in use. Set APEX_CONTROL_PORT.`);
  } else {
    console.error(`  daemon error: ${error.message}`);
  }
  process.exitCode = 1;
});

setInterval(() => {
  for (const client of clients) {
    try {
      client.write(": ping\n\n");
    } catch {
      clients.delete(client);
    }
  }
}, 15000).unref();

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n  shutting down control daemon…");
  try {
    if (session && activeLike(session.publicState())) {
      session.stop("Daemon shutting down");
    }
  } catch {
    // Ignore.
  }
  for (const client of clients) {
    try {
      client.end();
    } catch {
      // Ignore.
    }
  }
  clients.clear();
  for (const res of screenSubs) {
    try {
      res.end();
    } catch {
      // Ignore.
    }
  }
  screenSubs.clear();
  killAllPowerShell();
  stopCommands();
  stopBrowser();
  stopLiveFeed();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export { server };
