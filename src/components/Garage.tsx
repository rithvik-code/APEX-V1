import {
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { GarageView } from "../three/garage";

type GarageProps = {
  view: GarageView;
  licence: string;
  cp: number;
  unlocks: number;
  audioOn: boolean;
  onAudio: () => void;
  onView: (view: GarageView) => void;
  onRevStart: (vehicle: "car" | "bike") => void;
  onRevEnd: () => void;
  onReplay: () => void;
  onExit: () => void;
};

export function Garage({
  view,
  licence,
  cp,
  unlocks,
  audioOn,
  onAudio,
  onView,
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
          <b>{time}</b>
        </div>
      </header>

      <aside className="garage__panel">
        <span className="garage__eyebrow">[ SYS.09 — HOME BAY ]</span>
        <h2>THE GARAGE</h2>
        <p className="garage__lede">
          Door up. Lights on. The lift holds the car where you left it. Walk the
          floor, or orbit the bay.
        </p>

        <div className="garage__views" role="group" aria-label="Camera mode">
          <button
            type="button"
            className={view === "third" ? "is-on" : ""}
            aria-pressed={view === "third"}
            onClick={() => onView("third")}
          >
            <span>03</span> THIRD PERSON
          </button>
          <button
            type="button"
            className={view === "first" ? "is-on" : ""}
            aria-pressed={view === "first"}
            onClick={() => onView("first")}
          >
            <span>01</span> FIRST PERSON
          </button>
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
        {view === "third"
          ? "DRAG — ORBIT · WHEEL — ZOOM · DOUBLE-CLICK — RESET · HOLD REV — GEARBOX"
          : "WASD / ARROWS — WALK · SHIFT — SPRINT · DRAG — LOOK · HOLD REV — GEARBOX"}
      </p>

      {view === "first" && <span className="garage__reticle" aria-hidden="true" />}
    </div>
  );
}
