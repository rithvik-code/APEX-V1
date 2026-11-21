const BASE = "http://127.0.0.1:4399";
const MODEL = "hf.co/LiquidAI/LFM3-1.7B-GGUF:Q4_K_M";

async function post(path, body) {
  const started = Date.now();
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(280000),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, ms: Date.now() - started, data };
}

const out = (label, value) => {
  console.log(`\n===== ${label} =====`);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2).slice(0, 4000));
};

try {
  const ask = await post("/api/project/ask", { question: "Where is the CommandCenter component rendered?", model: MODEL, limit: 5 });
  out("PROJECT ASK", { status: ask.status, ms: ask.ms, ...ask.data });

  const crew = await post("/api/crew", { agent: "file-librarian", brief: "Which file defines the CommandCenter component and which file mounts it?", model: MODEL });
  out("CREW", { status: crew.status, ms: crew.ms, ...crew.data });

  const wf = await post("/api/workflows/run", { id: "page-to-task", confirm: true, model: MODEL, page: "APEX gains a memory panel that lists pinned notes and supports forgetting a note. Notes persist locally in ~/.apex/memory.json." });
  out("WORKFLOW RUN", { status: wf.status, ms: wf.ms, ok: wf.data?.ok, failedAt: wf.data?.failedAt, totalMs: wf.data?.totalMs, trace: wf.data?.trace?.map((s) => ({ index: s.index, label: s.label, ok: s.ok, ms: s.ms, detail: s.detail, output: String(s.output).slice(0, 600) })), answer: String(wf.data?.answer || "").slice(0, 800) });
} catch (error) {
  console.log("SMOKE FAILED:", error?.message || error);
  process.exitCode = 1;
}
console.log("\nSMOKE DONE");
