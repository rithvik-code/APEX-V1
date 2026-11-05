import { useEffect, useRef, useState } from "react";

const LINES = [
  "MOUNTING SHADER PIPELINE",
  "CALIBRATING CAMERA RIG",
  "WARMING LOCAL INFERENCE",
  "REMOVING THE METER",
  "APEX READY",
];

type Props = {
  onDone: () => void;
};

export function Preloader({ onDone }: Props) {
  const [progress, setProgress] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - started;
      const next = Math.min(100, elapsed / 19 + Math.random() * 1.4);
      setProgress(next);
      if (next >= 100) {
        window.clearInterval(timer);
        if (doneRef.current) return;
        doneRef.current = true;
        setLeaving(true);
        window.setTimeout(() => onDoneRef.current(), 720);
      }
    }, 36);
    return () => window.clearInterval(timer);
  }, []);

  const finishNow = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setProgress(100);
    setLeaving(true);
    window.setTimeout(() => onDoneRef.current(), 240);
  };

  const visibleLines = Math.min(
    LINES.length,
    Math.floor((progress / 100) * (LINES.length + 0.6)) + 1,
  );

  return (
    <div className={`preloader${leaving ? " is-leaving" : ""}`}>
      <div className="preloader__top">
        <span>APEX // BOOT SEQUENCE</span>
        <button type="button" onClick={finishNow}>
          SKIP →
        </button>
      </div>

      <div className="preloader__center">
        <div className="preloader__logo">
          APE<span>X</span>
        </div>
        <div className="preloader__lines">
          {LINES.slice(0, visibleLines).map((line, index) => (
            <div
              key={line}
              className={
                index === visibleLines - 1 ? "preloader__line is-active" : "preloader__line"
              }
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              {line}
              <b>{index === LINES.length - 1 ? "OK" : "OK"}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="preloader__bottom">
        <div className="preloader__meter">
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="preloader__stats">
          <span>LOCAL ENGINE / UNMETERED</span>
          <span>{String(Math.round(progress)).padStart(3, "0")}%</span>
        </div>
      </div>
    </div>
  );
}
