import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_SETTINGS, loadSettings, streamChat } from "../../lib/ai";
import type { MeshNodeProps } from "./types";
import { retrieveGrounding, type Grounding } from "../../lib/web";

type Tool = { name: string; prompt: string };
const TOOLS: Tool[] = [
  { name: "WRITING COACH", prompt: "You are a clear, adaptable writing coach. Help draft or revise the user's text. Preserve their intent and requested tone." },
  { name: "LEARNING COACH", prompt: "You are a patient tutor. Explain clearly at the level the user requests, then offer a short check-for-understanding question." },
  { name: "PLANNING STRATEGIST", prompt: "You are a practical planning strategist. Turn the goal into ordered, realistic steps, note dependencies, and identify the first action." },
  { name: "TRANSLATION RADIO", prompt: "You are a careful translator. Translate the user's text to the requested language, preserving tone and idiom. Ask for the target language if missing." },
  { name: "DATA ENGINEER", prompt: "You are a data analyst. Help interpret the data or question provided. State assumptions and show calculations clearly. Do not invent data." },
  { name: "DESIGN STUDIO", prompt: "You are a product and visual design partner. Offer concrete interface concepts, hierarchy, palettes, and interaction details based on the request." },
  { name: "RESEARCH SCOUT", prompt: "You are a research assistant. Distinguish known facts from uncertainty. Use supplied source context when available and never invent citations or claim to have searched." },
  { name: "PROMPT TUNER", prompt: "You are an expert prompt editor. Improve the user's prompt for clarity, constraints, and useful output. Return the revised prompt and a concise rationale." },
  { name: "WORKFLOW BUILDER", prompt: "You are a workflow designer. Turn the request into a sequence of steps with inputs, outputs, and a human review checkpoint before consequential actions." },
];

