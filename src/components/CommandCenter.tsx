import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addMemory,
  copilotAsk,
  copilotLook,
  forgetMemory,
  getBrain,
  getWorkflows,
  listMemory,
  projectAsk,
  projectSearch,
  previewWorkflow,
  reindexProject,
  runCrew,
  runEval,
  runWorkflow,
  saveWorkflow,
  setRoute,
  updateMemory,
  type BrainSnapshot,
  type CrewResult,
  type EvalResult,
  type MemoryNote,
  type ProjectHit,
  type WorkflowInfo,
  type WorkflowPreview,
  type WorkflowRun,
} from "../lib/brain";
import { controlUrl, pullModel } from "../lib/control";

/*
 * COMMAND CENTER — one local control surface for the whole assistant stack.
 *
 * Models, routing, the screen copilot, project search, the garage crew,
 * memory, workflows and the testing bay all talk to the same loopback daemon.
 * Nothing here reaches a hosted provider: if the daemon is down the panel says
 * so instead of pretending.
 */

type Tab = "models" | "eyes" | "project" | "crew" | "memory" | "workflows" | "test";

const TABS: Array<{ id: Tab; label: string; note: string }> = [
  { id: "models", label: "MODELS", note: "Routing + speed" },
  { id: "eyes", label: "EYES", note: "Screen copilot" },
  { id: "project", label: "PROJECT", note: "Code + docs search" },
  { id: "crew", label: "CREW", note: "Specialist agents" },
  { id: "memory", label: "MEMORY", note: "Saved notes" },
  { id: "workflows", label: "WORKFLOWS", note: "Preview + run" },
  { id: "test", label: "TEST BAY", note: "Compare answers" },
];

const PULL_SUGGESTIONS = ["gemma3:4b", "qwen3:1.7b", "qwen2.5:7b", "qwen2.5-coder:7b", "nomic-embed-text"];

function megabytes(bytes: number): string {
  if (!bytes) return "—";
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The local brain is unreachable";
}

