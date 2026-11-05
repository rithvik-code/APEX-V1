#!/usr/bin/env node

/**
 * APEX — terminal-native AI.
 *
 * Free and unlimited because inference runs on your machine through Ollama.
 * APEX adds no moderation layer and rewrites nothing: your system prompt is
 * sent exactly as configured. The model's own training still applies.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";

const VERSION = "1.1.0";
const CONFIG_DIR = path.join(os.homedir(), ".apex");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

const DEFAULT_SYSTEM_PROMPT =
  "You are APEX, a terminal-native intelligence engine. You are direct, technical and fast. " +
  "No corporate hedging. No repeated disclaimers. No filler. Answer the question first, then stop. " +
  "Use plain terminal-friendly text. When code is required, write complete working code. " +
  "You are running on the user's own machine with no metering and no middleman.";

const DEFAULT_CONFIG = {
  endpoint: "http://127.0.0.1:11434",
  model: "qwen2.5:3b",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  temperature: 0.85,
};

const useColor =
  process.stdout.isTTY && !process.env.NO_COLOR && !process.argv.includes("--no-color");

const color = (code) => (value) => (useColor ? `\x1b[${code}m${value}\x1b[0m` : String(value));
const acid = color("38;2;200;255;22");
const white = color("38;2;233;237;232");
const dim = color("38;2;110;120;113");
const faint = color("38;2;70;80;74");
const red = color("38;2;255;90;70");
const bold = color("1");

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    if (!fs.existsSync(CONFIG_PATH)) {
      fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
      return { ...DEFAULT_CONFIG };
    }
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (error) {
    console.error(red(`Could not read ${CONFIG_PATH}: ${error.message}`));
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
    return true;
  } catch (error) {
    console.error(red(`Could not write ${CONFIG_PATH}: ${error.message}`));
    return false;
  }
}

const config = loadConfig();
if (process.env.APEX_MODEL) config.model = process.env.APEX_MODEL;
if (process.env.APEX_ENDPOINT) config.endpoint = process.env.APEX_ENDPOINT;
if (process.env.APEX_SYSTEM_PROMPT) config.systemPrompt = process.env.APEX_SYSTEM_PROMPT;

const state = {
  demo: false,
  history: [],
  streaming: false,
  abort: null,
  autoApprove: false,
};

function header() {
  console.log("");
  console.log(`  ${acid("▄▀█ █▀█ █▀▀ █ █")}`);
  console.log(`  ${acid("█▀█ █▀▀ ██▄ █▀█")}  ${dim("terminal intelligence")}`);
  console.log(
    `  ${faint(`v${VERSION}`)} ${faint("/")} ${dim("local-first · unmetered · no middleman")}`,
  );
  console.log("");
}

function usage() {
  header();
  console.log(`${bold("USAGE")}`);
  console.log(`  ${acid("apex")}                          interactive session`);
  console.log(`  ${acid('apex "prompt"')}                 one-shot answer`);
  console.log(`  ${acid('apex do "task"')}                agent mode — read, edit, run`);
  console.log(`  ${acid('cat file | apex "explain"')}     pipe context in`);
  console.log(`  ${acid("apex models")}                   list local models`);
  console.log(`  ${acid("apex config")}                   show config + path`);
  console.log(`  ${acid("apex config --set model=…")}     edit a config key`);
  console.log("");
  console.log(`${bold("OPTIONS")}`);
  console.log(`  ${dim("--model <name>")}      override the model`);
  console.log(`  ${dim("--endpoint <url>")}    Ollama endpoint`);
  console.log(`  ${dim("--system <text>")}     override the system prompt`);
  console.log(`  ${dim("--temp <number>")}     sampling temperature`);
  console.log(`  ${dim("--demo")}              answer without a model`);
  console.log(`  ${dim("--yes, -y")}           auto-approve agent actions`);
  console.log(`  ${dim("--no-color")}          plain output`);
  console.log(`  ${dim("--help, --version")}`);
  console.log("");
  console.log(`${bold("REPL COMMANDS")}`);
  console.log(`  ${acid("/help")} ${dim("/model")} ${dim("/prompt")} ${dim("/temp")} ${dim("/models")} ${dim("/config")} ${dim("/clear")} ${dim("/demo")} ${dim("/live")} ${dim("/quit")}`);
  console.log(`  ${acid("/do <task>")}      switch to agent mode for one task`);
  console.log("");
  console.log(`${faint("Free forever: inference runs on your hardware via Ollama.")}`);
  console.log(`${faint("No filters are added by APEX. Your system prompt is passed through as written.")}`);
  console.log(`${faint("Agent mode asks before every write and command unless you pass --yes.")}`);
  console.log("");
}

function endpointBase() {
  return String(config.endpoint || DEFAULT_CONFIG.endpoint).replace(/\/+$/, "");
}

async function listModels() {
  try {
    const res = await fetch(`${endpointBase()}/api/tags`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.models || []).map((model) => model.name);
  } catch (error) {
    console.error(red(`No local link: ${error.message}`));
    console.error(dim("Start Ollama with `ollama serve`, then try again."));
    return [];
  }
}

function printModels(models) {
  if (!models.length) return;
  console.log("");
  models.forEach((model, index) => {
    const active = model === config.model;
    console.log(
      `  ${active ? acid("›") : faint("·")} ${active ? white(model) : dim(model)}${active ? acid("  [active]") : ""}`,
    );
    if (index === models.length - 1) console.log("");
  });
}

function buildMessages(prompt) {
  return [
    { role: "system", content: config.systemPrompt },
    ...state.history,
    { role: "user", content: prompt },
  ];
}

async function streamOllama(prompt, signal) {
  const res = await fetch(`${endpointBase()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: config.model,
      stream: true,
      messages: buildMessages(prompt),
      options: {
        temperature: Number(config.temperature) || 0.85,
      },
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Local model error ${res.status}. ${detail.slice(0, 240)}`.trim());
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let first = true;

  const showSpinner = Boolean(process.stdout.isTTY && useColor);
  if (showSpinner) process.stdout.write(dim("  thinking"));
  const spinner = showSpinner
    ? setInterval(() => {
        process.stdout.write(dim("."));
      }, 420)
    : null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const json = JSON.parse(line);
        if (json.error) throw new Error(json.error);
        const token = json.message?.content;
        if (token) {
          if (first) {
            if (spinner) clearInterval(spinner);
            if (showSpinner) process.stdout.write("\r\x1b[2K");
            first = false;
          }
          output += token;
          process.stdout.write(token);
        }
      }
    }
  } finally {
    if (spinner) clearInterval(spinner);
    if (first && showSpinner) process.stdout.write("\r\x1b[2K");
  }

  process.stdout.write("\n");
  return output;
}

const DEMO = {
  default:
    "This is the offline demo. No model is attached, so the words are finite and the intelligence is canned.\n" +
    "Start Ollama, pull a model, and run `apex` again to go live. Free, local, unmetered.",
  install:
    "INSTALL APEX\n\n  1. ollama pull qwen2.5:3b\n  2. npm install -g ./cli\n  3. apex\n\nNo account, no key, no meter.",
  free:
    "APEX is free and unlimited because inference runs on your hardware.\nCost per token: 0.00. Monthly ceiling: none. Middleman: none.",
  prompt:
    "The system prompt lives in ~/.apex/config.json and is sent exactly as written.\nNo rewrite, no injected moderation layer. The model's own training still applies.",
};

function demoAnswer(prompt) {
  const p = prompt.toLowerCase();
  if (/install|setup|npm/.test(p)) return DEMO.install;
  if (/free|cost|price|limit|unlimited/.test(p)) return DEMO.free;
  if (/prompt|system|persona/.test(p)) return DEMO.prompt;
  return DEMO.default;
}

async function streamDemo(prompt, signal) {
  const text = demoAnswer(prompt);
  for (const chunk of text.match(/.{1,4}/gs) || [text]) {
    if (signal.aborted) return "";
    process.stdout.write(chunk);
    await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 14));
  }
  process.stdout.write("\n");
  return text;
}

function printLinkError(error) {
  console.error("");
  console.error(red(`  LINK FAILED — ${error.message}`));
  console.error(dim(`  endpoint  ${endpointBase()}`));
  console.error(dim(`  model     ${config.model}`));
  console.error("");
  console.error(`  ${white("Start the local engine:")}`);
  console.error(`    ${acid("ollama serve")}`);
  console.error(`    ${acid(`ollama pull ${config.model}`)}`);
  console.error("");
  console.error(`  ${dim("Or run `apex --demo \"anything\"` to use the offline demo.")}`);
  console.error("");
}

async function ask(prompt) {
  if (state.streaming) {
    console.log(dim("  stream already active — wait or press Ctrl+C"));
    return;
  }

  const controller = new AbortController();
  state.abort = controller;
  state.streaming = true;

  console.log("");
  console.log(
    `  ${acid("APEX")} ${faint("→")} ${dim(state.demo ? "demo" : config.model)} ${faint(`/ ${endpointBase()}`)}`,
  );
  console.log(faint("  " + "─".repeat(58)));

  try {
    let output;
    if (state.demo) {
      output = await streamDemo(prompt, controller.signal);
    } else {
      output = await streamOllama(prompt, controller.signal);
    }
    if (output && !controller.signal.aborted) {
      state.history.push({ role: "user", content: prompt });
      state.history.push({ role: "assistant", content: output });
      state.history = state.history.slice(-20);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      console.log(dim("  [aborted]"));
    } else {
      printLinkError(error);
    }
  } finally {
    state.streaming = false;
    state.abort = null;
  }
}

/* -------------------------------------------------------------------------- */
/* AGENT MODE                                                                  */
/* -------------------------------------------------------------------------- */

