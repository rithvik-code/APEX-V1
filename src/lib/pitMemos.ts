export type PitMemo = { id: number; text: string; createdAt: number };

type Listener = (memo: PitMemo) => void;
const listeners = new Set<Listener>();
let nextId = 1;

export function publishPitMemo(answer: string): PitMemo | null {
  const text = answer
    .replace(/\n*SOURCES ─[\s\S]*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s/)[0]
    ?.slice(0, 118);
  if (!text) return null;
  const memo = { id: nextId++, text, createdAt: Date.now() };
  listeners.forEach((listener) => listener(memo));
  return memo;
}

export function subscribePitMemos(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
