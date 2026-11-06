import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { sound } from "../lib/sound";

type Lane = {
  n: string;
  glyph: string;
  title: string;
  desc: string;
  kicker: string;
  detail: string;
  note: string;
  specs: Array<[string, string]>;
  command: string;
};

const LANES: Lane[] = [
  {
    n: "01",
    glyph: "⌁",
    title: "CODE SYNTHESIS",
    desc: "Whole files, tests, refactors. Ask for the complete thing, not a snippet.",
    kicker: "BUILD",
    detail:
      "Describe the change at the level of intent. APEX writes the whole file, keeps the imports honest and hands back a diff you can undo byte-for-byte.",
    note: "One command. No key.",
    specs: [
      ["OUTPUT", "WHOLE FILES"],
      ["TIER", "PROJECT"],
      ["TRACE", "SNAPSHOTTED"],
    ],
    command: 'apex "write a retry helper in TypeScript"',
  },
  {
    n: "02",
    glyph: "◈",
    title: "SYSTEM DESIGN",
    desc: "Architecture, schemas, trade-offs, failure modes. Think in structures.",
    kicker: "ARCHITECT",
    detail:
      "Hold the whole system in view at once. APEX works structure first — boundaries, schemas, failure modes — then walks down to the code that has to exist.",
    note: "Think in structures.",
    specs: [
      ["SCOPE", "WHOLE SYSTEM"],
      ["CONTEXT", "32,768"],
      ["MODE", "READ-ONLY"],
    ],
    command: 'apex "design a local RAG stack"',
  },
  {
    n: "03",
    glyph: "≡",
    title: "DEEP CONTEXT",
    desc: "Long reads across specs, logs and repositories without a token invoice.",
    kicker: "LONG READ",
    detail:
      "Point it at specs, logs and repositories. APEX reads across all of them in one pass and keeps the thread until the answer actually lands.",
    note: "No invoice at the end.",
    specs: [
      ["WINDOW", "32K TOKENS"],
      ["READS", "UNLIMITED"],
      ["METER", "OFF"],
    ],
    command: 'apex "read ./specs and map the failure modes"',
  },
  {
    n: "04",
    glyph: "◐",
    title: "PROMPT CONTROL",
    desc: "Edit the system prompt directly. APEX passes your words through untouched.",
    kicker: "PERSONA",
    detail:
      "The system prompt is a file you own. Edit it directly; APEX passes your words through with no rewrite, no moderation layer and no hidden preamble.",
    note: "The persona is yours.",
    specs: [
      ["PERSONA", "USER-OWNED"],
      ["REWRITE", "NONE"],
      ["STORE", "~/.APEX"],
    ],
    command: 'apex config --set systemPrompt="direct, technical"',
  },
  {
    n: "05",
    glyph: "⨯",
    title: "AIR-GAPPED",
    desc: "Cut the network. The engine still runs. No telemetry, no callbacks, no account.",
    kicker: "OFFLINE",
    detail:
      "Pull the cable and the engine keeps running. No telemetry, no callbacks, no account handshake — the weights are already on your disk.",
    note: "Everything stays on the machine.",
    specs: [
      ["NETWORK", "OPTIONAL"],
      ["TELEMETRY", "NONE"],
      ["CALLBACKS", "NONE"],
    ],
    command: "ollama serve",
  },
  {
    n: "06",
    glyph: "∞",
    title: "MACHINE CONTROL",
    desc: "Hand it a whole task. It reads, writes and runs commands, with every action shown before it lands.",
    kicker: "AUTONOMOUS",
    detail:
      "Hand it a whole task and let it act: read, edit, run, verify. Every command is shown before it lands, and every write is snapshotted for a two-second undo.",
    note: "The whole loop, on your hardware.",
    specs: [
      ["TIER", "MACHINE"],
      ["ROLLBACK", "ARMED"],
      ["APPROVAL", "PER ACTION"],
    ],
    command: 'apex do "fix the failing tests and verify"',
  },
];

type Props = {
  onTakeControl: () => void;
};