const AGENT_PROMPT = `AGENT MODE.
You are operating on the user's computer and you can actually change it. Do not describe work you could do — use the tools and do it.
Working directory: ${process.cwd()}
Platform: ${process.platform}

Rules of engagement:
- Inspect before you edit. Use list_dir and read_file to ground yourself.
- Use write_file for new files, replace_in_file for focused edits, and run_command for builds, tests and shell work.
- Every command and every write is shown to the user for approval before it runs.
- If a command fails, read the error and fix the cause. Never claim success without checking the result.
- Keep the user's existing conventions and do not add unrelated features.
- When the task is complete, stop and write a short report: what changed, what you verified, anything still broken.
- If a request is destructive or outside your ability, say so instead of guessing.`;

const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "list_dir",
      description:
        "List files and directories at a path. Use this before reading or editing.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path, relative to the working directory or absolute.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read a UTF-8 text file. Returns the content, clipped if very large.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to read." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Create or overwrite a file with complete content. Parent directories are created.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to write." },
          content: { type: "string", description: "The complete file content." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replace_in_file",
      description:
        "Replace an exact string inside a file. Fails when the old text is not present.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path to edit." },
          old: { type: "string", description: "Exact text to replace." },
          new: { type: "string", description: "Replacement text." },
        },
        required: ["path", "old", "new"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Run a shell command and return its exit code, stdout and stderr.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command to run." },
        },
        required: ["command"],
      },
    },
  },
];

