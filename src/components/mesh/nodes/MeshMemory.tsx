import { useEffect, useRef, useState } from "react";
import type { MeshNodeProps } from "../types";
import { buildMemoryIndex, type MemoryIndex } from "../memoryIndex";
import type { LoadEvent } from "../embed";
import { knowledgeState } from "../../../lib/knowledge";

type Ranked = {
  title: string;
  source: string;
  url: string;
  snippet: string;
  date: string;
  score: number;
};

export function MeshMemory(_props: MeshNodeProps) {
  const [loads, setLoads] = useState<Record<string, LoadEvent>>({});
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Ranked[]>([]);
  const [scanned, setScanned] = useState(0);
  const indexRef = useRef<MemoryIndex | null>(null);
  const facts = knowledgeState().facts;

  const arm = async () => {
    setBusy(true);
    setError("");
    try {
      const index = await buildMemoryIndex((event) => {
        setLoads((prev) => ({ ...prev, [event.file]: event }));
      });
      indexRef.current = index;
      setArmed(true);
      setScanned(index.entries.length);
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 140) : "memory build failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => () => setLoads({}), []);

  const retrieve = async () => {
    const index = indexRef.current;
    if (!index || !query.trim() || busy) return;
    setBusy(true);
    try {
      const row = await index.embed(query.trim());
      const ranked = index.entries
        .map((entry) => ({ entry, score: index.cosine(row, entry.row) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(({ entry, score }) => ({
          title: entry.fact.title,
          source: entry.fact.source,
          url: entry.fact.url,
          snippet: entry.fact.text.slice(0, 260),
          date: new Date(entry.fact.at).toISOString().slice(0, 10),
          score,
        }));
      setHits(ranked);
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 140) : "retrieve failed");
    } finally {
      setBusy(false);
    }
  };

  const loadList = Object.values(loads);
  const modelPct = loadList.length
    ? Math.round(loadList.reduce((sum, e) => sum + e.pct, 0) / loadList.length)
    : 0;

  return (
    <div className="mesh-preview">
      <div className="mesh-preview__stats">
        <span>
          MEMORY LATTICE <b>{facts.length} FACTS</b>
        </span>
        <span>
          EMBEDDED <b>{armed ? scanned : 0}</b>
        </span>
        <span>
          MODEL <b>{armed ? "MINILM-L6 · 384D" : busy ? "LOADING…" : "COLD"}</b>
        </span>
      </div>

      {!armed && (
        <button type="button" className="mesh-cta" onClick={arm} disabled={busy}>
          {busy ? `BUILDING MEMORY · ${modelPct}%` : "ARM THE MEMORY"}
        </button>
      )}

      {busy && loadList.length > 0 && (
        <div className="mesh-loads">
          {loadList.map((event) => (
            <div key={event.file} className="mesh-load">
              <span>{event.file}</span>
              <div className="mesh-load__bar">
                <i style={{ width: `${event.pct}%` }} />
              </div>
              <b>{event.pct}%</b>
            </div>
          ))}
        </div>
      )}

      {armed && (
        <>
          <div className="mesh-query">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void retrieve();
              }}
              placeholder="ask the memory anything… e.g. who leads the championship"
              spellCheck={false}
            />
            <button type="button" onClick={() => void retrieve()} disabled={busy}>
              {busy ? "…" : "RETRIEVE"}
            </button>
          </div>
          <div className="mesh-hits">
            {hits.length === 0 && (
              <p className="mesh-hits__empty">
                NOTHING SURFACED YET — ASK A QUESTION. RANKING IS PURE COSINE
                SIMILARITY, NO KEYWORD MATCHING, NO SERVER.
              </p>
            )}
            {hits.map((hit, i) => (
              <a
                key={hit.title + i}
                className="mesh-hit"
                href={hit.url}
                target="_blank"
                rel="noreferrer"
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <div className="mesh-hit__score">
                  <div className="mesh-hit__bar">
                    <i style={{ width: `${Math.round(hit.score * 100)}%` }} />
                  </div>
                  <b>{hit.score.toFixed(3)}</b>
                </div>
                <div className="mesh-hit__body">
                  <span className="mesh-hit__meta">
                    [{i + 1}] {hit.source} · {hit.date}
                  </span>
                  <strong>{hit.title}</strong>
                  <p>{hit.snippet}…</p>
                </div>
              </a>
            ))}
          </div>
        </>
      )}

      {error && <p className="mesh-error">{error}</p>}
    </div>
  );
}
