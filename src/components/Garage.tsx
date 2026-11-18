import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { loadGarage, type CustomPaint, type GarageEntry, type Weather } from "../lib/scene";
import {
  knowledgeState,
  subscribeKnowledge,
  syncKnowledge,
  type KnowledgeState,
} from "../lib/knowledge";
import { sound } from "../lib/sound";
import { speakRadio } from "../lib/radio";
import { DIE_CAST_CATALOG, diecastUnlocked } from "../lib/diecast";
import { subscribePitMemos, type PitMemo } from "../lib/pitMemos";
import { formatLap, loadBoard, type DriveEntry } from "../lib/driveStore";
import type { CareerState } from "../lib/career";

type GarageAction = { id: string; seq: number };
type CarePet = "dog" | "cat" | "turtles";
type PetCareStats = Record<CarePet, { affection: number; treats: number }>;
const PET_CARE_KEY = "apex-pet-care-v1";
const petCareDay = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
function loadPetCare(): PetCareStats {
  const defaults: PetCareStats = { dog: { affection: 18, treats: 3 }, cat: { affection: 18, treats: 3 }, turtles: { affection: 18, treats: 3 } };
  try {
    const raw = JSON.parse(localStorage.getItem(PET_CARE_KEY) || "null") as { day?: unknown; pets?: Partial<PetCareStats> } | null;
    if (!raw || typeof raw !== "object") return defaults;
    const pets = { ...defaults };
    for (const id of ["dog", "cat", "turtles"] as const) {
      const value = raw.pets?.[id];
      if (value) pets[id] = {
        affection: Math.max(0, Math.min(100, Math.round(Number(value.affection) || 0))),
        treats: raw.day === petCareDay() ? Math.max(0, Math.min(3, Math.round(Number(value.treats) || 0))) : 3,
      };
    }
    return pets;
  } catch { return defaults; }
}

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
  weather: Weather;
  rainAmount: number;
  night: boolean;
  onNightMode: () => void;
  windSpeed: number;
  onPaint: (patch: Partial<CustomPaint>) => void;
  onDriveOut: (vehicle: "car" | "bike") => void;
  onSummon: (vehicle: "car" | "bike") => void;
  onCapture: () => void;
  onReward: () => void;
  onForecast: () => void;
  onIdleLearning: (active: boolean, whisper: string) => void;
  onPetCare: (pet: CarePet, action: "pet" | "treat") => void;
  trophies: number;
  season: CareerState;
};

type Panel = null | "shelf" | "computer" | "trophies" | "radio" | "launch" | "season" | "pets";
type MemoryPreview = { kind: "lap"; entry: DriveEntry } | { kind: "build"; entry: GarageEntry };

const STATIONS = [
  { name: "PIT FM", note: "race control + team radio" },
  { name: "SYNTH 88", note: "midnight drive synthwave" },
  { name: "V12 AM", note: "engine mic, no commentary" },
  { name: "LO-FI BAY", note: "tape hiss, crackle, midnight chords" },
];

