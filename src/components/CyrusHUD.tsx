import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { cyrus, useCyrus } from "../lib/cyrus";

const isolate = (event: SyntheticEvent) => event.stopPropagation();
const privacy = "Web Speech may use your browser's speech service. Whisper downloads once, then recognizes on-device. Keep this page open.";

export function CyrusHUD({ mode }: { mode: "garage" | "drive" | "page" }) {
  const { phase, ear, heard, reply, status, error, log } = useCyrus();
  const [expanded, setExpanded] = useState(mode === "garage");
  const [text, setText] = useState("");
  const rootRef = useRef<HTMLElement>(null);
  const id = useId();
  const enabled = cyrus.on;
  const visible = mode !== "page" || enabled || phase !== "off";
  const showPanel = mode !== "page" && expanded;
  const active = phase !== "off";
  const output = phase === "thinking" || phase === "speaking";
  const lastHeard = heard || [...log].reverse().find((line) => line.who === "you")?.text;
  const lastReply = reply || [...log].reverse().find((line) => line.who === "cyrus")?.text;

  useEffect(() => {
    setExpanded(mode === "garage");
  }, [mode]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !visible || mode === "page") return;
    const host = document.querySelector(mode === "garage" ? ".garage" : ".drive-hud");
    if (!host) return;
    const selector = mode === "garage"
      ? ".garage__panel, .garage__sheet, .garage__pad, .garage__focus, .garage__photo-actions"
      : ".dhud__setup, .dhud__controls, .dhud__touch-steer, .dhud__touch-pedals";
    let controls: Element[] = [];
    const place = () => {
      const bounds = root.getBoundingClientRect();
      let floor = 22;
      for (const control of controls) {
        const box = control.getBoundingClientRect();
        if (box.width && box.height && box.left < bounds.right && box.right > bounds.left) {
          floor = Math.max(floor, window.innerHeight - box.top + 12);
        }
      }
      root.style.setProperty("--cyrus-hud-floor", `${floor}px`);
    };
    const resize = new ResizeObserver(place);
    const watch = () => {
      resize.disconnect();
      controls = Array.from(host.querySelectorAll(selector));
      resize.observe(root);
      controls.forEach((control) => resize.observe(control));
      place();
    };
    const mutation = new MutationObserver(watch);
    mutation.observe(host, { childList: true });
    window.addEventListener("resize", place);
    watch();
    return () => {
      resize.disconnect();
      mutation.disconnect();
      window.removeEventListener("resize", place);
      root.style.removeProperty("--cyrus-hud-floor");
    };
  }, [mode, visible]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !visible) return;
    const bars = root.querySelectorAll<HTMLElement>(".cyrus-hud__bars i");
    const samples = Array<number>(bars.length).fill(0);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let intersecting = false;
    let lastSample = 0;

    const clear = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
      root.style.setProperty("--cyrus-hud-level", "0");
      bars.forEach((bar) => { bar.style.transform = "scaleY(0.06)"; });
      samples.fill(0);
    };
    const tick = (time: number) => {
      if (time - lastSample >= 65) {
        lastSample = time;
        const level = Math.max(0, Math.min(1, cyrus.level()));
        root.style.setProperty("--cyrus-hud-level", String(level));
        samples.shift();
        samples.push(level);
        bars.forEach((bar, index) => {
          bar.style.transform = `scaleY(${Math.max(0.06, samples[index])})`;
        });
      }
      frame = window.requestAnimationFrame(tick);
    };
    const sync = () => {
      clear();
      if (active && intersecting && !document.hidden && !motion.matches) {
        frame = window.requestAnimationFrame(tick);
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      sync();
    });
    observer.observe(root);
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener("change", sync);
    return () => {
      clear();
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", sync);
    };
  }, [visible, active, showPanel]);

  if (!visible) return null;

  return (
    <aside
      ref={rootRef}
      className="cyrus-hud"
      data-mode={mode}
      data-phase={phase}
      data-expanded={showPanel}
      aria-label="CYRUS voice controls"
      onKeyDown={isolate}
      onKeyUp={isolate}
      onKeyPress={isolate}
      onPointerDown={isolate}
      onPointerUp={isolate}
      onClick={isolate}
      onDoubleClick={isolate}
      onWheel={isolate}
    >
      <div className="cyrus-hud__header">
        <button
          type="button"
          className="cyrus-hud__wake"
          onClick={() => { void cyrus.wake(); }}
          aria-label={`Wake CYRUS. Current state: ${phase}`}
          aria-describedby={`${id}-privacy`}
          title={phase === "off" ? "Enable microphone and wake CYRUS" : "Wake CYRUS"}
          disabled={phase === "starting"}
        >
          <span className="cyrus-hud__orb" aria-hidden="true"><i /></span>
        </button>
        <div className="cyrus-hud__identity">
          <strong>CYRUS</strong>
          <span className="cyrus-hud__status" role="status" aria-atomic="true" title={`${phase.toUpperCase()} · ${status}`}>
            <span className="cyrus-hud__sr">{phase}. </span>{status}
          </span>
        </div>
        <button
          type="button"
          className="cyrus-hud__mic"
          aria-label={enabled ? "Disable CYRUS microphone" : "Enable CYRUS microphone"}
          aria-pressed={enabled}
          aria-describedby={`${id}-privacy`}
          title={enabled ? "Disable microphone" : "Enable microphone"}
          onClick={() => { if (enabled) cyrus.disable(); else void cyrus.enable(); }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
            {!enabled && <path d="m3 3 18 18" />}
          </svg>
        </button>
        {(mode !== "page" || output) && (
          <button
            type="button"
            className="cyrus-hud__stop"
            aria-label="Stop CYRUS output"
            title="Stop output"
            disabled={!output}
            onClick={() => cyrus.submit("stop")}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
          </button>
        )}
        {mode !== "page" && (
          <button
            type="button"
            className="cyrus-hud__expand"
            aria-label={showPanel ? "Collapse CYRUS" : "Expand CYRUS"}
            aria-expanded={showPanel}
            aria-controls={`${id}-panel`}
            onClick={() => setExpanded((value) => !value)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d={showPanel ? "m6 9 6 6 6-6" : "m6 15 6-6 6 6"} />
            </svg>
          </button>
        )}
      </div>
      {error && <p className="cyrus-hud__error" role="alert" title={error}>{error}</p>}
      {mode !== "page" && (
        <div id={`${id}-panel`} className="cyrus-hud__panel" hidden={!showPanel}>
          <div className="cyrus-hud__channel">
            <span>{phase.toUpperCase()}</span>
            <span>{ear === "web-speech" ? "WEB SPEECH" : ear === "whisper" ? "WHISPER" : "NO SPEECH EAR"}</span>
          </div>
          <div className="cyrus-hud__meter">
            <div className="cyrus-hud__bars" aria-hidden="true">
              {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
            </div>
            <span className="cyrus-hud__meter-label">
              {phase === "speaking" ? "Synthetic envelope · not measured speaker audio" : enabled ? "Microphone RMS · measured input" : "Microphone off"}
            </span>
            <span className="cyrus-hud__motion-note">Level animation paused · reduced motion</span>
          </div>
          <div
            className="cyrus-hud__captions"
            role="region"
            aria-label="Latest CYRUS conversation"
            aria-live="polite"
            aria-busy={output}
            tabIndex={0}
          >
            {lastHeard && <p><b>YOU</b><span>{lastHeard}</span></p>}
            {lastReply && <p><b>CYRUS</b><span>{lastReply}</span></p>}
            {!lastHeard && !lastReply && (
              <p className="cyrus-hud__empty">Type a request, or enable the mic and say “Hey Cyrus”.</p>
            )}
          </div>
          <form
            className="cyrus-hud__form"
            aria-label="Send a request to CYRUS"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const command = text.trim();
              if (!command) return;
              setText("");
              cyrus.submit(command);
            }}
          >
            <label className="cyrus-hud__sr" htmlFor={`${id}-input`}>Request for CYRUS</label>
            <input
              id={`${id}-input`}
              type="text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Ask CYRUS…"
              autoComplete="off"
              enterKeyHint="send"
            />
            <button type="submit" disabled={!text.trim()} aria-label="Send request to CYRUS">SEND</button>
          </form>
        </div>
      )}
      <p id={`${id}-privacy`} className={showPanel ? "cyrus-hud__privacy" : "cyrus-hud__sr"}>{privacy}</p>
    </aside>
  );
}
