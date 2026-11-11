import { useEffect, useState } from "react";
import type { GarageView } from "../three/garage";

type GarageProps = {
  view: GarageView;
  licence: string;
  cp: number;
  unlocks: number;
  audioOn: boolean;
  onAudio: () => void;
  onView: (view: GarageView) => void;
  onRev: (vehicle: "car" | "bike") => void;
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
  onRev,
  onReplay,
  onExit,
}: GarageProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString("en-GB", { hour12: false });

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

        <div className="garage__revs" role="group" aria-label="Rev the engines">
          <button type="button" onClick={() => onRev("car")}>
            <span>V12 BITURBO</span>
            <b>REV</b>
          </button>
          <button type="button" onClick={() => onRev("bike")}>
            <span>INLINE-4</span>
            <b>REV</b>
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
          ? "DRAG — ORBIT · WHEEL — ZOOM · DOUBLE-CLICK — RESET"
          : "WASD / ARROWS — WALK · SHIFT — SPRINT · DRAG — LOOK"}
      </p>

      {view === "first" && <span className="garage__reticle" aria-hidden="true" />}
    </div>
  );
}
