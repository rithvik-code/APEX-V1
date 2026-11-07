import { useEffect, useRef, useState } from "react";
import {
  ALL_ARMED,
  CAPABILITIES,
  isActiveStatus,
  mediaUrl,
  type CapabilityKey,
  type ControlStatus,
  type Permissions,
} from "../lib/control";
import type { ControlApi } from "../hooks/useControl";
import { sound } from "../lib/sound";

const STATUS_TEXT: Record<ControlStatus, string> = {
  running: "EXECUTING",
  paused: "HELD",
  awaiting: "APPROVAL",
  complete: "COMPLETE",
  stopped: "STOPPED",
  error: "FAULT",
};

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)
    .toString()
    .padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
}

type Props = {
  control: ControlApi;
  onExpand: () => void;
};

export function ControlDock({ control, onExpand }: Props) {
  const { state, health, online, busy, error } = control;
  const [draft, setDraft] = useState("");
  const [steerDraft, setSteerDraft] = useState("");
  const [armed, setArmed] = useState<Permissions>({ ...ALL_ARMED });
  const [notice, setNotice] = useState("");
  const [feedFailed, setFeedFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const active = isActiveStatus(state?.status);
  const permissions = active && state ? state.permissions : armed;
  const armedCount = CAPABILITIES.filter(
    (cap) => permissions[cap.key as CapabilityKey],
  ).length;
  const live = Boolean(online) && !feedFailed;
  const feedSrc = live
    ? mediaUrl("/api/control/screen/stream")
    : (state?.shotUrl ? mediaUrl(state.shotUrl) : null);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  const toggle = (key: CapabilityKey) => {
    if (active) return;
    setArmed((current) => ({ ...current, [key]: !current[key] }));
    sound.tick("click");
  };

  const sendSteer = async () => {
    const text = steerDraft.trim();
    if (!text || !active) return;
    setSteerDraft("");
    await control.steer(text);
    setNotice("Steering delivered to APEX.");
  };

  const engage = async () => {
    const goal = draft.trim();
    if (!goal) {
      setNotice("Describe the mission first.");
      inputRef.current?.focus();
      return;
    }
    if (armedCount === 0) {
      setNotice("Arm at least one capability.");
      return;
    }
    setNotice("");
    sound.tick("start");
    const defaults = health?.defaults;
    const next = await control.start({
      goal,
      permissions: armed,
      autoApprove: false,
      vision: Boolean(defaults?.vision),
      ocr: defaults?.ocr !== false,
      plannerModel: defaults?.plannerModel ?? "qwen3:4b",
      visionModel: defaults?.visionModel ?? "gemma3:4b",
      maxSteps: defaults?.maxSteps ?? 20,
    });
    if (next) {
      setDraft("");
      setNotice("Control handed over. APEX is driving.");
    }
  };

  const elapsed = state
    ? active
      ? now - state.startedAt
      : state.elapsedMs
    : 0;

  return (
    <div className="ctl-dock" aria-label="APEX control dock">
      <div className="ctl-dock__head">
        <span className={`ctl-dock__live${online ? " is-online" : ""}`}>
          <i /> CONTROL / {online ? "LINKED" : "OFFLINE"}
        </span>
        <span className="ctl-dock__meta">
          {state ? `${state.id} · ${STATUS_TEXT[state.status]}` : "NO SESSION"}
          {state?.currentAction ? ` · ${state.currentAction.action.toUpperCase()}` : ""}
        </span>
        <button type="button" className="ctl-dock__expand" onClick={onExpand}>
          WORKSPACE <span aria-hidden="true">↗</span>
        </button>
      </div>

      <div className="ctl-dock__body">
        <div className="ctl-dock__feed">
          {feedSrc ? (
            <img
              src={feedSrc}
              alt="APEX live desktop feed"
              onError={() => {
                if (live) setFeedFailed(true);
              }}
            />
          ) : (
            <span>{online ? "NO FRAME YET" : "DAEMON OFFLINE"}</span>
          )}
          <i className="ctl-dock__scan" aria-hidden="true" />
          <b>
            {live && !state?.currentAction
              ? "LIVE"
              : state
                ? `STEP ${Math.min(state.step + 1, state.maxSteps)} / ${state.maxSteps}`
                : "IDLE"}
          </b>
          <em>{clock(elapsed)}</em>
        </div>

        <div className="ctl-dock__panel">
          {active && state ? (
            <div className="ctl-dock__active">
              <span className="ctl-dock__goal">{state.goal}</span>
              <span className="ctl-dock__line">
                {state.pendingApproval
                  ? `APPROVAL · ${state.pendingApproval.description}`
                  : state.currentAction?.description ||
                    state.lastResult ||
                    "Awaiting the next observation…"}
              </span>
              <form
                className="ctl-dock__steer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendSteer();
                }}
              >
                <input
                  type="text"
                  value={steerDraft}
                  maxLength={2000}
                  placeholder="Steer APEX mid-mission…"
                  onChange={(event) => setSteerDraft(event.target.value)}
                  aria-label="Steer the running mission"
                />
                <button type="submit" disabled={!steerDraft.trim()}>
                  SEND
                </button>
              </form>
              {state.steering.length > 0 && (
                <span className="ctl-dock__steered">
                  {state.steering.length} DIRECTIVE{state.steering.length === 1 ? "" : "S"} QUEUED
                </span>
              )}
            </div>
          ) : (
            <div className="ctl-dock__mission">
              <input
                ref={inputRef}
                type="text"
                value={draft}
                maxLength={4000}
                placeholder="Describe the mission — APEX will drive this machine…"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void engage();
                  }
                }}
                aria-label="Mission goal"
              />
              <button
                type="button"
                className="ctl-dock__engage"
                disabled={!online || busy === "start"}
                onClick={() => void engage()}
              >
                {busy === "start" ? "ARMING…" : "ENGAGE"} <span aria-hidden="true">↗</span>
              </button>
            </div>
          )}

          <div className="ctl-dock__caps">
            {CAPABILITIES.map((cap) => {
              const on = Boolean(permissions[cap.key]);
              return (
                <button
                  key={cap.key}
                  type="button"
                  className={`ctl-dock__cap${on ? " is-on" : ""}`}
                  disabled={active || !online}
                  onClick={() => toggle(cap.key)}
                  title={cap.detail}
                >
                  {cap.label}
                </button>
              );
            })}
            <span className="ctl-dock__count">{armedCount} / 8 ARMED</span>
          </div>

          <div className="ctl-dock__actions">
            {state?.status === "running" && (
              <button type="button" onClick={() => control.pause()}>
                HOLD
              </button>
            )}
            {state?.status === "paused" && (
              <button type="button" onClick={() => control.resume()}>
                RESUME
              </button>
            )}
            {state?.status === "awaiting" && (
              <button type="button" className="is-acid" onClick={onExpand}>
                REVIEW APPROVAL
              </button>
            )}
            {active && (
              <button
                type="button"
                className="is-danger"
                onClick={() => control.stop("Emergency stop from grid dock")}
              >
                STOP
              </button>
            )}
            <span className="ctl-dock__state">
              {notice || error || (state?.doneSummary ? state.doneSummary : "")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
