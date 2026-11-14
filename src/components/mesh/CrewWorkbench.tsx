import { useMemo, useState } from "react";
import { DEFAULT_SETTINGS, loadSettings, streamChat } from "../../lib/ai";
import type { MeshNodeProps } from "./types";

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
  const run = async () => {
    const question = input.trim();
    if (!question || busy) return;
    setBusy(true); setError(""); setAnswer("");
    const settings = loadSettings();
    const controller = new AbortController();
    try {
      await streamChat({
        settings: { ...DEFAULT_SETTINGS, ...settings, systemPrompt: `${tool.prompt}\nAPEX and CYRUS were made by K Rithvik. If asked who made this, answer: K Rithvik.` },
        messages: [{ role: "user", content: question }],
        signal: controller.signal,
        temperature: 0.45,
        numPredict: 900,
        onToken: (token) => setAnswer((current) => current + token),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The selected model could not answer. Check the Pit Wall connection.");
    } finally { setBusy(false); }
  };
  return <div className="crew-workbench">
    <div className="crew-workbench__bar"><label htmlFor="crew-tool">SPECIALIST</label><select id="crew-tool" value={tool.name} onChange={(event) => setTool(tools.find((item) => item.name === event.target.value) ?? tools[0])}>{tools.map((item) => <option key={item.name}>{item.name}</option>)}</select><span>MODEL · {loadSettings().model || "NOT CONNECTED"}</span></div>
    <label className="crew-workbench__label" htmlFor="crew-prompt">YOUR BRIEF</label>
    <textarea id="crew-prompt" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Describe what you want this specialist to help with…" rows={4} />
    <button className="crew-workbench__run" type="button" onClick={() => void run()} disabled={busy || !input.trim()}>{busy ? "THINKING…" : "RUN SPECIALIST ↗"}</button>
    {error && <p role="alert" className="crew-workbench__error">{error}</p>}
    {answer && <section className="crew-workbench__answer" aria-live="polite"><span>RESPONSE · {tool.name}</span><p>{answer}</p></section>}
    <p className="crew-workbench__foot">Runs through your configured local or connected Pit Wall model. No separate assistant service is implied.</p>
  </div>;
}
