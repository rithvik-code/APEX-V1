import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CustomPaint } from "../lib/scene";
import {
  knowledgeState,
  subscribeKnowledge,
  syncKnowledge,
  type KnowledgeState,
} from "../lib/knowledge";
import { sound } from "../lib/sound";
import { DIE_CAST_CATALOG, diecastUnlocked } from "../lib/diecast";

type GarageAction = { id: string; seq: number };

type GarageProps = {
  licence: string;
  cp: number;
  unlocks: number;
  unlockIds: ReadonlySet<string>;
  audioOn: boolean;
  onAudio: () => void;
  onRevStart: (vehicle: "car" | "bike") => void;
  onRevEnd: () => void;
  onReplay: () => void;
  onExit: () => void;
  focus: { id: string; label: string } | null;
  action: GarageAction | null;
  onInteract: (id: string) => void;
  onMove: (forward: number, strafe: number) => void;
  doorOpen: boolean;
  liftUp: boolean;
  service: boolean;
  paint: CustomPaint;
  onPaint: (patch: Partial<CustomPaint>) => void;
  onDriveOut: (vehicle: "car" | "bike") => void;
  onCapture: () => void;
  onReward: () => void;
  trophies: number;
};

type Panel = null | "shelf" | "computer" | "trophies" | "radio" | "launch";

const STATIONS = [
  { name: "PIT FM", note: "race control + team radio" },
  { name: "SYNTH 88", note: "midnight drive synthwave" },
  { name: "V12 AM", note: "engine mic, no commentary" },
  { name: "LO-FI BAY", note: "tape hiss, crackle, midnight chords" },
];

const PAINTS = [
  { name: "ACID", base: "#12140f", accent: "#c8ff16" },
  { name: "SILVER", base: "#aab2ba", accent: "#f2f5f7" },
  { name: "GRAPHITE", base: "#2a2e33", accent: "#8b939b" },
  { name: "GULF", base: "#9fc4d8", accent: "#ff7a1a" },
  { name: "ROSÉ", base: "#5c1d2b", accent: "#f5c4cf" },
  { name: "NARDO", base: "#c6c8c2", accent: "#111311" },
];

const TROPHY_TIERS = [
  { cp: 120, label: "FIRST TRAY OF SILVER" },
  { cp: 240, label: "SECOND TRAY" },
  { cp: 360, label: "PADDOCK REGULAR" },
  { cp: 480, label: "WEEKEND WARRIOR" },
  { cp: 600, label: "SEASON HUNTER" },
  { cp: 720, label: "SILVER COLLECTOR" },
  { cp: 840, label: "BAY LEGEND" },
  { cp: 960, label: "APEX HALL OF FAME" },
];

function LaunchPractice({
  onReward,
  onToast,
}: {
  onReward: () => void;
  onToast: (message: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "live" | "done">("idle");
  const [rpm, setRpm] = useState(0);
  const [result, setResult] = useState("");
  const rpmRef = useRef(0);
  const timer = useRef<number | null>(null);
  const live = useRef(false);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const evaluate = useCallback(() => {
    stop();
    if (!live.current) return;
    live.current = false;
    const value = rpmRef.current;
    if (value >= 62 && value <= 78) {
      setResult(`PERFECT LAUNCH · ${Math.round(value)}% · +40 CP`);
      onReward();
      onToast("PERFECT LAUNCH — launch control logged, +40 CP");
    } else if (value > 78) {
      setResult(`WHEELSPIN · ${Math.round(value)}% · too hot, ease it back`);
      onToast("WHEELSPIN — release inside the acid band");
    } else {
      setResult(`BOGGED DOWN · ${Math.round(value)}% · not enough revs`);
      onToast("BOGGED — you need more rpm before releasing");
    }
    setPhase("done");
  }, [onReward, onToast, stop]);

  const build = useCallback(() => {
    if (live.current) return;
    stop();
    live.current = true;
    rpmRef.current = 0;
    setRpm(0);
    setResult("");
    setPhase("live");
    timer.current = window.setInterval(() => {
      rpmRef.current = Math.min(100, rpmRef.current + 1.4 + Math.random() * 1.3);
      setRpm(rpmRef.current);
      if (rpmRef.current >= 100) evaluate();
    }, 40);
  }, [evaluate, stop]);

  return (
    <div className="garage__launch">
      <p className="garage__launch-note">
        Launch control drill. Hold BUILD and release with the needle inside the
        acid band (62–78%). Too low bogs, too high spins the rears.
      </p>
      <div className="garage__meter" aria-hidden="true">
        <span className="garage__meter-band" />
        <span className="garage__meter-needle" style={{ left: `${rpm}%` }} />
      </div>
      <div className="garage__meter-labels">
        <span>0</span>
        <span>62</span>
        <span>78</span>
        <span>100</span>
      </div>
      <button
        type="button"
        className="garage__launch-btn"
        onPointerDown={(event) => {
          event.preventDefault();
          build();
        }}
        onPointerUp={evaluate}
        onPointerLeave={evaluate}
        onPointerCancel={evaluate}
        onKeyDown={(event) => {
          if ((event.key === " " || event.key === "Enter") && !event.repeat) {
            event.preventDefault();
            build();
          }
        }}
        onKeyUp={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            evaluate();
          }
        }}
        onBlur={evaluate}
      >
        <span>BUILD &amp; RELEASE</span>
        <b>{phase === "live" ? `${Math.round(rpm)}%` : "HOLD"}</b>
      </button>
      {result && (
        <p
          className={`garage__launch-result${
            result.startsWith("PERFECT") ? " is-perfect" : ""
          }`}
        >
          {result}
        </p>
      )}
    </div>
  );
}

