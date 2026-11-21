import { listWindows, screenInfo } from "./desktop.mjs";
import { ACTIONS } from "./permissions.mjs";
import { apexUrl } from "./actions.mjs";
import { addNote, search as searchMemory } from "./memory.mjs";
import { readProjectFile, searchProject } from "./project.mjs";
import { look } from "./copilot.mjs";
import { listWorkflows, runWorkflow } from "./workflows.mjs";

/*
 * CYRUS DESKTOP — a deterministic command router over the control session.
 *
 * Speech is unreliable and small models are slow, so the common verbs are
 * parsed here instead of guessed by a model. Anything that cannot be parsed is
 * refused with a hint rather than silently doing something else.
 *
 * Every action still runs through ControlSession.manual(), which enforces the
 * armed capabilities and writes to the audit log. High-risk actions return
 * `needsApproval` first; the caller repeats the request with confirm: true.
 */

const APPS = {
  notepad: "notepad.exe",
  notes: "notepad.exe",
  calculator: "calc.exe",
  calc: "calc.exe",
  paint: "mspaint.exe",
  explorer: "explorer.exe",
  files: "explorer.exe",
  "file explorer": "explorer.exe",
  cmd: "cmd.exe",
  "command prompt": "cmd.exe",
  terminal: "wt.exe",
  powershell: "powershell.exe",
  settings: "ms-settings:",
  "task manager": "taskmgr.exe",
  taskmgr: "taskmgr.exe",
  chrome: "chrome.exe",
  "google chrome": "chrome.exe",
  edge: "msedge.exe",
  firefox: "firefox.exe",
  code: "code",
  vscode: "code",
  "vs code": "code",
  spotify: "spotify:",
  camera: "microsoft.windows.camera:",
  photos: "ms-photos:",
  store: "ms-windows-store:",
  word: "winword.exe",
  excel: "excel.exe",
  powerpoint: "powerpnt.exe",
  slack: "slack.exe",
  discord: "discord.exe",
  steam: "steam.exe",
};

const KEYS = {
  control: "ctrl",
  ctrl: "ctrl",
  alt: "alt",
  option: "alt",
  shift: "shift",
  cmd: "win",
  command: "win",
  win: "win",
  windows: "win",
  enter: "enter",
  return: "enter",
  esc: "escape",
  escape: "escape",
  tab: "tab",
  space: "space",
  spacebar: "space",
  backspace: "backspace",
  delete: "delete",
  del: "delete",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  home: "home",
  end: "end",
  pageup: "pageup",
  pagedown: "pagedown",
  insert: "insert",
  printscreen: "printscreen",
  capslock: "capslock",
};

export const CYRUS_HELP = [
  "open <app> — launch Notepad, Chrome, Settings, Terminal…",
  "open <url> or search for <words>",
  "show the garage — jump to an APEX section in the browser",
  "switch to <window> — focus an open window",
  "type <text> — type into the focused window (asks first)",
  "press <keys> — e.g. press ctrl+s, press enter",
  "scroll up / scroll down [n]",
  "click — click the centre of the screen",
  "screenshot / read the screen / look at my screen",
  "what windows are open",
  "where is <feature> — search the APEX project",
  "read file <path> — read a project file",
  "remember that <fact> — save a memory note",
  "what do you remember about <topic>",
  "run workflow <name> — preview and run a workflow (asks first)",
  "run <command> — shell command (asks first)",
  "close <app>, lock the screen, shut down, restart",
];

function cleanApp(raw) {
  const value = String(raw)
    .toLowerCase()
    .replace(/^(the|my)\s+/, "")
    .replace(/\s+(app|application|window|program)$/, "")
    .trim();
  return APPS[value] || value;
}

function appName(raw) {
  return String(raw)
    .toLowerCase()
    .replace(/^(the|my)\s+/, "")
    .replace(/\s+(app|application|window|program)$/, "")
    .trim();
}

function normalizeChord(raw) {
  const text = String(raw)
    .toLowerCase()
    .replace(/\bpage\s+up\b/g, "pageup")
    .replace(/\bpage\s+down\b/g, "pagedown")
    .replace(/\bcaps\s+lock\b/g, "capslock")
    .replace(/\bprint\s+screen\b/g, "printscreen");
  const parts = text
    .split(/\s*(?:\+|,|\band\b)\s*/)
    .flatMap((part) => part.trim().split(/\s+/))
    .filter(Boolean);
  if (!parts.length) return "";
  return parts.map((part) => KEYS[part] || part).join("+");
}

