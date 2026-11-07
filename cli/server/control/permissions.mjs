export const CAPABILITIES = [
  ["screen", "Screen observation"],
  ["accessibility", "Windows accessibility tree"],
  ["mouse", "Mouse control"],
  ["keyboard", "Keyboard control"],
  ["apps", "Application control"],
  ["browser", "Browser tabs"],
  ["files", "Files and documents"],
  ["terminal", "Terminal commands"],
];

export const ACTIONS = {
  screenshot: { capability: "screen", risk: "low" },
  ocr_screen: { capability: "screen", risk: "low" },
  list_windows: { capability: "accessibility", risk: "low" },
  focus_window: { capability: "apps", risk: "medium" },
  launch_app: { capability: "apps", risk: "medium" },
  move_mouse: { capability: "mouse", risk: "medium" },
  click: { capability: "mouse", risk: "medium" },
  drag: { capability: "mouse", risk: "medium" },
  scroll: { capability: "mouse", risk: "low" },
  type_text: { capability: "keyboard", risk: "high" },
  press_keys: { capability: "keyboard", risk: "high" },
  clipboard_get: { capability: "keyboard", risk: "medium" },
  clipboard_set: { capability: "keyboard", risk: "medium" },
  browser_tabs: { capability: "browser", risk: "low" },
  browser_open: { capability: "browser", risk: "medium" },
  browser_activate: { capability: "browser", risk: "low" },
  browser_close: { capability: "browser", risk: "medium" },
  browser_navigate: { capability: "browser", risk: "medium" },
  browser_click: { capability: "browser", risk: "medium" },
  browser_type: { capability: "browser", risk: "medium" },
  browser_press: { capability: "browser", risk: "medium" },
  browser_eval: { capability: "browser", risk: "high" },
  file_list: { capability: "files", risk: "low" },
  file_read: { capability: "files", risk: "low" },
  file_write: { capability: "files", risk: "high" },
  file_replace: { capability: "files", risk: "high" },
  file_mkdir: { capability: "files", risk: "medium" },
  run_command: { capability: "terminal", risk: "high" },
  done: { capability: null, risk: "none" },
};

const ACTION_DOCS = {
  screenshot: "screenshot {} — capture the screen",
  ocr_screen: "ocr_screen {} — read all visible screen text with Windows OCR; each line carries its screen coordinates",
  list_windows: "list_windows {} — list desktop windows",
  focus_window: "focus_window {pid} — bring an application forward",
  launch_app: "launch_app {app, args?, cwd?} — start an application",
  move_mouse: "move_mouse {x,y} — move the pointer",
  click: "click {x,y,button?,count?} — click at screen coordinates",
  drag: "drag {fromX,fromY,toX,toY} — drag with the left button",
  scroll: "scroll {x,y,amount} — scroll at a point; negative scrolls down",
  type_text: "type_text {text} — type into the focused control",
  press_keys: 'press_keys {keys} — e.g. "ctrl+s", "enter", "alt+tab"',
  clipboard_get: "clipboard_get {} — read the clipboard text",
  clipboard_set: "clipboard_set {text} — stage text on the clipboard, then paste it with ctrl+v for fast reliable input",
  focus_window: "focus_window {pid} — bring an application forward",
  launch_app: "launch_app {app, args?, cwd?} — start an application",
  move_mouse: "move_mouse {x,y} — move the pointer",
  click: "click {x,y,button?,count?} — click at screen coordinates",
  drag: "drag {fromX,fromY,toX,toY} — drag with the left button",
  scroll: "scroll {x,y,amount} — scroll at a point; negative scrolls down",
  type_text: "type_text {text} — type into the focused control",
  press_keys: 'press_keys {keys} — e.g. "ctrl+s", "enter", "alt+tab"',
  browser_tabs: "browser_tabs {} — list open browser tabs",
  browser_open: "browser_open {url} — open a tab",
  browser_activate: "browser_activate {id} — focus a tab",
  browser_close: "browser_close {id} — close a tab",
  browser_navigate: "browser_navigate {id,url} — navigate a tab",
  browser_click: "browser_click {id,selector?|x?,y?} — click in a tab",
  browser_type: "browser_type {id,text,selector?} — type into a tab",
  browser_press: "browser_press {id,keys} — enter/tab/escape in a tab",
  browser_eval: "browser_eval {id,expression} — run page JavaScript (high risk)",
  file_list: "file_list {path} — list a directory",
  file_read: "file_read {path} — read a UTF-8 file",
  file_write: "file_write {path,content,append?} — create or overwrite a file",
  file_replace: "file_replace {path,old,new,all?} — edit a file",
  file_mkdir: "file_mkdir {path} — create a directory",
  run_command: "run_command {command,cwd?} — run a terminal command",
  done: "done {summary} — finish; summary states what was verified",
};

export const ACTION_HELP = `Available actions (one per turn):
${Object.values(ACTION_DOCS).join("\n")}`;

export function actionHelp(permissions = {}) {
  const lines = Object.entries(ACTION_DOCS)
    .filter(([name]) => {
      const meta = ACTIONS[name];
      return !meta.capability || Boolean(permissions[meta.capability]);
    })
    .map(([, line]) => line);
  if (!lines.some((line) => line.startsWith("done "))) {
    lines.push(ACTION_DOCS.done);
  }
  return `Available actions (one per turn):\n${lines.join("\n")}`;
}

export function normalizePermissions(input = {}) {
  const permissions = {};
  for (const [key] of CAPABILITIES) permissions[key] = input[key] !== false;
  return permissions;
}

export function checkAction(name, permissions, { autoApprove = false } = {}) {
  const meta = ACTIONS[name];
  if (!meta) {
    return {
      allowed: false,
      needsApproval: false,
      risk: "none",
      reason: `Unknown action: ${name}`,
    };
  }
  if (meta.capability && !permissions[meta.capability]) {
    return {
      allowed: false,
      needsApproval: false,
      risk: meta.risk,
      reason: `Capability "${meta.capability}" is not authorized for this session`,
    };
  }
  const needsApproval = meta.risk === "high" && !autoApprove;
  return {
    allowed: true,
    needsApproval,
    risk: meta.risk,
    reason: needsApproval ? "High-risk action requires approval" : "Authorized",
  };
}

export function publicPermissions() {
  return CAPABILITIES.map(([key, label]) => ({ key, label }));
}

export function describeAction(name, args = {}) {
  const clip = (value, max = 120) =>
    String(value ?? "").replace(/\s+/g, " ").slice(0, max);
  switch (name) {
    case "launch_app":
      return `launch ${clip(args.app)}`;
    case "focus_window":
      return `focus pid ${args.pid}`;
    case "click":
      return `click ${args.x},${args.y}${args.button === "right" ? " right" : ""}`;
    case "type_text":
      return `type "${clip(args.text, 80)}"`;
    case "press_keys":
      return `press ${clip(args.keys, 40)}`;
    case "browser_open":
    case "browser_navigate":
      return `browser ${clip(args.url, 100)}`;
    case "browser_click":
      return `browser click ${clip(args.selector || `${args.x},${args.y}`, 80)}`;
    case "browser_type":
      return `browser type "${clip(args.text, 70)}"`;
    case "file_write":
      return `write ${clip(args.path)}`;
    case "file_replace":
      return `edit ${clip(args.path)}`;
    case "file_read":
      return `read ${clip(args.path)}`;
    case "run_command":
      return `run "${clip(args.command, 100)}"`;
    case "done":
      return `complete: ${clip(args.summary, 100)}`;
    default:
      return name.replace(/_/g, " ");
  }
}
