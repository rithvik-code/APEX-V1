import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApexEngine } from "./three/Engine";
import { Terminal } from "./components/Terminal";
import type { CoreVariant } from "./components/CoreLab";
import { GridDeck } from "./components/GridDeck";
import { Takeover } from "./components/Takeover";
import { Preloader } from "./components/Preloader";
import { Cursor } from "./components/Cursor";
import { AeroDock, AeroLaunch, type DockBridge, type DockStatus } from "./components/AeroDock";
import { DriveHUD, type TrackOutline } from "./components/DriveHUD";
import { Garage } from "./components/Garage";
import type { GarageView } from "./three/garage";
import type { DriveHudState, DriveVehicle } from "./three/drive";
import { DEFAULT_DRIVE_SETUP, type DriveSetup } from "./lib/driveStore";
import {
  addDistance,
  awardCareer,
  currentLicence,
  loadCareer,
  unlockSet,
  type CareerEvent,
  type CareerState,
} from "./lib/career";
import { useControl } from "./hooks/useControl";
import { sound } from "./lib/sound";
import { downloadBlob } from "./lib/clip";
import {
  aeroTelemetry,
  CAMERA_PRESETS,
  DEFAULT_SCENE,
  dynoPoint,
  LIVERIES,
  readSetupFromUrl,
  type SceneConfig,
} from "./lib/scene";

const CoreLab = lazy(() =>
  import("./components/CoreLab").then((module) => ({ default: module.CoreLab })),
);

const CHAPTERS = [
  { id: "top", n: "00", label: "IGNITION" },
  { id: "manifesto", n: "01", label: "MANIFESTO" },
  { id: "machine", n: "02", label: "MACHINE" },
  { id: "pitwall", n: "03", label: "PIT WALL" },
  { id: "grid", n: "04", label: "GRID" },
  { id: "vast", n: "05", label: "VAST" },
  { id: "install", n: "06", label: "SPAWN" },
];

const ANCHORS = [
  { id: "car-aero", index: "A-01", label: "ACTIVE AERO", value: "1,240 KG DOWNFORCE" },
  { id: "car-sprint", index: "A-02", label: "0–100 TOKENS", value: "0.14 SEC" },
  { id: "car-core", index: "A-03", label: "INFERENCE CORE", value: "LOCAL / 32K" },
  { id: "car-v12", index: "A-04", label: "V12 BITURBO", value: "6.5L / 48 VALVES" },
  { id: "bike-power", index: "B-01", label: "OUTPUT", value: "210 HP / 32K CTX" },
  { id: "bike-mass", index: "B-02", label: "DRY MASS", value: "186 KG" },
  { id: "bike-aero", index: "B-03", label: "AERO SHELL", value: "0.21 CD" },
  { id: "bike-dohc", index: "B-04", label: "DOHC / 16V", value: "IN-LINE FOUR" },
];

const BLUEPRINT = [
  ["01", "INFERENCE CORE", "Local Ollama / any GGUF model"],
  ["02", "CONTEXT", "32,768 tokens, up to the model max"],
  ["03", "TRANSPORT", "HTTP + NDJSON stream, no socket"],
  ["04", "PROMPT", "User-owned system string, no rewrite"],
  ["05", "TELEMETRY", "None. No analytics. No callbacks."],
  ["06", "RUNTIME", "Node 18+, 186 MB cold"],
  ["07", "PROVIDERS", "Ollama, any OpenAI-compatible endpoint"],
  ["08", "LICENSE", "Yours. Runs offline forever."],
];

const INSTALL_CMD = "npm install -g ./cli";

const SECTOR_COUNT = String(CHAPTERS.length - 1).padStart(2, "0");

