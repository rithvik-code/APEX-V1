#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { listWindows } from "./control/desktop.mjs";
import { listTabs } from "./control/browser.mjs";
import { ControlSession } from "./control/session.mjs";
import { readControlConfig, writeControlConfig } from "./control/files.mjs";
import {
  DEFAULT_ENDPOINT,
  DEFAULT_PLANNER,
  DEFAULT_VISION,
  listModels,
} from "./control/planner.mjs";
import { killAllPowerShell } from "./control/powershell.mjs";
import { stopCommands } from "./control/terminal.mjs";
import { stopBrowser } from "./control/browser.mjs";

const VERSION = "1.3.0";
const PORT = Number(process.env.APEX_CONTROL_PORT || 4317);
const HOST = "127.0.0.1";
const READ_ONLY =
  process.env.APEX_CONTROL_READONLY === "1" || process.argv.includes("--readonly");
const ORIGIN_OK = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i;

let session = null;
let shuttingDown = false;
const clients = new Set();
const healthCache = { at: 0, value: null };

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

function activeLike(state) {
  return ["running", "paused", "awaiting"].includes(state?.status);
}

async function route(req, res) {
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
      ...(body.plannerModel ? { plannerModel: String(body.plannerModel) } : {}),
      ...(body.visionModel ? { visionModel: String(body.visionModel) } : {}),
      ...(body.maxSteps ? { maxSteps: Math.max(1, Math.min(60, Number(body.maxSteps))) } : {}),
      ...(typeof body.autoApprove === "boolean" ? { autoApprove: body.autoApprove } : {}),
      ...(typeof body.vision === "boolean" ? { vision: body.vision } : {}),
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
        plannerModel: body.plannerModel || config.plannerModel || DEFAULT_PLANNER,
        visionModel: body.visionModel || config.visionModel || DEFAULT_VISION,
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

  if (req.method === "GET" && routePath === "/api/control/tabs") {
    json(res, 200, { tabs: await requireSession().refreshBrowserTabs() });
    return;
  }

  json(res, 404, { error: "Unknown endpoint" });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    if (!res.headersSent) {
      json(res, error.message.includes("No control session") ? 409 : 400, {
        error: error.message,
      });
    } else {
      res.end();
    }
  });
});

server.listen(PORT, HOST, () => {
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
  killAllPowerShell();
  stopCommands();
  stopBrowser();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export { server };
