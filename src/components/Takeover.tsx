import { useEffect, useMemo, useRef, useState } from "react";
import { sound } from "../lib/sound";

type Target = "files" | "editor" | "terminal" | "tests";

type Step = {
  label: string;
  detail: string;
  cmd: string;
  target: Target;
  cursor: [number, number];
};

const STEPS: Step[] = [
  {
    label: "HANDSHAKE",
    detail: "shadow snapshot armed · session linked",
    cmd: 'apex do --tier machine "fix the failing tests"',
    target: "terminal",
    cursor: [27, 72],
  },
  {
    label: "SCAN REPO",
    detail: "142 files · 8 changed",
    cmd: "list_dir ./",
    target: "files",
    cursor: [20, 34],
  },
  {
    label: "READ CONTEXT",
    detail: "src/lib/retry.ts · 2.4 KB",
    cmd: "read_file src/lib/retry.ts",
    target: "editor",
    cursor: [58, 42],
  },
  {
    label: "PATCH",
    detail: "3 lines changed · undo armed",
    cmd: "replace_in_file src/lib/retry.ts",
    target: "editor",
    cursor: [66, 54],
  },
  {
    label: "VERIFY",
    detail: "18 passed · 0 failed",
    cmd: "run_command npm test",
    target: "terminal",
    cursor: [34, 76],
  },
  {
    label: "COMPLETE",
    detail: "apex undo <session> · ready",
    cmd: "task complete",
    target: "tests",
    cursor: [76, 66],
  },
];

const FILES: Array<[string, string]> = [
  ["src/lib/retry.ts", "2.4K"],
  ["src/lib/ai.ts", "6.1K"],
  ["src/components/Terminal.tsx", "18K"],
  ["tests/retry.test.ts", "1.2K"],
  ["package.json", "0.7K"],
  ["server.log", "94K"],
];

const CODE = [
  "export async function retry<T>(",
  "  task: () => Promise<T>,",
  "  attempts = 3,",
  "): Promise<T> {",
  "  for (let i = 0; i < attempts; i++) {",
  "    try { return await task(); }",
  "    catch (e) {",
  "      if (i === attempts - 1) throw e;",
  "    }",
  "  }",
  "  throw new Error(\"unreachable\");",
  "}",
];

const STEP_MS = 1400;