function SectionHead({
  index,
  title,
  meta,
}: {
  index: string;
  title: string;
  meta: string;
}) {
  return (
    <header className="section-head" data-reveal>
      <span className="section-head__index">{index} /</span>
      <h2>{title}</h2>
      <span className="section-head__meta">{meta}</span>
    </header>
  );
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied("failed");
      window.setTimeout(() => setCopied(null), 1800);
    }
  }, []);
  return { copied, copy };
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ApexEngine | null>(null);
  const progressBarRef = useRef<HTMLSpanElement>(null);
  const progressTextRef = useRef<HTMLSpanElement>(null);
  const pausedRef = useRef(false);

  const [booting, setBooting] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState("top");
  const [audioOn, setAudioOn] = useState(false);
  const [blueprintOpen, setBlueprintOpen] = useState(false);
  const [coreView, setCoreView] = useState<CoreVariant | null>(null);
  const [takeover, setTakeover] = useState(false);
  const [takeoverGoal, setTakeoverGoal] = useState<string | undefined>(undefined);
  const [scene, setScene] = useState<SceneConfig>(() => {
    const shared = readSetupFromUrl();
    return shared ? { ...DEFAULT_SCENE, ...shared, aero: true } : DEFAULT_SCENE;
  });
  const sceneRef = useRef(scene);
  const [dockStatus, setDockStatus] = useState<DockStatus>({
    isClipping: false,
    isRecordingLap: false,
    lapElapsed: 0,
    isReplaying: false,
    replayPaused: false,
    replayTime: 0,
    replayDuration: 0,
  });
  const audioLockedRef = useRef(false);
  const [drive, setDrive] = useState<{ vehicle: DriveVehicle } | null>(null);
  const [driveHud, setDriveHud] = useState<DriveHudState | null>(null);
  const [driveTrack, setDriveTrack] = useState<TrackOutline | null>(null);
  const [driveSetup, setDriveSetup] = useState<DriveSetup>(DEFAULT_DRIVE_SETUP);
  const driveSetupRef = useRef(driveSetup);
  const [garage, setGarage] = useState<GarageView | null>(null);
  const [career, setCareer] = useState<CareerState>(() => loadCareer());
  const careerRef = useRef(career);
  const careerDistanceRef = useRef(0);
  const pendingDistanceRef = useRef(0);
  const missionStatusRef = useRef("");
  const [rankUp, setRankUp] = useState<string | null>(null);
  const control = useControl();
  const { copied, copy } = useCopy();

  const applyCareer = useCallback((next: CareerState) => {
    careerRef.current = next;
    setCareer(next);
  }, []);

  const award = useCallback((event: CareerEvent) => {
    const result = awardCareer(careerRef.current, event);
    if (result.gained <= 0 && !result.rankUp) return;
    careerRef.current = result.state;
    setCareer(result.state);
    if (result.rankUp) {
      setRankUp(`LICENCE ${String(result.rankUp.index).padStart(2, "0")} // ${result.rankUp.name}`);
      window.setTimeout(() => setRankUp(null), 5200);
      sound.tick("start");
    }
  }, []);

  const activeChapter = CHAPTERS.find((c) => c.id === active) ?? CHAPTERS[0];
  const licenceName = currentLicence(career.cp).name;
  const unlockCount = useMemo(() => unlockSet(career).size, [career]);

  const openTakeover = useCallback((goal?: string) => {
    sound.tick("start");
    // GridDeck wires this straight to onClick, so a MouseEvent can arrive here;
    // only a real string goal is treated as a handoff from the chat terminal.
    const text = typeof goal === "string" ? goal.trim() : "";
    setTakeoverGoal(text || undefined);
    if (text) {
      try {
        localStorage.setItem("apex.control.goal", text);
      } catch {
        // Storage can be unavailable in private contexts.
      }
    }
    setTakeover(true);
  }, []);

  const closeTakeover = useCallback(() => setTakeover(false), []);

  const scrollToId = useCallback((id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  }, []);

  const updateScene = useCallback(
    (patch: Partial<SceneConfig>) => {
      setScene((prev) => ({ ...prev, ...patch }));
      if (patch.camera || patch.focus) scrollToId("top");
    },
    [scrollToId],
  );

  const tuneScene = useCallback(
    (patch: Partial<SceneConfig>) => {
      setScene((prev) => ({ ...prev, ...patch, aero: true }));
      scrollToId("top");
    },
    [scrollToId],
  );

  const toggleAero = useCallback(() => {
    const next = !sceneRef.current.aero;
    setScene((prev) => ({ ...prev, aero: next }));
    if (next) {
      sound.whoosh();
      if (!audioLockedRef.current && !sound.isOn) {
        setAudioOn(sound.toggle());
      }
      window.setTimeout(() => scrollToId("top"), 60);
    }
  }, [scrollToId]);

  const launchDrive = useCallback((vehicle: DriveVehicle = "car") => {
    const engine = engineRef.current;
    if (!engine) return;
    sound.tick("start");
    setCoreView(null);
    setTakeover(false);
    engine.enterDrive(vehicle, driveSetupRef.current, {
      wet: sceneRef.current.weather === "rain",
      night: sceneRef.current.nightRace,
    });
    setDriveTrack(engine.getTrackOutline());
    setDriveHud(engine.getDriveState());
    setDrive({ vehicle });
  }, []);

  const exitDrive = useCallback(() => {
    engineRef.current?.exitDrive();
    setDrive(null);
    setDriveHud(null);
    setDriveTrack(null);
    sound.tick("click");
  }, []);

  const openGarage = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (drive) {
      engine.exitDrive();
      setDrive(null);
      setDriveHud(null);
      setDriveTrack(null);
    }
    setCoreView(null);
    setTakeover(false);
    if (sceneRef.current.aero) setScene((prev) => ({ ...prev, aero: false }));
    sound.tick("start");
    sound.whoosh();
    if (!audioLockedRef.current && !sound.isOn) setAudioOn(sound.toggle());
    engine.enterGarage("third");
    setGarage("third");
  }, [drive]);

  const closeGarage = useCallback(() => {
    engineRef.current?.exitGarage();
    setGarage(null);
    sound.tick("click");
  }, []);

  const switchGarageView = useCallback((view: GarageView) => {
    engineRef.current?.setGarageView(view);
    setGarage(view);
    sound.tick("click");
  }, []);

  const replayGarage = useCallback(() => {
    engineRef.current?.replayGarageEntry();
    sound.whoosh();
    sound.tick("start");
  }, []);

  const revVehicle = useCallback((vehicle: "car" | "bike") => {
    if (!audioLockedRef.current && !sound.isOn) {
      setAudioOn(sound.toggle());
    }
    sound.revEngine(vehicle);
    engineRef.current?.revVehicle(vehicle);
  }, []);

  const switchDriveVehicle = useCallback(
    (vehicle: DriveVehicle) => {
      const engine = engineRef.current;
      if (!engine || drive?.vehicle === vehicle) return;
      engine.enterDrive(vehicle, driveSetupRef.current, {
        wet: sceneRef.current.weather === "rain",
        night: sceneRef.current.nightRace,
      });
      setDriveTrack(engine.getTrackOutline());
      setDriveHud(engine.getDriveState());
      setDrive({ vehicle });
      sound.tick("click");
    },
    [drive],
  );

  const updateDriveSetup = useCallback((patch: Partial<DriveSetup>) => {
    setDriveSetup((prev) => {
      const next = { ...prev, ...patch };
      driveSetupRef.current = next;
      engineRef.current?.setDriveSetup(next);
      return next;
    });
  }, []);

  const toggleDriveGhost = useCallback((enabled: boolean) => {
    engineRef.current?.setDriveGhost(enabled);
    setDriveHud(engineRef.current?.getDriveState() ?? null);
    sound.tick("click");
  }, []);

  const exportScene = useCallback(() => {
    const url = engineRef.current?.exportPNG();
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = "apex-wind-tunnel.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
    sound.tick("start");
  }, []);

  const randomizeScene = useCallback(() => {
    const pick = <T,>(list: ReadonlyArray<T>): T =>
      list[Math.floor(Math.random() * list.length)];
    sound.tick("start");
    setScene((prev) => ({
      ...prev,
      livery: pick(LIVERIES).id,
      colorMode: pick(["velocity", "pressure", "acid"] as const),
      lighting: pick(["studio", "midnight", "neon"] as const),
      windSpeed: 80 + Math.floor(Math.random() * 64) * 5,
      turbulence: Math.round(Math.random() * 16) * 5 / 100,
      density: 0.4 + Math.round(Math.random() * 12) * 5 / 100,
    }));
  }, []);

  const resetScene = useCallback(() => {
    sound.tick("click");
    setScene((prev) => ({ ...DEFAULT_SCENE, aero: prev.aero }));
  }, []);

  const dockBridge = useMemo<DockBridge>(() => {
    const telemetry = () => {
      const cfg = sceneRef.current;
      const flow = aeroTelemetry(cfg.windSpeed);
      const power = dynoPoint(cfg.rpm);
      return [
        `SPD ${cfg.windSpeed} KM/H`,
        `DF ${Math.round(flow.downforceKg)} KG`,
        `DRAG ${Math.round(flow.dragN)} N`,
        `PWR ${Math.round(power.powerHp)} HP`,
      ];
    };
    return {
      startClip: () => {
        engineRef.current?.startClip(telemetry);
      },
      stopClip: () => {
        void engineRef.current?.stopClip().then((blob) => {
          if (blob) downloadBlob(blob, "apex-cinematic.webm");
        });
      },
      startLap: () => {
        engineRef.current?.startLap(sceneRef.current);
      },
      stopLap: () => engineRef.current?.stopLap() ?? null,
      playLap: (lap) => {
        engineRef.current?.playLap(lap);
      },
      pauseLap: () => {
        engineRef.current?.pauseLap();
      },
      resumeLap: () => {
        engineRef.current?.resumeLap();
      },
      seekLap: (time) => {
        engineRef.current?.seekLap(time);
      },
      stopReplay: () => {
        engineRef.current?.stopLapReplay();
      },
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const labels = labelsRef.current;
    if (!canvas || !labels) return;
    let disposed = false;
    let engine: ApexEngine | null = null;

    // The 3D world is the heaviest asset on the page. Load it as its own
    // chunk during the preloader so first paint is not blocked by Three.js.
    void import("./three/Engine").then(({ ApexEngine: Engine }) => {
      if (disposed) return;
      engine = new Engine(canvas, labels);
      engineRef.current = engine;
      engine.setPaused(pausedRef.current);
      engine.configure(sceneRef.current);
      engine.setCareer(
        unlockSet(careerRef.current),
        currentLicence(careerRef.current.cp).name,
      );
      engine.setDriveLapListener((lap) => {
        award({
          kind: "lap",
          id: `${lap.vehicle}-${lap.lapCount}-${Math.round(lap.time * 1000)}`,
          cp: lap.best ? 40 : 25,
        });
        if (lap.best) {
          award({
            kind: "ghost",
            id: `${lap.vehicle}-best-${Math.round(lap.time * 1000)}`,
          });
        }
      });
    });

    return () => {
      disposed = true;
      engine?.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const paused = coreView !== null || takeover;
    pausedRef.current = paused;
    engineRef.current?.setPaused(paused);
  }, [coreView, takeover]);

  useEffect(() => {
    sceneRef.current = scene;
    engineRef.current?.configure(scene);
    sound.setWind(scene.aero ? scene.windSpeed / 400 : 0);
    sound.setEngine(scene.aero && scene.dyno ? scene.rpm : 0);
    sound.setRain(scene.aero && scene.weather === "rain" ? scene.rainAmount : 0);
  }, [scene]);

  useEffect(() => {
    engineRef.current?.setCareer(
      unlockSet(career),
      currentLicence(career.cp).name,
    );
  }, [career]);

  useEffect(() => {
    if (!scene.aero) return;
    const read = () => {
      const engine = engineRef.current;
      if (!engine) return;
      const next: DockStatus = {
        isClipping: engine.isClipping,
        isRecordingLap: engine.isRecordingLap,
        lapElapsed: engine.lapElapsed,
        isReplaying: engine.isReplaying,
        replayPaused: engine.replayPaused,
        replayTime: engine.currentReplayTime,
        replayDuration: engine.replayDuration,
      };
      // The tick is 10 Hz; skip the state write when nothing actually changed
      // so idle tunnels do not re-render the whole app ten times a second.
      setDockStatus((current) =>
        current.isClipping === next.isClipping &&
        current.isRecordingLap === next.isRecordingLap &&
        current.lapElapsed === next.lapElapsed &&
        current.isReplaying === next.isReplaying &&
        current.replayPaused === next.replayPaused &&
        current.replayTime === next.replayTime &&
        current.replayDuration === next.replayDuration
          ? current
          : next,
      );
    };
    read();
    const id = window.setInterval(read, 100);
    return () => window.clearInterval(id);
  }, [scene.aero]);

  useEffect(() => {
    driveSetupRef.current = driveSetup;
  }, [driveSetup]);

  useEffect(() => {
    if (!drive) return;
    careerDistanceRef.current = 0;
    pendingDistanceRef.current = 0;
    const flush = () => {
      const meters = pendingDistanceRef.current;
      if (meters < 1) return;
      pendingDistanceRef.current = 0;
      const next = addDistance(careerRef.current, meters);
      if (next === careerRef.current) return;
      careerRef.current = next;
      setCareer(next);
    };
    const read = () => {
      const next = engineRef.current?.getDriveState() ?? null;
      if (next) {
        const delta = next.distanceM - careerDistanceRef.current;
        if (delta > 0) pendingDistanceRef.current += delta;
        careerDistanceRef.current = next.distanceM;
      }
      setDriveHud(next);
    };
    read();
    const id = window.setInterval(read, 50);
    const flushId = window.setInterval(flush, 2000);
    return () => {
      window.clearInterval(id);
      window.clearInterval(flushId);
      flush();
    };
  }, [drive]);

  useEffect(() => {
    const state = control.state;
    if (!state) return;
    const previous = missionStatusRef.current;
    missionStatusRef.current = state.status;
    if (state.status !== "complete" || previous === "complete") return;
    if (!state.id) return;
    award({ kind: "mission", id: state.id });
  }, [control.state, award]);

  useEffect(() => {
    document.body.classList.toggle("driving", drive !== null);
    return () => document.body.classList.remove("driving");
  }, [drive]);

  useEffect(() => {
    document.body.classList.toggle("garage-open", garage !== null);
    return () => document.body.classList.remove("garage-open");
  }, [garage]);

  useEffect(() => {
    if (!garage) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeGarage();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [garage, closeGarage]);

  useEffect(() => {
    if (!drive) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") exitDrive();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drive, exitDrive]);

  useEffect(() => {
    document.body.classList.toggle("locked", booting);
    return () => document.body.classList.remove("locked");
  }, [booting]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 48);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      },
      { rootMargin: "-42% 0px -42% 0px" },
    );
    CHAPTERS.forEach((chapter) => {
      const el = document.getElementById(chapter.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    document.querySelectorAll("[data-reveal]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const max = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const p = Math.min(1, Math.max(0, window.scrollY / max));
      if (progressBarRef.current) {
        progressBarRef.current.style.transform = `scaleX(${p})`;
      }
      if (progressTextRef.current) {
        progressTextRef.current.textContent = String(
          Math.round(p * 100),
        ).padStart(3, "0");
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (coreView || takeover || drive || garage) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const key = event.key.toLowerCase();
      if (key === "a") {
        toggleAero();
        return;
      }
      if (key === "escape" && scene.aero) {
        setScene((prev) => ({ ...prev, aero: false }));
        return;
      }
      if (scene.aero) {
        if (key === "c") {
          const index = CAMERA_PRESETS.findIndex((p) => p.id === scene.camera);
          updateScene({
            camera: CAMERA_PRESETS[(index + 1) % CAMERA_PRESETS.length].id,
          });
          return;
        }
        if (key === "l") {
          const index = LIVERIES.findIndex((l) => l.id === scene.livery);
          updateScene({ livery: LIVERIES[(index + 1) % LIVERIES.length].id });
          return;
        }
        if (key === "g") {
          updateScene({ grid: !scene.grid });
          return;
        }
        if (key === "r") {
          resetScene();
          return;
        }
        if (key === "e") {
          exportScene();
          return;
        }
      }
      const index = Number(event.key);
      if (!Number.isInteger(index) || index < 0 || index >= CHAPTERS.length) return;
      scrollToId(CHAPTERS[index].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [coreView, takeover, drive, garage, scene, toggleAero, updateScene, resetScene, exportScene, scrollToId]);

  const finishBoot = () => {
    setBooting(false);
    window.scrollTo(0, 0);
  };

  const toggleAudio = () => {
    audioLockedRef.current = true;
    setAudioOn(sound.toggle());
  };

  return (
    <div
      className={`site${booting ? "" : " is-ready"}${scene.aero ? " aero-on" : ""}`}
    >
      <a className="skip-link" href="#main">
        SKIP TO CONTENT
      </a>
      {booting && <Preloader onDone={finishBoot} />}
      <Cursor />

      <canvas ref={canvasRef} className="webgl" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />

      <div className="progress" aria-hidden="true">
        <span ref={progressBarRef} />
      </div>

      <div className="anchors" ref={labelsRef} aria-hidden="true">
        {ANCHORS.map((anchor) => (
          <div className="anchor" data-anchor={anchor.id} key={anchor.id}>
            <span className="anchor__dot" />
            <span className="anchor__line" />
            <div className="anchor__card">
              <span>
                {anchor.index} / {anchor.label}
              </span>
              <b>{anchor.value}</b>
            </div>
          </div>
        ))}
      </div>

      <header className={`topbar${scrolled ? " is-scrolled" : ""}`}>
        <a className="brand" href="#top" aria-label="APEX home">
          <span className="brand__mark" aria-hidden="true">
            A<span>/</span>
          </span>
          <span className="brand__text">
            <b>APEX</b>
            <i>TERMINAL INTELLIGENCE</i>
          </span>
        </a>

        <div className="topbar__status">
          <span className="dot" />
          LOCAL-FIRST / V1.1
        </div>

        <nav className="topbar__nav" aria-label="Chapters">
          {CHAPTERS.slice(1).map((chapter) => (
            <a
              key={chapter.id}
              href={`#${chapter.id}`}
              aria-current={active === chapter.id ? "location" : undefined}
            >
              <span>{chapter.n}</span>
              {chapter.label}
            </a>
          ))}
        </nav>

        <button
          type="button"
          className={`audio${audioOn ? " is-on" : ""}`}
          onClick={toggleAudio}
          aria-pressed={audioOn}
        >
          <span className="audio__bars" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          AUDIO {audioOn ? "ON" : "OFF"}
        </button>
      </header>

      <aside className="rail" aria-label="Section index">
        <span className="rail__label">SECTORS 00—{SECTOR_COUNT}</span>
        <ul>
          {CHAPTERS.map((chapter) => (
            <li key={chapter.id} className={active === chapter.id ? "is-active" : ""}>
              <a
                href={`#${chapter.id}`}
                aria-current={active === chapter.id ? "location" : undefined}
              >
                <span className="rail__idx">{chapter.n}</span>
                <span className="rail__line" />
                <span className="rail__name">{chapter.label}</span>
              </a>
            </li>
          ))}
        </ul>
        <span className="rail__hint">KEYS 0—{CHAPTERS.length - 1}</span>
      </aside>

      <main id="main">
        <section className="hero" id="top">
          <div className="hero__aside" data-reveal>
            <span className="micro">[ LOCAL-FIRST / NO METER ]</span>
            <p>
              APEX is a command-line AI engine for people who think faster than
              dashboards. Local weights. Live answers. Nothing counting.
            </p>
            <div className="hero__chips">
              <span>
                <i /> ENGINE READY
              </span>
              <span>UNMETERED</span>
            </div>
          </div>

          <div className="hero__title">
            <span className="hero__kicker">
              [ SYS.00 — TERMINAL INTELLIGENCE ]
            </span>
            <h1 aria-label="APEX">
              {["A", "P", "E", "X"].map((letter, index) => (
                <span
                  key={index}
                  className="hero__letter"
                  style={{ animationDelay: `${0.08 + index * 0.09}s` }}
                  aria-hidden="true"
                >
                  {letter}
                </span>
              ))}
            </h1>
            <div className="hero__under">
              <span>TERMINAL INTELLIGENCE AT THE LIMIT</span>
              <span className="hero__under-right">EST. 2026 / LOCALHOST</span>
            </div>
          </div>

          <div className="hero__bottom">
            <div className="hero__actions">
              <button
                type="button"
                className="btn btn--solid"
                onClick={() => scrollToId("pitwall")}
              >
                ENTER THE PIT WALL <span aria-hidden="true">↘</span>
              </button>
              <button
                type="button"
                className="btn btn--drive"
                onClick={() => launchDrive("car")}
              >
                TIME ATTACK <span aria-hidden="true">↗</span>
              </button>
              <button
                type="button"
                className="btn btn--garage"
                onClick={openGarage}
              >
                ENTER THE GARAGE <span aria-hidden="true">↘</span>
              </button>
              <div className="hero__revs" role="group" aria-label="Rev the engines">
                <button
                  type="button"
                  className="revbtn"
                  onClick={() => revVehicle("car")}
                >
                  <span>V12 BITURBO</span>
                  <b>REV</b>
                </button>
                <button
                  type="button"
                  className="revbtn"
                  onClick={() => revVehicle("bike")}
                >
                  <span>INLINE-4</span>
                  <b>REV</b>
                </button>
              </div>
              <button
                type="button"
                className="cmdline"
                onClick={() => copy(INSTALL_CMD, "hero")}
                aria-label={`Copy install command: ${INSTALL_CMD}`}
              >
                <span>$</span> {INSTALL_CMD}
                <b>{copied === "hero" ? "COPIED" : "COPY"}</b>
              </button>
              <span className="hero__camhint">
                <i /> DRAG — ORBIT · DOUBLE-CLICK — RESET
              </span>
            </div>

            <div className="hero__telemetry">
              <div>
                <span>0–100 TOKENS</span>
                <b>0.14S</b>
              </div>
              <div>
                <span>TOKEN CEILING</span>
                <b>∞</b>
              </div>
              <div>
                <span>METRICS</span>
                <b>OFF</b>
              </div>
            </div>

            <button
              type="button"
              className="scrollcue"
              onClick={() => scrollToId("manifesto")}
            >
              SCROLL TO IGNITE
              <span aria-hidden="true" />
            </button>
          </div>
        </section>

        <section className="section manifesto" id="manifesto">
          <SectionHead index="01" title="MANIFESTO" meta="NO MIDDLEMEN" />

          <div className="manifesto__lines">
            <p className="manifesto__line" data-reveal>
              SPEED IS A <em>FEATURE.</em>
            </p>
            <p className="manifesto__line manifesto__line--indent" data-reveal>
              NO METERS. NO <em>CEILINGS.</em>
            </p>
            <p className="manifesto__line" data-reveal>
              YOUR MACHINE. <em>YOUR RULES.</em>
            </p>
          </div>

          <div className="manifesto__stats" data-reveal>
            <div>
              <span>∞</span>
              <p>TOKEN CEILING</p>
            </div>
            <div>
              <span>0.00</span>
              <p>COST PER TOKEN</p>
            </div>
            <div>
              <span>100%</span>
              <p>LOCAL EXECUTION</p>
            </div>
            <div>
              <span>01</span>
              <p>COMMAND TO START</p>
            </div>
          </div>

          <div className="principles">
            {[
              [
                "01",
                "THE MODEL IS YOURS",
                "Open weights on your own GPU. Nothing is fetched from a landlord.",
              ],
              [
                "02",
                "THE PROMPT IS YOURS",
                "Edit the system string directly. No hidden layer rewrites it on the way in.",
              ],
              [
                "03",
                "THE PACE IS YOURS",
                "No queue, no rate card, no quiet throttling at the end of the month.",
              ],
            ].map(([n, title, body], index) => (
              <article
                key={n}
                data-reveal
                style={{ transitionDelay: `${index * 80}ms` }}
              >
                <span>/{n}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section machine" id="machine">
          <SectionHead index="02" title="THE MACHINE" meta="CONCEPT 01 / SUPERBIKE" />

          <div className="machine__grid">
            <div className="machine__copy" data-reveal>
              <span className="micro">02.1 / CHASSIS</span>
              <h2>
                A LIGHTER
                <br />
                <em>FRAME.</em>
              </h2>
              <p>
                The interface is a cockpit, not a chat box. APEX keeps the whole
                loop on your hardware: weights, context, prompt, output. Nothing
                leaves the garage unless you point it somewhere.
              </p>
              <button
                type="button"
                className="textlink"
                onClick={() => setBlueprintOpen((open) => !open)}
                aria-expanded={blueprintOpen}
              >
                {blueprintOpen ? "CLOSE THE BLUEPRINT" : "OPEN THE BLUEPRINT"}
                <span aria-hidden="true">{blueprintOpen ? "−" : "+"}</span>
              </button>
              <button
                type="button"
                className="textlink textlink--core"
                onClick={() => setCoreView("v12")}
              >
                X-RAY THE V12 BITURBO
                <span aria-hidden="true">↗</span>
              </button>
            </div>

            <div className="machine__specs" data-reveal>
              {[
                ["OUTPUT", "LOCAL GPU", 96],
                ["CONTEXT", "32,768 TOKENS", 78],
                ["FIRST TOKEN", "0.14 SEC", 91],
                ["RUNTIME", "186 MB COLD", 34],
                ["MODELS", "ANY OLLAMA", 100],
              ].map(([label, value, fill]) => (
                <div className="spec" key={label}>
                  <span>{label}</span>
                  <b>{value}</b>
                  <i style={{ width: `${fill}%` }} />
                </div>
              ))}
              <p className="machine__note">
                NO CLOUD CALLS <span>/</span> NO METERING <span>/</span> NO
                QUEUE
              </p>
            </div>
          </div>

          {blueprintOpen && (
            <div className="blueprint">
              <div className="blueprint__head">
                <span>EXPLODED VIEW / APEX V1</span>
                <span>8 ASSEMBLIES</span>
              </div>
              <div className="blueprint__grid">
                {BLUEPRINT.map(([n, part, detail]) => (
                  <div key={n}>
                    <span>{n}</span>
                    <b>{part}</b>
                    <p>{detail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="machine__ticker" aria-hidden="true">
            <span>TRACK / 01</span>
            <span>APEX // BIKE CONCEPT</span>
            <span>DRY MASS 186 KG</span>
            <span>0.21 CD</span>
            <span>SCAN / ACTIVE</span>
            <span>LOCAL ONLY</span>
          </div>
        </section>

        <div className="marquee" aria-hidden="true">
          <div className="marquee__track">
            {[0, 1, 2].map((rep) => (
              <div className="marquee__group" key={rep}>
                <span>FAST</span>
                <i>◆</i>
                <span>VAST</span>
                <i>◆</i>
                <span>FREE</span>
                <i>◆</i>
                <span>UNLIMITED</span>
                <i>◆</i>
                <span>LOCAL</span>
                <i>◆</i>
                <span>NO METER</span>
                <i>◆</i>
              </div>
            ))}
          </div>
        </div>

        <section className="section pitwall" id="pitwall">
          <SectionHead index="03" title="THE PIT WALL" meta="LIVE LINK / UNMETERED" />

          <div className="pitwall__grid">
            <div className="pitwall__copy" data-reveal>
              <h2>
                TALK TO THE
                <br />
                <em>MACHINE.</em>
              </h2>
              <p>
                Plain language in, tokens out. No account, no rate card, nobody
                listening in the middle. This terminal auto-detects a local
                Ollama daemon — if it finds one, it goes live.
              </p>
              <ul className="featlist">
                <li>
                  <span>01</span> LOCAL LINK — one click, no key
                </li>
                <li>
                  <span>02</span> STREAMING — token by token
                </li>
                <li>
                  <span>03</span> OWN PROMPT — the persona is yours
                </li>
                <li>
                  <span>04</span> NO METER — because nobody is counting
                </li>
              </ul>
              <p className="fine">
                APEX adds no moderation layer and rewrites nothing. The
                underlying model's own training still applies — that part is
                not ours to remove.
              </p>
            </div>

            <Terminal
              onTakeControl={openTakeover}
              onDrive={() => launchDrive("car")}
              scene={scene}
              onTune={tuneScene}
              career={career}
              onAward={award}
            />
          </div>
        </section>

        <section className="section grid" id="grid">
          <SectionHead index="04" title="THE GRID" meta="SIX WAYS IN" />

          <div className="grid__intro" data-reveal>
            <h2>
              A WHOLE
              <br />
              <em>GRID.</em>
            </h2>
            <p>
              One engine, many lines. Every capability below runs on the model
              you chose, on the machine you own. Pick a lane and go.
            </p>
          </div>

          <GridDeck onTakeControl={openTakeover} control={control} />
        </section>

        <section className="section vast" id="vast">
          <span className="vast__infinity" aria-hidden="true">
            ∞
          </span>
          <div className="vast__top" data-reveal>
            <span className="micro">05 / THE VAST</span>
            <span className="micro">NO END OF LINE</span>
          </div>

          <div className="vast__copy" data-reveal>
            <h2>
              ROOM TO
              <br />
              <em>RUN.</em>
            </h2>
            <p>
              The ceiling was never the model. It was the meter. Point APEX at
              hardware you own and context, requests and hours stop being a line
              item. Ride until the road runs out.
            </p>
            <button
              type="button"
              className="textlink textlink--core"
              onClick={() => setCoreView("i4")}
            >
              X-RAY THE IN-LINE FOUR
              <span aria-hidden="true">↗</span>
            </button>
          </div>

          <div className="vast__readouts" data-reveal>
            <div>
              <span>REQUESTS / TODAY</span>
              <b>∞</b>
            </div>
            <div>
              <span>TOKENS / BURNED</span>
              <b>∞</b>
            </div>
            <div>
              <span>QUEUE DEPTH</span>
              <b>00</b>
            </div>
            <div>
              <span>HARD LIMIT</span>
              <b>NONE</b>
            </div>
          </div>
        </section>

        <section className="section install" id="install">
          <SectionHead index="06" title="SPAWN IT" meta="NODE 18+ / OLLAMA" />

          <div className="install__grid">
            <div className="install__copy" data-reveal>
              <h2>
                ONE COMMAND.
                <br />
                <em>NO ACCOUNT.</em>
              </h2>
              <p>
                The CLI ships with this project. Link it, pull a model, and the
                machine is yours. No signup screen, no API key, no billing page
                waiting at the end.
              </p>

              <div className="cmdbox">
                <code>
                  <span>$</span> {INSTALL_CMD}
                </code>
                <button
                  type="button"
                  onClick={() => copy(INSTALL_CMD, "install")}
                  aria-label="Copy install command"
                >
                  {copied === "install" ? "COPIED" : "COPY"}
                </button>
              </div>
              <div className="cmdbox cmdbox--small">
                <code>
                  <span>$</span> apex
                </code>
                <button
                  type="button"
                  onClick={() => copy("apex", "run")}
                  aria-label="Copy run command"
                >
                  {copied === "run" ? "COPIED" : "COPY"}
                </button>
              </div>

              <p className="fine">
                The CLI is a local chat engine and an agent. Ask it to change
                the machine and it can read, write and run commands — every
                action shown first, every action yours to approve.
              </p>
            </div>

            <ol className="steps" data-reveal>
              <li>
                <span>01</span>
                <div>
                  <b>INSTALL</b>
                  <p>Link the CLI from this repo. Node 18 or newer.</p>
                  <code>npm install -g ./cli</code>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <b>POINT</b>
                  <p>Pull a local model. Any Ollama model will do.</p>
                  <code>ollama pull qwen2.5:3b</code>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <b>RUN</b>
                  <p>One-shot or interactive. Your prompt, your rules.</p>
                  <code>apex "explain this stack"</code>
                </div>
              </li>
              <li>
                <span>04</span>
                <div>
                  <b>TAKE CONTROL</b>
                  <p>Agent mode reads, edits and runs until the task is done.</p>
                  <code>apex do "fix the failing tests"</code>
                </div>
              </li>
            </ol>
          </div>

          <div className="configpanel" data-reveal>
            <div className="configpanel__head">
              <span>~/.apex/config.json</span>
              <span>EDITABLE / YOURS</span>
            </div>
            <pre>{`{
  "endpoint": "http://127.0.0.1:11434",
  "model": "qwen2.5:3b",
  "systemPrompt": "You are APEX. Direct. Technical. No filler.",
  "stream": true
}`}</pre>
            <div className="configpanel__foot">
              <span>NO FILTERS ADDED</span>
              <span>NO METERING</span>
              <span>NO CALLBACKS</span>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer__top">
          <div>
            <span className="micro">APEX / TERMINAL INTELLIGENCE</span>
            <p>BUILT FOR THE LIMIT. RUNNING ON YOUR HARDWARE.</p>
          </div>
          <nav aria-label="Footer">
            {CHAPTERS.slice(1).map((chapter) => (
              <a key={chapter.id} href={`#${chapter.id}`}>
                {chapter.label}
              </a>
            ))}
          </nav>
          <button
            type="button"
            className="footer__back"
            onClick={() => scrollToId("top")}
          >
            BACK TO IGNITION <span aria-hidden="true">↑</span>
          </button>
        </div>

        <div className="footer__word" aria-hidden="true">
          APEX
        </div>

        <div className="footer__meta">
          <span>© 2026 APEX INC</span>
          <span>NO RIGHTS RESERVED / LOCAL FIRST</span>
          <span>STATUS OK / SECTOR {activeChapter.n}</span>
        </div>
      </footer>

      <div className="hud-corner" aria-hidden="true">
        <span>P</span>
        <b>
          <span ref={progressTextRef}>000</span>.0%
        </b>
        <i />
        <span>SECTOR {activeChapter.n}</span>
        <b>{activeChapter.label}</b>
      </div>
      <div className="hud-corner hud-corner--right" aria-hidden="true">
        <span>APEX.SYS</span>
        <b>∞</b>
        <span>NO METER</span>
      </div>

      <AeroLaunch active={scene.aero} onToggle={toggleAero} />
      {scene.aero && (
        <AeroDock
          config={scene}
          onChange={updateScene}
          onClose={toggleAero}
          onExport={exportScene}
          onRandomize={randomizeScene}
          onReset={resetScene}
          bridge={dockBridge}
          status={dockStatus}
          career={career}
          onCareer={applyCareer}
        />
      )}

      {rankUp && (
        <div className="rankup" role="status" aria-live="polite">
          <span>CONSTRUCTOR SERIES</span>
          <b>{rankUp}</b>
          <i>LICENCE PROMOTION</i>
        </div>
      )}

      {drive && driveHud && (
        <DriveHUD
          state={driveHud}
          track={driveTrack}
          audioOn={audioOn}
          onAudio={toggleAudio}
          onExit={exitDrive}
          onRestart={() => {
            engineRef.current?.restartDrive();
            sound.tick("click");
          }}
          onRecover={() => engineRef.current?.recoverDrive()}
          onVehicle={switchDriveVehicle}
          onSetup={updateDriveSetup}
          onGhost={toggleDriveGhost}
          onTouch={(touch) => engineRef.current?.setDriveTouch(touch)}
        />
      )}

      {garage && (
        <Garage
          view={garage}
          licence={licenceName}
          cp={career.cp}
          unlocks={unlockCount}
          audioOn={audioOn}
          onAudio={toggleAudio}
          onView={switchGarageView}
          onRev={revVehicle}
          onReplay={replayGarage}
          onExit={closeGarage}
        />
      )}

      {coreView && (
        <Suspense
          fallback={
            <div
              className="corelab corelab--loading"
              role="status"
              aria-live="polite"
            >
              <span>CORE LAB / SPOOLING GEOMETRY…</span>
            </div>
          }
        >
          <CoreLab
            variant={coreView}
            onChange={setCoreView}
            onClose={() => setCoreView(null)}
          />
        </Suspense>
      )}

      {takeover && (
        <Takeover
          onRelease={closeTakeover}
          control={control}
          initialGoal={takeoverGoal}
        />
      )}
    </div>
  );
}
