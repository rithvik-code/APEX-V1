import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  ALL_ARMED,
  CAPABILITIES,
  cancelPull,
  getPulls,
  isActiveStatus,
  isTerminalStatus,
  mediaUrl,
  pullModel,
  type CapabilityKey,
  type ControlStatus,
  type OcrResult,
  type Permissions,
  type PullState,
  type ScreenBounds,
  type StartMissionInput,
} from "../lib/control";
import type { ControlApi } from "../hooks/useControl";
import {
  loadPlaybooks,
  removePlaybook,
  savePlaybook,
  type Playbook,
} from "../lib/playbooks";
import { sound } from "../lib/sound";

const GOAL_KEY = "apex.control.goal";

const STATUS_LABEL: Record<ControlStatus, string> = {
  running: "EXECUTING",
  paused: "CONTROL HELD",
  awaiting: "APPROVAL REQUIRED",
  complete: "MISSION COMPLETE",
  stopped: "STOPPED",
  error: "FAULT",
};

const STATUS_TONE: Record<ControlStatus, string> = {
  running: "is-live",
  paused: "is-held",
  awaiting: "is-wait",
  complete: "is-done",
  stopped: "is-danger",
  error: "is-danger",
};

const TOOLS: Array<{ name: string; label: string; args?: Record<string, unknown> }> = [
  { name: "screenshot", label: "CAPTURE" },
  { name: "ocr_screen", label: "READ SCREEN" },
  { name: "list_windows", label: "WINDOWS" },
  { name: "browser_tabs", label: "TABS" },
];

const RECOMMENDED: Array<{ name: string; role: string; note: string }> = [
  { name: "qwen2.5vl:3b", role: "VISION", note: "reads screens like text — strongest free eyes" },
  { name: "qwen2.5vl:7b", role: "VISION", note: "deeper vision, needs headroom" },
  { name: "qwen3:8b", role: "PLANNER", note: "sharper multi-step reasoning" },
  { name: "llama3.1:8b", role: "PLANNER", note: "strong tool calling" },
  { name: "qwen2.5:3b", role: "FAST", note: "low-latency planner for CPU-only rigs" },
];

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)
    .toString()
    .padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}

function logTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString([], { hour12: false });
}

function mapPoint(
  event: ReactMouseEvent<HTMLImageElement>,
  img: HTMLImageElement,
  screen: ScreenBounds,
): { x: number; y: number } | null {
  const rect = img.getBoundingClientRect();
  const naturalW = img.naturalWidth || screen.w;
  const naturalH = img.naturalHeight || screen.h;
  const scale = Math.min(rect.width / naturalW, rect.height / naturalH);
  if (!scale) return null;
  const width = naturalW * scale;
  const height = naturalH * scale;
  const left = rect.left + (rect.width - width) / 2;
  const top = rect.top + (rect.height - height) / 2;
  const nx = (event.clientX - left) / width;
  const ny = (event.clientY - top) / height;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
  return {
    x: Math.round(screen.x + nx * screen.w),
    y: Math.round(screen.y + ny * screen.h),
  };
}

type Props = {
  control: ControlApi;
  onRelease: () => void;
  initialGoal?: string;
};

