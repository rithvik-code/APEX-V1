import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  capture,
  click,
  clipboardGet,
  clipboardSet,
  describeObservation,
  drag,
  focusWindow,
  foreground,
  getLiveFrame,
  launchApp,
  listWindows,
  moveMouse,
  observe,
  ocrScreen,
  pressKeys,
  screenInfo,
  scroll,
  typeText,
} from "./desktop.mjs";
import {
  activateTab,
  click as browserClick,
  closeTab,
  ensureBrowser,
  evaluate as browserEvaluate,
  listTabs,
  navigate as browserNavigate,
  newTab,
  press as browserPress,
  type as browserType,
} from "./browser.mjs";
import { FileEngine } from "./files.mjs";
import {
  ACTIONS,
  CAPABILITIES,
  checkAction,
  describeAction,
  normalizePermissions,
} from "./permissions.mjs";
import {
  DEFAULT_ENDPOINT,
  DEFAULT_PLANNER,
  DEFAULT_VISION,
  describeScreen,
  planNext,
  summarizeMission,
} from "./planner.mjs";
import { killAllPowerShell } from "./powershell.mjs";
import { runCommand, stopCommands } from "./terminal.mjs";

const CONTROL_DIR = path.join(os.homedir(), ".apex", "control");
const ACTION_LOG = path.join(os.homedir(), ".apex", "actions.log");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function clip(value, max = 400) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function guard(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException("Control stopped", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Control stopped", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function previewArgs(args) {
  const preview = {};
  for (const [key, value] of Object.entries(args ?? {})) {
    preview[key] =
      typeof value === "string" ? clip(value, 240) : value;
  }
  return preview;
}

export class ControlSession {
  constructor({
    goal,
    permissions,
    autoApprove = false,
    vision = false,
    ocr = true,
    plannerModel = DEFAULT_PLANNER,
    visionModel = DEFAULT_VISION,
    endpoint = DEFAULT_ENDPOINT,
    maxSteps = 20,
    fileRoots,
    onEvent,
  }) {
    this.id = `CTL-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    this.goal = String(goal || "").trim();
    if (!this.goal) throw new Error("A mission goal is required");
    this.permissions = normalizePermissions(permissions);
    this.autoApprove = Boolean(autoApprove);
    this.vision = Boolean(vision);
    this.ocr = Boolean(ocr);
    this.plannerModel = plannerModel;
    this.visionModel = visionModel;
    this.endpoint = endpoint;
    this.maxSteps = Math.max(1, Math.min(60, Number(maxSteps) || 20));
    this.status = "running";
    this.step = 0;
    this.startedAt = Date.now();
    this.endedAt = null;
    this.doneSummary = "";
    this.error = "";
    this.currentAction = null;
    this.lastResult = "";
    this.lastVerify = "";
    this.history = [];
    this.logs = [];
    this.seq = 0;
    this.pendingApproval = null;
    this.approval = null;
    this.screen = null;
    this.observation = null;
    this.latestShot = null;
    this.shotVersion = 0;
    this.browserTabs = [];
    this.browserRunning = false;
    this.consecutiveErrors = 0;
    this.lastVisionStep = -99;
    this.lastActionName = "";
    this.directives = [];
    this.ocrBroken = false;
    this.fileEngine = new FileEngine({ roots: fileRoots, sessionId: this.id });
    this.fileRoots = this.fileEngine.roots;
    this.onEvent = onEvent;
    this.abort = new AbortController();
    this.eventsPath = path.join(CONTROL_DIR, this.id, "events.jsonl");
    fs.mkdirSync(path.dirname(this.eventsPath), { recursive: true });
    this.log("session", "CONTROL ARMED", `goal: ${clip(this.goal, 180)}`, "low");
  }

  log(type, title, detail, risk = "low", extra = {}) {
    this.seq += 1;
    const entry = {
      seq: this.seq,
      ts: new Date().toISOString(),
      type,
      title,
      detail: clip(detail, 500),
      risk,
      ...extra,
    };
    this.logs.push(entry);
    if (this.logs.length > 140) this.logs.shift();
    try {
      fs.appendFileSync(this.eventsPath, `${JSON.stringify(entry)}\n`);
    } catch {
      // Logging must never stop control.
    }
    this.publish();
  }

  audit(action, args, risk, detail) {
    try {
      fs.appendFileSync(
        ACTION_LOG,
        `${JSON.stringify({
          ts: new Date().toISOString(),
          tier: "machine",
          tool: `control:${action}`,
          target: detail,
          risk,
          session: this.id,
          goal: clip(this.goal, 120),
          approved: true,
          args: previewArgs(args),
        })}\n`,
      );
    } catch {
      // Audit is best-effort.
    }
  }

  publish() {
    try {
      this.onEvent?.(this.publicState());
    } catch {
      // A broken listener must not break execution.
    }
  }

  publicState() {
    return {
      id: this.id,
      goal: this.goal,
      status: this.status,
      step: this.step,
      maxSteps: this.maxSteps,
      startedAt: this.startedAt,
      elapsedMs: (this.endedAt ?? Date.now()) - this.startedAt,
      doneSummary: this.doneSummary,
      error: this.error,
      permissions: this.permissions,
      autoApprove: this.autoApprove,
      vision: this.vision,
      ocr: this.ocr,
      steering: this.directives.slice(-5),
      plannerModel: this.plannerModel,
      visionModel: this.visionModel,
      currentAction: this.currentAction
        ? {
            action: this.currentAction.action,
            args: previewArgs(this.currentAction.args),
            thought: this.currentAction.thought,
            verify: this.currentAction.verify,
            description: describeAction(
              this.currentAction.action,
              this.currentAction.args,
            ),
          }
        : null,
      lastResult: clip(this.lastResult, 700),
      lastVerify: clip(this.lastVerify, 400),
      pendingApproval: this.pendingApproval
        ? {
            ...this.pendingApproval,
            args: previewArgs(this.pendingApproval.args),
            description: describeAction(
              this.pendingApproval.action,
              this.pendingApproval.args,
            ),
          }
        : null,
      observation: this.observation
        ? {
            screen: this.observation.screen,
            active: this.observation.active,
            focused: this.observation.focused,
            focusedValue: clip(this.observation.focusedValue, 600),
            windows: (this.observation.windows ?? []).slice(0, 8),
            elements: (this.observation.elements ?? []).slice(0, 14),
            vision: this.observation.vision,
            capturedAt: this.observation.capturedAt,
          }
        : null,
      shotUrl: this.latestShot
        ? `/api/control/screenshot?v=${this.shotVersion}`
        : null,
      browserTabs: this.browserTabs,
      browserRunning: this.browserRunning,
      logs: this.logs.slice(-80),
      capabilities: CAPABILITIES.map(([key, label]) => ({
        key,
        label,
        granted: this.permissions[key],
      })),
    };
  }

  start() {
    this.run().catch((error) => {
      if (error?.name === "AbortError") return;
      this.fail(error.message);
    });
    return this.publicState();
  }

  async run() {
    if (!this.screen) {
      this.screen = await screenInfo(this.abort.signal).catch(() => null);
    }
    while (this.step < this.maxSteps) {
      await this.waitIfPaused();
      if (this.status !== "running" || this.abort.signal.aborted) return;

      const observation = await this.observe();
      if (this.status !== "running") return;
      this.observation = observation;
      this.publish();

      const decision = await planNext({
        goal: this.goal,
        observation: observation.text,
        vision: observation.vision,
        ocrText: observation.ocrText,
        directives: this.directives,
        history: this.history,
        permissions: this.permissions,
        fileRoots: this.fileRoots,
        model: this.plannerModel,
        endpoint: this.endpoint,
        step: this.step,
        maxSteps: this.maxSteps,
        signal: this.abort.signal,
      });
      if (this.status !== "running") return;

      this.currentAction = decision;
      this.lastVerify = decision.verify;
      this.log(
        "plan",
        `STEP ${String(this.step + 1).padStart(2, "0")} / ${decision.action.toUpperCase()}`,
        decision.verify || decision.thought || describeAction(decision.action, decision.args),
        "low",
      );

      if (decision.action === "done") {
        this.complete(decision.args.summary || decision.thought || "Task reported complete");
        return;
      }

      const signature = `${decision.action}:${JSON.stringify(decision.args)}`;
      const repeats = this.history.filter(
        (item) => !item.error && `${item.action}:${JSON.stringify(item.args)}` === signature,
      ).length;
      if (repeats >= 2) {
        this.log(
          "state",
          "REPEAT GUARD",
          `${decision.action} repeated; closing with recorded results`,
          "low",
        );
        try {
          const summary = await summarizeMission({
            goal: this.goal,
            history: this.history,
            model: this.plannerModel,
            endpoint: this.endpoint,
            signal: this.abort.signal,
          });
          if (this.status === "running") {
            this.complete(summary || this.lastResult || "Task closed after repeated actions");
          }
        } catch (error) {
          if (error?.name === "AbortError" || this.status !== "running") return;
          this.fail(
            `Planner kept repeating ${decision.action} with identical arguments. Last result: ${clip(this.lastResult, 900)}`,
          );
        }
        return;
      }

      const gate = checkAction(decision.action, this.permissions, {
        autoApprove: this.autoApprove,
      });
      if (!gate.allowed) {
        this.recordError(decision, gate.reason);
        this.step += 1;
        this.consecutiveErrors += 1;
        if (this.consecutiveErrors >= 3) {
          this.fail(`Three consecutive blocked steps. Last: ${gate.reason}`);
          return;
        }
        continue;
      }

      if (gate.needsApproval) {
        const approved = await this.requestApproval(decision, gate.risk);
        if (!approved) return;
      }

      try {
        const result = await this.execute(decision);
        this.recordSuccess(decision, result);
        this.consecutiveErrors = 0;
      } catch (error) {
        if (error?.name === "AbortError" || this.status !== "running") {
          return;
        }
        this.recordError(decision, error.message);
        this.consecutiveErrors += 1;
        if (this.consecutiveErrors >= 3) {
          this.fail(`Three consecutive execution failures. Last: ${error.message}`);
          return;
        }
      }
      this.step += 1;
      await sleep(this.autoApprove ? 350 : 550).catch(() => null);
    }
    this.status = "stopped";
    this.error = this.error || "Step budget exhausted";
    this.endedAt = Date.now();
    this.log("halt", "BUDGET EXHAUSTED", `${this.maxSteps} steps used`, "medium");
  }

  async waitIfPaused() {
    while (this.status === "paused") {
      await sleep(250);
      if (this.abort.signal.aborted) return;
    }
  }

  async observe() {
    const accessibility = this.permissions.accessibility;
    const screenPermission = this.permissions.screen;
    let tree = null;
    let shot = null;
    this.log("observe", "OBSERVE", "reading desktop state", "low");

    if (accessibility) {
      tree = await observe({ maxElements: 70, maxDepth: 5, signal: this.abort.signal });
    } else if (this.permissions.apps || this.permissions.mouse) {
      const windows = await listWindows(this.abort.signal);
      const active = windows.find((win) => win.active) ?? null;
      tree = { active, windows, elements: [], focused: null };
    }

    if (screenPermission) {
      shot = await capture({ quality: 62, maxWidth: 1440, signal: this.abort.signal });
      this.latestShot = shot;
      this.shotVersion = Date.now();
    }

    if (this.permissions.browser) {
      try {
        this.browserTabs = await listTabs({ ensure: false });
        this.browserRunning = this.browserTabs.length > 0;
      } catch {
        this.browserTabs = [];
        this.browserRunning = false;
      }
    }

    let vision = "";
    const needVision =
      this.vision &&
      shot &&
      (this.step === 0 ||
        this.lastActionName === "screenshot" ||
        this.step - this.lastVisionStep >= 3 ||
        (!tree?.elements?.length && this.step - this.lastVisionStep >= 2));
    if (needVision) {
      try {
        const image = fs.readFileSync(shot.path).toString("base64");
        vision = await describeScreen({
          imageBase64: image,
          goal: this.goal,
          model: this.visionModel,
          endpoint: this.endpoint,
          signal: this.abort.signal,
        });
        this.lastVisionStep = this.step;
        this.log("vision", "VISION READ", clip(vision, 300), "low");
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        this.log("vision", "VISION UNAVAILABLE", error.message, "low");
      }
    }

    const screen = this.screen
      ? { x: this.screen.x, y: this.screen.y, w: this.screen.w, h: this.screen.h }
      : null;
    const lines = [];
    if (screen) {
      lines.push(
        `Screen: origin ${screen.x},${screen.y} size ${screen.w}x${screen.h} (coordinates are absolute screen pixels)`,
      );
    }
    if (this.permissions.accessibility) {
      lines.push(describeObservation(tree ?? {}));
    } else if (tree?.windows?.length) {
      lines.push(
        `Active window: ${tree.active?.title ?? "unknown"}\nWindows: ${tree.windows
          .map((win) => win.title)
          .join(" | ")}`,
      );
    } else {
      lines.push("Accessibility observation is not authorized. Use the screenshot and keyboard shortcuts.");
    }
    if (vision) lines.push(`VISION READ: ${vision}`);
    if (this.permissions.browser) {
      if (this.browserTabs.length) {
        lines.push(
          `Browser tabs:\n${this.browserTabs
            .map((tab) => `- ${tab.id} | ${tab.title} | ${tab.url}`)
            .join("\n")}`,
        );
      } else {
        lines.push(
          "Browser: not running. Use browser_open {url} to start the APEX browser and open a tab.",
        );
      }
    }
    if (this.lastActionName) {
      lines.push(`Last action: ${this.lastActionName} — ${clip(this.lastResult, 600)}`);
    }

    return {
      screen,
      active: tree?.active ?? null,
      focused: tree?.focused ?? null,
      focusedValue: tree?.focusedValue ?? "",
      windows: tree?.windows ?? [],
      elements: tree?.elements ?? [],
      text: lines.join("\n"),
      vision,
      capturedAt: new Date().toISOString(),
    };
  }

  recordSuccess(decision, result) {
    const forModel =
      typeof result?.forModel === "string"
        ? result.forModel
        : JSON.stringify(result ?? {}, null, 0);
    this.lastActionName = decision.action;
    this.lastResult = clip(forModel, 1400);
    this.history.push({
      action: decision.action,
      args: previewArgs(decision.args),
      result: clip(forModel, 1600),
      timestamp: Date.now(),
    });
    if (this.history.length > 30) this.history.shift();
    this.currentAction = decision;
    this.log(
      "action",
      decision.action.toUpperCase(),
      describeAction(decision.action, decision.args) +
        (result?.display ? ` · ${result.display}` : ""),
      ACTIONS[decision.action]?.risk ?? "low",
      { action: decision.action, state: "ok" },
    );
    this.audit(
      decision.action,
      decision.args,
      ACTIONS[decision.action]?.risk ?? "low",
      describeAction(decision.action, decision.args),
    );
  }

  recordError(decision, message) {
    this.lastActionName = decision.action;
    this.lastResult = `ERROR: ${message}`;
    this.history.push({
      action: decision.action,
      args: previewArgs(decision.args),
      error: message,
      timestamp: Date.now(),
    });
    if (this.history.length > 30) this.history.shift();
    this.log(
      "error",
      `${decision.action.toUpperCase()} FAILED`,
      message,
      "medium",
      { action: decision.action, state: "error" },
    );
    this.audit(
      decision.action,
      decision.args,
      ACTIONS[decision.action]?.risk ?? "low",
      `error: ${message}`,
    );
  }

  async execute(decision) {
    const { action, args } = decision;
    const signal = this.abort.signal;
    switch (action) {
      case "screenshot": {
        const shot = await capture({ quality: 62, maxWidth: 1440, signal });
        this.latestShot = shot;
        this.shotVersion = Date.now();
        this.publish();
        return {
          display: `${shot.width}x${shot.height} · ${Math.round(shot.bytes / 1024)} KB`,
          forModel: `Captured ${shot.width}x${shot.height} screenshot. Use the observation for UI details.`,
        };
      }
      case "list_windows": {
        const windows = await listWindows(signal);
        return {
          display: `${windows.length} windows`,
          forModel: windows
            .map(
              (win) =>
                `${win.active ? "[ACTIVE] " : ""}${win.title} (pid ${win.pid}, ${win.process})`,
            )
            .join("\n"),
        };
      }
      case "focus_window": {
        const result = await focusWindow(args.pid, signal);
        return {
          display: result.focused ? `pid ${args.pid} focused` : `pid ${args.pid} not focused`,
          forModel: JSON.stringify(result),
        };
      }
      case "launch_app": {
        const result = await launchApp(
          { app: args.app, args: args.args, cwd: args.cwd },
          signal,
        );
        await sleep(1100);
        return {
          display: `pid ${result.pid} · ${result.process}`,
          forModel: `Launched ${result.process} (pid ${result.pid}). Wait for its window before interacting.`,
        };
      }
      case "move_mouse": {
        const result = await moveMouse(args.x, args.y, signal);
        return { display: `${args.x},${args.y}`, forModel: JSON.stringify(result) };
      }
      case "click": {
        const result = await click(
          { x: args.x, y: args.y, button: args.button, count: args.count },
          signal,
        );
        return {
          display: `${args.x},${args.y}${args.button === "right" ? " right" : ""}`,
          forModel: JSON.stringify(result),
        };
      }
      case "drag": {
        const result = await drag(
          {
            fromX: args.fromX,
            fromY: args.fromY,
            toX: args.toX,
            toY: args.toY,
          },
          signal,
        );
        return { display: "drag complete", forModel: JSON.stringify(result) };
      }
      case "scroll": {
        const result = await scroll(
          { x: args.x, y: args.y, amount: args.amount },
          signal,
        );
        return { display: `scroll ${args.amount}`, forModel: JSON.stringify(result) };
      }
      case "type_text": {
        const result = await typeText(args.text, signal);
        return {
          display: `${result.chars} chars`,
          forModel: `Typed ${result.chars} characters into the focused control. Verify the text landed.`,
        };
      }
      case "press_keys": {
        const result = await pressKeys(args.keys, signal);
        return { display: result.keys, forModel: `Pressed ${result.keys}.` };
      }
      case "browser_tabs": {
        const tabs = await listTabs();
        this.browserTabs = tabs;
        this.browserRunning = true;
        this.publish();
        return {
          display: `${tabs.length} tabs`,
          forModel: tabs
            .map((tab) => `${tab.id} | ${tab.title} | ${tab.url}`)
            .join("\n"),
        };
      }
      case "browser_open": {
        const tab = await guard(newTab(args.url), signal);
        const tabs = await listTabs();
        this.browserTabs = tabs;
        this.browserRunning = true;
        this.publish();
        return {
          display: `${tab.id} · ${args.url}`,
          forModel: `Opened tab ${tab.id} at ${tab.url}. Active tabs: ${tabs
            .map((item) => item.id)
            .join(", ")}`,
        };
      }
      case "browser_activate": {
        const result = await guard(activateTab(args.id), signal);
        this.publish();
        return { display: args.id, forModel: JSON.stringify(result) };
      }
      case "browser_close": {
        await guard(closeTab(args.id), signal);
        const tabs = await listTabs();
        this.browserTabs = tabs;
        this.publish();
        return { display: args.id, forModel: `Closed tab ${args.id}.` };
      }
      case "browser_navigate": {
        const tabId = args.id || this.browserTabs[0]?.id;
        if (!tabId) throw new Error("Open a browser tab first");
        const result = await guard(browserNavigate(tabId, args.url), signal);
        await sleep(300);
        const tabs = await listTabs();
        this.browserTabs = tabs;
        this.publish();
        return {
          display: `${result.title ?? args.url}`,
          forModel: `Tab ${tabId} is now "${result.title}" at ${result.url}`,
        };
      }
      case "browser_click": {
        const tabId = args.id || this.browserTabs[0]?.id;
        if (!tabId) throw new Error("Open a browser tab first");
        const result = await guard(
          browserClick(tabId, {
            selector: args.selector,
            x: args.x,
            y: args.y,
          }),
          signal,
        );
        return {
          display: args.selector || `${args.x},${args.y}`,
          forModel: `Clicked ${JSON.stringify(result)} in tab ${tabId}.`,
        };
      }
      case "browser_type": {
        const tabId = args.id || this.browserTabs[0]?.id;
        if (!tabId) throw new Error("Open a browser tab first");
        const result = await guard(
          browserType(tabId, args.text, args.selector),
          signal,
        );
        return {
          display: `${result.chars} chars`,
          forModel: `Typed ${result.chars} characters in tab ${tabId}.`,
        };
      }
      case "browser_press": {
        const tabId = args.id || this.browserTabs[0]?.id;
        if (!tabId) throw new Error("Open a browser tab first");
        const result = await guard(browserPress(tabId, args.keys), signal);
        return { display: result.key, forModel: `Pressed ${result.key} in tab ${tabId}.` };
      }
      case "browser_eval": {
        const tabId = args.id || this.browserTabs[0]?.id;
        if (!tabId) throw new Error("Open a browser tab first");
        const result = await guard(browserEvaluate(tabId, args.expression), signal);
        return {
          display: clip(JSON.stringify(result.value), 120),
          forModel: `Page returned: ${clip(JSON.stringify(result.value), 3000)}`,
        };
      }
      case "file_list": {
        const listing = this.fileEngine.list(args.path ?? ".");
        return {
          display: `${listing.entries.length} entries`,
          forModel: `${listing.path}\n${listing.entries
            .map((entry) => `${entry.type === "dir" ? "[dir]" : "     "} ${entry.name} (${entry.size})`)
            .join("\n")}`,
        };
      }
      case "file_read": {
        const file = this.fileEngine.read(args.path);
        return {
          display: `${file.size} bytes`,
          forModel: `File ${file.path} (${file.size} bytes)\n---\n${clip(file.content, 6000)}`,
        };
      }
      case "file_write": {
        const result = this.fileEngine.write(args.path, args.content, {
          append: Boolean(args.append),
        });
        return {
          display: `${result.bytes} bytes${result.snapshot ? " · undo armed" : " · new file"}`,
          forModel: `Wrote ${result.bytes} bytes to ${result.path}.${
            result.snapshot ? " A rollback snapshot was saved." : ""
          }`,
        };
      }
      case "file_replace": {
        const result = this.fileEngine.replace(
          args.path,
          args.old,
          args.new,
          { all: Boolean(args.all) },
        );
        return {
          display: `${result.replaced} replacement(s) · undo armed`,
          forModel: `Replaced ${result.replaced} occurrence(s) in ${result.path}.`,
        };
      }
      case "file_mkdir": {
        const result = this.fileEngine.mkdir(args.path);
        return { display: result.path, forModel: `Created directory ${result.path}.` };
      }
      case "run_command": {
        const result = await runCommand(args.command, {
          cwd: args.cwd,
          signal,
        });
        const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
        return {
          display: `exit ${result.code} · ${(result.ms / 1000).toFixed(1)}s`,
          forModel: `exit ${result.code}\n${clip(output || "(no output)", 5000)}${
            result.timedOut ? "\nTIMEOUT: command was killed" : ""
          }`,
        };
      }
      default:
        throw new Error(`No executor for ${action}`);
    }
  }

  async manual(name, args = {}) {
    if (!ACTIONS[name] || name === "done") {
      throw new Error(`Manual action not allowed: ${name}`);
    }
    const gate = checkAction(name, this.permissions, { autoApprove: true });
    if (!gate.allowed) throw new Error(gate.reason);
    if (
      this.status === "running" &&
      !["screenshot", "browser_tabs", "list_windows"].includes(name)
    ) {
      throw new Error("Pause APEX before taking manual control");
    }
    const signal =
      this.status === "running" || this.status === "paused"
        ? this.abort.signal
        : new AbortController().signal;
    const result = await this.execute({ action: name, args, thought: "manual", verify: "" });
    this.lastActionName = name;
    this.lastResult = clip(result.forModel ?? JSON.stringify(result), 1400);
    this.log(
      "manual",
      `MANUAL ${name.toUpperCase()}`,
      describeAction(name, args) + (result.display ? ` · ${result.display}` : ""),
      ACTIONS[name].risk,
    );
    this.audit(name, args, ACTIONS[name].risk, `manual: ${describeAction(name, args)}`);
    return this.publicState();
  }

  async refreshBrowserTabs() {
    try {
      this.browserTabs = await listTabs({ ensure: false });
      this.browserRunning = this.browserTabs.length > 0;
    } catch {
      this.browserTabs = [];
      this.browserRunning = false;
    }
    this.publish();
    return this.browserTabs;
  }

  requestApproval(decision, risk) {
    const id = `APR-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    this.pendingApproval = {
      id,
      action: decision.action,
      args: decision.args,
      risk,
      reason: "High-risk action. Review the arguments before APEX continues.",
      createdAt: new Date().toISOString(),
    };
    this.status = "awaiting";
    this.currentAction = decision;
    this.log(
      "approval",
      "APPROVAL REQUIRED",
      describeAction(decision.action, decision.args),
      "high",
    );
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.approval = null;
        this.pendingApproval = null;
        this.status = "stopped";
        this.error = "Approval timed out";
        this.endedAt = Date.now();
        this.log("halt", "APPROVAL TIMEOUT", "no response in 180s", "high");
        reject(new Error("Approval timed out"));
      }, 180_000);
      this.approval = {
        id,
        resolve: (allow) => {
          clearTimeout(timer);
          this.approval = null;
          this.pendingApproval = null;
          if (allow) {
            this.status = "running";
            this.log("approval", "APPROVED", describeAction(decision.action, decision.args), risk);
            resolve(true);
          } else {
            this.status = "stopped";
            this.error = "Denied by the user";
            this.endedAt = Date.now();
            this.log("halt", "DENIED", "user stopped the pending action", "high");
            resolve(false);
          }
        },
      };
    });
  }

  approve(id, allow) {
    if (!this.approval || !this.pendingApproval) {
      throw new Error("No approval is waiting");
    }
    if (this.pendingApproval.id !== id) {
      throw new Error("Approval id does not match");
    }
    this.approval.resolve(Boolean(allow));
    return this.publicState();
  }

  pause() {
    if (this.status === "running") {
      this.status = "paused";
      this.log("state", "PAUSED", "execution loop held", "low");
    }
    return this.publicState();
  }

  resume() {
    if (this.status === "paused") {
      this.status = "running";
      this.log("state", "RESUMED", "execution loop released", "low");
    }
    return this.publicState();
  }

  stop(reason = "User released control") {
    if (["complete", "stopped", "error"].includes(this.status)) return this.publicState();
    this.status = "stopped";
    this.error = this.error || reason;
    this.endedAt = Date.now();
    this.abort.abort();
    killAllPowerShell();
    stopCommands();
    if (this.approval) {
      this.approval.resolve(false);
      this.approval = null;
      this.pendingApproval = null;
    }
    this.log("halt", "CONTROL STOPPED", reason, "high");
    return this.publicState();
  }

  complete(summary) {
    this.status = "complete";
    this.doneSummary = clip(summary, 2000);
    this.endedAt = Date.now();
    this.log("done", "MISSION COMPLETE", this.doneSummary, "low");
    this.publish();
    return this.publicState();
  }

  fail(message) {
    if (["complete", "stopped"].includes(this.status)) return;
    this.status = "error";
    this.error = String(message || "Unknown control error");
    this.endedAt = Date.now();
    this.abort.abort();
    killAllPowerShell();
    stopCommands();
    this.log("halt", "CONTROL ERROR", this.error, "high");
  }
}

export async function previewDesktop() {
  const [screen, windows] = await Promise.all([screenInfo(), listWindows()]);
  return { screen, windows };
}

export async function previewBrowser() {
  await ensureBrowser();
  return listTabs();
}

export async function stopBrowserOnly() {
  const { stopBrowser } = await import("./browser.mjs");
  stopBrowser();
}

export { foreground };