export function Garage({
  licence,
  cp,
  unlocks,
  unlockIds,
  audioOn,
  onAudio,
  onRevStart,
  onRevEnd,
  onReplay,
  onExit,
  focus,
  action,
  onInteract,
  onMove,
  doorOpen,
  liftUp,
  service,
  paint,
  onPaint,
  onDriveOut,
  onCapture,
  onReward,
  trophies,
}: GarageProps) {
  const [now, setNow] = useState(() => new Date());
  const [panel, setPanel] = useState<Panel>(null);
  const [photo, setPhoto] = useState(false);
  const [flash, setFlash] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [station, setStation] = useState(0);
  const [tone, setTone] = useState(0.6);
  const [diecast, setDiecast] = useState(DIE_CAST_CATALOG[0].id);
  const [knowledge, setKnowledge] = useState<KnowledgeState>(() => knowledgeState());
  const lastAction = useRef(0);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(
    () =>
      subscribeKnowledge(() => {
        setKnowledge(knowledgeState());
      }),
    [],
  );

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!photo && !panel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      if (photo) setPhoto(false);
      else setPanel(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [photo, panel]);

  useEffect(() => {
    if (!action || action.seq === lastAction.current) return;
    lastAction.current = action.seq;
    switch (action.id) {
      case "shelf":
      case "computer":
      case "trophies":
      case "radio":
      case "launch":
        setPanel(action.id);
        break;
      case "photo":
        setPanel(null);
        setPhoto(true);
        break;
      case "cat":
        setToast("THE BAY CAT — MISO BLINKS, ROLLS OVER, DEMANDS ATTENTION");
        break;
      case "stool":
        setPanel(null);
        setToast("SEATED — VIEW UNLOCKS FROM THE STOOL");
        break;
      case "door":
        setToast(doorOpen ? "DOOR OPENING — DRIVE LIGHT SPILLS IN" : "DOOR CLOSING — MOTOR WINDING DOWN");
        break;
      case "lift":
        setToast(liftUp ? "LIFT RAISING — PUMPS ENGAGED" : "LIFT LOWERING — HYDRAULIC BLEED");
        break;
      case "service":
        setToast(service ? "SERVICE MODE — LANE LIGHTS DIM, LIFT UP" : "SERVICE MODE OFF");
        break;
      default:
        break;
    }
  }, [action, doorOpen, liftUp, service]);

  const time = now.toLocaleTimeString("en-GB", { hour12: false });

  const holdProps = (vehicle: "car" | "bike") => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      onRevStart(vehicle);
    },
    onPointerUp: onRevEnd,
    onPointerLeave: onRevEnd,
    onPointerCancel: onRevEnd,
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if ((event.key === " " || event.key === "Enter") && !event.repeat) {
        event.preventDefault();
        onRevStart(vehicle);
      }
    },
    onKeyUp: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        onRevEnd();
      }
    },
    onBlur: onRevEnd,
  });

  const padProps = (forward: number, strafe: number) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      onMove(forward, strafe);
    },
    onPointerUp: () => onMove(0, 0),
    onPointerLeave: () => onMove(0, 0),
    onPointerCancel: () => onMove(0, 0),
  });

  const pickStation = (index: number) => {
    setStation(index);
    if (index === 0) {
      sound.setStation(0);
      return;
    }
    if (!sound.isOn) onAudio();
    sound.setStation(index);
    sound.setStationMix(tone);
  };

  const pickTone = (value: number) => {
    setTone(value);
    sound.setStationMix(value);
  };

  const capture = () => {
    onCapture();
    setFlash(true);
    window.setTimeout(() => setFlash(false), 220);
    setToast("FRAME SAVED — PNG DOWNLOADED TO THIS MACHINE");
  };

  const selectedCar =
    DIE_CAST_CATALOG.find((entry) => entry.id === diecast) ?? DIE_CAST_CATALOG[0];
  const lastSync = knowledge.lastSync
    ? new Date(knowledge.lastSync).toLocaleTimeString("en-GB", { hour12: false })
    : "NOT YET";

  return (
    <div
      className={`garage${photo ? " garage--photo" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="APEX private garage"
    >
      <div className="garage__backdrop" aria-hidden="true" />

      {!photo && (
        <header className="garage__bar">
          <div className="garage__brand">
            <span className="garage__dot" aria-hidden="true" />
            <b>APEX / PRIVATE GARAGE</b>
            <i>BAY 01 · HOME BAY</i>
          </div>
          <div className="garage__meta">
            <span>{licence}</span>
            <span>{cp} CP</span>
            <span>{unlocks} UNLOCKS</span>
            <b>{time}</b>
          </div>
        </header>
      )}

      {!photo && (
        <aside className="garage__panel">
          <span className="garage__eyebrow">[ SYS.09 — HOME BAY ]</span>
          <h2>THE GARAGE</h2>
          <p className="garage__lede">
            Door up. Lights on. The lift holds the car where you left it. Walk the
            floor, rev the engines, tune the radio and take the car out.
          </p>

          <div className="garage__revs" role="group" aria-label="Hold to rev the engines">
            <button
              type="button"
              {...holdProps("car")}
              aria-label="Hold to rev the V12 biturbo through its gears"
            >
              <span>V12 BITURBO</span>
              <b>HOLD</b>
            </button>
            <button
              type="button"
              {...holdProps("bike")}
              aria-label="Hold to rev the inline-four through its gears"
            >
              <span>INLINE-4</span>
              <b>HOLD</b>
            </button>
          </div>

          <div className="garage__toggle-row">
            <button
              type="button"
              className={doorOpen ? "is-on" : ""}
              onClick={() => onInteract("door")}
            >
              DOOR <b>{doorOpen ? "OPEN" : "SHUT"}</b>
            </button>
            <button
              type="button"
              className={liftUp ? "is-on" : ""}
              onClick={() => onInteract("lift")}
            >
              LIFT <b>{liftUp ? "UP" : "DOWN"}</b>
            </button>
            <button
              type="button"
              className={service ? "is-on" : ""}
              onClick={() => onInteract("service")}
            >
              SERVICE <b>{service ? "ON" : "OFF"}</b>
            </button>
          </div>

          <div className="garage__chips" role="group" aria-label="Garage stations">
            <button type="button" onClick={() => setPanel("shelf")}>DIE-CAST</button>
            <button type="button" onClick={() => setPanel("computer")}>COMPUTER</button>
            <button type="button" onClick={() => setPanel("trophies")}>TROPHIES</button>
            <button type="button" onClick={() => setPanel("radio")}>RADIO</button>
            <button type="button" onClick={() => setPanel("launch")}>LAUNCH</button>
            <button type="button" onClick={() => setPhoto(true)}>PHOTO</button>
          </div>

          <div className="garage__actions">
            <button type="button" onClick={() => onDriveOut("car")}>
              TAKE THE CAR OUT <span aria-hidden="true">▶</span>
            </button>
            <button type="button" onClick={() => onDriveOut("bike")}>
              TAKE THE BIKE OUT <span aria-hidden="true">▶</span>
            </button>
            <button type="button" onClick={onReplay}>
              REPLAY ENTRY <span aria-hidden="true">↻</span>
            </button>
            <button type="button" onClick={onAudio}>
              SOUND {audioOn ? "ON" : "OFF"} <span aria-hidden="true">◉</span>
            </button>
            <button type="button" className="garage__exit" onClick={onExit}>
              LEAVE THE BAY <span aria-hidden="true">ESC</span>
            </button>
          </div>
        </aside>
      )}

      {!photo && focus && !panel && (
        <button type="button" className="garage__focus" onClick={() => onInteract(focus.id)}>
          <kbd>E</kbd>
          <span>{focus.label}</span>
        </button>
      )}

      {!photo && panel && (
        <section className="garage__sheet" role="dialog" aria-label={`${panel} panel`}>
          <header>
            <span>
              {panel === "shelf" && "DIE-CAST SHELF"}
              {panel === "computer" && "BAY COMPUTER"}
              {panel === "trophies" && "CAREER TROPHY WALL"}
              {panel === "radio" && "RADIO TUNER"}
              {panel === "launch" && "LAUNCH CONTROL"}
            </span>
            <button type="button" onClick={() => setPanel(null)} aria-label="Close panel">
              CLOSE ✕
            </button>
          </header>

          {panel === "shelf" && (
            <div className="garage__shelf">
              <p>
                Eight 1:18 die-casts on the lit shelf. Each casting is earned with
                the career part it represents — pick one to read its plate.
              </p>
              <div className="garage__shelf-grid">
                {DIE_CAST_CATALOG.map((entry) => {
                  const open = diecastUnlocked(entry, unlockIds);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={`${entry.id === diecast ? "is-active" : ""}${
                        open ? "" : " is-locked"
                      }`}
                      onClick={() => {
                        setDiecast(entry.id);
                        sound.tick("click");
                      }}
                    >
                      <span
                        className="garage__shelf-swatch"
                        style={{ background: entry.css }}
                        aria-hidden="true"
                      />
                      <b>{entry.name}</b>
                      <span>{open ? entry.year : "LOCKED"}</span>
                    </button>
                  );
                })}
              </div>
              <div className="garage__spec">
                <b>{selectedCar.name}</b>
                <span>{selectedCar.series}</span>
                <i>{selectedCar.spec}</i>
                {selectedCar.unlock && !diecastUnlocked(selectedCar, unlockIds) && (
                  <em>
                    Locked — earn the {selectedCar.unlock.replace(/([A-Z])/g, " $1").toUpperCase()} unlock.
                  </em>
                )}
              </div>
            </div>
          )}

          {panel === "computer" && (
            <div className="garage__computer">
              <p>Bay workstation: paint the car, put the lift into service, sync the local knowledge base.</p>
              <div className="garage__paint">
                <span className="garage__sheet-label">LIVERY PAINTER</span>
                <div className="garage__paint-swatches">
                  {PAINTS.map((entry) => (
                    <button
                      key={entry.name}
                      type="button"
                      title={entry.name}
                      style={{ background: `linear-gradient(135deg, ${entry.base} 48%, ${entry.accent} 52%)` }}
                      className={paint.enabled && paint.base === entry.base ? "is-active" : ""}
                      onClick={() => onPaint({ base: entry.base, accent: entry.accent, enabled: true })}
                    >
                      <span>{entry.name}</span>
                    </button>
                  ))}
                </div>
                <div className="garage__paint-row">
                  <label>
                    NUMBER
                    <input
                      value={paint.number}
                      maxLength={3}
                      onChange={(event) =>
                        onPaint({
                          number: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3),
                          enabled: true,
                        })
                      }
                    />
                  </label>
                  <label className="garage__paint-toggle">
                    <input
                      type="checkbox"
                      checked={paint.stripe}
                      onChange={(event) => onPaint({ stripe: event.target.checked, enabled: true })}
                    />
                    HOOD STRIPE
                  </label>
                  <button type="button" onClick={() => onPaint({ enabled: false })}>
                    RESET
                  </button>
                </div>
              </div>

              <div className="garage__toggle-row">
                <button
                  type="button"
                  className={service ? "is-on" : ""}
                  onClick={() => onInteract("service")}
                >
                  SERVICE MODE <b>{service ? "ON" : "OFF"}</b>
                </button>
              </div>

              <div className="garage__knowledge">
                <span className="garage__sheet-label">LOCAL KNOWLEDGE</span>
                <p>
                  {knowledge.facts.length} facts stored · last sync {lastSync} · {knowledge.syncs} syncs
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void syncKnowledge(true);
                    setToast("KNOWLEDGE SYNC — pulling live sources now");
                  }}
                >
                  SYNC NOW
                </button>
                {knowledge.error && <i>LAST ERROR: {knowledge.error}</i>}
              </div>
            </div>
          )}

          {panel === "trophies" && (
            <div className="garage__tally">
              <p>
                {trophies} of {TROPHY_TIERS.length} trophies on the wall. Every 120
                CP you bank buys another tray of silver.
              </p>
              <div className="garage__tally-grid">
                {TROPHY_TIERS.map((tier, index) => (
                  <span key={tier.label} className={index < trophies ? "is-earned" : ""}>
                    {index < trophies ? "◆" : "◇"} {tier.label} · {tier.cp} CP
                  </span>
                ))}
              </div>
            </div>
          )}

          {panel === "radio" && (
            <div className="garage__stations">
              <p>Bay speakers. The engine mic feed is the honest one.</p>
              <button
                type="button"
                className={station === 0 ? "is-active" : ""}
                onClick={() => pickStation(0)}
              >
                <b>OFF</b>
                <span>silence, just the idle</span>
              </button>
              {STATIONS.map((entry, index) => (
                <button
                  key={entry.name}
                  type="button"
                  className={station === index + 1 ? "is-active" : ""}
                  onClick={() => pickStation(index + 1)}
                >
                  <b>{entry.name}</b>
                  <span>{entry.note}</span>
                </button>
              ))}
              <label className="garage__dial">
                <span>TONE</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(tone * 100)}
                  onChange={(event) => pickTone(Number(event.target.value) / 100)}
                  aria-label="Radio tone"
                />
                <b>{tone < 0.34 ? "TAPE" : tone < 0.7 ? "WARM" : "OPEN"}</b>
              </label>
            </div>
          )}

          {panel === "launch" && (
            <LaunchPractice onReward={onReward} onToast={setToast} />
          )}
        </section>
      )}

      {!photo && (
        <div className="garage__pad" aria-label="Walk controls">
          <button type="button" className="garage__pad-up" {...padProps(1, 0)} aria-label="Walk forward">
            ▲
          </button>
          <button type="button" className="garage__pad-left" {...padProps(0, -1)} aria-label="Strafe left">
            ◀
          </button>
          <button
            type="button"
            className="garage__pad-e"
            onClick={() => focus && onInteract(focus.id)}
            aria-label="Interact with what you are looking at"
          >
            E
          </button>
          <button type="button" className="garage__pad-right" {...padProps(0, 1)} aria-label="Strafe right">
            ▶
          </button>
          <button type="button" className="garage__pad-down" {...padProps(-1, 0)} aria-label="Walk back">
            ▼
          </button>
        </div>
      )}

      {!photo && (
        <p className="garage__hint">
          MOVE POINTER — LOOK · WASD / ARROWS — WALK · SHIFT — SPRINT · E — INTERACT · P — PHOTO
        </p>
      )}

      {!photo && <span className="garage__reticle" aria-hidden="true" />}

      {toast && !photo && (
        <div className="garage__toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}

      {photo && (
        <div className="garage__photo">
          <span className="garage__photo-tag">PHOTO MODE · BAY 01 · {licence}</span>
          <div className="garage__photo-actions">
            <button type="button" onClick={capture}>
              CAPTURE PNG <span aria-hidden="true">◉</span>
            </button>
            <button type="button" onClick={() => setPhoto(false)}>
              EXIT PHOTO <span aria-hidden="true">ESC</span>
            </button>
          </div>
        </div>
      )}

      {flash && <span className="garage__flash" aria-hidden="true" />}
    </div>
  );
}