export function CrewWorkbench({ scene: _scene, onTune: _onTune, onDrive: _onDrive }: MeshNodeProps) {
  const tools = useMemo(() => TOOLS, []);
  const [tool, setTool] = useState(tools[0]);
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [testRequest, setTestRequest] = useState("");
  const [tunedPrompt, setTunedPrompt] = useState("");
  const [comparison, setComparison] = useState<[string, string]>(["", ""]);
  const [tuning, setTuning] = useState(false);
  const [benchStage, setBenchStage] = useState<"idle" | "tuning" | "comparing">("idle");
  const benchAbortRef = useRef<AbortController | null>(null);
  const [research, setResearch] = useState<Grounding | null>(null);
  const [researchStatus, setResearchStatus] = useState<"idle" | "searching" | "sourced" | "no-source">("idle");
  useEffect(() => () => benchAbortRef.current?.abort(), []);
  const run = async () => {
    const question = input.trim();
    if (!question || busy) return;
    setBusy(true); setError(""); setAnswer(""); setResearch(null); setResearchStatus("idle");
    const settings = loadSettings();
    const controller = new AbortController();
    try {
      const grounding = tool.name === "RESEARCH SCOUT"
        ? await (async () => {
          setResearchStatus("searching");
          const result = await retrieveGrounding(question, controller.signal);
          setResearch(result);
          setResearchStatus(result ? "sourced" : "no-source");
          return result;
        })()
        : null;
      await streamChat({
        settings: { ...DEFAULT_SETTINGS, ...settings, systemPrompt: `${tool.prompt}\nAPEX and CYRUS were made by K Rithvik. If asked who made this, answer: K Rithvik.` },
        messages: [{ role: "user", content: question }],
        signal: controller.signal,
        grounding,
        temperature: 0.45,
        numPredict: 900,
        onToken: (token) => setAnswer((current) => current + token),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The selected model could not answer. Check the Pit Wall connection.");
    } finally { setBusy(false); }
  };

  const tuneSystemPrompt = async () => {
    if (!systemPrompt.trim() || tuning) return;
    setTuning(true); setBenchStage("tuning"); setError(""); setTunedPrompt(""); setComparison(["", ""]);
    try {
      const settings = { ...DEFAULT_SETTINGS, ...loadSettings(), systemPrompt: "You are a precise system-prompt editor. Rewrite the user's prompt for clear role, scope, constraints, and useful output. Return only the improved prompt, without commentary." };
      const controller = new AbortController();
      benchAbortRef.current = controller;
      await streamChat({ settings, messages: [{ role: "user", content: systemPrompt.trim() }], signal: controller.signal, temperature: 0.25, numPredict: 500, onToken: (token) => setTunedPrompt((value) => value + token) });
    } catch (err) { if (!(err instanceof DOMException && err.name === "AbortError")) setError(err instanceof Error ? err.message : "Prompt tuning failed. Check the model connection."); }
    finally { benchAbortRef.current = null; setTuning(false); setBenchStage("idle"); }
  };

  const comparePrompts = async () => {
    const task = testRequest.trim();
    if (!task || !systemPrompt.trim() || !tunedPrompt.trim() || tuning) return;
    setTuning(true); setBenchStage("comparing"); setError(""); setComparison(["", ""]);
    const prompts = [systemPrompt.trim(), tunedPrompt.trim()];
    const controller = new AbortController();
    benchAbortRef.current = controller;
    try {
      const results = await Promise.allSettled(prompts.map(async (prompt, index) => {
        await streamChat({
          settings: { ...DEFAULT_SETTINGS, ...loadSettings(), systemPrompt: `${prompt}\nAPEX and CYRUS were made by K Rithvik. If asked who made this, answer: K Rithvik.` },
          messages: [{ role: "user", content: task }], temperature: 0.45, numPredict: 600,
          signal: controller.signal,
          onToken: (token) => setComparison((values) => values.map((value, item) => item === index ? value + token : value) as [string, string]),
        });
      }));
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    } catch (err) { if (!(err instanceof DOMException && err.name === "AbortError")) setError(err instanceof Error ? err.message : "Comparison failed. Check the model connection."); }
    finally { benchAbortRef.current = null; setTuning(false); setBenchStage("idle"); }
  };
  return <div className="crew-workbench">
    <div className="crew-workbench__bar"><label htmlFor="crew-tool">SPECIALIST</label><select id="crew-tool" value={tool.name} onChange={(event) => setTool(tools.find((item) => item.name === event.target.value) ?? tools[0])}>{tools.map((item) => <option key={item.name}>{item.name}</option>)}</select><span>MODEL · {loadSettings().model || "NOT CONNECTED"}</span></div>
    {tool.name === "PROMPT TUNER" ? <div className="prompt-bench">
      <label className="crew-workbench__label" htmlFor="prompt-original">SYSTEM PROMPT / ORIGINAL</label>
      <textarea id="prompt-original" value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} placeholder="Paste the system prompt you want to improve and test…" rows={4} />
      <button className="crew-workbench__run" type="button" onClick={() => void tuneSystemPrompt()} disabled={tuning || !systemPrompt.trim()}>{benchStage === "tuning" ? "TUNING…" : "SUGGEST IMPROVED PROMPT ↗"}</button>
      {tunedPrompt && <><label className="crew-workbench__label" htmlFor="prompt-tuned">IMPROVED / EDIT BEFORE TESTING</label><textarea id="prompt-tuned" value={tunedPrompt} onChange={(event) => setTunedPrompt(event.target.value)} rows={4} /></>}
      <label className="crew-workbench__label" htmlFor="prompt-test">SAME TEST REQUEST FOR BOTH</label>
      <textarea id="prompt-test" value={testRequest} onChange={(event) => setTestRequest(event.target.value)} placeholder="Ask both versions the same thing…" rows={3} />
      <button className="crew-workbench__run" type="button" onClick={() => void comparePrompts()} disabled={tuning || !systemPrompt.trim() || !tunedPrompt.trim() || !testRequest.trim()}>{benchStage === "comparing" ? "RUNNING BOTH PROMPTS…" : "COMPARE RESPONSES ↗"}</button>
      {tuning && <button className="prompt-bench__cancel" type="button" onClick={() => benchAbortRef.current?.abort()}>STOP RUN</button>}
      {(comparison[0] || comparison[1]) && <div className="prompt-bench__results"><section><b>ORIGINAL PROMPT</b><p>{comparison[0] || "WAITING FOR RESPONSE…"}</p></section><section><b>IMPROVED PROMPT</b><p>{comparison[1] || "WAITING FOR RESPONSE…"}</p></section></div>}
    </div> : <>
      <label className="crew-workbench__label" htmlFor="crew-prompt">YOUR BRIEF</label>
      <textarea id="crew-prompt" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Describe what you want this specialist to help with…" rows={4} />
      <button className="crew-workbench__run" type="button" onClick={() => void run()} disabled={busy || !input.trim()}>{busy ? "THINKING…" : "RUN SPECIALIST ↗"}</button>
    </>}
    {error && <p role="alert" className="crew-workbench__error">{error}</p>}
    {tool.name === "RESEARCH SCOUT" && researchStatus !== "idle" && <p className="research-status" role="status">{researchStatus === "searching" ? "SEARCHING APPROVED SOURCES…" : researchStatus === "sourced" ? `SOURCE CONTEXT · ${research?.sources.length ?? 0} RESULT(S) · ${research?.fetchedAt ?? ""}` : "NO SOURCE RESULTS · ANSWER WILL BE MARKED UNCITED"}</p>}
    {answer && <section className="crew-workbench__answer" aria-live="polite"><span>RESPONSE · {tool.name}{tool.name === "RESEARCH SCOUT" && researchStatus === "no-source" ? " · UNCITED" : ""}</span><p>{answer}</p>{research?.sources.length ? <ul className="research-sources" aria-label="Research sources">{research.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a><span>{source.detail}</span></li>)}</ul> : null}</section>}
    <p className="crew-workbench__foot">Runs through your configured local or connected Pit Wall model. No separate assistant service is implied.</p>
  </div>;
}
