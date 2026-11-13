import { useRef, useState } from "react";
import { loadNer, type Entity, type LoadEvent } from "../embed";
import { knowledgeState, type KnowledgeFact } from "../../../lib/knowledge";

const TYPE_LABEL: Record<string, string> = {
  PER: "PEOPLE",
  ORG: "TEAMS / ORGS",
  LOC: "PLACES",
  MISC: "MISC",
};

type Chip = { word: string; entity: string; count: number };

export function DossierParser(_props: Record<string, never>) {
  const [loads, setLoads] = useState<Record<string, LoadEvent>>({});
  const [state, setState] = useState<"idle" | "loading" | "scanning" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [chips, setChips] = useState<Chip[]>([]);
  const [scanned, setScanned] = useState(0);
  const [picked, setPicked] = useState<Chip | null>(null);
  const abortRef = useRef(false);

  const loadList = Object.values(loads);
  const modelPct = loadList.length
    ? Math.round(loadList.reduce((sum, e) => sum + e.pct, 0) / loadList.length)
    : 0;

  const build = async () => {
    setError("");
    setPicked(null);
    abortRef.current = false;
    try {
      setState("loading");
      const ner = await loadNer((event) => setLoads((prev) => ({ ...prev, [event.file]: event })));
      setState("scanning");
      const facts = knowledgeState().facts.slice(0, 60);
      const counts = new Map<string, Chip>();
      for (let i = 0; i < facts.length; i++) {
        if (abortRef.current) return;
        const fact = facts[i];
        const entities = await ner.scan(`${fact.title}. ${fact.text.slice(0, 280)}`);
        for (const entity of entities) {
          const key = `${entity.entity}:${entity.word.toUpperCase()}`;
          const existing = counts.get(key);
          if (existing) existing.count++;
          else counts.set(key, { word: entity.word, entity: entity.entity, count: 1 });
        }
        setScanned(i + 1);
        if (i % 6 === 0) {
          setChips(
            [...counts.values()]
              .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
              .slice(0, 48),
          );
        }
      }
      setChips(
        [...counts.values()]
          .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
          .slice(0, 48),
      );
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 160) : "dossier build failed");
      setState("error");
    }
  };

  const factsFor = (chip: Chip | null): KnowledgeFact[] => {
    if (!chip) return [];
    const needle = chip.word.toLowerCase().replace(/^##/, "");
    return knowledgeState()
      .facts.filter(
        (fact) =>
          fact.title.toLowerCase().includes(needle) ||
          fact.text.toLowerCase().includes(needle),
      )
      .slice(0, 4);
  };

  const maxCount = chips[0]?.count ?? 1;

  return (
    <div className="mesh-preview">
      <div className="mesh-status__head">
        <span>
          DOSSIER <b>{state === "done" ? `${chips.length} ENTITIES · ${scanned} FACTS SWEPT` : state === "scanning" ? `SWEEPING ${scanned}…` : "NOT BUILT"}</b>
        </span>
        <button type="button" className="mesh-mini" onClick={() => void build()} disabled={state === "loading" || state === "scanning"}>
          {state === "idle" || state === "error" ? "BUILD DOSSIER" : state === "loading" ? `MODEL ${modelPct}%` : "RE-SWEEP"}
        </button>
      </div>

      <div className="mesh-dossier">
        {chips.map((chip, i) => (
          <button
            key={`${chip.entity}-${chip.word}`}
            type="button"
            className={`mesh-chip mesh-chip--${chip.entity.toLowerCase()} ${picked === chip ? "is-picked" : ""}`}
            style={{
              animationDelay: `${Math.min(i * 45, 900)}ms`,
              fontSize: `${11 + (chip.count / maxCount) * 7}px`,
            }}
            onClick={() => setPicked(chip === picked ? null : chip)}
          >
            {chip.word}
            <i>{chip.count}</i>
          </button>
        ))}
        {chips.length === 0 && state !== "loading" && state !== "scanning" && (
          <p className="mesh-hits__empty">
            THE PARSER SWEEPS THE MACHINE'S WHOLE MEMORY WITH BERT-NER AND PULLS
            OUT EVERY PERSON, TEAM AND PLACE. RUN /learn IN THE TERMINAL FIRST IF
            MEMORY IS EMPTY.
          </p>
        )}
      </div>

      {picked && (
        <div className="mesh-dossier__panel">
          <span className="mesh-hit__meta">
            {TYPE_LABEL[picked.entity] ?? picked.entity} · {picked.count} MENTIONS
          </span>
          {factsFor(picked).map((fact) => (
            <a key={fact.id} className="mesh-hit" href={fact.url} target="_blank" rel="noreferrer">
              <div className="mesh-hit__body">
                <strong>{fact.title}</strong>
                <p>{fact.text.slice(0, 180)}…</p>
              </div>
            </a>
          ))}
        </div>
      )}

      {error && <p className="mesh-error">{error}</p>}
    </div>
  );
}