function looksLikeUrl(value) {
  const text = String(value).trim();
  return /^(https?:\/\/|www\.)\S+$/i.test(text) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(text);
}

function withScheme(value) {
  const text = String(value).trim();
  return /^https?:\/\//i.test(text) ? text : `https://${text.replace(/^\/+/, "")}`;
}

export function parseCyrusCommand(input) {
  const text = String(input ?? "").trim();
  if (!text) {
    return { kind: "unknown", speech: "I did not catch a command. Try: open Notepad." };
  }

  if (/^(help|what can you do|commands|what commands)\b/i.test(text)) {
    return { kind: "answer", speech: CYRUS_HELP.join(" · ") };
  }

  if (/^(what('s| is) the )?(time|date)\b/i.test(text) || /^what time is it/i.test(text)) {
    const now = new Date();
    return {
      kind: "answer",
      speech: `${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} on ${now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}.`,
    };
  }

  const apex = text.match(
    /^(?:open|show|go to|jump to)\s+(?:the\s+)?(?:apex(?:\s+section)?\s+)?(garage|mesh|pit\s?wall|grid|machine|manifesto|command(?:\s+center)?|workflows?|install|ignition|hero)\b/i,
  );
  if (apex) {
    const section = apex[1].replace(/\s+/g, " ");
    return {
      kind: "action",
      action: "browser_open",
      args: { url: apexUrl(section) },
      speech: `Opening ${section} in APEX.`,
    };
  }

  const findInProject = text.match(
    /^(?:search|find|look\s+for)\s+(?:the\s+|this\s+)?(?:project|code|repo|repository|files?)\s+(?:for\s+)?(.+)$/i,
  );
  if (findInProject) {
    return { kind: "tool", tool: "project_search", args: { query: findInProject[1].trim() } };
  }

  const whereIs = text.match(/^where\s+(?:is|are)\s+(.+?)(?:\s+(?:in|defined|implemented)\b.*)?$/i);
  if (whereIs) {
    return { kind: "tool", tool: "project_search", args: { query: whereIs[1].trim() } };
  }

  const readFile = text.match(/^(?:read|open)\s+(?:the\s+)?file\s+(.+)$/i);
  if (readFile) {
    return { kind: "tool", tool: "file_read", args: { path: readFile[1].trim() } };
  }

  const remember = text.match(/^(?:remember|note|keep in mind)(?:\s+that)?\s+([\s\S]+)$/i);
  if (remember) {
    return { kind: "tool", tool: "memory_add", args: { text: remember[1].trim() } };
  }

  const recall = text.match(/^what do you (?:remember|know)(?: about)?\s*(.*)$/i);
  if (recall) {
    return { kind: "tool", tool: "memory_search", args: { query: recall[1].trim() } };
  }

  const workflow = text.match(/^(?:run|start|launch)\s+(?:the\s+)?workflow\s+(.+)$/i);
  if (workflow) {
    return { kind: "tool", tool: "workflow", args: { name: workflow[1].trim() } };
  }

  if (
    /^(?:look at|describe|watch|see)\s+(?:my|the)\s+screen$/i.test(text) ||
    /^(?:what do you see(?: on (?:my|the) screen)?|what'?s on (?:my|the) screen)$/i.test(text)
  ) {
    return { kind: "tool", tool: "copilot", args: { question: text } };
  }

  if (/^(screenshot|screen shot|take a screenshot|capture (the )?screen)\b/i.test(text)) {
    return { kind: "action", action: "screenshot", args: {}, speech: "Screenshot captured." };
  }

  if (/^(read (the )?screen|ocr)\b/i.test(text)) {
    return { kind: "action", action: "ocr_screen", args: {}, speech: "Reading the screen." };
  }

  if (/(what|which) windows|list windows|what('s| is) open/i.test(text)) {
    return { kind: "action", action: "list_windows", args: {}, speech: "Listing windows." };
  }

  const search = text.match(/^(?:search(?: the web)? for|google|look up)\s+(.+)$/i);
  if (search) {
    const query = search[1].trim();
    return {
      kind: "action",
      action: "browser_open",
      args: { url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}` },
      speech: `Searching for ${query}.`,
    };
  }

  const focus = text.match(/^(?:switch to|focus(?: on)?|bring up)\s+(.+)$/i);
  if (focus) {
    return {
      kind: "action",
      action: "focus_window",
      args: { query: focus[1].trim().toLowerCase() },
      speech: `Focusing ${focus[1].trim()}.`,
    };
  }

  const open = text.match(/^(?:open|launch|start|go to|visit)\s+(.+)$/i);
  if (open) {
    const target = open[1].trim();
    if (looksLikeUrl(target)) {
      return {
        kind: "action",
        action: "browser_open",
        args: { url: withScheme(target) },
        speech: `Opening ${target}.`,
      };
    }
    return {
      kind: "action",
      action: "launch_app",
      args: { app: cleanApp(target) },
      speech: `Opening ${appName(target)}.`,
    };
  }

  const typed = text.match(/^(?:type|write|enter text|type out)\s+([\s\S]+)$/i);
  if (typed) {
    const value = typed[1];
    return {
      kind: "action",
      action: "type_text",
      args: { text: value },
      speech: `Type ${value.length} character${value.length === 1 ? "" : "s"} into the focused window?`,
    };
  }

  const press = text.match(/^(?:press|hit|send)\s+(.+)$/i);
  if (press) {
    const keys = normalizeChord(press[1]);
    return {
      kind: "action",
      action: "press_keys",
      args: { keys },
      speech: `Press ${keys.replace(/\+/g, " + ")}?`,
    };
  }

  const scroll = text.match(/^scroll(?:\s+(up|down))?(?:\s+(?:by\s+)?(\d{1,2}))?$/i);
  if (scroll) {
    const up = (scroll[1] || "down").toLowerCase() === "up";
    const count = Math.min(20, Math.max(1, Number(scroll[2]) || 3));
    return {
      kind: "action",
      action: "scroll",
      args: { amount: (up ? 1 : -1) * count },
      speech: `Scrolling ${up ? "up" : "down"}.`,
    };
  }

  if (/^(click|left click)$/i.test(text)) {
    return { kind: "action", action: "click", args: {}, speech: "Clicking the centre of the screen." };
  }

  const run = text.match(/^(?:run|execute|shell)\s+([\s\S]+)$/i);
  if (run) {
    return {
      kind: "action",
      action: "run_command",
      args: { command: run[1].trim() },
      speech: `Run "${run[1].trim()}"?`,
    };
  }

  const close = text.match(/^(?:close|quit|kill)\s+(.+)$/i);
  if (close) {
    const name = appName(close[1]);
    const exe = APPS[name] && APPS[name].endsWith(".exe") ? APPS[name] : `${name}.exe`;
    return {
      kind: "action",
      action: "run_command",
      args: { command: `taskkill /IM "${exe}" /F` },
      speech: `Close ${name}?`,
    };
  }

  if (/^lock( the)?( screen| laptop| pc)?$/i.test(text)) {
    return {
      kind: "action",
      action: "run_command",
      args: { command: "rundll32.exe user32.dll,LockWorkStation" },
      speech: "Lock the screen?",
    };
  }

  if (/^(shut ?down|power off|turn off)( the)?( laptop| pc| computer)?$/i.test(text)) {
    return {
      kind: "action",
      action: "run_command",
      args: { command: "shutdown /s /t 15" },
      speech: "Shut down in 15 seconds? Run 'shutdown /a' to abort.",
    };
  }

  if (/^(restart|reboot)( the)?( laptop| pc| computer)?$/i.test(text)) {
    return {
      kind: "action",
      action: "run_command",
      args: { command: "shutdown /r /t 15" },
      speech: "Restart in 15 seconds? Run 'shutdown /a' to abort.",
    };
  }

  return {
    kind: "unknown",
    speech: `I did not map "${text}" to a desktop action. Try: open Notepad, switch to Chrome, screenshot, or run ipconfig.`,
  };
}

async function resolveFocus(query) {
  const windows = await listWindows();
  const wanted = String(query).toLowerCase();
  const match =
    windows.find((win) => String(win.title || "").toLowerCase().includes(wanted)) ||
    windows.find((win) => String(win.process || "").toLowerCase().includes(wanted));
  return match || null;
}

async function runToolPlan(plan, options) {
  const args = plan.args ?? {};
  switch (plan.tool) {
    case "project_search": {
      const results = await searchProject(args.query, 5);
      if (!results.length) {
        return { ok: false, kind: "answer", speech: `I found nothing in the project for ${args.query}.` };
      }
      const top = results.slice(0, 3).map((hit) => `${hit.file}:${hit.start}`).join(", ");
      return {
        ok: true,
        kind: "answer",
        speech: `Best matches: ${top}.`,
        results,
      };
    }
    case "file_read": {
      const file = readProjectFile(args.path, { maxChars: 1200 });
      return {
        ok: true,
        kind: "answer",
        speech: `${file.path}: ${file.text.replace(/\s+/g, " ").slice(0, 280)}`,
        file,
      };
    }
    case "memory_add": {
      const note = addNote({ text: args.text, source: "cyrus" });
      return { ok: true, kind: "action", speech: "Saved. I will remember that.", note };
    }
    case "memory_search": {
      const notes = searchMemory(args.query, 5);
      if (!notes.length) {
        return { ok: false, kind: "answer", speech: "I have nothing saved about that yet." };
      }
      return {
        ok: true,
        kind: "answer",
        speech: notes.map((note) => note.text).join(" · ").slice(0, 600),
        notes,
      };
    }
    case "copilot": {
      const seen = await look({ question: args.question, fresh: true });
      return { ok: true, kind: "answer", speech: seen.answer, seen };
    }
    case "workflow": {
      const workflows = listWorkflows();
      const wanted = String(args.name || "").toLowerCase();
      const match =
        workflows.find((entry) => entry.id === wanted) ??
        workflows.find((entry) => entry.name.toLowerCase().includes(wanted)) ??
        workflows.find((entry) => wanted.includes(entry.name.toLowerCase()));
      if (!match) {
        return {
          ok: false,
          kind: "answer",
          speech: `No workflow matches ${args.name}. Available: ${workflows.map((entry) => entry.name).join(", ")}.`,
        };
      }
      if (options.confirm !== true) {
        return {
          ok: false,
          kind: "approval",
          needsApproval: true,
          action: "workflow",
          args: { workflow: match.id, input: args.name },
          risk: "high",
          speech: `Run ${match.name}? It may read the screen and save memory notes.`,
        };
      }
      const result = await runWorkflow({
        id: match.id,
        input: String(args.input || ""),
        confirm: true,
      });
      return {
        ok: result.ok !== false,
        kind: "action",
        speech: result.ok === false
          ? `${match.name} failed at step ${result.failedAt}.`
          : String(result.answer || "Workflow complete.").slice(0, 800),
        workflow: result,
      };
    }
    default:
      return { ok: false, kind: "unknown", speech: "That action is not available." };
  }
}

export async function runCyrusCommand(session, input, options = {}) {
  const text = String(input ?? "").trim();
  const plan = parseCyrusCommand(text);

  if (plan.kind === "answer") return { ok: true, kind: "answer", speech: plan.speech };
  if (plan.kind === "unknown") return { ok: false, kind: "unknown", speech: plan.speech };
  if (plan.kind === "tool") {
    try {
      return await runToolPlan(plan, options);
    } catch (error) {
      return { ok: false, kind: "error", speech: `That failed: ${error.message}` };
    }
  }
  if (plan.kind !== "action") return { ok: false, kind: "unknown", speech: "I did not understand that." };

  let args = { ...plan.args };

  try {
    if (plan.action === "focus_window") {
      const target = await resolveFocus(args.query);
      if (!target) {
        return {
          ok: false,
          kind: "error",
          speech: `No open window matches ${args.query}.`,
        };
      }
      args = { pid: target.pid };
    }

    if (plan.action === "scroll" && (args.x === undefined || args.y === undefined)) {
      const screen = await screenInfo().catch(() => null);
      const width = screen?.w ?? screen?.width ?? 1280;
      const height = screen?.h ?? screen?.height ?? 800;
      args = { ...args, x: Math.round(width / 2), y: Math.round(height / 2) };
    }

    if (plan.action === "click" && (args.x === undefined || args.y === undefined)) {
      const screen = await screenInfo().catch(() => null);
      const width = screen?.w ?? screen?.width ?? 1280;
      const height = screen?.h ?? screen?.height ?? 800;
      args = { ...args, x: Math.round(width / 2), y: Math.round(height / 2), button: "left", count: 1 };
    }

    const risk = ACTIONS[plan.action]?.risk ?? "medium";
    if (risk === "high" && options.confirm !== true) {
      return {
        ok: false,
        kind: "approval",
        needsApproval: true,
        action: plan.action,
        args,
        risk,
        speech: plan.speech,
      };
    }

    await session.manual(plan.action, args);
    return {
      ok: true,
      kind: "action",
      action: plan.action,
      args,
      speech: plan.speech,
      detail: String(session.lastResult ?? "").slice(0, 400),
    };
  } catch (error) {
    return {
      ok: false,
      kind: "error",
      speech: `That failed: ${error.message}`,
    };
  }
}
