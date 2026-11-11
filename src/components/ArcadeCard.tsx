import { useEffect, useRef, useState } from "react";
import {
  paintPoster,
  type ArcadePayload,
  type ArcadeStats,
  type MissionPayload,
  type QuizPayload,
} from "../lib/arcade";
import { sound } from "../lib/sound";

export type XpKind = "quiz-correct" | "quiz-wrong" | "mission";

type ArcadeCardProps = {
  payload: ArcadePayload;
  text: string;
  stats: ArcadeStats;
  onXp: (kind: XpKind) => void;
  onHandoff?: (goal: string) => void;
};

const OPTION_KEYS = ["A", "B", "C", "D"];

function AnswerReveal({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="arcade__reveal">
      <button
        type="button"
        className="arcade__revealbtn"
        aria-expanded={open}
        onClick={() => {
          sound.tick("click");
          setOpen((prev) => !prev);
        }}
      >
        {open ? "HIDE FULL ANSWER" : "FULL ANSWER"}
      </button>
      {open && <p className="arcade__answer">{text}</p>}
    </div>
  );
}

type QuizCardProps = {
  quiz: QuizPayload;
  text: string;
  stats: ArcadeStats;
  onXp: (kind: XpKind) => void;
};

function QuizCard({ quiz, text, stats, onXp }: QuizCardProps) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [awarded, setAwarded] = useState(false);

  const done = chosen !== null;
  const right = chosen === quiz.correct;

  useEffect(() => {
    if (!done || awarded) return;
    setAwarded(true);
    onXp(right ? "quiz-correct" : "quiz-wrong");
  }, [done, awarded, right, onXp]);

  const sourceLabel =
    quiz.source === "model"
      ? "MODEL"
      : quiz.source === "cloze"
        ? "FROM ANSWER"
        : "RACE BANK";

  return (
    <section className="arcade arcade--quiz" aria-label="Arcade quiz">
      <header className="arcade__head">
        <span className="arcade__kicker">ARCADE // QUIZ</span>
        <span className="arcade__chips">
          {stats.streak > 0 && (
            <span className="arcade__chip arcade__chip--streak">
              STREAK {stats.streak}
            </span>
          )}
          <span className="arcade__chip">{sourceLabel}</span>
        </span>
      </header>
      <p className="arcade__question">{quiz.question}</p>
      <div className="arcade__options" role="group" aria-label="Quiz options">
        {quiz.options.map((option, index) => {
          const isCorrect = done && index === quiz.correct;
          const isWrong = done && index === chosen && index !== quiz.correct;
          return (
            <button
              key={`${index}-${option}`}
              type="button"
              className={`arcade__option${isCorrect ? " arcade__option--correct" : ""}${
                isWrong ? " arcade__option--wrong" : ""
              }`}
              onClick={() => {
                if (done) return;
                sound.tick(index === quiz.correct ? "start" : "click");
                setChosen(index);
              }}
              disabled={done}
              aria-pressed={chosen === index}
            >
              <span className="arcade__option-key">{OPTION_KEYS[index]}</span>
              <span className="arcade__option-text">{option}</span>
              {isCorrect && <span className="arcade__option-mark">✓</span>}
              {isWrong && <span className="arcade__option-mark">✕</span>}
            </button>
          );
        })}
      </div>
      {done && (
        <p className={`arcade__result${right ? " arcade__result--good" : ""}`}>
          {right
            ? `CORRECT · +15 CP${stats.streak > 1 ? ` · STREAK ${stats.streak}` : ""}`
            : "NOT QUITE · +4 CP FOR SHOWING UP"}
        </p>
      )}
      <AnswerReveal text={text} />
    </section>
  );
}

type MissionCardProps = {
  mission: MissionPayload;
  text: string;
  onXp: (kind: XpKind) => void;
  onHandoff?: (goal: string) => void;
};

function MissionCard({ mission, text, onXp, onHandoff }: MissionCardProps) {
  const [sent, setSent] = useState(false);
  return (
    <section
      className={`arcade arcade--mission arcade--risk-${mission.risk}`}
      aria-label="Arcade mission"
    >
      <header className="arcade__head">
        <span className="arcade__kicker">ARCADE // MISSION</span>
        <span className="arcade__chips">
          <span className={`arcade__chip arcade__chip--${mission.risk}`}>
            {mission.risk.toUpperCase()} RISK
          </span>
          <span className="arcade__chip">REVIEWED BY YOU</span>
        </span>
      </header>
      <p className="arcade__goal">{mission.goal}</p>
      <div className="arcade__caps">
        {mission.capabilities.map((cap) => (
          <span key={cap} className="arcade__cap">
            {cap}
          </span>
        ))}
      </div>
      <ol className="arcade__steps">
        {mission.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {onHandoff && (
        <button
          type="button"
          className="arcade__run"
          disabled={sent}
          onClick={() => {
            sound.tick("start");
            setSent(true);
            onXp("mission");
            onHandoff(mission.goal);
          }}
        >
          <span aria-hidden="true">▶</span>
          {sent ? "SENT TO TAKE CONTROL" : "RUN IN TAKE CONTROL"}
          <span className="arcade__run-arrow" aria-hidden="true">
            ↗
          </span>
        </button>
      )}
      <AnswerReveal text={text} />
    </section>
  );
}

function IntelCard({
  payload,
  text,
}: {
  payload: ArcadePayload;
  text: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poster = payload.kind === "intel" ? payload.poster : null;

  useEffect(() => {
    if (canvasRef.current && poster) paintPoster(canvasRef.current, poster);
  }, [poster]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `apex-intel-${Date.now().toString(36)}.png`;
      // The anchor has to be in the document for Safari/Firefox to honour the
      // download, and the URL must outlive the click.
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }, "image/png");
  };

  return (
    <section className="arcade arcade--intel" aria-label="Arcade intel card">
      <header className="arcade__head">
        <span className="arcade__kicker">ARCADE // INTEL CARD</span>
        <button
          type="button"
          className="arcade__chip arcade__chip--btn"
          onClick={download}
        >
          DOWNLOAD POSTER
        </button>
      </header>
      <canvas
        ref={canvasRef}
        className="arcade__poster"
        aria-label="Generated intel poster"
      />
      <p className="arcade__intel-text">{text}</p>
    </section>
  );
}

export function ArcadeCard({
  payload,
  text,
  stats,
  onXp,
  onHandoff,
}: ArcadeCardProps) {
  if (payload.kind === "quiz") {
    return (
      <QuizCard
        key={`${payload.quiz.question}-${payload.quiz.options.join("|")}`}
        quiz={payload.quiz}
        text={text}
        stats={stats}
        onXp={onXp}
      />
    );
  }
  if (payload.kind === "mission") {
    return (
      <MissionCard
        mission={payload.mission}
        text={text}
        onXp={onXp}
        onHandoff={onHandoff}
      />
    );
  }
  return <IntelCard payload={payload} text={text} />;
}
