import { cosine, loadEmbedder, type ProgressSink } from "./embed";
import { knowledgeState, subscribeKnowledge, type KnowledgeFact } from "../../lib/knowledge";

export type MemoryEntry = { fact: KnowledgeFact; row: Float32Array };

export type MemoryIndex = {
  entries: MemoryEntry[];
  embed(text: string): Promise<Float32Array>;
  cosine: typeof cosine;
};

let job: Promise<MemoryIndex> | null = null;
let builtFrom = -1;
let watching = false;

function watch(): void {
  if (watching) return;
  watching = true;
  subscribeKnowledge(() => {
    if (knowledgeState().facts.length !== builtFrom) {
      job = null;
      builtFrom = -1;
    }
  });
}

export function memoryIndexReady(): boolean {
  return job !== null && builtFrom === knowledgeState().facts.length;
}

export function buildMemoryIndex(onEvent?: ProgressSink): Promise<MemoryIndex> {
  watch();
  if (job && builtFrom === knowledgeState().facts.length) return job;
  const current = knowledgeState().facts.slice(0, 140);
  job = (async () => {
    const embedder = await loadEmbedder(onEvent);
    const texts = current.map(
      (fact) => `${fact.title}. ${fact.topic}. ${fact.text.slice(0, 420)}`,
    );
    const rows: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 32) {
      const slice = texts.slice(i, i + 32);
      const batch = await embedder.embed(slice);
      rows.push(...batch);
      onEvent?.({
        file: `embedding ${Math.min(i + slice.length, texts.length)}/${texts.length}`,
        status: "progress",
        pct: Math.round(((i + slice.length) / texts.length) * 100),
      });
    }
    builtFrom = knowledgeState().facts.length;
    return {
      entries: current.map((fact, index) => ({ fact, row: rows[index] })),
      async embed(text: string) {
        return (await embedder.embed([text]))[0];
      },
      cosine,
    };
  })();
  return job.catch((error: unknown) => {
    job = null;
    builtFrom = -1;
    throw error;
  });
}

export type Cluster = {
  id: number;
  members: number[];
  center: Float32Array;
};

// Cosine k-means over the memory rows — the SEMANTIC GRID's clustering pass.
export function kmeans(rows: Float32Array[], k: number, iters = 14): Cluster[] {
  const dims = rows[0].length;
  const centers: Float32Array[] = [];
  for (let c = 0; c < k; c++) {
    centers.push(rows[Math.floor(((c + 0.5) * rows.length) / k)].slice());
  }
  const assign = new Array<number>(rows.length).fill(0);
  for (let iter = 0; iter < iters; iter++) {
    let moved = 0;
    for (let i = 0; i < rows.length; i++) {
      let best = 0;
      let bestDot = -Infinity;
      for (let c = 0; c < k; c++) {
        const dot = cosine(rows[i], centers[c]);
        if (dot > bestDot) {
          bestDot = dot;
          best = c;
        }
      }
      if (assign[i] !== best) moved++;
      assign[i] = best;
    }
    if (!moved && iter > 0) break;
    const accs = centers.map(() => new Float32Array(dims));
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < rows.length; i++) {
      const acc = accs[assign[i]];
      const row = rows[i];
      for (let d = 0; d < dims; d++) acc[d] += row[d];
      counts[assign[i]]++;
    }
    for (let c = 0; c < k; c++) {
      if (!counts[c]) continue;
      const acc = accs[c];
      let norm = 0;
      for (let d = 0; d < dims; d++) norm += acc[d] * acc[d];
      norm = Math.sqrt(norm) || 1;
      for (let d = 0; d < dims; d++) acc[d] /= norm;
      centers[c] = acc;
    }
  }
  return centers.map((center, id) => ({
    id,
    center,
    members: assign.map((a, i) => (a === id ? i : -1)).filter((i) => i >= 0),
  }));
}

export function hash01(value: number): number {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
