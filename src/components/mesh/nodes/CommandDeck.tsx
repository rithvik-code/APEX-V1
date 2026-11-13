import { useEffect, useRef, useState } from "react";
import { loadAsr, openMic, type LoadEvent, type MicRecorder } from "../embed";
import type { MeshNodeProps } from "../types";

type Executed = {
  say: string;
  action: string;
  at: number;
};

type Rule = {
  re: RegExp;
  build: (scene: MeshNodeProps["scene"]) => { action: string; patch?: Record<string, unknown>; drive?: boolean } | null;
};

const RULES: Rule[] = [
  { re: /\b(rain|wet weather|make it rain|storm)\b/i, build: () => ({ action: "WEATHER → RAIN", patch: { weather: "rain" } }) },
  { re: /\b(clear up|dry|stop the rain|clear sky)\b/i, build: () => ({ action: "WEATHER → CLEAR", patch: { weather: "clear" } }) },
  { re: /\b(night|lights out|midnight)\b/i, build: () => ({ action: "NIGHT RACE ON", patch: { nightRace: true } }) },
  { re: /\b(daylight|day time|sunrise|morning)\b/i, build: () => ({ action: "NIGHT RACE OFF", patch: { nightRace: false } }) },
  {
    re: /\b(wind|tunnel|air)\b.*\b(up|more|higher|stronger)\b|\bmore (wind|downforce)\b/i,
    build: (scene) => ({ action: `WIND TUNNEL → ${Math.min(400, scene.windSpeed + 40)} KM/H`, patch: { windSpeed: Math.min(400, scene.windSpeed + 40) } }),
  },
  {
    re: /\b(wind|tunnel|air)\b.*\b(down|less|lower|weaker|calm)\b/i,
    build: (scene) => ({ action: `WIND TUNNEL → ${Math.max(40, scene.windSpeed - 40)} KM/H`, patch: { windSpeed: Math.max(40, scene.windSpeed - 40) } }),
  },
  { re: /\b(blow (it )?apart|explode|tear (it )?apart|apart)\b/i, build: () => ({ action: "EXPLODED VIEW 65%", patch: { explode: 0.65 } }) },
  { re: /\b(put (it )?back|reassemble|together|snap (it )?home|home)\b/i, build: () => ({ action: "ASSEMBLY SNAPPED HOME", patch: { explode: 0 } }) },
  { re: /\b(redline|rev|dyno|power run|full power)\b/i, build: () => ({ action: "DYNO → REDLINE", patch: { dyno: true, rpm: 0.9 } }) },
  { re: /\b(kill the engine|engine off|stop the dyno|shut (it )?down)\b/i, build: () => ({ action: "DYNO OFF", patch: { dyno: false } }) },
  { re: /\b(heavy rain|monsoon|soak)\b/i, build: () => ({ action: "RAIN AMOUNT → 100%", patch: { weather: "rain", rainAmount: 1 } }) },
  { re: /\b(launch|drive|race|let'?s go|go go)\b/i, build: () => ({ action: "LAUNCH TIME ATTACK", drive: true }) },
  {
    re: /\b(turbulence)\b.*\b(up|more|higher)\b/i,
    build: (scene) => ({ action: `TURBULENCE → ${Math.min(1, scene.turbulence + 0.15).toFixed(2)}`, patch: { turbulence: Math.min(1, scene.turbulence + 0.15) } }),
  },
  {
    re: /\b(turbulence)\b.*\b(down|less|lower|calm)\b/i,
    build: (scene) => ({ action: `TURBULENCE → ${Math.max(0, scene.turbulence - 0.15).toFixed(2)}`, patch: { turbulence: Math.max(0, scene.turbulence - 0.15) } }),
  },
];

export function CommandDeck({ scene, onTune, onDrive }: MeshNodeProps) {
  const [phase, setPhase] = useState<"idle" | "loading" | "recording" | "parsing" | "error">("idle");
  const [loads, setLoads] = useState<Record<string, LoadEvent>>({});
  const [say, setSay] = useState("");
  const [log, setLog] = useState<Executed[]>([]);
  const [error, setError] = useState("");
  const micRef = useRef<MicRecorder | null>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const tuneRef = useRef(onTune);
  tuneRef.current = onTune;
  const driveRef = useRef(onDrive);
  driveRef.current = onDrive;

  useEffect(() => {
    return () => {
      micRef.current?.close();
      micRef.current = null;
    };
  }, []);

  const startHold = async () => {
    if (phase === "recording") return;
    setError("");
    try {
      if (phase === "idle") {
        setPhase("loading");
        await loadAsr((event) => setLoads((prev) => ({ ...prev, [event.file]: event })));
      }
      micRef.current ??= await openMic();
      await micRef.current.start();
      setPhase("recording");
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 160) : "mic unavailable");
      setPhase("error");
    }
  };

  const endHold = async () => {
    const mic = micRef.current;
    if (!mic || phase !== "recording") return;
    setPhase("parsing");
    try {
      const pcm = await mic.stop();
      if (pcm.length < 3200) {
        setSay("— too short —");
        setPhase("idle");
        return;
      }
      const asr = await loadAsr();
      const heard = await asr.transcribe(pcm);
      setSay(heard || "— silence —");
      if (!heard) {
        setPhase("idle");
        return;
      }
      const rule = RULES.find((entry) => entry.re.test(heard));
      if (!rule) {
        setLog((prev) => [
          { say: heard, action: "NO INTENT MATCHED — TRY: rain / night / wind up / explode / redline / launch", at: Date.now() },
          ...prev.slice(0, 7),
        ]);
        setPhase("idle");
        return;
      }
      const intent = rule.build(sceneRef.current);
      if (!intent) {
        setPhase("idle");
        return;
      }
      if (intent.drive) driveRef.current();
      if (intent.patch) tuneRef.current(intent.patch);
      setLog((prev) => [{ say: heard, action: `▸ ${intent.action}`, at: Date.now() }, ...prev.slice(0, 7)]);
      setPhase("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 160) : "command failed");
      setPhase("error");
    }
  };

  const loadList = Object.values(loads);
  const modelPct = loadList.length
    ? Math.round(loadList.reduce((sum, e) => sum + e.pct, 0) / loadList.length)
    : 0;

  return (
    <div className="mesh-preview">
      <div className="mesh-command">
        <button
          type="button"
          className={`mesh-ear mesh-ear--compact ${phase === "recording" ? "mesh-ear--live" : ""}`}
          onPointerDown={() => void startHold()}
          onPointerUp={() => void endHold()}
          onPointerLeave={() => void endHold()}
        >
          <span className="mesh-ear__ring" aria-hidden="true" />
          <span className="mesh-ear__label">
            {phase === "idle"
              ? "HOLD TO SPEAK"
              : phase === "loading"
                ? `LOADING WHISPER · ${modelPct}%`
                : phase === "recording"
                  ? "LISTENING — RELEASE"
                  : phase === "parsing"
                    ? "PARSING…"
                    : "HOLD TO SPEAK"}
          </span>
        </button>
        <div className="mesh-command__vocab">
          <b>GRAMMAR</b>
          <span>RAIN · NIGHT · WIND UP/DOWN · TURBULENCE · EXPLODE · REASSEMBLE · REDLINE · LAUNCH</span>
        </div>
      </div>

      {say && phase !== "recording" && (
        <p className="mesh-say">
          HEARD: <b>“{say}”</b>
        </p>
      )}

      <div className="mesh-log">
        {log.length === 0 && (
          <p className="mesh-hits__empty">
            EXECUTION LOG EMPTY — EVERY MATCHED COMMAND FIRES A REAL CONTROL INTO
            THE LIVE SCENE.
          </p>
        )}
        {log.map((entry, i) => (
          <div key={entry.at} className="mesh-log__row" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="mesh-log__say">“{entry.say}”</span>
            <span className={entry.action.startsWith("▸") ? "mesh-log__ok" : "mesh-log__no"}>
              {entry.action}
            </span>
          </div>
        ))}
      </div>

      {error && <p className="mesh-error">{error}</p>}
    </div>
  );
}