export function CommandCenter() {
  const [snapshot, setSnapshot] = useState<BrainSnapshot | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("models");
  const [online, setOnline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await getBrain();
      setSnapshot(next);
      setOnline(true);
      setError("");
    } catch (err) {
      setOnline(false);
      setError(messageOf(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void refresh();
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <div className="command-center">
      <div className="command-center__status">
        <span className={`cc-dot${online ? " cc-dot--live" : ""}`} aria-hidden="true" />
        <b>{online ? "LOCAL BRAIN ONLINE" : "DAEMON OFFLINE"}</b>
        <span>{snapshot?.endpoint ?? "127.0.0.1:11434"}</span>
        <span>{snapshot ? `${snapshot.models.length} MODELS` : "—"}</span>
        <span>{snapshot ? `${snapshot.memory.count} NOTES` : "—"}</span>
        <span>{snapshot ? `${snapshot.project.files} FILES INDEXED` : "—"}</span>
        <button type="button" onClick={() => void refresh()} aria-label="Refresh command center">
          ↻
        </button>
      </div>

      {error && (
        <p role="alert" className="command-center__error">
          {error} — start it with <code>npm run apexd</code>.
        </p>
      )}

      <div className="command-center__tabs" role="tablist" aria-label="Command center sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? "cc-tab cc-tab--on" : "cc-tab"}
            onClick={() => setTab(entry.id)}
          >
            <b>{entry.label}</b>
            <span>{entry.note}</span>
          </button>
        ))}
      </div>

      {!snapshot && !error && <p className="command-center__empty">LINKING TO THE LOCAL BRAIN…</p>}

      {snapshot && tab === "models" && <ModelsPanel snapshot={snapshot} refresh={refresh} />}
      {snapshot && tab === "eyes" && <EyesPanel snapshot={snapshot} refresh={refresh} />}
      {snapshot && tab === "project" && <ProjectPanel snapshot={snapshot} refresh={refresh} />}
      {snapshot && tab === "crew" && <CrewPanel snapshot={snapshot} />}
      {tab === "memory" && <MemoryPanel />}
      {tab === "workflows" && <WorkflowPanel />}
      {snapshot && tab === "test" && <TestPanel snapshot={snapshot} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* MODELS                                                                      */
/* -------------------------------------------------------------------------- */

function ModelsPanel({ snapshot, refresh }: { snapshot: BrainSnapshot; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [pullName, setPullName] = useState(PULL_SUGGESTIONS[0]);
  const latency = useMemo(
    () => new Map(snapshot.latency.map((entry) => [entry.model, entry])),
    [snapshot.latency],
  );

  const route = async (role: string, model: string) => {
    setBusy(role);
    setError("");
    try {
      await setRoute(role, model);
      await refresh();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("");
    }
  };

  const pull = async () => {
    setBusy("pull");
    setError("");
    try {
      await pullModel(pullName.trim());
      await refresh();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="cc-panel">
      <div className="cc-panel__head">
        <h3>MODEL SWITCHBOARD</h3>
        <p>Each task asks for a role, not a name. Saved choices fall back to the best installed model.</p>
      </div>

      <div className="cc-routes">
        {snapshot.routing.map((entry) => (
          <div className="cc-route" key={entry.role}>
            <div>
              <b>{entry.label}</b>
              <span>{entry.hint}</span>
            </div>
            <select
              value={entry.model}
              disabled={busy === entry.role || !entry.options.length}
              onChange={(event) => void route(entry.role, event.target.value)}
              aria-label={`Model for ${entry.label}`}
            >
              {!entry.options.length && <option value="">NOT INSTALLED</option>}
              {entry.options.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <em className={entry.installed ? "cc-badge cc-badge--ok" : "cc-badge"}>
              {entry.source}
            </em>
          </div>
        ))}
      </div>

      <div className="cc-models">
        {snapshot.models.map((model) => {
          const stats = latency.get(model.name);
          return (
            <div className="cc-model" key={model.name}>
              <b>{model.name}</b>
              <span>{megabytes(model.size)}</span>
              <span>{model.params ? `${model.params}B` : model.family || "—"}</span>
              <div className="cc-model__tags">
                {model.vision && <i>VISION</i>}
                {model.code && <i>CODE</i>}
                {model.embed && <i>EMBED</i>}
                {model.chat && <i>CHAT</i>}
              </div>
              <span className="cc-model__ms">
                {stats?.medianMs ? `${stats.medianMs} ms median` : "no runs yet"}
              </span>
            </div>
          );
        })}
        {!snapshot.models.length && (
          <p className="command-center__empty">
            No models are installed. Pull one below; Ollama stores it on this machine.
          </p>
        )}
      </div>

      <div className="cc-pull">
        <label htmlFor="cc-pull-name">GET A MODEL</label>
        <input
          id="cc-pull-name"
          list="cc-pull-list"
          value={pullName}
          onChange={(event) => setPullName(event.target.value)}
          placeholder="gemma3:4b"
        />
        <datalist id="cc-pull-list">
          {PULL_SUGGESTIONS.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <button type="button" onClick={() => void pull()} disabled={busy === "pull" || !pullName.trim()}>
          {busy === "pull" ? "STARTING…" : "DOWNLOAD ↗"}
        </button>
      </div>

      {snapshot.pulls.length > 0 && (
        <div className="cc-pulls">
          {snapshot.pulls.map((entry) => (
            <div className="cc-pull-row" key={entry.model}>
              <b>{entry.model}</b>
              <div className="cc-bar">
                <i style={{ width: `${Math.max(2, entry.pct)}%` }} />
              </div>
              <span>
                {entry.done ? entry.status.toUpperCase() : `${entry.pct.toFixed(0)}% · ${entry.status}`}
              </span>
              {entry.error && <em>{entry.error}</em>}
            </div>
          ))}
        </div>
      )}

      {error && <p role="alert" className="cc-error">{error}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* EYES                                                                        */
/* -------------------------------------------------------------------------- */

function EyesPanel({ snapshot, refresh }: { snapshot: BrainSnapshot; refresh: () => Promise<void> }) {
  const [question, setQuestion] = useState("Describe what is on my screen and flag anything broken.");
  const [answer, setAnswer] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stamp, setStamp] = useState(0);

  const capture = async (followUp: boolean) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = followUp && snapshot.copilot.held
        ? await copilotAsk(question)
        : await copilotLook(question, true);
      setAnswer(result.answer);
      setModel(result.model);
      setStamp(Date.now());
      await refresh();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cc-panel">
      <div className="cc-panel__head">
        <h3>SCREEN COPILOT</h3>
        <p>
          One screenshot, kept for follow-ups. The vision model reads the frame; the image never
          leaves this machine.
        </p>
      </div>

      <div className="cc-eyes">
        <div className="cc-eyes__frame">
          {snapshot.copilot.held ? (
            <img
              src={`${controlUrl("/api/copilot/shot")}?t=${stamp || encodeURIComponent(snapshot.copilot.at)}`}
              alt="Last captured screen"
            />
          ) : (
            <div className="cc-eyes__empty">
              <span>NO FRAME HELD</span>
              <p>Capture the screen to give Cyrus eyes.</p>
            </div>
          )}
          <div className="cc-eyes__meta">
            {snapshot.copilot.held
              ? `${snapshot.copilot.width}×${snapshot.copilot.height} · ${snapshot.copilot.turns} FOLLOW-UP(S) · ${snapshot.copilot.model || "—"}`
              : "WAITING FOR A CAPTURE"}
          </div>
        </div>

        <div className="cc-eyes__side">
          <label htmlFor="cc-eyes-q">QUESTION</label>
          <textarea
            id="cc-eyes-q"
            rows={3}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What is this dialog asking? / Where is the deploy button?"
          />
          <div className="cc-actions">
            <button type="button" onClick={() => void capture(false)} disabled={busy}>
              {busy ? "READING…" : "CAPTURE + ASK ↗"}
            </button>
            <button
              type="button"
              className="cc-ghost"
              onClick={() => void capture(true)}
              disabled={busy || !snapshot.copilot.held}
            >
              ASK THIS FRAME
            </button>
          </div>
          {answer && (
            <div className="cc-answer" aria-live="polite">
              <span>CYRUS / {model || snapshot.copilot.model || "VISION"}</span>
              <p>{answer}</p>
            </div>
          )}
          {error && <p role="alert" className="cc-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* PROJECT                                                                     */
/* -------------------------------------------------------------------------- */

function ProjectPanel({ snapshot, refresh }: { snapshot: BrainSnapshot; refresh: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProjectHit[]>([]);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState<"" | "search" | "ask" | "index">("");
  const [error, setError] = useState("");
  const poll = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (poll.current) window.clearInterval(poll.current);
    },
    [],
  );

  const reindex = async () => {
    setBusy("index");
    setError("");
    try {
      await reindexProject();
      await refresh();
      if (poll.current) window.clearInterval(poll.current);
      poll.current = window.setInterval(async () => {
        await refresh();
        const next = await getBrain().catch(() => null);
        if (!next || !next.project.building) {
          if (poll.current) window.clearInterval(poll.current);
          poll.current = null;
        }
      }, 2000);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("");
    }
  };

  const search = async () => {
    if (!query.trim()) return;
    setBusy("search");
    setError("");
    try {
      const result = await projectSearch(query, 8);
      setHits(result.results);
      setAnswer("");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("");
    }
  };

  const ask = async () => {
    if (!query.trim()) return;
    setBusy("ask");
    setError("");
    try {
      const result = await projectAsk(query);
      setAnswer(result.answer);
      setHits(result.sources);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("");
    }
  };

  const project = snapshot.project;

  return (
    <div className="cc-panel">
      <div className="cc-panel__head">
        <h3>PROJECT AWARENESS</h3>
        <p>
          A local index of APEX's code, docs and features. Lexical by default; vector reranking
          when an embedding model is installed.
        </p>
      </div>

      <div className="cc-project__bar">
        <span>{project.root}</span>
        <span>{project.files} FILES</span>
        <span>{project.chunks} PASSAGES</span>
        <span className={project.mode === "hybrid" ? "cc-badge cc-badge--ok" : "cc-badge"}>
          {project.mode.toUpperCase()}
        </span>
        <span>{project.embedded} VECTORS</span>
        <button type="button" onClick={() => void reindex()} disabled={busy === "index" || project.building}>
          {project.building ? "INDEXING…" : busy === "index" ? "STARTING…" : "REINDEX ↻"}
        </button>
      </div>

      <div className="cc-query">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void search();
            }
          }}
          placeholder="Where is the kill switch handled? / publish timer / workflow steps"
          aria-label="Search the project"
        />
        <button type="button" onClick={() => void search()} disabled={busy === "search" || !query.trim()}>
          {busy === "search" ? "SEARCHING…" : "SEARCH"}
        </button>
        <button type="button" className="cc-ghost" onClick={() => void ask()} disabled={busy === "ask" || !query.trim()}>
          {busy === "ask" ? "READING CODE…" : "ASK THE PROJECT ↗"}
        </button>
      </div>

      {answer && (
        <div className="cc-answer">
          <span>CYRUS / PROJECT</span>
          <p>{answer}</p>
        </div>
      )}

      <div className="cc-hits">
        {hits.map((hit) => (
          <div className="cc-hit" key={`${hit.file}-${hit.start}-${hit.id}`}>
            <div>
              <b>{hit.file}</b>
              <span>
                L{hit.start}–{hit.end} · {hit.id}
              </span>
            </div>
            <p>{hit.snippet}</p>
          </div>
        ))}
        {!hits.length && !busy && (
          <p className="command-center__empty">Search the index, or ask a question and Cyrus will cite the files.</p>
        )}
      </div>

      {error && <p role="alert" className="cc-error">{error}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* CREW                                                                        */
/* -------------------------------------------------------------------------- */

function CrewPanel({ snapshot }: { snapshot: BrainSnapshot }) {
  const [agent, setAgent] = useState(snapshot.crew[0]?.id ?? "code-mechanic");
  const [brief, setBrief] = useState("");
  const [result, setResult] = useState<CrewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    if (!brief.trim() || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await runCrew(agent, brief));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const active = snapshot.crew.find((entry) => entry.id === agent);

  return (
    <div className="cc-panel">
      <div className="cc-panel__head">
        <h3>GARAGE CREW</h3>
        <p>Four specialists, each with a narrow tool belt. Every call is shown.</p>
      </div>

      <div className="cc-crew">
        {snapshot.crew.map((entry) => (
          <button
            type="button"
            key={entry.id}
            className={agent === entry.id ? "cc-crew__card cc-crew__card--on" : "cc-crew__card"}
            onClick={() => setAgent(entry.id)}
          >
            <b>{entry.name}</b>
            <span>{entry.tag}</span>
            <em>{entry.tools.join(" · ")}</em>
          </button>
        ))}
      </div>

      <label htmlFor="cc-crew-brief">{active ? `${active.name} / BRIEF` : "BRIEF"}</label>
      <textarea
        id="cc-crew-brief"
        rows={4}
        value={brief}
        onChange={(event) => setBrief(event.target.value)}
        placeholder={active?.job ?? "Describe the job"}
      />
      <div className="cc-actions">
        <button type="button" onClick={() => void run()} disabled={busy || !brief.trim()}>
          {busy ? "WORKING…" : "DISPATCH ↗"}
        </button>
      </div>

      {result && (
        <div className="cc-crew__result">
          <div className="cc-trace">
            {result.trace.map((step, index) => (
              <div key={`${step.tool}-${index}`} className={step.ok ? "cc-trace__row" : "cc-trace__row cc-trace__row--bad"}>
                <b>{step.tool}</b>
                <span>{step.ms} ms</span>
                <span>{step.ok ? "OK" : "FAILED"}</span>
                <em>{step.detail}</em>
              </div>
            ))}
          </div>
          <div className="cc-answer">
            <span>
              {result.agent.name} / {result.model}
              {result.memoryUsed ? " · MEMORY USED" : ""}
            </span>
            <p>{result.answer}</p>
          </div>
        </div>
      )}

      {error && <p role="alert" className="cc-error">{error}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* MEMORY                                                                      */
/* -------------------------------------------------------------------------- */

function MemoryPanel() {
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [draft, setDraft] = useState("");
  const [tags, setTags] = useState("");
  const [pinned, setPinned] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await listMemory();
      setNotes(data.notes);
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const guard = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await task();
      await load();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cc-panel">
      <div className="cc-panel__head">
        <h3>PERSONAL MEMORY</h3>
        <p>
          Notes Cyrus may keep. Pinned notes always enter the prompt; the rest only when they match.
          Chat history is separate and never becomes memory.
        </p>
      </div>

      <div className="cc-memory__add">
        <textarea
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Prefers metric units. The project root is this folder. Never send page text to a cloud model."
          aria-label="New memory note"
        />
        <div className="cc-memory__row">
          <input
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="tags: prefs, project"
            aria-label="Tags"
          />
          <label className="cc-check">
            <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
            PIN
          </label>
          <button
            type="button"
            disabled={busy || draft.trim().length < 2}
            onClick={() =>
              void guard(async () => {
                await addMemory(draft, tags, pinned);
                setDraft("");
                setTags("");
                setPinned(false);
              })
            }
          >
            SAVE NOTE
          </button>
        </div>
      </div>

      <div className="cc-notes">
        {notes.map((note) => (
          <div className={note.pinned ? "cc-note cc-note--pinned" : "cc-note"} key={note.id}>
            {editing?.id === note.id ? (
              <>
                <textarea
                  rows={3}
                  value={editing.text}
                  onChange={(event) => setEditing({ id: note.id, text: event.target.value })}
                  aria-label="Edit memory note"
                />
                <div className="cc-note__row">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void guard(async () => {
                        await updateMemory(note.id, { text: editing.text });
                        setEditing(null);
                      })
                    }
                  >
                    SAVE
                  </button>
                  <button type="button" className="cc-ghost" onClick={() => setEditing(null)}>
                    CANCEL
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>{note.text}</p>
                <div className="cc-note__row">
                  <span>{note.tags.length ? note.tags.join(" · ") : "UNTAGGED"}</span>
                  <span>{note.source}</span>
                  <button
                    type="button"
                    className="cc-ghost"
                    disabled={busy}
                    onClick={() => void guard(() => updateMemory(note.id, { pinned: !note.pinned }))}
                  >
                    {note.pinned ? "UNPIN" : "PIN"}
                  </button>
                  <button type="button" className="cc-ghost" onClick={() => setEditing({ id: note.id, text: note.text })}>
                    EDIT
                  </button>
                  <button
                    type="button"
                    className="cc-danger"
                    disabled={busy}
                    onClick={() => void guard(() => forgetMemory(note.id))}
                  >
                    FORGET
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
        {!notes.length && <p className="command-center__empty">Nothing saved yet. Memory starts empty, by design.</p>}
      </div>

      {error && <p role="alert" className="cc-error">{error}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* WORKFLOWS                                                                   */
/* -------------------------------------------------------------------------- */

function WorkflowPanel() {
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  const [selected, setSelected] = useState("");
  const [input, setInput] = useState("");
  const [page, setPage] = useState("");
  const [preview, setPreview] = useState<WorkflowPreview | null>(null);
  const [result, setResult] = useState<WorkflowRun | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "run">("");
  const [error, setError] = useState("");
  const [saveName, setSaveName] = useState("");
  const [saveSteps, setSaveSteps] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await getWorkflows();
      setWorkflows(data.workflows);
      setSelected((current) => current || data.workflows[0]?.id || "");
    } catch (err) {
      setError(messageOf(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = workflows.find((entry) => entry.id === selected);

  const doPreview = async () => {
    if (!active) return;
    setBusy("preview");
    setError("");
    setResult(null);
    try {
      setPreview(await previewWorkflow({ id: active.id, input, page }));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("");
    }
  };

  const doRun = async () => {
    if (!active) return;
    setBusy("run");
    setError("");
    try {
      const output = await runWorkflow({ id: active.id, input, page, confirm: true });
      if ("needsConfirm" in output) {
        setPreview(output.preview);
      } else {
        setResult(output);
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    setError("");
    try {
      const parsed: unknown = JSON.parse(saveSteps);
      const steps = Array.isArray(parsed) ? parsed : [];
      await saveWorkflow({
        id: `custom-${Date.now()}`,
        name: saveName || "CUSTOM WORKFLOW",
        summary: "Saved from the command center.",
        steps: steps as WorkflowInfo["steps"],
      });
      setSaveName("");
      setSaveSteps("");
      await load();
    } catch (err) {
      setError(err instanceof SyntaxError ? "Steps must be a JSON array" : messageOf(err));
    }
  };

  return (
    <div className="cc-panel">
      <div className="cc-panel__head">
        <h3>WORKFLOW STUDIO</h3>
        <p>Compose local steps, preview exactly what each one receives, then run it.</p>
      </div>

      <div className="cc-workflows">
        {workflows.map((entry) => (
          <button
            type="button"
            key={entry.id}
            className={entry.id === selected ? "cc-crew__card cc-crew__card--on" : "cc-crew__card"}
            onClick={() => {
              setSelected(entry.id);
              setPreview(null);
              setResult(null);
            }}
          >
            <b>{entry.name}</b>
            <span>{entry.summary || `${entry.steps.length} steps`}</span>
            <em>{entry.steps.map((step) => step.type).join(" → ")}</em>
          </button>
        ))}
      </div>

      <div className="cc-workflow__inputs">
        <label htmlFor="cc-wf-input">INPUT</label>
        <textarea
          id="cc-wf-input"
          rows={2}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="The brief or question this workflow starts from"
        />
        <label htmlFor="cc-wf-page">PAGE TEXT (OPTIONAL)</label>
        <textarea
          id="cc-wf-page"
          rows={3}
          value={page}
          onChange={(event) => setPage(event.target.value)}
          placeholder="Paste a page, notes or a transcript here"
        />
        <div className="cc-actions">
          <button type="button" onClick={() => void doPreview()} disabled={!active || busy !== ""}>
            {busy === "preview" ? "PLANNING…" : "PREVIEW STEPS"}
          </button>
          <button type="button" className="cc-ghost" onClick={() => void doRun()} disabled={!active || busy !== ""}>
            {busy === "run" ? "RUNNING…" : "RUN WORKFLOW ↗"}
          </button>
        </div>
      </div>

      {preview && (
        <div className="cc-preview">
          <span>
            {preview.workflow.name} · {preview.steps.length} STEPS · {preview.ready ? "READY" : "NEEDS INPUT"}
          </span>
          {preview.warnings.map((warning) => (
            <p key={warning} className="cc-warn">
              {warning}
            </p>
          ))}
          {preview.steps.map((step) => (
            <div className="cc-step" key={step.index}>
              <b>
                {step.index}. {step.label}
              </b>
              <em>
                {step.type}
                {step.needs.input ? " · input" : ""}
                {step.needs.page ? " · page" : ""}
                {step.needs.previous ? " · previous" : ""}
              </em>
              <pre>{typeof step.params.prompt === "string" ? step.params.prompt : JSON.stringify(step.params)}</pre>
            </div>
          ))}
        </div>
      )}

      {result && (
        <div className="cc-run">
          <span>
            {result.workflow.name} · {result.ok ? "COMPLETE" : `FAILED AT STEP ${result.failedAt}`} ·{" "}
            {(result.totalMs / 1000).toFixed(1)}s
          </span>
          {result.trace.map((step) => (
            <div className={step.ok ? "cc-step" : "cc-step cc-step--bad"} key={step.index}>
              <b>
                {step.index}. {step.label}
              </b>
              <em>
                {step.detail} · {step.ms} ms
              </em>
              <pre>{step.output || "(no output)"}</pre>
            </div>
          ))}
        </div>
      )}

      <details className="cc-save">
        <summary>SAVE A CUSTOM WORKFLOW</summary>
        <input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Workflow name" />
        <textarea
          rows={5}
          value={saveSteps}
          onChange={(event) => setSaveSteps(event.target.value)}
          placeholder={'[{"type":"chat","label":"Ask","params":{"prompt":"{{input}}"}}]'}
          aria-label="Workflow steps JSON"
        />
        <button type="button" onClick={() => void save()} disabled={!saveSteps.trim()}>
          SAVE
        </button>
      </details>

      {error && <p role="alert" className="cc-error">{error}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* TESTING BAY                                                                 */
/* -------------------------------------------------------------------------- */

function TestPanel({ snapshot }: { snapshot: BrainSnapshot }) {
  const chatModels = snapshot.models.filter((model) => model.chat);
  const [prompts, setPrompts] = useState("Explain what APEX does in two sentences.\nList the files that run the control daemon.");
  const [models, setModels] = useState<string[]>(chatModels.slice(0, 2).map((model) => model.name));
  const [result, setResult] = useState<EvalResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const toggle = (name: string) => {
    setModels((current) =>
      current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name].slice(0, 3),
    );
  };

  const run = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const list = prompts
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      setResult(await runEval({ prompts: list, models }));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cc-panel">
      <div className="cc-panel__head">
        <h3>TESTING BAY</h3>
        <p>Run the same example prompts against several models. Compare speed and output on real tasks.</p>
      </div>

      <label htmlFor="cc-eval-prompts">TEST PROMPTS — one per line</label>
      <textarea
        id="cc-eval-prompts"
        rows={4}
        value={prompts}
        onChange={(event) => setPrompts(event.target.value)}
      />

      <div className="cc-eval__models">
        {chatModels.map((model) => (
          <label className="cc-check" key={model.name}>
            <input type="checkbox" checked={models.includes(model.name)} onChange={() => toggle(model.name)} />
            {model.name}
          </label>
        ))}
        {!chatModels.length && <span className="command-center__empty">Install a chat model first.</span>}
      </div>

      <div className="cc-actions">
        <button type="button" onClick={() => void run()} disabled={busy || !models.length}>
          {busy ? "TESTING…" : "RUN COMPARISON ↗"}
        </button>
      </div>

      {result && (
        <div className="cc-eval">
          <div className="cc-eval__summary">
            {result.byModel.map((entry) => (
              <div key={entry.model}>
                <b>{entry.model}</b>
                <span>{entry.medianMs ? `${entry.medianMs} ms median` : "no result"}</span>
                <span>{entry.failures ? `${entry.failures} failed` : "all passed"}</span>
                <span>{entry.chars} chars</span>
              </div>
            ))}
          </div>
          {result.runs.map((entry, index) => (
            <div className={entry.ok ? "cc-step" : "cc-step cc-step--bad"} key={`${entry.model}-${index}`}>
              <b>{entry.model}</b>
              <em>
                {entry.ms} ms · {entry.prompt}
              </em>
              <pre>{entry.ok ? entry.answer : entry.error}</pre>
            </div>
          ))}
        </div>
      )}

      {error && <p role="alert" className="cc-error">{error}</p>}
    </div>
  );
}
