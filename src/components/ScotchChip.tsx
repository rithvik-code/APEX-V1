import { useCallback, useEffect, useRef, useState } from "react";
import { cyrus } from "../lib/cyrus";
import type { Weather } from "../lib/scene";

type ScotchChipProps = {
  open: boolean;
  onToggle: (open: boolean) => void;
  weather: Weather;
  night: boolean;
  proud: boolean;
};

export function ScotchChip({ open, onToggle, weather, night, proud }: ScotchChipProps) {
  const [input, setInput] = useState("");
  const [follow, setFollow] = useState(false);
  const [placed, setPlaced] = useState<"corner" | "cursor">("corner");
  const [curious, setCurious] = useState(false);
  const tipRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef(0);

  const submit = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      setInput("");
      cyrus.submit(clean);
    },
    [],
  );

  const wakeAssistant = useCallback(() => {
    cyrus.submit("hey cyrus");
  }, []);

  const callScotch = useCallback(() => {
    cyrus.submit("hey scotch");
  }, []);

  useEffect(() => {
    if (!open) return;
    const root = chipRef.current;
    if (!root) return;

    if (follow) {
      const onMove = (event: MouseEvent) => {
        const next = nextRef.current;
        if (next > performance.now()) return;
        nextRef.current = performance.now() + 8;
        requestAnimationFrame(() => {
          if (!root) return;
          const offset = 14;
          root.style.transform = `translate(${event.clientX + offset}px, ${event.clientY + offset}px)`;
        });
      };
      window.addEventListener("mousemove", onMove, { passive: true });
      return () => window.removeEventListener("mousemove", onMove);
    }

    return () => {
      root.style.transform = "";
    };
  }, [open, follow]);

  useEffect(() => {
    if (!open || placed !== "corner") return;
    const root = chipRef.current;
    if (!root) return;
    root.style.transform = "translate(calc(100% - 18px), calc(100% - 18px))";
    return () => {
      root.style.transform = "";
    };
  }, [open, placed]);

  if (!open) return null;

  const mood = proud ? "proud" : night ? "sleepy" : curious ? "curious" : "ready";
  const moodLine = proud ? "Clean lap! That one had paws on the podium." : mood === "sleepy" ? "Mmm. Saving my zoomies for tomorrow." : mood === "curious" ? "What’s that? I’m listening." : "Scotch is right here.";

  return (
    <div
      ref={chipRef}
      className={`scotch-chip scotch-chip--${mood}${weather === "rain" ? " scotch-chip--rain" : ""}${night ? " scotch-chip--night" : ""}`}
      onMouseEnter={() => setCurious(true)}
      onMouseLeave={() => setCurious(false)}
      onClick={() => {
        callScotch();
        onToggle(false);
      }}
      title="Hey Scotch — tap to call him"
    >
      <div className="scotch-chip__avatar" aria-hidden="true">
        <span className="scotch-chip__tail" />
        <span className="scotch-chip__ears">
          <i />
          <i />
        </span>
        <span className="scotch-chip__face">
          <span className="scotch-chip__eye scotch-chip__eye--l" />
          <span className="scotch-chip__eye scotch-chip__eye--r" />
          <span className="scotch-chip__nose" />
          <span className="scotch-chip__tongue" />
        </span>
      </div>
      <span className="scotch-chip__weather" role="status" aria-live="polite">
        {moodLine} {weather === "rain" ? "· RAIN" : night ? "· NIGHT" : ""}
      </span>
      <div className="scotch-chip__tip" ref={tipRef}>
        <button
          type="button"
          className="scotch-chip__wake"
          onClick={(event) => {
            event.stopPropagation();
            wakeAssistant();
          }}
        >
          HEY CYRUS
        </button>
        <form
          className="scotch-chip__form"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            submit(input);
          }}
        >
          <input
            className="scotch-chip__input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="hey cyrus …"
            autoComplete="off"
            enterKeyHint="send"
          />
          <button
            type="submit"
            className="scotch-chip__send"
            disabled={!input.trim()}
            title="Send to CYRUS"
          >
            <span aria-hidden="true">↗</span>
          </button>
        </form>
        <div className="scotch-chip__bar">
          <button
            type="button"
            className="scotch-chip__follow"
            onClick={(event) => {
              event.stopPropagation();
              setFollow((value) => {
                const next = !value;
                setPlaced(next ? ("cursor" as const) : ("corner" as const));
                return next;
              });
            }}
            title={follow ? "Scotch follows the cursor" : "Scotch stays in the corner"}
          >
            <span className="scotch-chip__dot" aria-hidden="true" />
            {follow ? "FOLLOW" : "CORNER"}
          </button>
          <button
            type="button"
            className="scotch-chip__close"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(false);
            }}
            title="Hide Scotch"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <p className="scotch-chip__micro">
          tap Scotch for “hey scotch” · wake for “hey cyrus”
        </p>
      </div>
    </div>
  );
}