function resolvePath(target) {
  return path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
}

function clip(text, max = 12000) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [clipped ${text.length - max} chars]`;
}

function askApproval(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(false);
      return;
    }

    process.stdout.write(`  ${acid("?")} ${question} ${dim("[y/N]")} `);
    const stdin = process.stdin;
    const wasRaw = Boolean(stdin.isRaw);
    stdin.setRawMode?.(true);
    stdin.resume();

    const finish = (answer) => {
      stdin.off("data", onData);
      stdin.setRawMode?.(wasRaw);
      stdin.pause();
      process.stdout.write("\n");
      resolve(answer);
    };

    const onData = (buffer) => {
      const text = buffer.toString("utf8");
      if (text === "\u0003") {
        state.abort?.abort();
        finish(false);
        return;
      }
      if (text === "\r" || text === "\n") return finish(false);
      const key = text.toLowerCase();
      if (key === "y") finish(true);
      else if (key === "n" || key === "\u001b") finish(false);
    };

    stdin.on("data", onData);
  });
}

async function approve(question) {
  if (state.autoApprove) {
    console.log(`  ${acid("✓")} ${dim("auto-approved")}`);
    return true;
  }
  return askApproval(question);
}

function runShell(command) {
  return new Promise((resolve) => {
    const limit = 400000;
    const timeoutMs = Number(process.env.APEX_CMD_TIMEOUT) || 180000;
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;

    let child;
    try {
      child = spawn(command, {
        shell: true,
        cwd: process.cwd(),
        env: process.env,
        windowsHide: true,
      });
    } catch (error) {
      resolve({ code: 1, stdout: "", stderr: error.message, ms: 0, timedOut, truncated });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const collect = (chunk, which) => {
      const text = chunk.toString();
      if (which === "out") {
        if (stdout.length + text.length > limit) truncated = true;
        stdout += text;
      } else {
        if (stderr.length + text.length > limit) truncated = true;
        stderr += text;
      }
    };

    child.stdout?.on("data", (chunk) => collect(chunk, "out"));
    child.stderr?.on("data", (chunk) => collect(chunk, "err"));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: error.message, ms: Date.now() - started, timedOut, truncated });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
        ms: Date.now() - started,
        timedOut,
        truncated,
      });
    });
  });
}

async function executeTool(name, rawArgs) {
  let args = rawArgs;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return { forModel: `ERROR: could not parse arguments as JSON.` };
    }
  }
  if (!args || typeof args !== "object") {
    return { forModel: "ERROR: missing arguments." };
  }

  try {
    switch (name) {
      case "list_dir": {
        const target = resolvePath(String(args.path ?? "."));
        const entries = fs.readdirSync(target, { withFileTypes: true });
        const lines = entries
          .slice(0, 400)
          .map((entry) => `${entry.isDirectory() ? "[dir] " : "      "}${entry.name}`);
        return {
          forModel: `Directory ${target}\n${lines.join("\n") || "(empty)"}`,
        };
      }

      case "read_file": {
        const target = resolvePath(String(args.path ?? ""));
        const stat = fs.statSync(target);
        if (stat.size > 2_000_000) {
          return { forModel: `ERROR: ${target} is ${stat.size} bytes. Read a smaller file.` };
        }
        const content = fs.readFileSync(target, "utf8");
        return {
          forModel: `File ${target} (${content.length} chars)\n---\n${clip(content)}`,
        };
      }

      case "write_file": {
        const target = resolvePath(String(args.path ?? ""));
        const content = String(args.content ?? "");
        const bytes = Buffer.byteLength(content, "utf8");
        const preview = content
          .split("\n")
          .slice(0, 24)
          .map((line) => `    │ ${line}`)
          .join("\n");
        console.log("");
        console.log(`  ${acid("→")} ${white("write_file")} ${dim(target)} ${faint(`${bytes} bytes`)}`);
        console.log(faint(preview + (content.split("\n").length > 24 ? "\n    │ …" : "")));
        if (!(await approve(`write ${target}?`))) {
          return { forModel: "DENIED: the user rejected this write. Do not retry it blindly." };
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, "utf8");
        console.log(`  ${acid("✓")} ${dim(`wrote ${bytes} bytes`)}`);
        return { forModel: `Wrote ${bytes} bytes to ${target}.` };
      }

      case "replace_in_file": {
        const target = resolvePath(String(args.path ?? ""));
        const oldText = String(args.old ?? "");
        const newText = String(args.new ?? "");
        if (!oldText) return { forModel: "ERROR: old text is empty." };
        const before = fs.readFileSync(target, "utf8");
        const occurrences = before.split(oldText).length - 1;
        if (occurrences === 0) {
          return { forModel: `ERROR: that exact text does not appear in ${target}.` };
        }
        console.log("");
        console.log(`  ${acid("→")} ${white("replace_in_file")} ${dim(target)} ${faint(`${occurrences} match(es)`)}`);
        console.log(faint(`    − ${clip(oldText, 120).replace(/\n/g, "\n    ")}`));
        console.log(faint(`    + ${clip(newText, 120).replace(/\n/g, "\n    ")}`));
        if (!(await approve(`edit ${target}?`))) {
          return { forModel: "DENIED: the user rejected this edit." };
        }
        fs.writeFileSync(target, before.split(oldText).join(newText), "utf8");
        console.log(`  ${acid("✓")} ${dim(`replaced ${occurrences} occurrence(s)`)}`);
        return { forModel: `Replaced ${occurrences} occurrence(s) in ${target}.` };
      }

      case "run_command": {
        const command = String(args.command ?? "").trim();
        if (!command) return { forModel: "ERROR: command is empty." };
        console.log("");
        console.log(`  ${acid("→")} ${white("run_command")} ${dim(command)}`);
        if (!(await approve(`run this command?`))) {
          return { forModel: "DENIED: the user rejected this command." };
        }
        const result = await runShell(command);
        const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
        const shown = output
          .split("\n")
          .slice(0, 28)
          .map((line) => `    │ ${line}`)
          .join("\n");
        if (shown) console.log(faint(shown));
        if (output.split("\n").length > 28) console.log(faint("    │ …"));
        console.log(
          `  ${result.code === 0 ? acid("✓") : red("✗")} ${dim(
            `exit ${result.code} · ${(result.ms / 1000).toFixed(1)}s${
              result.timedOut ? " · TIMEOUT" : ""
            }${result.truncated ? " · TRUNCATED" : ""}`,
          )}`,
        );
        return {
          forModel: clip(
            `exit code: ${result.code}\nstdout:\n${result.stdout || "(empty)"}\nstderr:\n${result.stderr || "(empty)"}${
              result.timedOut ? "\nTIMEOUT: the command was killed." : ""
            }`,
            14000,
          ),
        };
      }

      default:
        return { forModel: `ERROR: unknown tool ${name}.` };
    }
  } catch (error) {
    return { forModel: `ERROR: ${error.message}` };
  }
}

async function streamAgentTurn(messages, signal) {
  const res = await fetch(`${endpointBase()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: config.model,
      stream: true,
      messages,
      tools: TOOL_SCHEMAS,
      options: {
        temperature: Number(config.temperature) || 0.85,
        num_ctx: 8192,
      },
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Local model error ${res.status}. ${detail.slice(0, 240)}`.trim());
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const toolCalls = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const json = JSON.parse(line);
      if (json.error) throw new Error(json.error);

      const token = json.message?.content;
      if (token) {
        content += token;
        process.stdout.write(token);
      }

      const incoming = json.message?.tool_calls;
      if (Array.isArray(incoming)) {
        for (const call of incoming) {
          const index = Number.isInteger(call.index) ? call.index : toolCalls.length;
          const current = toolCalls[index] || {
            function: { name: "", arguments: {} },
          };
          if (call.function?.name) current.function.name = call.function.name;
          let args = call.function?.arguments;
          if (typeof args === "string") {
            try {
              args = JSON.parse(args);
            } catch {
              args = {};
            }
          }
          if (args && typeof args === "object") {
            current.function.arguments = {
              ...current.function.arguments,
              ...args,
            };
          }
          toolCalls[index] = current;
        }
      }
    }
  }

  if (content) process.stdout.write("\n");
  return { content, toolCalls: toolCalls.filter(Boolean) };
}

async function runAgent(task) {
  if (state.streaming) {
    console.log(dim("  a stream is already active — wait or press Ctrl+C"));
    return;
  }
  if (state.demo) {
    console.log(dim("  agent mode needs a live model. Run without --demo."));
    return;
  }
  if (!state.autoApprove && !process.stdin.isTTY) {
    console.error(
      red("  agent mode needs an interactive terminal to approve actions, or pass --yes."),
    );
    process.exitCode = 1;
    return;
  }

  const controller = new AbortController();
  state.abort = controller;
  state.streaming = true;

  console.log("");
  console.log(
    `  ${acid("APEX")} ${dim("agent")} ${faint("→")} ${white(config.model)} ${faint(`/ ${endpointBase()}`)}`,
  );
  console.log(faint("  " + "─".repeat(58)));
  console.log(`  ${dim("task")} ${white(task)}`);
  console.log(
    `  ${dim("mode")} ${state.autoApprove ? acid("AUTO-APPROVE") : white("ASK BEFORE WRITE / RUN")}`,
  );
  console.log(faint(`  cwd  ${process.cwd()}`));

  const messages = [
    { role: "system", content: `${config.systemPrompt}\n\n${AGENT_PROMPT}` },
    { role: "user", content: task },
  ];

  let step = 0;
  const maxSteps = 24;

  try {
    while (step < maxSteps) {
      step += 1;
      console.log("");
      console.log(`${faint(`  [${String(step).padStart(2, "0")}]`)} ${dim("thinking")}`);

      const { content, toolCalls } = await streamAgentTurn(
        messages,
        controller.signal,
      );

      if (!toolCalls.length) {
        if (!content.trim()) console.log(dim("  [no output]"));
        break;
      }

      messages.push({
        role: "assistant",
        content: content || "",
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        const name = call.function?.name || "unknown";
        console.log(
          `${faint(`  [${String(step).padStart(2, "0")}]`)} ${acid("tool")} ${white(name)}`,
        );
        const result = await executeTool(name, call.function?.arguments);
        console.log(
          faint(`  [${String(step).padStart(2, "0")}]`),
          dim("result"),
          white(clip(result.forModel.split("\n")[0], 110)),
        );
        messages.push({
          role: "tool",
          tool_name: name,
          content: result.forModel,
        });

        if (controller.signal.aborted) break;
      }

      if (controller.signal.aborted) {
        console.log(dim("  [aborted]"));
        break;
      }
    }

    if (step >= maxSteps) {
      console.log(dim(`  step limit (${maxSteps}) reached — stopping the agent.`));
    }
  } catch (error) {
    if (controller.signal.aborted) console.log(dim("  [aborted]"));
    else printLinkError(error);
  } finally {
    state.streaming = false;
    state.abort = null;
  }
}

function showConfig() {
  console.log("");
  console.log(`  ${dim("path")} ${white(CONFIG_PATH)}`);
  console.log("");
  const printable = {
    ...config,
    systemPrompt:
      config.systemPrompt.length > 160
        ? `${config.systemPrompt.slice(0, 157)}...`
        : config.systemPrompt,
  };
  console.log(
    JSON.stringify(printable, null, 2)
      .split("\n")
      .map((line) => `  ${dim(line)}`)
      .join("\n"),
  );
  console.log("");
  console.log(`  ${dim("Edit the file directly, or use /model /prompt /temp in the REPL.")}`);
  console.log("");
}

function handleConfigCommand(args) {
  const setIndex = args.indexOf("--set");
  if (setIndex !== -1) {
    const assignment = args[setIndex + 1];
    if (!assignment || !assignment.includes("=")) {
      console.error(red("  Usage: apex config --set model=qwen2.5:3b"));
      process.exitCode = 1;
      return;
    }
    const split = assignment.indexOf("=");
    const key = assignment.slice(0, split);
    const value = assignment.slice(split + 1);
    if (!["endpoint", "model", "systemPrompt", "temperature"].includes(key)) {
      console.error(red(`  Unknown key "${key}". Use endpoint, model, systemPrompt, temperature.`));
      process.exitCode = 1;
      return;
    }
    config[key] = key === "temperature" ? Number(value) : value;
    if (saveConfig(config)) {
      console.log(`  ${acid("saved")} ${dim(`${key} →`)} ${white(String(config[key]))}`);
    }
    return;
  }
  showConfig();
}

function replCommand(line, rl) {
  const [command, ...rest] = line.split(/\s+/);
  const arg = rest.join(" ").trim();

  switch (command.toLowerCase()) {
    case "/help":
      console.log("");
      console.log(
        `  ${acid("/model")} <name>   switch model      ${acid("/prompt")} <text>  replace system prompt`,
      );
      console.log(
        `  ${acid("/temp")} <n>       temperature       ${acid("/models")}        list local models`,
      );
      console.log(
        `  ${acid("/config")}         show config       ${acid("/clear")}         wipe context`,
      );
      console.log(
        `  ${acid("/demo")}           offline demo      ${acid("/live")}          use local model`,
      );
      console.log(`  ${acid("/do")} <task>     take control for one task`);
      console.log(`  ${acid("/quit")}           exit`);
      console.log("");
      break;
    case "/quit":
    case "/exit":
      rl.close();
      break;
    case "/clear":
      state.history = [];
      console.log(dim("  context cleared"));
      break;
    case "/demo":
      state.demo = true;
      console.log(dim("  demo link active — no model attached"));
      break;
    case "/live":
      state.demo = false;
      console.log(dim(`  live link → ${config.model} / ${endpointBase()}`));
      break;
    case "/model":
      if (!arg) {
        console.log(dim(`  active: ${config.model}`));
      } else {
        config.model = arg;
        saveConfig(config);
        state.demo = false;
        console.log(dim(`  model → ${config.model}`));
      }
      break;
    case "/prompt":
      if (!arg) {
        console.log("");
        console.log(`  ${dim(config.systemPrompt)}`);
        console.log("");
      } else {
        config.systemPrompt = arg;
        saveConfig(config);
        console.log(dim("  system prompt replaced"));
      }
      break;
    case "/temp": {
      const value = Number(arg);
      if (!Number.isFinite(value)) {
        console.log(dim("  usage: /temp 0.8"));
        break;
      }
      config.temperature = value;
      saveConfig(config);
      console.log(dim(`  temperature → ${value}`));
      break;
    }
    case "/models":
      void listModels().then(printModels);
      break;
    case "/config":
      showConfig();
      break;
    default:
      console.log(dim(`  unknown command ${command} — try /help`));
  }
}

function startRepl() {
  header();
  console.log(`  ${dim("model")}    ${white(config.model)}`);
  console.log(`  ${dim("endpoint")} ${white(endpointBase())}`);
  console.log(`  ${dim("prompt")}   ${faint("yours — edit ~/.apex/config.json")}`);
  console.log(`  ${dim("cost")}     ${acid("0.00")} ${faint("/ no meter")}`);
  console.log("");
  console.log(`  ${dim("Type /help for commands. Ctrl+C to abort a stream or exit.")}`);
  console.log("");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 100,
    prompt: `${acid("apex")} ${faint("›")} `,
  });

  rl.prompt();

  rl.on("line", (line) => {
    const value = line.trim();
    if (!value) {
      rl.prompt();
      return;
    }
    if (value.startsWith("/do ") || value === "/do") {
      const task = value.slice(3).trim();
      if (!task) {
        console.log(dim("  usage: /do <task>"));
        rl.prompt();
        return;
      }
      rl.pause();
      void runAgent(task).finally(() => {
        if (!rl.closed) {
          rl.resume();
          rl.prompt();
        }
      });
      return;
    }

    if (value.startsWith("/")) {
      replCommand(value, rl);
      rl.prompt();
      return;
    }

    rl.pause();
    ask(value).finally(() => {
      if (!rl.closed) {
        rl.resume();
        rl.prompt();
      }
    });
  });

  rl.on("close", () => {
    state.abort?.abort();
    console.log("");
    console.log(faint("  apex out."));
    console.log("");
    process.exit(0);
  });

  process.on("SIGINT", () => {
    if (state.streaming) {
      state.abort?.abort();
      return;
    }
    rl.close();
  });
}

async function readStdin() {
  if (process.stdin.isTTY) return "";

  // Some shells hand us a non-TTY stdin that never sends EOF. Resolve on end
  // or once the pipe goes quiet, so a prompt argument can never hang here.
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    let idle = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (idle) clearTimeout(idle);
      process.stdin.off("data", onData);
      process.stdin.off("end", finish);
      process.stdin.off("close", finish);
      process.stdin.off("error", finish);
      process.stdin.pause();
      resolve(Buffer.concat(chunks).toString("utf8").trim());
    };

    const onData = (chunk) => {
      chunks.push(Buffer.from(chunk));
      if (idle) clearTimeout(idle);
      idle = setTimeout(finish, 350);
    };

    process.stdin.on("data", onData);
    process.stdin.on("end", finish);
    process.stdin.on("close", finish);
    process.stdin.on("error", finish);
    idle = setTimeout(finish, 300);
    process.stdin.resume();
  });
}

async function main() {
  let argv = process.argv.slice(2);
  state.autoApprove = process.env.APEX_YES === "1";

  if (argv.includes("--help") || argv.includes("-h")) {
    usage();
    return;
  }

  if (argv.includes("--version") || argv.includes("-v")) {
    console.log(`apex ${VERSION}`);
    return;
  }

  if (argv[0] === "config") {
    handleConfigCommand(argv.slice(1));
    return;
  }

  if (argv[0] === "models") {
    const models = await listModels();
    printModels(models);
    return;
  }

  const agentMode = argv[0] === "do";
  if (agentMode) argv = argv.slice(1);

  let prompt = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--model") {
      config.model = argv[++i] || config.model;
    } else if (arg === "--endpoint") {
      config.endpoint = argv[++i] || config.endpoint;
    } else if (arg === "--system") {
      config.systemPrompt = argv[++i] || config.systemPrompt;
    } else if (arg === "--temp") {
      config.temperature = Number(argv[++i]) || config.temperature;
    } else if (arg === "--demo") {
      state.demo = true;
    } else if (arg === "--yes" || arg === "-y") {
      state.autoApprove = true;
    } else if (arg === "--no-color") {
      // handled at import time
    } else {
      prompt += `${prompt ? " " : ""}${arg}`;
    }
  }

  const piped = await readStdin();
  if (piped) {
    prompt = prompt ? `${prompt}\n\n---\n\n${piped}` : piped;
  }

  if (agentMode) {
    if (!prompt.trim()) {
      console.error(red("  Usage: apex do \"task\" [--yes]"));
      process.exitCode = 1;
      return;
    }
    header();
    await runAgent(prompt.trim());
    return;
  }

  if (prompt.trim()) {
    header();
    await ask(prompt.trim());
    return;
  }

  if (!process.stdin.isTTY) {
    console.error(red("No prompt provided on stdin."));
    process.exitCode = 1;
    return;
  }

  startRepl();
}

main().catch((error) => {
  console.error(red(`  fatal: ${error.message}`));
  process.exitCode = 1;
});
