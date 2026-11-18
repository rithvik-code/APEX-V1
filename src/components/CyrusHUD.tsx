import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";
import { CYRUS_PERSONAS, cyrus, personaById, useCyrus } from "../lib/cyrus";
import { speakRadio } from "../lib/radio";

const isolate = (event: SyntheticEvent) => event.stopPropagation();
const privacy = "Chat uses your configured AI model and recent conversation saved on this device. Clear it any time. Web Speech may use your browser's speech service; Whisper runs on-device after download.";

export function CyrusHUD({ mode }: { mode: "garage" | "drive" | "page" }) {
  const { phase, ear, heard, reply, status, brain, error, log } = useCyrus();
  const [expanded, setExpanded] = useState(mode === "garage");
  const [text, setText] = useState("");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [search, setSearch] = useState("");
  const [responsePrefs, setResponsePrefs] = useState(() => cyrus.getResponseSettings());
  const [memories, setMemories] = useState(() => cyrus.getPersonalMemory());
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => typeof speechSynthesis === "undefined" ? [] : speechSynthesis.getVoices());
  const [micNudges, setMicNudges] = useState(false);
  const [micHint, setMicHint] = useState("");
  const rootRef = useRef<HTMLElement>(null);
  const id = useId();
  const enabled = cyrus.on;
  const visible = true;
  const showPanel = expanded;
  const active = phase !== "off";
  const output = phase === "thinking" || phase === "speaking";
  const lastHeard = heard || [...log].reverse().find((line) => line.who === "you")?.text;
  const lastReply = reply || [...log].reverse().find((line) => line.who === "cyrus")?.text;

  useEffect(() => {
    setExpanded(mode === "garage");
  }, [mode]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const refresh = () => setVoices(window.speechSynthesis.getVoices());
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, []);

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
      const ceiling = parseFloat(getComputedStyle(root).getPropertyValue("--cyrus-hud-ceiling"));
      let floor = 22;
      for (const control of controls) {
        const box = control.getBoundingClientRect();
        if (box.width && box.height && box.bottom > ceiling && box.left < bounds.right && box.right > bounds.left) {
          floor = Math.max(floor, window.innerHeight - box.top + 12);
        }
      }
      floor = Math.min(floor, Math.max(22, window.innerHeight - ceiling - 64));
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
    let lowSince = 0;
    let highSince = 0;
    let lastNudgeAt = 0;
    let clearHintTimer = 0;

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
        if (!motion.matches) {
          root.style.setProperty("--cyrus-hud-level", String(level));
          samples.shift();
          samples.push(level);
          bars.forEach((bar, index) => {
            bar.style.transform = `scaleY(${Math.max(0.06, samples[index])})`;
          });
        }
        if (enabled && phase === "awake" && !output) {
          // Ignore silence. A low-input hint is only useful after voice energy is present.
          lowSince = level >= 0.035 && level < 0.09 ? lowSince || time : 0;
          highSince = level > 0.78 ? highSince || time : 0;
          const hint = lowSince && time - lowSince > 3000 ? "MIC LEVEL LOW · MOVE CLOSER OR SPEAK UP" : highSince && time - highSince > 1200 ? "MIC LEVEL STRONG · TRY A LITTLE MORE DISTANCE" : "";
          if (hint) {
            setMicHint((current) => current === hint ? current : hint);
            if (micNudges && time - lastNudgeAt > 15000) {
              lastNudgeAt = time;
              speakRadio(hint.includes("LOW") ? "I'm hearing you softly. Try moving a little closer." : "Your microphone input is strong. A little more distance may help.");
            }
            window.clearTimeout(clearHintTimer);
            clearHintTimer = window.setTimeout(() => setMicHint(""), 5200);
          } else {
            window.clearTimeout(clearHintTimer);
            setMicHint("");
          }
        } else {
          lowSince = 0;
          highSince = 0;
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    const sync = () => {
      clear();
      window.clearTimeout(clearHintTimer);
      if (active && intersecting && !document.hidden) {
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
  }, [visible, active, showPanel, enabled, phase, output, micNudges]);

  if (!visible) return null;

  return (
    <aside
      ref={rootRef}
      className="cyrus-hud"
      data-mode={mode}
      data-voice-room={mode === "garage" ? "garage" : mode === "drive" ? "drive" : "pitwall"}
      data-phase={phase}
      data-expanded={showPanel}
      aria-label="CYRUS voice controls"
      onKeyDown={isolate}
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
          className="cyrus-hud__persona-lens"
          onClick={() => {
            const index = CYRUS_PERSONAS.findIndex((persona) => persona.id === responsePrefs.persona);
            const next = CYRUS_PERSONAS[(index + 1) % CYRUS_PERSONAS.length];
            setResponsePrefs(cyrus.applyPersona(next.id));
          }}
          aria-label={`Switch co-driver persona. Current ${personaById(responsePrefs.persona).label}. Next persona.`}
          title={`${personaById(responsePrefs.persona).label} · click to switch`}
        >
          <i aria-hidden="true" />{personaById(responsePrefs.persona).label.toUpperCase()}
        </button>
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
        <button
            type="button"
            className="cyrus-hud__expand"
            aria-label={showPanel ? "Collapse CYRUS" : "Open CYRUS conversation"}
            aria-expanded={showPanel}
            aria-controls={`${id}-panel`}
            onClick={() => setExpanded((value) => !value)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d={showPanel ? "m6 9 6 6 6-6" : "m6 15 6-6 6 6"} />
            </svg>
        </button>
      </div>
      {error && <p className="cyrus-hud__error" role="alert" title={error}>{error}</p>}
      <div id={`${id}-panel`} className="cyrus-hud__panel" hidden={!showPanel}>
          <div className="cyrus-hud__channel">
            <span>{phase.toUpperCase()}</span>
            <span>{ear === "web-speech" ? "WEB SPEECH" : ear === "whisper" ? "WHISPER" : "NO SPEECH EAR"}</span>
            <span className="cyrus-hud__room-chip" aria-label={`Voice room treatment: ${mode}`}>ROOM / {mode === "garage" ? "GARAGE" : mode === "drive" ? "TRACK" : "PIT WALL"}</span>
          </div>
          <p className="cyrus-hud__detail">{status}</p>
          <p className="cyrus-hud__detail" role="status">{brain}</p>
          <div className="cyrus-hud__meter">
            <div className="cyrus-hud__bars" aria-hidden="true">
              {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
            </div>
            <span className="cyrus-hud__meter-label">
              {phase === "speaking" ? "Synthetic envelope · not measured speaker audio" : enabled ? "Microphone RMS · measured input" : "Microphone off"}
            </span>
            <span className="cyrus-hud__motion-note">Level animation paused · reduced motion</span>
          </div>
          <div className="cyrus-hud__mic-coach">
            <button type="button" aria-pressed={micNudges} onClick={() => setMicNudges((enabled) => !enabled)}>VOICE INPUT HINTS {micNudges ? "ON" : "OFF"}<span>{micNudges ? "SPOKEN NUDGES ENABLED" : "TEXT ONLY"}</span></button>
            {micHint && <p role="status" aria-live="polite"><i aria-hidden="true" />{micHint}</p>}
            <small>Uses measured microphone level as a rough distance clue; it cannot measure physical distance.</small>
          </div>
          <details className="cyrus-hud__preferences">
            <summary>VOICE & RESPONSE SETTINGS</summary>
            <label>PERSONA
              <select value={responsePrefs.persona} onChange={(event) => {
                setResponsePrefs(cyrus.applyPersona(event.target.value));
              }}>
                {CYRUS_PERSONAS.map((persona) => (
                  <option key={persona.id} value={persona.id}>{persona.label}</option>
                ))}
              </select>
              <small>{personaById(responsePrefs.persona).blurb}</small>
            </label>
            <label>INSTALLED VOICE
              <select value={responsePrefs.voice} onChange={(event) => {
                const voice = event.target.value;
                const next = { ...responsePrefs, voice };
                setResponsePrefs(next); cyrus.setResponseSettings({ voice });
              }}>
                <option value="">AUTO · BOLD ENGLISH VOICE</option>
                {voices.map((voice) => <option key={`${voice.name}::${voice.lang}`} value={`${voice.name}::${voice.lang}`}>{voice.name} · {voice.lang}</option>)}
              </select>
              {voices.length === 0 && <small>Voices appear when your browser makes them available.</small>}
            </label>
            <label>ANSWER DETAIL
              <select value={responsePrefs.detail} onChange={(event) => {
                const detail = event.target.value as typeof responsePrefs.detail;
                const next = { ...responsePrefs, detail };
                setResponsePrefs(next); cyrus.setResponseSettings({ detail });
              }}>
                <option value="brief">BRIEF</option><option value="balanced">BALANCED</option><option value="detailed">DETAILED</option>
              </select>
            </label>
            <label>VOICE PACE <b>{responsePrefs.rate.toFixed(2)}×</b>
              <input type="range" min="0.8" max="1.3" step="0.05" value={responsePrefs.rate} onChange={(event) => {
                const rate = Number(event.target.value); setResponsePrefs((value) => ({ ...value, rate })); cyrus.setResponseSettings({ rate });
              }} />
            </label>
            <label>VOICE PITCH <b>{responsePrefs.pitch.toFixed(2)}×</b>
              <input type="range" min="0.8" max="1.35" step="0.05" value={responsePrefs.pitch} onChange={(event) => {
                const pitch = Number(event.target.value); setResponsePrefs((value) => ({ ...value, pitch })); cyrus.setResponseSettings({ pitch });
              }} />
            </label>
          </details>
          <details className="cyrus-hud__preferences">
            <summary>PERSONAL MEMORY · {memories.length}</summary>
            <p className="cyrus-hud__memory-note">Only notes you explicitly ask me to remember are saved on this device. Say “remember that…” or type it below.</p>
            <form className="cyrus-hud__memory-form" onSubmit={(event) => {
              event.preventDefault();
              const fact = memoryDraft.trim();
              if (!fact) return;
              cyrus.rememberPersonalFact(fact);
              setMemories(cyrus.getPersonalMemory());
              setMemoryDraft("");
            }}>
              <label className="cyrus-hud__sr" htmlFor={`${id}-memory`}>Add a personal memory</label>
              <input id={`${id}-memory`} value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} placeholder="Add a note CYRUS can remember…" maxLength={240} />
              <button type="submit" disabled={!memoryDraft.trim()}>SAVE</button>
            </form>
            {memories.length > 0 && <div className="cyrus-hud__memories">
              {memories.map((memory) => <p key={memory}><span>{memory}</span><button type="button" aria-label={`Forget: ${memory}`} onClick={() => { cyrus.forgetPersonalFact(memory); setMemories(cyrus.getPersonalMemory()); }}>FORGET</button></p>)}
              <button type="button" className="cyrus-hud__forget-all" onClick={() => { cyrus.clearPersonalMemory(); setMemories([]); }}>FORGET ALL NOTES</button>
            </div>}
          </details>
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
              <p className="cyrus-hud__empty">Ask about anything, talk through an idea, or give a garage command. Enable the mic to say “Hey Cyrus”.</p>
            )}
          </div>
          <div className="cyrus-hud__history-head">
            <label className="cyrus-hud__sr" htmlFor={`${id}-search`}>Search recent CYRUS conversation</label>
            <input id={`${id}-search`} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search recent chat…" />
            <button type="button" onClick={() => { cyrus.clearConversation(); setSearch(""); }} disabled={!log.length}>CLEAR</button>
          </div>
          {log.length > 0 && (
            <div className="cyrus-hud__history" role="region" aria-label="Searchable recent conversation">
              {log.filter((line) => !search.trim() || line.text.toLowerCase().includes(search.trim().toLowerCase())).map((line, index) => (
                <p key={`${index}-${line.who}`}><b>{line.who === "you" ? "YOU" : "CYRUS"}</b><span>{line.text}</span></p>
              ))}
              {search.trim() && !log.some((line) => line.text.toLowerCase().includes(search.trim().toLowerCase())) && <p className="cyrus-hud__empty">NO MATCHES IN RECENT CHAT</p>}
            </div>
          )}
          <div className="cyrus-hud__quick" role="group" aria-label="Quick CYRUS prompts">
            <button type="button" onClick={() => cyrus.submit("What can you do in APEX?")}>WHAT CAN YOU DO?</button>
            <button type="button" onClick={() => cyrus.submit("Explain this project to me")}>EXPLAIN APEX</button>
            <button type="button" onClick={() => cyrus.submit("Open the garage")}>OPEN GARAGE</button>
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
              placeholder="Talk to CYRUS…"
              autoComplete="off"
              enterKeyHint="send"
            />
            <button type="submit" disabled={!text.trim()} aria-label="Send request to CYRUS">SEND</button>
          </form>
      </div>
      <p id={`${id}-privacy`} className={showPanel ? "cyrus-hud__privacy" : "cyrus-hud__sr"}>{privacy}</p>
    </aside>
  );
}