function clock(total: number): string {
  const m = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

type Props = {
  onRelease: () => void;
};

export function Takeover({ onRelease }: Props) {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [typed, setTyped] = useState("");
  const releaseRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const session = useMemo(
    () => `APX-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    [],
  );

  const current = STEPS[Math.min(step, STEPS.length - 1)];

  useEffect(() => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.classList.add("locked");
    releaseRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onRelease();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.body.classList.remove("locked");
      window.removeEventListener("keydown", onKey, true);
      const target =
        returnFocus.current && returnFocus.current !== document.body
          ? returnFocus.current
          : document.querySelector<HTMLButtonElement>(
              ".lane__cta, .control-bar__btn",
            );
      target?.focus({ preventScroll: true });
    };
  }, [onRelease]);

  useEffect(() => {
    const id = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (done) return;
    const id = window.setTimeout(
      () => {
        if (step >= STEPS.length - 1) {
          setDone(true);
          sound.tick("start");
        } else {
          setStep((value) => value + 1);
          sound.tick("key");
        }
      },
      step === 0 ? 1500 : STEP_MS,
    );
    return () => window.clearTimeout(id);
  }, [step, done]);

  useEffect(() => {
    const command = done ? "task complete · control held" : current.cmd;
    setTyped("");
    let index = 0;
    const id = window.setInterval(() => {
      index += 1;
      setTyped(command.slice(0, index));
      if (index >= command.length) window.clearInterval(id);
    }, 18);
    return () => window.clearInterval(id);
  }, [current.cmd, done]);

  const progress = done ? 1 : step / STEPS.length;

  const handleRelease = () => {
    sound.tick("click");
    onRelease();
  };

  return (
    <div
      className="takeover"
      role="dialog"
      aria-modal="true"
      aria-label="APEX autonomous control"
    >
      <span className="takeover__grid" aria-hidden="true" />
      <span className="takeover__scan" aria-hidden="true" />
      <span className="takeover__glow" aria-hidden="true" />

      <header className="takeover__bar">
        <span className="takeover__live">
          <i /> APEX // AUTONOMOUS CONTROL
        </span>
        <span className="takeover__meta">
          SESSION {session} · TIER MACHINE · UNDO ARMED
        </span>
        <span className={`takeover__state${done ? " is-done" : ""}`}>
          <i /> {done ? "CONTROL HELD" : "EXECUTING"}
        </span>
        <button
          ref={releaseRef}
          type="button"
          className="takeover__release"
          onClick={handleRelease}
        >
          RELEASE CONTROL <span>[ESC]</span>
        </button>
      </header>

      <div className="takeover__body">
        <div className="takeover__stage" aria-hidden="true">
          <span className="takeover__stage-tag">USER SCREEN / LOCAL</span>

          <div
            className={`takeover__win takeover__win--files${
              current.target === "files" ? " is-target" : ""
            }`}
          >
            <div className="takeover__win-head">
              <span>FILES / PROJECT</span>
              <i>{step > 1 ? "SCANNED" : "READING"}</i>
            </div>
            <div className="takeover__files">
              {FILES.map(([name, size], index) => (
                <p
                  key={name}
                  className={step > 1 && index < 4 ? "is-hit" : ""}
                >
                  <span>{index < 4 ? "■" : "▪"}</span>
                  {name}
                  <em>{size}</em>
                </p>
              ))}
            </div>
          </div>

          <div
            className={`takeover__win takeover__win--editor${
              current.target === "editor" ? " is-target" : ""
            }`}
          >
            <div className="takeover__win-head">
              <span>EDITOR / RETRY.TS</span>
              <i>{step >= 3 ? "PATCHED" : "OPEN"}</i>
            </div>
            <div className="takeover__code">
              {CODE.map((line, index) => (
                <p
                  key={line}
                  className={
                    step >= 3 && index >= 4 && index <= 7 ? "is-hit" : ""
                  }
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {line}
                </p>
              ))}
            </div>
          </div>

          <div
            className={`takeover__win takeover__win--terminal${
              current.target === "terminal" ? " is-target" : ""
            }`}
          >
            <div className="takeover__win-head">
              <span>TERMINAL / APEX</span>
              <i>LIVE</i>
            </div>
            <div className="takeover__lines">
              {STEPS.slice(Math.max(0, step - 2), step + 1).map((item) => (
                <p key={item.cmd}>
                  <span>›</span>
                  {item.cmd}
                </p>
              ))}
              {done && <p className="is-hit">■ 18 passed · 0 failed</p>}
            </div>
          </div>

          <div
            className={`takeover__win takeover__win--tests${
              current.target === "tests" ? " is-target" : ""
            }`}
          >
            <div className="takeover__win-head">
              <span>TESTS</span>
              <i>{step >= 4 ? "PASS" : "QUEUED"}</i>
            </div>
            <div className="takeover__tests">
              <b>{step >= 4 ? "18" : "—"}</b>
              <span>/ 18 PASSED</span>
              <div>
                {Array.from({ length: 9 }).map((_, index) => (
                  <i
                    key={index}
                    className={step >= 4 ? "is-hit" : ""}
                    style={{ transitionDelay: `${index * 70}ms` }}
                  />
                ))}
              </div>
            </div>
          </div>

          <span
            className="takeover__cursor"
            style={{
              left: `${current.cursor[0]}%`,
              top: `${current.cursor[1]}%`,
            }}
          >
            <span key={step} className="takeover__click" />
          </span>
        </div>

        <aside className="takeover__rail">
          <div className="takeover__rail-head">
            <span>AGENT PLAN</span>
            <span>
              {String(Math.min(step + 1, STEPS.length)).padStart(2, "0")} /{" "}
              {String(STEPS.length).padStart(2, "0")}
            </span>
          </div>

          <ol className="takeover__plan">
            {STEPS.map((item, index) => {
              const state = done || index < step
                ? "is-done"
                : index === step
                  ? "is-active"
                  : "";
              return (
                <li key={item.label} className={state}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <b>{item.label}</b>
                    <em>{item.detail}</em>
                  </div>
                  <i>
                    {done || index < step
                      ? "DONE"
                      : index === step
                        ? "ACT"
                        : "QUEUED"}
                  </i>
                </li>
              );
            })}
          </ol>

          <div className="takeover__log">
            {STEPS.slice(Math.max(0, step - 2), step + 1).map((item) => (
              <p key={item.label}>
                <span>{item.target.toUpperCase()}</span>
                {item.cmd}
              </p>
            ))}
          </div>
        </aside>
      </div>

      <footer className="takeover__foot">
        <div className="takeover__cmd">
          <span>apex@local:~$</span>
          <code>{typed}</code>
          <i className="takeover__caret" aria-hidden="true" />
        </div>
        <div className="takeover__track" aria-hidden="true">
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
        <div className="takeover__foot-meta">
          <span>ELAPSED {clock(elapsed)}</span>
          <span>
            STEPS {String(Math.min(step + 1, STEPS.length)).padStart(2, "0")} /{" "}
            {String(STEPS.length).padStart(2, "0")}
          </span>
          <span>
            {done
              ? "TASK COMPLETE · CONTROL HELD"
              : "LOCAL · NO METER · SHADOW ON"}
          </span>
        </div>
      </footer>
    </div>
  );
}