const RADIO_CONSTELLATIONS = [
  [[50,8],[72,18],[92,50],[72,82],[50,92],[28,82],[8,50],[28,18],[50,28],[70,50],[50,72],[30,50]],
  [[50,8],[71,13],[87,29],[92,50],[87,71],[71,87],[50,92],[29,87],[13,71],[8,50],[13,29],[29,13]],
  [[50,8],[65,23],[82,35],[92,50],[72,58],[65,77],[50,92],[35,77],[18,65],[8,50],[28,42],[35,23]],
  [[50,8],[72,18],[84,38],[92,50],[74,65],[68,84],[50,92],[36,75],[14,70],[8,50],[27,35],[34,17]],
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
  const [countdown, setCountdown] = useState<number | null>(null);
  const rpmRef = useRef(0);
  const timer = useRef<number | null>(null);
  const countdownTimer = useRef<number | null>(null);
  const countdownValue = useRef(0);
  const live = useRef(false);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);
  useEffect(() => () => { if (countdownTimer.current !== null) window.clearInterval(countdownTimer.current); }, []);

  const stage = useCallback(() => {
    if (countdownTimer.current !== null) window.clearInterval(countdownTimer.current);
    countdownValue.current = 3;
    setCountdown(3);
    speakRadio("Three");
    countdownTimer.current = window.setInterval(() => {
      const next = countdownValue.current - 1;
      countdownValue.current = next;
      setCountdown(next);
      speakRadio(next > 0 ? String(next) : "Go");
      sound.tick("start");
      if (next <= 0) {
        if (countdownTimer.current !== null) window.clearInterval(countdownTimer.current);
        countdownTimer.current = null;
        onToast("GREEN LIGHT — launch practice is staged");
        window.setTimeout(() => setCountdown(null), 900);
      }
    }, 1000);
  }, [onToast]);

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
      <button type="button" className="garage__launch-stage" onClick={stage} disabled={countdown !== null && countdown > 0}>
        <span>STAGE LAUNCH</span><b>3 SEC / VOICE COUNT</b>
      </button>
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
      {countdown !== null && (
        <div className="garage__launch-clock" role="status" aria-live="assertive" aria-label={countdown === 0 ? "Go" : `${countdown} seconds to launch`}>
          <svg viewBox="0 0 120 120" aria-hidden="true"><circle className="launch-clock__track" cx="60" cy="60" r="50"/><circle className="launch-clock__sweep" cx="60" cy="60" r="50" style={{ strokeDashoffset: `${314 * (1 - (3 - countdown) / 3)}` }}/><text x="60" y="67">{countdown === 0 ? "GO" : countdown}</text></svg>
          <span>{countdown === 0 ? "GREEN LIGHT" : "STAGED SEQUENCE"}</span>
        </div>
      )}
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
  weather,
  rainAmount,
  night,
  onNightMode,
  windSpeed,
  onPaint,
  onDriveOut,
  onSummon,
  onCapture,
  onReward,
  onForecast,
  onIdleLearning,
  onPetCare,
  trophies,
  season,
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
  const [memos, setMemos] = useState<PitMemo[]>([]);
  const [bestLapPlaques] = useState(() => [...loadBoard("car"), ...loadBoard("bike")].sort((a, b) => a.time - b.time).slice(0, 4));
  const [savedPlaybooks] = useState(() => loadGarage().slice(0, 4));
  const [memoryPreview, setMemoryPreview] = useState<MemoryPreview | null>(null);
  const [selectedSeasonDay, setSelectedSeasonDay] = useState<string | null>(null);
  const [idleLearningEnabled, setIdleLearningEnabled] = useState(() => {
    try { return localStorage.getItem("apex-scotch-idle-learning") !== "off"; } catch { return true; }
  });
  const [garageIdle, setGarageIdle] = useState(false);
  const [petCareStats, setPetCareStats] = useState<PetCareStats>(() => loadPetCare());
  const [selectedPet, setSelectedPet] = useState<CarePet>("dog");
  const [careAction, setCareAction] = useState<"pet" | "treat" | null>(null);
  const [careMessage, setCareMessage] = useState("Choose a friend, then give them some attention.");
  const offerPetCare = useCallback((kind: "pet" | "treat", pet: CarePet = selectedPet) => {
    const petInfo = petCareStats[pet];
    const petName = pet === "dog" ? "SCOTCH" : pet === "cat" ? "MARIO" : "MR & MRS TURTLE";
    if (kind === "treat" && petInfo.treats <= 0) {
      setCareMessage(`${petName} is all out of treats for today. Come back tomorrow.`);
      sound.tick("click");
      return;
    }
    const next = { ...petCareStats, [pet]: {
      affection: Math.min(100, petInfo.affection + (kind === "pet" ? 5 : 18)),
      treats: petInfo.treats - (kind === "treat" ? 1 : 0),
    } };
    setPetCareStats(next);
    try { localStorage.setItem(PET_CARE_KEY, JSON.stringify({ day: petCareDay(), pets: next })); } catch { /* care still works for this visit */ }
    setSelectedPet(pet);
    setCareAction(kind);
    setCareMessage(kind === "pet" ? `${petName} leans into your hand. Bond ${next[pet].affection}%.` : `${petName} got a treat. Bond ${next[pet].affection}%.`);
    onPetCare(pet, kind);
    sound.tick(kind === "treat" ? "start" : "click");
    window.clearTimeout(careAnimationTimer.current);
    careAnimationTimer.current = window.setTimeout(() => setCareAction(null), 1900);
  }, [onPetCare, petCareStats, selectedPet]);
  const careAnimationTimer = useRef(0);
  const memoTimers = useRef(new Map<number, number>());
  // Seed from the incoming action so a stale action held by App while the
  // garage was closed does not replay on the next entry.
  const lastAction = useRef(action?.seq ?? 0);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => () => window.clearTimeout(careAnimationTimer.current), []);

  useEffect(() => {
    let timer = 0;
    const whisper = memos[memos.length - 1]?.text ?? "Clean entry. Patient throttle. Tidy exit.";
    const resetIdle = () => {
      window.clearTimeout(timer);
      setGarageIdle(false);
      onIdleLearning(false, whisper);
      if (idleLearningEnabled) timer = window.setTimeout(() => {
        setGarageIdle(true);
        onIdleLearning(true, whisper);
      }, 45_000);
    };
    if (idleLearningEnabled) timer = window.setTimeout(() => {
      setGarageIdle(true);
      onIdleLearning(true, whisper);
    }, 45_000);
    else onIdleLearning(false, whisper);
    window.addEventListener("pointerdown", resetIdle, { passive: true });
    window.addEventListener("keydown", resetIdle);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", resetIdle);
      window.removeEventListener("keydown", resetIdle);
      onIdleLearning(false, whisper);
    };
  }, [idleLearningEnabled, memos, onIdleLearning]);

  useEffect(() => {
    const unsubscribe = subscribePitMemos((memo) => {
      setMemos((current) => [...current.slice(-2), memo]);
      const timer = window.setTimeout(() => {
        setMemos((current) => current.filter((item) => item.id !== memo.id));
        memoTimers.current.delete(memo.id);
      }, 5200);
      memoTimers.current.set(memo.id, timer);
    });
    return () => {
      unsubscribe();
      memoTimers.current.forEach((timer) => window.clearTimeout(timer));
      memoTimers.current.clear();
    };
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
    if (photo) return;
    const onFetchKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "f" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      onInteract("fetch-trophy");
    };
    window.addEventListener("keydown", onFetchKey);
    return () => window.removeEventListener("keydown", onFetchKey);
  }, [photo, onInteract]);

  useEffect(() => {
    if (!action || action.seq === lastAction.current) return;
    lastAction.current = action.seq;
    switch (action.id) {
      case "shelf":
      case "computer":
      case "trophies":
      case "radio":
      case "launch":
      case "season":
      case "pets":
        setPanel(action.id);
        break;
      case "photo":
        setPanel(null);
        setPhoto(true);
        break;
      case "cat":
      case "dog":
      case "turtles":
        setPanel("pets");
        offerPetCare("pet", action.id);
        break;
      case "summon-car":
        setToast("SCOTCH RECOGNIZES THE CAR — EARS UP, TAIL WAGGING");
        break;
      case "summon-bike":
        setToast("SCOTCH RECOGNIZES THE BIKE — CURIOUS HEAD TILT, TAIL WAGGING");
        break;
      case "stool":
        setPanel(null);
        setToast("SEATED — VIEW UNLOCKS FROM THE STOOL");
        break;
      case "door":
        setToast(doorOpen ? "SCOTCH / DOOR'S OPEN — READY WHEN YOU ARE" : "SCOTCH / HEARD THE DOOR — SETTLING BACK INTO THE BAY");
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
  }, [action, doorOpen, liftUp, offerPetCare, service]);

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
  const selectedPetName = selectedPet === "dog" ? "SCOTCH" : selectedPet === "cat" ? "MARIO" : "MR & MRS TURTLE";
  const selectedPetInfo = petCareStats[selectedPet];
  const seasonDays = season.activeDays.slice(-12);
  const selectedDay = selectedSeasonDay && seasonDays.includes(selectedSeasonDay)
    ? selectedSeasonDay
    : seasonDays[seasonDays.length - 1] ?? null;
  const selectedDayIds = selectedDay ? season.eventIds.filter((id) => id.includes(selectedDay)) : [];
  const dayLaps = selectedDayIds.filter((id) => id.startsWith(`lap-${selectedDay}`)).length;
  const dayMissions = selectedDayIds.filter((id) => id.startsWith(`mission-${selectedDay}`)).length;
  const firstSeasonDay = season.activeDays[0];
  const seasonSpan = firstSeasonDay
    ? Math.max(1, Math.floor((new Date(`${season.activeDays[season.activeDays.length - 1]}T12:00:00`).getTime() - new Date(`${firstSeasonDay}T12:00:00`).getTime()) / 86_400_000) + 1)
    : 0;

  return (
    <div
      className={`garage${photo ? " garage--photo" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="APEX private garage"
    >
      <div className="garage__backdrop" aria-hidden="true" />

      {!photo && (
        <aside className={`garage__weather-mural${weather === "rain" ? " is-rain" : ""}${night ? " is-night" : ""}`} aria-label={`${weather === "rain" ? `Rain ${(rainAmount * 100).toFixed(0)} percent` : "Clear weather"}, ${night ? "night" : "day"}, wind ${Math.round(windSpeed)} kilometers per hour`}>
          <svg viewBox="0 0 180 88" role="img" aria-label="Abstract live weather painting">
            <defs><linearGradient id="garageWeatherStroke" x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--weather-a)"/><stop offset="1" stopColor="var(--weather-b)"/></linearGradient></defs>
            <path className="weather-stroke weather-stroke--one" d="M8 60 C38 18 51 72 83 38 S126 19 171 49" />
            <path className="weather-stroke weather-stroke--two" d="M8 69 C40 40 59 84 94 54 S137 37 171 62" />
            <path className="weather-stroke weather-stroke--three" d="M18 34 C42 12 58 40 82 23 S128 7 160 28" />
            {weather === "rain" && [0,1,2,3,4,5,6].map((drop) => <path key={drop} className="weather-drop" d={`M${20 + drop * 23} ${18 + (drop % 3) * 14} l-5 12`} style={{ animationDelay: `${drop * -0.21}s` }} />)}
            {weather === "rain" && <g className="weather-constellation" aria-hidden="true"><path d="M24 17 48 11 65 24 91 14 111 28 139 17 160 30"/><path d="M48 11 52 34 91 14 88 39 111 28 120 48 160 30"/>{[[24,17],[48,11],[65,24],[91,14],[111,28],[139,17],[160,30],[52,34],[88,39],[120,48]].map(([cx,cy], index) => <circle key={index} cx={cx} cy={cy} r={index % 3 === 0 ? 1.8 : 1.2} style={{ animationDelay: `${index * -.27}s` }} />)}</g>}
          </svg>
          <div><b>{night ? "NOCTURNE" : "DAYLIGHT"} / {weather === "rain" ? "RAIN STUDY" : "CLEAR AIR"}</b><span>WIND {Math.round(windSpeed)} KM/H · {weather === "rain" ? `PRECIP ${Math.round(rainAmount * 100)}%` : "DRY LINE"}</span></div>
        </aside>
      )}

      {!photo && memos.length > 0 && (
        <aside className="garage__memo-slugs" aria-label="Recent Cyrus pit-wall notes" aria-live="polite">
          {memos.map((memo) => (
            <div className="garage__memo-slug" key={memo.id}>
              <b>CYRUS / PIT NOTE</b><span>{memo.text}</span>
            </div>
          ))}
        </aside>
      )}

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
          <button type="button" className={`garage__goodnight${night ? " is-on" : ""}`} onClick={onNightMode} aria-pressed={night}>
            <span>{night ? "GOOD NIGHT MODE" : "DIM THE BAY / GOOD NIGHT"}</span><b>{night ? "☾" : "✧"}</b>
          </button>
          <button type="button" className="garage__fetch-quest" onClick={() => onInteract("fetch-trophy")}>
            <span>SCOTCH / FETCH THE TROPHY</span><kbd>F</kbd>
          </button>
          <button type="button" className={`garage__idle-learning${idleLearningEnabled ? " is-on" : ""}`} aria-pressed={idleLearningEnabled} onClick={() => {
            const enabled = !idleLearningEnabled;
            setIdleLearningEnabled(enabled);
            try { localStorage.setItem("apex-scotch-idle-learning", enabled ? "on" : "off"); } catch { /* session toggle still works */ }
            if (!enabled) { setGarageIdle(false); onIdleLearning(false, ""); }
          }}>
            <span>SCOTCH / IDLE MEMORY</span><b>{idleLearningEnabled ? garageIdle ? "RESTING" : "ARMED" : "OFF"}</b>
          </button>

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
            <button type="button" onClick={() => setPanel("season")}>SEASON</button>
            <button type="button" onClick={onForecast}>NEXT RUN</button>
            <button type="button" onClick={() => setPanel("pets")}>PET CARE</button>
            <button type="button" onClick={() => setPhoto(true)}>PHOTO</button>
          </div>

          <div className="garage__actions">
            <button type="button" className="garage__summon" onClick={() => onSummon("car")}>
              ASSEMBLE THE CAR <span aria-hidden="true">✦</span>
            </button>
            <button type="button" className="garage__summon" onClick={() => onSummon("bike")}>
              ASSEMBLE THE BIKE <span aria-hidden="true">✦</span>
            </button>
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

      {!photo && !panel && focus?.id === "trophies" && (
        <aside className="garage__trophy-projection-note" role="status" aria-live="polite">
          <b>SCOTCH / TROPHY SCAN</b>
          <span>{trophies} of {TROPHY_TIERS.length} trophies earned. {trophies >= TROPHY_TIERS.length ? "The shelf is complete." : `${TROPHY_TIERS.length - trophies} ${TROPHY_TIERS.length - trophies === 1 ? "milestone remains" : "milestones remain"}.`}</span>
        </aside>
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
              {panel === "season" && "HOLOGRAPHIC SEASON CALENDAR"}
              {panel === "pets" && "PET CARE / LITTLE GARAGE GAME"}
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
              <section className="garage__memory-shelf" aria-label="Memory lane garage shelf">
                <header><b>MEMORY LANE</b><span>BEST LAPS / SAVED PLAYBOOKS</span></header>
                <div className="garage__memory-plaques">
                  {bestLapPlaques.map((entry) => <button key={entry.id} type="button" onClick={() => setMemoryPreview({ kind: "lap", entry })}>
                    <i>GHOST LAP · {entry.vehicle.toUpperCase()}</i><b>{formatLap(entry.time)}</b><span>{entry.sectors.map(formatLap).join(" / ")}</span>
                  </button>)}
                  {savedPlaybooks.map((entry) => <button key={entry.id} type="button" onClick={() => setMemoryPreview({ kind: "build", entry })}>
                    <i>SAVED PLAYBOOK</i><b>{entry.name}</b><span>{entry.config.livery.toUpperCase()} · {new Date(entry.createdAt).toLocaleDateString()}</span>
                  </button>)}
                  {bestLapPlaques.length + savedPlaybooks.length === 0 && <p>Run a clean lap or save a setup to leave the first memory on this shelf.</p>}
                </div>
                {memoryPreview && <div className="garage__memory-preview" role="status" aria-live="polite">
                  <div><b>{memoryPreview.kind === "lap" ? `REPLAY · ${memoryPreview.entry.vehicle.toUpperCase()} SECTOR TRACE` : `PLAYBOOK · ${memoryPreview.entry.name}`}</b><button type="button" onClick={() => setMemoryPreview(null)} aria-label="Close memory preview">×</button></div>
                  <svg viewBox="0 0 220 48" aria-hidden="true"><path d="M3 37 C22 35 24 13 48 18 S68 43 92 27 S119 7 141 16 S174 42 217 9"/><path d="M3 37 C22 35 24 13 48 18 S68 43 92 27 S119 7 141 16 S174 42 217 9" className="is-glow"/></svg>
                  <span>{memoryPreview.kind === "lap" ? `PERSONAL BEST ${formatLap(memoryPreview.entry.time)} · ${memoryPreview.entry.sectors.map(formatLap).join(" / ")}` : `SAVED ${memoryPreview.entry.config.livery.toUpperCase()} LIVERY · TAP TO REOPEN THE SETUP IN THE WIND TUNNEL`}</span>
                </div>}
              </section>
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

          {panel === "season" && (
            <div className="garage__season">
              <p>Career time is counted from your saved garage days. Tap a glowing mark to revisit what you logged that day.</p>
              <div className="garage__season-summary">
                <span><b>{seasonSpan}</b> DAYS IN SEASON</span>
                <span><b>{season.activeDays.length}</b> ACTIVE DAYS</span>
                <span><b>{Math.floor(season.distanceM / 1000)}</b> KM DRIVEN</span>
              </div>
              <div className="garage__season-ring" role="group" aria-label="Career activity calendar">
                <svg viewBox="0 0 220 220" aria-hidden="true"><circle cx="110" cy="110" r="78"/><circle cx="110" cy="110" r="57"/><path d="M110 12v22M208 110h-22M110 208v-22M12 110h22"/></svg>
                <div className="garage__season-core"><b>SEASON</b><span>{season.activeDays.length ? `${season.activeDays.length} LOGGED` : "AWAITING FIRST RUN"}</span></div>
                {seasonDays.map((day, index) => {
                  const angle = (index / Math.max(1, seasonDays.length)) * Math.PI * 2 - Math.PI / 2;
                  const left = 50 + Math.cos(angle) * 43;
                  const top = 50 + Math.sin(angle) * 43;
                  return <button key={day} type="button" className={day === selectedDay ? "is-selected" : ""} style={{ left: `${left}%`, top: `${top}%` }} onClick={() => setSelectedSeasonDay(day)} aria-label={`Show career notes for ${day}`} title={day}>{String(index + 1).padStart(2, "0")}</button>;
                })}
              </div>
              <div className="garage__season-note" aria-live="polite">
                <b>{selectedDay ? new Date(`${selectedDay}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "YOUR FIRST DAY IS WAITING"}</b>
                <span>{selectedDay ? dayLaps || dayMissions ? `You logged ${dayLaps} ${dayLaps === 1 ? "lap" : "laps"}${dayMissions ? ` and completed ${dayMissions} ${dayMissions === 1 ? "mission" : "missions"}` : ""}. A marker in your APEX season.` : "You spent time in the garage and saved this day to your APEX season." : "Drive a lap or complete a mission to place your first mark on the calendar."}</span>
              </div>
            </div>
          )}

          {panel === "pets" && (
            <div className="garage__pet-care">
              <p>Spend a moment with the three garage pets. Petting builds your bond; treats are limited to three per friend each day.</p>
              <div className="garage__pet-select" role="group" aria-label="Choose a pet">
                {(["dog", "cat", "turtles"] as const).map((pet) => <button key={pet} type="button" className={selectedPet === pet ? "is-selected" : ""} onClick={() => { setSelectedPet(pet); setCareAction(null); setCareMessage("Ready for a little attention."); }}>
                  <span aria-hidden="true">{pet === "dog" ? "🐕" : pet === "cat" ? "🐈" : "🐢"}</span><b>{pet === "dog" ? "SCOTCH" : pet === "cat" ? "MARIO" : "TURTLES"}</b>
                </button>)}
              </div>
              <div className="garage__pet-game" data-action={careAction ?? "idle"}>
                <div className="garage__pet-avatar" aria-hidden="true"><span>{selectedPet === "dog" ? "🐕" : selectedPet === "cat" ? "🐈" : "🐢"}</span><i>✦</i><b>{careAction === "treat" ? selectedPet === "dog" ? "🍪" : selectedPet === "cat" ? "🐟" : "🥬" : "✋"}</b></div>
                <div className="garage__pet-stats"><strong>{selectedPetName}</strong><span>{selectedPet === "dog" ? "WHITE LABRADOR" : selectedPet === "cat" ? "WHITE PERSIAN" : "MR & MRS TURTLE"}</span><div className="garage__pet-hearts" aria-label={"Bond " + selectedPetInfo.affection + " out of 100"}>{Array.from({ length: 5 }, (_, index) => <i key={index} className={selectedPetInfo.affection >= (index + 1) * 20 ? "is-filled" : ""}>♥</i>)}</div><div className="garage__pet-bond"><i style={{ width: selectedPetInfo.affection + "%" }} /></div><small>BOND {selectedPetInfo.affection}% · TREATS {selectedPetInfo.treats}/3</small></div>
              </div>
              <div className="garage__pet-actions">
                <button type="button" onClick={() => offerPetCare("pet")}>PET {selectedPetName}</button>
                <button type="button" className="is-treat" onClick={() => offerPetCare("treat")} disabled={selectedPetInfo.treats <= 0}>GIVE {selectedPet === "dog" ? "BISCUIT" : selectedPet === "cat" ? "FISH TREAT" : "LEAF"}</button>
              </div>
              <div className="garage__pet-message" role="status" aria-live="polite">{careMessage}</div>
              <small className="garage__pet-footnote">Treats refill daily. Bond and treat counts are saved on this device.</small>
            </div>
          )}

          {panel === "radio" && (
            <div className="garage__stations">
              <p>Bay speakers. The engine mic feed is the honest one.</p>
              <div className={`garage__constellation is-${station}`} aria-hidden="true">
                <svg viewBox="0 0 100 100" focusable="false">
                  <polyline points={RADIO_CONSTELLATIONS[Math.max(0, station - 1)].map(([x, y]) => `${x},${y}`).join(" ")} />
                  <circle className="garage__constellation-core" cx="50" cy="50" r="4" />
                </svg>
                {RADIO_CONSTELLATIONS[Math.max(0, station - 1)].map(([x, y], index) => (
                  <i key={index} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${index * -0.13}s` }} />
                ))}
              </div>
              <p className={`garage__constellation-label is-${station}`} aria-live="polite">
                {station === 0 ? "RADIO SILENT · IDLE ONLY" : `${STATIONS[station - 1].name} · SIGNAL CONSTELLATION`}
              </p>
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
