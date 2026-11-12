import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

type BoardState = "idle" | "loading" | "ready" | "offline";

type GarageProps = {
  licence: string;
  cp: number;
  unlocks: number;
  files: number;
  filesState: BoardState;
  audioOn: boolean;
  onAudio: () => void;
  onRevStart: (vehicle: "car" | "bike") => void;
  onRevEnd: () => void;
  onReplay: () => void;
  onExit: () => void;
};

export function Garage({
  licence,
  cp,
  unlocks,
  files,
  filesState,
  audioOn,
  onAudio,
  onRevStart,
  onRevEnd,
  onReplay,
  onExit,
}: GarageProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

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

  return (
    <div className="garage" role="dialog" aria-modal="true" aria-label="APEX private garage">
      <div className="garage__backdrop" aria-hidden="true" />

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
          <span className={`garage__files is-${filesState}`}>
            {filesState === "ready"
              ? `${files} FILES LINKED`
              : filesState === "loading"
                ? "SYNCING FILES"
                : filesState === "offline"
                  ? "LOCAL LINK OFFLINE"
                  : "LOCAL LINK"}
          </span>
          <b>{time}</b>
        </div>
      </header>

      <aside className="garage__panel">
        <span className="garage__eyebrow">[ SYS.09 — HOME BAY ]</span>
        <h2>THE GARAGE</h2>
        <p className="garage__lede">
          Door up. Lights on. The lift holds the car where you left it. Walk the
          floor — your local files are chalked up on the left wall.
        </p>

        <div className="garage__board" aria-live="polite">
          <span>BLACKBOARD · LEFT WALL</span>
          <b>
            {filesState === "ready"
              ? `${files} LOCAL FILES CHALKED`
              : filesState === "loading"
                ? "SCANNING HOME ROOTS"
                : filesState === "offline"
                  ? "RUN npm run apex TO SYNC"
                  : "AWAITING LOCAL LINK"}
          </b>
        </div>

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

        <div className="garage__actions">
          <button type="button" onClick={onReplay}>
            ROLL UP DOOR <span aria-hidden="true">↻</span>
          </button>
          <button type="button" onClick={onAudio}>
            SOUND {audioOn ? "ON" : "OFF"} <span aria-hidden="true">◉</span>
          </button>
          <button type="button" className="garage__exit" onClick={onExit}>
            LEAVE THE BAY <span aria-hidden="true">ESC</span>
          </button>
        </div>
      </aside>

      <p className="garage__hint">
        MOVE POINTER — LOOK · WASD / ARROWS — WALK · SHIFT — SPRINT · HOLD REV — GEARBOX
      </p>

      <span className="garage__reticle" aria-hidden="true" />
    </div>
  );
}