export function GridDeck({ onTakeControl }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const tiles = useRef<Array<HTMLButtonElement | null>>([]);
  const list = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const closeBtn = useRef<HTMLButtonElement | null>(null);
  const origin = useRef<DOMRect | null>(null);
  const closing = useRef(false);

  const close = useCallback(() => {
    const el = panel.current;
    const from = origin.current;
    const index = selected;
    if (!el || !from || index === null || closing.current) {
      setSelected(null);
      return;
    }
    closing.current = true;
    const to = el.getBoundingClientRect();
    const anim = el.animate(
      [
        { transform: "translate(0px, 0px) scale(1, 1)", opacity: 1 },
        {
          transform: `translate(${from.left - to.left}px, ${
            from.top - to.top
          }px) scale(${from.width / to.width}, ${from.height / to.height})`,
          opacity: 0.15,
        },
      ],
      { duration: 420, easing: "cubic-bezier(0.7, 0, 0.84, 0)" },
    );
    sound.tick("hover");
    anim.onfinish = () => {
      closing.current = false;
      setSelected(null);
      tiles.current[index]?.focus({ preventScroll: true });
    };
  }, [selected]);

  const open = (index: number) => {
    if (selected === index) {
      close();
      return;
    }
    if (selected !== null) return;
    const tile = tiles.current[index];
    if (tile) origin.current = tile.getBoundingClientRect();
    setSelected(index);
    sound.tick("click");

    const grid = list.current;
    if (grid) {
      const rect = grid.getBoundingClientRect();
      if (rect.height <= window.innerHeight * 0.85) {
        grid.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        window.scrollTo({
          top: window.scrollY + rect.top - 74,
          behavior: "smooth",
        });
      }
    }
  };

  useLayoutEffect(() => {
    const el = panel.current;
    const from = origin.current;
    if (selected === null || !el || !from) return;
    const to = el.getBoundingClientRect();
    const anim = el.animate(
      [
        {
          transform: `translate(${from.left - to.left}px, ${
            from.top - to.top
          }px) scale(${from.width / to.width}, ${from.height / to.height})`,
          opacity: 0.12,
        },
        { transform: "translate(0px, 0px) scale(1, 1)", opacity: 1 },
      ],
      { duration: 620, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    return () => anim.cancel();
  }, [selected]);

  useEffect(() => {
    if (selected === null) return;
    closeBtn.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, close]);

  const lane = selected === null ? null : LANES[selected];

  return (
    <div className="grid-deck">
      <div className="control-bar" data-reveal>
        <span className="control-bar__scan" aria-hidden="true" />
        <div className="control-bar__mark">
          <span className="control-bar__pulse" aria-hidden="true" />
          <span className="control-bar__label">TAKE CONTROL</span>
        </div>
        <p>
          Hand APEX the whole screen. It plans, edits, runs and verifies —
          every write is snapshotted, and <b>ESC</b> hands it straight back.
        </p>
        <span className="control-bar__meta">
          TIER / MACHINE
          <b>UNDO ARMED</b>
        </span>
        <button
          type="button"
          className="control-bar__btn"
          onClick={onTakeControl}
        >
          ENGAGE
          <span aria-hidden="true">↗</span>
        </button>
      </div>

      <div className="grid-list" ref={list}>
        {LANES.map((item, index) => (
          <button
            key={item.n}
            ref={(el) => {
              tiles.current[index] = el;
            }}
            type="button"
            className={`grid-item${selected === index ? " is-open" : ""}`}
            data-reveal
            style={{ transitionDelay: `${index * 40}ms` }}
            aria-expanded={selected === index}
            aria-controls="grid-lane-panel"
            onClick={() => open(index)}
            onMouseEnter={() => sound.tick("hover")}
          >
            <span className="grid-item__idx">/{item.n}</span>
            <span className="grid-item__glyph" aria-hidden="true">
              {item.glyph}
            </span>
            <h3>{item.title}</h3>
            <p>{item.desc}</p>
            <span className="grid-item__foot">
              <span className="grid-item__sys">
                <i /> SYS / READY
              </span>
              <span className="grid-item__select">SELECT ↗</span>
            </span>
          </button>
        ))}

        {lane && (
          <div
            className="lane"
            id="grid-lane-panel"
            ref={panel}
            role="region"
            aria-label={`${lane.title} lane`}
          >
            <span className="lane__scan" aria-hidden="true" />
            <span className="lane__tag">
              /{lane.n} · LANE {lane.n} / {lane.kicker}
            </span>
            <span className="lane__status">
              <i /> LINK OPEN / READY
            </span>
            <button
              ref={closeBtn}
              type="button"
              className="lane__close"
              onClick={close}
            >
              CLOSE <span>[ESC]</span>
            </button>

            <div className="lane__grid">
              <div className="lane__copy">
                <span className="lane__glyph" aria-hidden="true">
                  {lane.glyph}
                </span>
                <span className="micro">LANE / {lane.kicker}</span>
                <h3>{lane.title}</h3>
                <p>{lane.detail}</p>
                <span className="lane__note">{lane.note}</span>
              </div>

              <div className="lane__data">
                <span className="micro">READOUT</span>
                <div className="lane__specs">
                  {lane.specs.map(([label, value], index) => (
                    <div
                      key={label}
                      style={{ animationDelay: `${160 + index * 70}ms` }}
                    >
                      <span>{label}</span>
                      <b>{value}</b>
                    </div>
                  ))}
                </div>
                <div className="lane__cmd">
                  <span>apex@local:~$</span>
                  <code>{lane.command}</code>
                </div>
                <button
                  type="button"
                  className="lane__cta"
                  onClick={onTakeControl}
                >
                  TAKE CONTROL <span aria-hidden="true">↗</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
