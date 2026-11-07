import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import type { ApexEngine } from "./three/Engine";
import { Terminal } from "./components/Terminal";
import type { CoreVariant } from "./components/CoreLab";
import { GridDeck } from "./components/GridDeck";
import { Takeover } from "./components/Takeover";
import { Preloader } from "./components/Preloader";
import { Cursor } from "./components/Cursor";
import { sound } from "./lib/sound";

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
  const { copied, copy } = useCopy();

  const activeChapter = CHAPTERS.find((c) => c.id === active) ?? CHAPTERS[0];

  const openTakeover = useCallback(() => {
    sound.tick("start");
    setTakeover(true);
  }, []);

  const closeTakeover = useCallback(() => setTakeover(false), []);

  const scrollToId = useCallback((id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
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
      if (coreView || takeover) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const index = Number(event.key);
      if (!Number.isInteger(index) || index < 0 || index >= CHAPTERS.length) return;
      scrollToId(CHAPTERS[index].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [coreView, takeover, scrollToId]);

  const finishBoot = () => {
    setBooting(false);
    window.scrollTo(0, 0);
  };

  const toggleAudio = () => {
    setAudioOn(sound.toggle());
  };

  return (
    <div className={`site${booting ? "" : " is-ready"}`}>
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
            <h1>APEX</h1>
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
                className="cmdline"
                onClick={() => copy(INSTALL_CMD, "hero")}
                aria-label={`Copy install command: ${INSTALL_CMD}`}
              >
                <span>$</span> {INSTALL_CMD}
                <b>{copied === "hero" ? "COPIED" : "COPY"}</b>
              </button>
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

            <Terminal />
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

          <GridDeck onTakeControl={openTakeover} />
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
          <span>P {copied ? "—" : "OK"} / SECTOR {activeChapter.n}</span>
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

      {takeover && <Takeover onRelease={closeTakeover} />}
    </div>
  );
}
