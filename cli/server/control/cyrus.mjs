import { listWindows, screenInfo } from "./desktop.mjs";
import { ACTIONS } from "./permissions.mjs";

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
  "switch to <window> — focus an open window",
  "type <text> — type into the focused window (asks first)",
  "press <keys> — e.g. press ctrl+s, press enter",
  "scroll up / scroll down [n]",
  "click — click the centre of the screen",
  "screenshot / read the screen",
  "what windows are open",
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
  const parts = String(raw)
    .toLowerCase()
    .split(/\s*(?:\+|,|\band\b)\s*/)
    .map((part) => part.trim())
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

  if (/^(screenshot|screen shot|take a screenshot|capture (the )?screen)\b/i.test(text)) {
    return { kind: "action", action: "screenshot", args: {}, speech: "Screenshot captured." };
  }

  if (/^(read (the )?screen|what('s| is) on (the |my )?screen|ocr)\b/i.test(text)) {
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

export async function runCyrusCommand(session, input, options = {}) {
  const text = String(input ?? "").trim();
  const plan = parseCyrusCommand(text);

  if (plan.kind === "answer") return { ok: true, kind: "answer", speech: plan.speech };
  if (plan.kind === "unknown") return { ok: false, kind: "unknown", speech: plan.speech };
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
