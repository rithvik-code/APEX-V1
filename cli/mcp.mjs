#!/usr/bin/env node
/**
 * APEX MCP server.
 *
 * Speaks the Model Context Protocol over stdio, so any MCP client (Claude
 * Desktop, an editor, another agent) can drive this machine through the same
 * gated executor the console and `apex cyrus` use. The daemon stays the only
 * thing with desktop access; this process is a thin, stateless bridge.
 *
 *   apex mcp
 *   APEX_CONTROL_PORT=4317 node cli/mcp.mjs
 */
import { createInterface } from "node:readline";

const PORT = process.env.APEX_CONTROL_PORT || 4317;
const BASE = `http://127.0.0.1:${PORT}`;
const PROTOCOL = "2024-11-05";
const VERSION = "1.0.0";

const TOOLS = [
  {
    name: "desktop_command",
    description:
      "Run a spoken-style command on this computer through APEX. Low-risk verbs (open, switch, screenshot, list windows) run immediately. Typing, key presses and shell commands are gated: the first call returns needsApproval and nothing happens until you repeat it with confirm true.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: 'What to do, e.g. "open notepad", "switch to chrome", "take a screenshot", "press ctrl+s".',
        },
        confirm: {
          type: "boolean",
          description: "Approve a high-risk action in the same call.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "desktop_state",
    description:
      "Current control session: status, step, active window, screen size and the last observation. Returns null when no session has been created yet.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "screen_text",
    description:
      "OCR the current screen. Returns the recognized text and every region's pixel coordinates, useful for deciding where to click.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "desktop_commands",
    description: "List every command verb APEX understands, with examples.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
];

async function daemon(path, init) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: AbortSignal.timeout(45000),
    });
  } catch (error) {
    const reason = error?.name === "TimeoutError" ? "timed out" : "unreachable";
    throw new Error(
      `APEX daemon ${reason} on ${BASE}. Start it with "npm run apexd" (${error?.message ?? error}).`,
    );
  }
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* plain-text endpoints are fine */
  }
  if (!res.ok) {
    throw new Error(parsed?.error || parsed?.message || `daemon HTTP ${res.status}`);
  }
  return parsed ?? text;
}

async function callTool(name, args) {
  switch (name) {
    case "desktop_command": {
      const command = String(args?.command ?? "").trim();
      if (!command) throw new Error("command is required");
      return daemon("/api/cyrus", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: command, confirm: args?.confirm === true }),
      });
    }
    case "desktop_state":
      return daemon("/api/control/state");
    case "screen_text":
      return daemon("/api/control/ocr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    case "desktop_commands":
      return daemon("/api/cyrus");
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function toolResult(id, payload, isError = false) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }],
      ...(isError ? { isError: true } : {}),
    },
  };
}

async function handle(request) {
  const { id, method, params } = request;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "apex", version: VERSION },
        instructions:
          "APEX controls this computer. Commands are deterministic and run locally; high-risk ones require confirm:true. There is no cloud in this path.",
      },
    };
  }

  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };

  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };

  if (method === "tools/call") {
    const name = params?.name;
    try {
      const payload = await callTool(name, params?.arguments ?? {});
      const refused = payload && typeof payload === "object" && payload.ok === false;
      return toolResult(id, payload, refused);
    } catch (error) {
      return toolResult(id, { error: error.message }, true);
    }
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `method not found: ${method}` },
  };
}

process.stderr.write(`APEX MCP ready · daemon ${BASE}\n`);

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    return;
  }

  // Notifications (no id) never get a response.
  if (request.id === undefined || request.id === null) return;

  void handle(request)
    .then(send)
    .catch((error) => {
      send({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32603, message: error?.message ?? "internal error" },
      });
    });
});

// No explicit exit: a client often closes stdin right after its last request,
// and the pending fetch has to answer first. Node drains the loop on its own,
// which also avoids the libuv stdio abort on Windows that process.exit causes.