export function Takeover({ control, onRelease, initialGoal }: Props) {
  const { state, health, online, busy, error } = control;
  const status = state?.status;
  const statusLabel = status ? STATUS_LABEL[status] : "STANDBY";
  const tone = status ? STATUS_TONE[status] : "is-live";
  const active = isActiveStatus(status);
  const [draftGoal, setDraftGoal] = useState(initialGoal ?? "");
  const [armed, setArmed] = useState<Permissions>({ ...ALL_ARMED });
  const [autoApprove, setAutoApprove] = useState(false);
  const [vision, setVision] = useState(false);
  const [ocr, setOcr] = useState(true);
  const [plannerModel, setPlannerModel] = useState("qwen3:4b");
  const [visionModel, setVisionModel] = useState("gemma3:4b");
  const [maxSteps, setMaxSteps] = useState(20);
  const [minimized, setMinimized] = useState(false);
  const [clickMode, setClickMode] = useState(false);
  const [cursorAt, setCursorAt] = useState<{ x: number; y: number } | null>(null);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  const [steerDraft, setSteerDraft] = useState("");
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [pulls, setPulls] = useState<Record<string, PullState>>({});
  const [feedFailed, setFeedFailed] = useState(false);
  const [playbooks, setPlaybooks] = useState<Playbook[]>(() => loadPlaybooks());
  const [playbookName, setPlaybookName] = useState("");
  const pullSnapshot = useRef<Record<string, boolean>>({});

  const permissionMap: Permissions =
    active && state ? state.permissions : armed;

  const releaseRef = useRef<HTMLButtonElement>(null);
  const goalRef = useRef<HTMLTextAreaElement>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const stateRef = useRef(state);
  const settingsSeeded = useRef(false);
  const yieldTimer = useRef<number | null>(null);

  stateRef.current = state;

  useEffect(() => {
    if (initialGoal) {
      setDraftGoal(initialGoal);
      return;
    }
    try {
      const saved = localStorage.getItem(GOAL_KEY);
      if (saved) setDraftGoal(saved);
    } catch {
      // Storage can be unavailable in private contexts.
    }
  }, [initialGoal]);

  useEffect(() => {
    const lastGoal = state?.goal;
    if (!lastGoal) return;
    setDraftGoal((current) => (current.trim() ? current : lastGoal));
  }, [state?.id, state?.goal]);

  useEffect(() => {
    if (!health || settingsSeeded.current) return;
    settingsSeeded.current = true;
    setPlannerModel(health.defaults.plannerModel);
    setVisionModel(health.defaults.visionModel);
    setMaxSteps(health.defaults.maxSteps);
    setAutoApprove(Boolean(health.defaults.autoApprove));
    setVision(Boolean(health.defaults.vision));
    setOcr(health.defaults.ocr !== false);
  }, [health]);

  useEffect(() => {
    if (!online) return;
    let stop = false;
    const tick = async () => {
      try {
        const { pulls: next } = await getPulls();
        if (stop) return;
        setPulls(Object.fromEntries(next.map((pull) => [pull.model, pull])));
        let completed = false;
        for (const pull of next) {
          if (pull.done && pull.status === "ready" && pullSnapshot.current[pull.model] === false) {
            completed = true;
          }
          pullSnapshot.current[pull.model] = pull.done;
        }
        if (completed) void control.refresh();
      } catch {
        // Daemon hiccup; the next tick retries.
      }
    };
    void tick();
    const id = window.setInterval(tick, 2500);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [online, control]);

  useEffect(() => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return () => {
      const target =
        returnFocus.current && returnFocus.current !== document.body
          ? returnFocus.current
          : document.querySelector<HTMLButtonElement>(
              ".control-bar__btn, .lane__cta",
            );
      target?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (minimized) {
      document.body.classList.remove("locked");
      return;
    }
    document.body.classList.add("locked");
    releaseRef.current?.focus({ preventScroll: true });
    return () => document.body.classList.remove("locked");
  }, [minimized]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (isActiveStatus(stateRef.current?.status)) {
        sound.tick("click");
        void control.stop("Emergency stop from console");
        setMinimized(false);
      } else {
        onRelease();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [control, onRelease]);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (!minimized) return;
    if (status === "awaiting" || isTerminalStatus(status)) {
      setMinimized(false);
      sound.tick("start");
    }
  }, [status, minimized]);

  useEffect(() => {
    if (status === "awaiting") approveRef.current?.focus({ preventScroll: true });
  }, [status]);

  useEffect(() => {
    if (minimized) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state?.logs.length, minimized]);

  useEffect(() => {
    return () => {
      if (yieldTimer.current) window.clearTimeout(yieldTimer.current);
    };
  }, []);

  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => (current === message ? "" : current)), 5000);
  }, []);

  const engage = async (override?: StartMissionInput) => {
    if (!online) {
      flash("The local control daemon is offline. Start it with: npm run apexd");
      return;
    }
    const mission: StartMissionInput = override ?? {
      goal: draftGoal,
      permissions: armed,
      autoApprove,
      vision,
      ocr,
      plannerModel,
      visionModel,
      maxSteps,
    };
    const goal = mission.goal.trim();
    if (!goal) {
      flash("Describe the mission first.");
      goalRef.current?.focus();
      return;
    }
    if (!CAPABILITIES.some((cap) => mission.permissions[cap.key])) {
      flash("Arm at least one capability.");
      return;
    }
    sound.tick("start");
    try {
      localStorage.setItem(GOAL_KEY, goal);
    } catch {
      // Non-fatal.
    }
    const next = await control.start({ ...mission, goal });
    if (next) {
      flash("Control handed over. Every action is logged; STOP or ESC takes it back.");
      if (yieldTimer.current) window.clearTimeout(yieldTimer.current);
      yieldTimer.current = window.setTimeout(() => setMinimized(true), 1400);
    }
  };

  const currentMission = (): StartMissionInput => ({
    goal: draftGoal.trim(),
    permissions: { ...armed },
    autoApprove,
    vision,
    ocr,
    plannerModel,
    visionModel,
    maxSteps,
  });

  const saveCurrentPlaybook = () => {
    const mission = currentMission();
    if (!mission.goal) {
      flash("Describe the mission before saving it as a playbook.");
      goalRef.current?.focus();
      return;
    }
    savePlaybook(playbookName, mission);
    setPlaybooks(loadPlaybooks());
    setPlaybookName("");
    flash("PLAYBOOK SAVED — one click to load, ▶ to run.");
    sound.tick("start");
  };

  const restorePlaybook = (playbook: Playbook) => {
    setDraftGoal(playbook.mission.goal);
    setArmed({ ...playbook.mission.permissions });
    setVision(playbook.mission.vision);
    setOcr(playbook.mission.ocr);
    setPlannerModel(playbook.mission.plannerModel);
    setVisionModel(playbook.mission.visionModel);
    setMaxSteps(playbook.mission.maxSteps);
    // Playbooks never inherit auto-approve; the operator re-arms it deliberately.
    setAutoApprove(false);
  };

  const loadPlaybookIntoConsole = (playbook: Playbook) => {
    if (active) return;
    restorePlaybook(playbook);
    flash(`PLAYBOOK "${playbook.name}" LOADED — review the loadout, then ENGAGE.`);
    sound.tick("start");
  };

  const runPlaybook = (playbook: Playbook) => {
    if (active) return;
    restorePlaybook(playbook);
    // One-click run still gates every risky action behind approval.
    void engage({ ...playbook.mission, autoApprove: false });
  };

  const release = async () => {
    sound.tick("click");
    if (isActiveStatus(stateRef.current?.status)) {
      await control.stop("Control released from console");
    }
    onRelease();
  };

  const yieldScreen = () => {
    sound.tick("hover");
    setMinimized(true);
  };

  const toggleCapability = (key: CapabilityKey) => {
    if (active) return;
    setArmed((current) => ({ ...current, [key]: !current[key] }));
    sound.tick("click");
  };

  const setAll = (value: boolean) => {
    if (active) return;
    setArmed(
      CAPABILITIES.reduce(
        (acc, cap) => ({ ...acc, [cap.key]: value }),
        {} as Permissions,
      ),
    );
    sound.tick("click");
  };

  const runTool = async (name: string, args?: Record<string, unknown>) => {
    if (!state) {
      flash("Engage a mission before issuing manual actions.");
      return;
    }
    sound.tick("click");
    const next = await control.manual(name, args ?? {});
    if (next) flash(`${name.toUpperCase()} · ${next.lastResult.slice(0, 120)}`);
  };

  const toggleClickMode = async () => {
    if (!state) return;
    if (state.status === "running") {
      await control.pause();
    }
    if (state.status === "awaiting") {
      flash("Resolve the pending approval before taking the pointer.");
      return;
    }
    setClickMode((value) => !value);
    sound.tick("click");
  };

  const onScreenClick = async (event: ReactMouseEvent<HTMLImageElement>) => {
    if (!clickMode || !state) return;
    if (state.status !== "paused") {
      flash("Pause APEX before manual clicks.");
      return;
    }
    if (!state.permissions.mouse) {
      flash("Mouse capability is disarmed for this session.");
      return;
    }
    const screen = state.observation?.screen;
    const img = imgRef.current;
    if (!screen || !img) return;
    const point = mapPoint(event, img, screen);
    if (!point) return;
    sound.tick("click");
    const next = await control.manual("click", point);
    if (next) flash(`CLICK ${point.x},${point.y}`);
  };

  const onScreenMove = (event: ReactMouseEvent<HTMLImageElement>) => {
    const screen = state?.observation?.screen;
    const img = imgRef.current;
    if (!screen || !img) return;
    setCursorAt(mapPoint(event, img, screen));
  };

  const undoWrites = async () => {
    sound.tick("click");
    const result = await control.undo();
    if (result) {
      flash(`ROLLBACK · ${result.restored} restored · ${result.removed} removed`);
    }
  };

  const sendSteer = async () => {
    const text = steerDraft.trim();
    if (!text || !state) return;
    const next = await control.steer(text);
    if (next) {
      setSteerDraft("");
      flash("STEERING QUEUED · APEX reads it at the next step");
    }
  };

  const readScreen = async () => {
    if (!state) {
      flash("Engage a mission first — OCR runs inside a session.");
      return;
    }
    sound.tick("click");
    const result = await control.ocr();
    if (result) {
      setOcrResult(result);
      flash(`OCR · ${result.lines.length} text regions · ${result.engine}`);
    }
  };

  const installModel = async (name: string) => {
    sound.tick("click");
    try {
      const { pull } = await pullModel(name);
      setPulls((current) => ({ ...current, [name]: pull }));
      pullSnapshot.current[name] = false;
      flash(`PULLING ${name} · progress lands in the bay`);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Pull failed");
    }
  };

  const cancelModel = async (name: string) => {
    try {
      await cancelPull(name);
    } catch {
      // The pull may have already finished.
    }
  };

  const elapsed = state
    ? active
      ? now - state.startedAt
      : state.elapsedMs
    : 0;
  const progress = state
    ? status === "complete"
      ? 1
      : Math.min(1, state.step / Math.max(1, state.maxSteps))
    : 0;
  const armedCount = CAPABILITIES.filter((cap) => permissionMap[cap.key]).length;
  const models = health?.ollama.models ?? [];
  const plannerChoices = models.filter((model) => model.tools);
  const visionChoices = models.filter((model) => model.vision);
  const shot = mediaUrl(state?.shotUrl);
  const feedSrc = online && !feedFailed ? mediaUrl("/api/control/screen/stream") : null;
  const screenSrc = feedSrc ?? shot;
  const pending = state?.pendingApproval;
  const lastLog = state?.logs[state.logs.length - 1];

  if (minimized) {
    return (
      <div className="ctl-hud" role="dialog" aria-label="APEX control HUD">
        <span className={`ctl-hud__live ${tone}`}>
          <i /> APEX // {statusLabel}
        </span>
        <b>{state?.id ?? "NO SESSION"}</b>
        <span className="ctl-hud__meta">
          STEP {state ? Math.min(state.step + 1, state.maxSteps) : 0} /{" "}
          {state?.maxSteps ?? 0} · {clock(elapsed)}
        </span>
        {status === "running" && (
          <button type="button" onClick={() => control.pause()}>
            HOLD
          </button>
        )}
        {status === "paused" && (
          <button type="button" onClick={() => control.resume()}>
            RESUME
          </button>
        )}
        {status === "awaiting" && (
          <button
            type="button"
            className="is-acid"
            onClick={() => setMinimized(false)}
          >
            REVIEW
          </button>
        )}
        <button type="button" onClick={() => setMinimized(false)}>
          RESTORE
        </button>
        {active && (
          <button
            type="button"
            className="is-danger"
            onClick={() => control.stop("Emergency stop from HUD")}
          >
            STOP
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="takeover ctl"
      role="dialog"
      aria-modal="true"
      aria-label="APEX take control console"
    >
      <span className="takeover__grid" aria-hidden="true" />
      <span className="takeover__scan" aria-hidden="true" />
      <span className="takeover__glow" aria-hidden="true" />

      <header className="takeover__bar ctl-bar">
        <span className="takeover__live">
          <i /> APEX // TAKE CONTROL
        </span>
        <span className="takeover__meta">
          {state ? `SESSION ${state.id}` : "NO SESSION"} ·{" "}
          {autoApprove ? "AUTO-APPROVE" : "APPROVAL PER ACTION"} ·{" "}
          {online ? `DAEMON v${health?.version ?? "—"}` : "DAEMON OFFLINE"}
        </span>
        <span className={`takeover__state ${tone}`} aria-live="polite">
          <i /> {statusLabel}
        </span>
        <div className="ctl-bar__btns">
          {active && (
            <button
              type="button"
              className="ctl-bar__yield"
              onClick={yieldScreen}
              title="Hide this console so APEX can see the desktop"
            >
              YIELD SCREEN
            </button>
          )}
          <button
            ref={releaseRef}
            type="button"
            className="takeover__release"
            onClick={() => void release()}
          >
            {active ? "STOP + RELEASE" : "CLOSE"} <span>[ESC]</span>
          </button>
        </div>
      </header>

      <div className="ctl-body">
        <section className="ctl-main">
          <div className={`ctl-screen${clickMode ? " is-manual" : ""}`}>
            {screenSrc ? (
              <img
                ref={imgRef}
                src={screenSrc}
                alt="Live desktop capture from the APEX control daemon"
                draggable={false}
                onClick={onScreenClick}
                onMouseMove={onScreenMove}
                onMouseLeave={() => setCursorAt(null)}
                onError={() => {
                  if (feedSrc) {
                    setFeedFailed(true);
                  } else {
                    flash("Screen feed dropped; waiting for the next frame.");
                  }
                }}
              />
            ) : (
              <div className="ctl-screen__empty">
                {!online ? (
                  <>
                    <span>DAEMON OFFLINE</span>
                    <b>Link the local control daemon to see this machine.</b>
                    <code>npm run apexd</code>
                    <p>
                      Loopback only · 127.0.0.1:4317 · nothing leaves the machine.
                    </p>
                    <button
                      type="button"
                      className="ctl-btn ctl-btn--ghost"
                      onClick={() => void control.refresh()}
                    >
                      {busy === "link" ? "LINKING…" : "RETRY LINK"}
                    </button>
                  </>
                ) : state ? (
                  <>
                    <span>FIRST OBSERVATION IN FLIGHT</span>
                    <b>APEX is reading the desktop feed.</b>
                    <p>The frame lands here as soon as the engine captures it.</p>
                  </>
                ) : (
                  <>
                    <span>NO SESSION</span>
                    <b>Arm capabilities, write a mission, hand over control.</b>
                    <p>
                      The screen feed, plan, actions and verdict stream here in
                      real time. ESC always takes the machine back.
                    </p>
                  </>
                )}
              </div>
            )}

            <span className="ctl-screen__scan" aria-hidden="true" />
            <span className="ctl-screen__frame" aria-hidden="true" />

            <div className="ctl-screen__top">
              <span className="ctl-screen__tag">
                <i /> LIVE /{" "}
                {state?.observation?.active?.title?.slice(0, 42) ?? "LOCAL DESKTOP"}
              </span>
              <span className="ctl-screen__bounds">
                {state?.observation?.screen
                  ? `${state.observation.screen.w}×${state.observation.screen.h}`
                  : "—"}
              </span>
            </div>

            <div className="ctl-screen__bottom">
              <span>
                {cursorAt
                  ? `CURSOR ${cursorAt.x}, ${cursorAt.y}`
                  : clickMode
                    ? "CLICK MODE ARMED · CLICK THE FEED"
                    : feedSrc
                      ? `LIVE FEED${health?.live?.fps ? ` · ${health.live.fps} FPS` : ""}`
                      : "APEX VISION / LOCAL"}
              </span>
              <span>{state?.observation?.capturedAt ? `FRAME ${logTime(state.observation.capturedAt)}` : "STANDBY"}</span>
            </div>

            {clickMode && <span className="ctl-screen__crosshair" aria-hidden="true" />}
          </div>

          <div className="ctl-tools">
            <span className="ctl-tools__label">MANUAL</span>
            <button
              type="button"
              className={`ctl-tools__click${clickMode ? " is-on" : ""}`}
              onClick={() => void toggleClickMode()}
              disabled={!state || status === "awaiting"}
            >
              {clickMode ? "CLICK-THROUGH ON" : "TAKE THE POINTER"}
            </button>
            {TOOLS.map((tool) => (
              <button
                key={tool.name}
                type="button"
                onClick={() =>
                  void (tool.name === "ocr_screen" ? readScreen() : runTool(tool.name, tool.args))
                }
                disabled={!state}
              >
                {tool.label}
              </button>
            ))}
            <button type="button" onClick={() => void undoWrites()} disabled={!state}>
              UNDO WRITES
            </button>
            <span className="ctl-tools__note">
              {state?.observation?.focused?.name
                ? `FOCUS / ${state.observation.focused.name}`
                : state?.observation?.focusedValue
                  ? `FOCUS / ${state.observation.focusedValue.slice(0, 48)}`
                  : "FOCUS / —"}
            </span>
          </div>

          {state && (
            <form
              className="ctl-steer"
              onSubmit={(event) => {
                event.preventDefault();
                void sendSteer();
              }}
            >
              <span className="ctl-steer__label">STEER</span>
              <input
                value={steerDraft}
                maxLength={2000}
                onChange={(event) => setSteerDraft(event.target.value)}
                placeholder={
                  active
                    ? "change the plan mid-flight — APEX reads this at the next step"
                    : "engage a mission, then steer it while it runs"
                }
                aria-label="Steer the running mission"
              />
              <button type="submit" disabled={!steerDraft.trim() || busy === "steer"}>
                {busy === "steer" ? "···" : "SEND"}
              </button>
              {state.steering?.length ? (
                <em>{state.steering.length} QUEUED</em>
              ) : null}
            </form>
          )}

          {ocrResult && (
            <div className="ctl-ocr" role="status">
              <div className="ctl-ocr__head">
                <span>
                  SCREEN TEXT · {ocrResult.lines.length} REGIONS · {ocrResult.engine}
                </span>
                <button
                  type="button"
                  onClick={() => setOcrResult(null)}
                  aria-label="Dismiss OCR panel"
                >
                  ×
                </button>
              </div>
              <pre>{ocrResult.text.slice(0, 900)}</pre>
            </div>
          )}

          <div className="ctl-log">
            <div className="ctl-log__head">
              <span>EXECUTION LOG</span>
              <span>
                {state ? `${state.logs.length} EVENTS · SEQ ${lastLog?.seq ?? 0}` : "NO EVENTS"}
              </span>
            </div>
            <div className="ctl-log__body" ref={logRef} role="log" aria-live="polite">
              {state?.logs.length ? (
                state.logs.map((entry) => (
                  <p
                    key={entry.seq}
                    className={`ctl-log__line is-${entry.risk} type-${entry.type}`}
                  >
                    <span>{String(entry.seq).padStart(3, "0")}</span>
                    <span>{logTime(entry.ts)}</span>
                    <em>{entry.type}</em>
                    <b>{entry.title}</b>
                    <span className="ctl-log__detail">{entry.detail}</span>
                  </p>
                ))
              ) : (
                <p className="ctl-log__empty">
                  {online
                    ? "› log is empty — engage a mission to open the loop"
                    : "› daemon offline — run `npm run apexd` in a terminal"}
                </p>
              )}
            </div>
          </div>
        </section>

        <aside className="ctl-rail">
          <div className="ctl-block">
            <div className="ctl-block__head">
              <span>MISSION</span>
              <span>{state?.id ?? "NEW CONTROL SESSION"}</span>
            </div>
            <textarea
              ref={goalRef}
              className="ctl-goal"
              value={active && state ? state.goal : draftGoal}
              onChange={(event) => setDraftGoal(event.target.value)}
              placeholder="e.g. open the repo, fix the failing test, run the suite and report the diff"
              rows={4}
              maxLength={4000}
              disabled={active}
              aria-label="Mission goal"
            />
            <div className="ctl-goal__meta">
              <span>{active ? "LOCKED WHILE APEX DRIVES" : "NATURAL LANGUAGE · 4000 MAX"}</span>
              <span>{(active && state ? state.goal : draftGoal).length} / 4000</span>
            </div>
          </div>

          <div className="ctl-block">
            <div className="ctl-block__head">
              <span>PLAYBOOKS</span>
              <span>{playbooks.length}/12</span>
            </div>
            <div className="ctl-playbook-save">
              <input
                className="ctl-playbook-name"
                type="text"
                value={playbookName}
                maxLength={28}
                placeholder="NAME THIS MISSION"
                disabled={active}
                onChange={(event) => setPlaybookName(event.target.value)}
                aria-label="Playbook name"
              />
              <button
                type="button"
                className="ctl-link"
                onClick={saveCurrentPlaybook}
                disabled={active || !draftGoal.trim()}
              >
                SAVE
              </button>
            </div>
            {playbooks.length === 0 ? (
              <p className="ctl-fine">
                Save the mission + loadout as a one-click macro. Runs always
                keep per-action approval, undo and STOP.
              </p>
            ) : (
              <ul className="ctl-playbooks">
                {playbooks.map((playbook) => (
                  <li key={playbook.id}>
                    <button
                      type="button"
                      className="ctl-playbook"
                      onClick={() => loadPlaybookIntoConsole(playbook)}
                      disabled={active}
                      title={playbook.mission.goal}
                    >
                      <b>{playbook.name}</b>
                      <span>
                        {playbook.mission.goal.slice(0, 64)}
                        {playbook.mission.goal.length > 64 ? "…" : ""}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="ctl-playbook-run"
                      onClick={() => runPlaybook(playbook)}
                      disabled={active || !online}
                      aria-label={`Run playbook ${playbook.name}`}
                      title="Run now — approvals still required"
                    >
                      ▶
                    </button>
                    <button
                      type="button"
                      className="ctl-playbook-del"
                      onClick={() => {
                        setPlaybooks(removePlaybook(playbook.id));
                        sound.tick("click");
                      }}
                      aria-label={`Delete playbook ${playbook.name}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="ctl-block">
            <div className="ctl-block__head">
              <span>CAPABILITIES</span>
              <button
                type="button"
                className="ctl-link"
                onClick={() => setAll(armedCount < CAPABILITIES.length)}
                disabled={active}
              >
                {armedCount < CAPABILITIES.length ? "ARM ALL" : "DISARM ALL"}
              </button>
            </div>
            <div className="ctl-caps">
              {CAPABILITIES.map((cap) => {
                const on = Boolean(permissionMap[cap.key]);
                return (
                  <button
                    key={cap.key}
                    type="button"
                    className={`ctl-cap${on ? " is-on" : ""}`}
                    onClick={() => toggleCapability(cap.key)}
                    disabled={active}
                    title={cap.detail}
                  >
                    <span>{cap.label}</span>
                    <i>{on ? "ARMED" : "OFF"}</i>
                  </button>
                );
              })}
            </div>
            <p className="ctl-fine">
              {armedCount} / {CAPABILITIES.length} armed · every action is written
              to the audit log · file writes are snapshotted before they land.
            </p>
          </div>

          <div className="ctl-block">
            <div className="ctl-block__head">
              <span>ENGINE</span>
              <span>{online ? "OLLAMA LINKED" : "LOCAL ONLY"}</span>
            </div>
            <label className="ctl-field">
              <span>PLANNER</span>
              <select
                value={plannerModel}
                disabled={active}
                onChange={(event) => {
                  setPlannerModel(event.target.value);
                  void control.saveConfig({ plannerModel: event.target.value });
                }}
              >
                {plannerChoices.length ? (
                  plannerChoices.map((model) => (
                    <option key={model.name} value={model.name}>
                      {model.name}
                    </option>
                  ))
                ) : (
                  <option value={plannerModel}>{plannerModel}</option>
                )}
              </select>
            </label>
            <label className="ctl-field">
              <span>VISION</span>
              <select
                value={visionModel}
                disabled={active || !vision}
                onChange={(event) => {
                  setVisionModel(event.target.value);
                  void control.saveConfig({ visionModel: event.target.value });
                }}
              >
                {(visionChoices.length
                  ? visionChoices.map((model) => model.name)
                  : [visionModel]
                ).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ctl-field ctl-field--num">
              <span>STEP BUDGET</span>
              <input
                type="number"
                min={1}
                max={60}
                value={maxSteps}
                disabled={active}
                onChange={(event) =>
                  setMaxSteps(
                    Math.max(1, Math.min(60, Number(event.target.value) || 1)),
                  )
                }
              />
            </label>
            <button
              type="button"
              className={`ctl-switch${vision ? " is-on" : ""}`}
              onClick={() => {
                setVision((value) => !value);
                void control.saveConfig({ vision: !vision });
              }}
              disabled={active}
            >
              <i /> VISION READ <em>{vision ? "ON" : "OFF"}</em>
            </button>
            <button
              type="button"
              className={`ctl-switch${ocr ? " is-on" : ""}`}
              onClick={() => {
                setOcr((value) => !value);
                void control.saveConfig({ ocr: !ocr });
              }}
              disabled={active}
            >
              <i /> OCR TEXT READ <em>{ocr ? "ON" : "OFF"}</em>
            </button>
            <button
              type="button"
              className={`ctl-switch ctl-switch--danger${autoApprove ? " is-on" : ""}`}
              onClick={() => setAutoApprove((value) => !value)}
              disabled={active}
            >
              <i /> AUTO-APPROVE RISKY <em>{autoApprove ? "ON" : "OFF"}</em>
            </button>
            <p className="ctl-fine">
              {autoApprove
                ? "High-risk writes and commands will run without asking. Use only for a trusted, scoped mission."
                : "High-risk writes and commands pause here for an explicit allow."}
            </p>
          </div>

          <div className="ctl-block">
            <div className="ctl-block__head">
              <span>MODEL BAY</span>
              <span>{online ? "FREE · OLLAMA REGISTRY" : "OFFLINE"}</span>
            </div>
            <div className="ctl-models">
              {RECOMMENDED.map((rec) => {
                const pull = pulls[rec.name];
                const installed = models.some((model) => model.name === rec.name);
                const pulling = pull && !pull.done;
                return (
                  <div key={rec.name} className="ctl-model">
                    <div className="ctl-model__info">
                      <b>{rec.name}</b>
                      <span>{rec.note}</span>
                    </div>
                    <i className={`ctl-model__role is-${rec.role.toLowerCase()}`}>
                      {rec.role}
                    </i>
                    {pulling ? (
                      <button
                        type="button"
                        className="ctl-model__btn is-live"
                        onClick={() => void cancelModel(rec.name)}
                        title={`${pull.status} · click to cancel`}
                      >
                        {Math.round(pull.pct)}%
                      </button>
                    ) : installed ? (
                      <span className="ctl-model__ok">READY</span>
                    ) : (
                      <button
                        type="button"
                        className="ctl-model__btn"
                        onClick={() => void installModel(rec.name)}
                        disabled={!online}
                      >
                        PULL
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="ctl-fine">
              One click downloads from the Ollama registry straight to your disk.
              qwen2.5vl reads pixels like text; qwen3:8b plans harder. Everything
              stays local.
            </p>
          </div>

          <div className="ctl-block ctl-block--run">
            <div className="ctl-block__head">
              <span>RUN</span>
              <span>
                STEP {state ? Math.min(state.step + 1, state.maxSteps) : 0} /{" "}
                {state?.maxSteps ?? maxSteps}
              </span>
            </div>

            {pending && (
              <div className="ctl-approval" role="alert">
                <span className="ctl-approval__risk">
                  APPROVAL REQUIRED · {String(pending.risk).toUpperCase()}
                </span>
                <b>{pending.description}</b>
                <p>{pending.reason}</p>
                <pre>{JSON.stringify(pending.args, null, 2).slice(0, 900)}</pre>
                <div className="ctl-approval__btns">
                  <button
                    ref={approveRef}
                    type="button"
                    className="ctl-btn ctl-btn--acid"
                    onClick={() => void control.approve(pending.id, true)}
                  >
                    {busy === "approve" ? "RELEASING…" : "ALLOW ONCE"}
                  </button>
                  <button
                    type="button"
                    className="ctl-btn ctl-btn--danger"
                    onClick={() => void control.approve(pending.id, false)}
                  >
                    DENY + STOP
                  </button>
                </div>
              </div>
            )}

            {state?.currentAction && (
              <div className="ctl-now">
                <span>
                  {state.currentAction.action.toUpperCase()} ·{" "}
                  {state.currentAction.description}
                </span>
                {state.currentAction.thought && (
                  <p>{state.currentAction.thought}</p>
                )}
                {state.currentAction.verify && (
                  <em>VERIFY · {state.currentAction.verify}</em>
                )}
              </div>
            )}

            {active ? (
              <div className="ctl-run">
                {status === "running" && (
                  <button
                    type="button"
                    className="ctl-btn ctl-btn--ghost"
                    onClick={() => void control.pause()}
                  >
                    {busy === "pause" ? "HOLDING…" : "HOLD"}
                  </button>
                )}
                {status === "paused" && (
                  <button
                    type="button"
                    className="ctl-btn ctl-btn--acid"
                    onClick={() => void control.resume()}
                  >
                    {busy === "resume" ? "RELEASING…" : "RESUME LOOP"}
                  </button>
                )}
                <button
                  type="button"
                  className="ctl-btn ctl-btn--ghost"
                  onClick={yieldScreen}
                >
                  YIELD SCREEN
                </button>
                <button
                  type="button"
                  className="ctl-btn ctl-btn--danger"
                  onClick={() => void control.stop("Emergency stop from console")}
                >
                  {busy === "stop" ? "STOPPING…" : "EMERGENCY STOP"}
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="ctl-btn ctl-btn--primary"
                  onClick={() => void engage()}
                  disabled={!online || busy === "start"}
                >
                  {busy === "start" ? "ARMING ENGINE…" : "ENGAGE CONTROL"}
                  <span aria-hidden="true">↗</span>
                </button>
                {state && isTerminalStatus(state.status) && (
                  <p className="ctl-fine">
                    LAST RUN · {state.doneSummary || state.error || "no summary"}
                  </p>
                )}
              </>
            )}

            {notice && <p className="ctl-notice">{notice}</p>}
            {error && <p className="ctl-error">{error}</p>}
          </div>

          {state && (
            <div className="ctl-block">
              <div className="ctl-block__head">
                <span>READOUT</span>
                <span>{clock(elapsed)}</span>
              </div>
              <div className="ctl-readout">
                <div>
                  <span>ACTIVE</span>
                  <b>{state.observation?.active?.title?.slice(0, 40) ?? "—"}</b>
                </div>
                <div>
                  <span>FOCUS</span>
                  <b>
                    {state.observation?.focused?.name?.slice(0, 40) ||
                      state.observation?.focusedValue.slice(0, 40) ||
                      "—"}
                  </b>
                </div>
                <div>
                  <span>TABS</span>
                  <b>{state.browserTabs.length}</b>
                </div>
                <div>
                  <span>VISION</span>
                  <b>{state.observation?.vision ? "READ" : state.vision ? "PENDING" : "OFF"}</b>
                </div>
              </div>
              {state.lastVerify && (
                <p className="ctl-verify">VERIFY · {state.lastVerify}</p>
              )}
              {state.doneSummary && (
                <p className="ctl-summary">{state.doneSummary}</p>
              )}
              {state.error && <p className="ctl-error">{state.error}</p>}
            </div>
          )}
        </aside>
      </div>

      <footer className="takeover__foot">
        <div className="takeover__cmd">
          <span>apex@local:~$</span>
          <code>
            {state?.currentAction?.description ||
              state?.goal ||
              draftGoal ||
              "take control"}
          </code>
          <i className="takeover__caret" aria-hidden="true" />
        </div>
        <div className="takeover__track" aria-hidden="true">
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
        <div className="takeover__foot-meta">
          <span>ELAPSED {clock(elapsed)}</span>
          <span>
            STEP {state ? Math.min(state.step + 1, state.maxSteps) : 0} /{" "}
            {state?.maxSteps ?? maxSteps}
          </span>
          <span>
            {online
              ? "LOCAL LOOPBACK · UNDO ARMED · ESC TAKES IT BACK"
              : "DAEMON OFFLINE · NOTHING LEAVES THIS MACHINE"}
          </span>
        </div>
      </footer>
    </div>
  );
}
