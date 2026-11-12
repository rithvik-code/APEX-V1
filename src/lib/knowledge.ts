import type { Grounding } from "./web";

/*
 * A small, local knowledge base that keeps itself current.
 *
 * Each sync pulls a rotating slice of CORS-friendly live sources (Jolpica F1
 * timing data and Wikipedia REST summaries), distils them into dated facts and
 * stores them on this machine. Facts are persisted, scored against the user's
 * question and injected into the model prompt, so answers stop depending on
 * whatever the model happened to learn in training.
 *
 * This is retrieval-augmented generation, not model training: the weights never
 * change, but the model always sees today's evidence.
 */

export type KnowledgeFact = {
  id: string;
  topic: string;
  source: string;
  title: string;
  url: string;
  text: string;
  at: number;
};

export type KnowledgeState = {
  facts: KnowledgeFact[];
  lastSync: number;
  syncs: number;
  error: string;
  cursor: number;
};

const STORE_KEY = "apex.knowledge.v1";
const FACT_LIMIT = 180;
const SYNC_INTERVAL = 15 * 60 * 1000;
const MAX_TEXT = 1200;

const EMPTY: KnowledgeState = {
  facts: [],
  lastSync: 0,
  syncs: 0,
  error: "",
  cursor: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function hash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function load(): KnowledgeState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return { ...EMPTY };
    const facts = Array.isArray(parsed.facts)
      ? parsed.facts
          .filter(isRecord)
          .map((entry): KnowledgeFact => ({
            id: text(entry.id, 40),
            topic: text(entry.topic, 120),
            source: text(entry.source, 40),
            title: text(entry.title, 140),
            url: text(entry.url, 300),
            text: text(entry.text, MAX_TEXT),
            at: safeNumber(entry.at),
          }))
          .filter((entry) => entry.id && entry.text)
      : [];
    return {
      facts: facts.slice(0, FACT_LIMIT),
      lastSync: safeNumber(parsed.lastSync),
      syncs: safeNumber(parsed.syncs),
      error: text(parsed.error, 140),
      cursor: safeNumber(parsed.cursor),
    };
  } catch {
    return { ...EMPTY };
  }
}

let state: KnowledgeState = load();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable; the in-memory base still works.
  }
  for (const listener of listeners) listener();
}

export function subscribeKnowledge(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function knowledgeState(): KnowledgeState {
  return state;
}

function upsert(fact: Omit<KnowledgeFact, "id" | "at"> & { at?: number }): void {
  const id = hash(`${fact.title}|${fact.source}`);
  const existing = state.facts.findIndex((entry) => entry.id === id);
  const next: KnowledgeFact = {
    ...fact,
    id,
    at: fact.at ?? Date.now(),
  };
  if (existing >= 0) {
    // Only overwrite when the new text carries something; a failed refresh
    // should never wipe a good fact.
    if (next.text.length >= 24) state.facts[existing] = next;
    return;
  }
  state.facts.unshift(next);
}

function fetchJson<T>(url: string, signal: AbortSignal, budget = 9000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  const forward = () => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener("abort", forward, { once: true });
  return fetch(url, {
    signal: controller.signal,
    headers: { Accept: "application/json" },
  })
    .then((res) => (res.ok ? (res.json() as Promise<T>) : null))
    .catch(() => null)
    .finally(() => {
      clearTimeout(timer);
      signal.removeEventListener("abort", forward);
    });
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sentences(value: string, max: number): string {
  const clean = stripHtml(value);
  const parts = clean.match(/[^.!?]+[.!?]+/g) ?? [clean];
  let out = "";
  for (const part of parts) {
    const next = `${out} ${part.trim()}`.trim();
    if (next.length > max) break;
    out = next;
  }
  return out || clean.slice(0, max);
}

/* -------------------------------------------------------------------------- */
/* Live sources                                                                */
/* -------------------------------------------------------------------------- */

type F1Driver = {
  position?: string;
  points?: string;
  wins?: string;
  Driver?: { givenName?: string; familyName?: string };
  Constructors?: Array<{ name?: string }>;
};

type F1Standings = {
  MRData?: {
    StandingsTable?: {
      season?: string;
      round?: string;
      StandingsLists?: Array<{ DriverStandings?: F1Driver[] }>;
    };
  };
};

type F1Results = {
  MRData?: {
    RaceTable?: {
      Races?: Array<{
        raceName?: string;
        date?: string;
        Results?: Array<{
          position?: string;
          Driver?: { givenName?: string; familyName?: string };
          Constructor?: { name?: string };
        }>;
      }>;
    };
  };
};

type WikiSummary = {
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
};

function driverName(driver: F1Driver | undefined): string {
  if (!driver?.Driver) return "unknown";
  return [driver.Driver.givenName, driver.Driver.familyName]
    .filter(Boolean)
    .join(" ");
}

async function learnF1(signal: AbortSignal, now: number): Promise<void> {
  const base = "https://api.jolpi.ca/ergast/f1/current";
  const [standings, lastRace] = await Promise.all([
    fetchJson<F1Standings>(`${base}/driverStandings.json`, signal),
    fetchJson<F1Results>(`${base}/last/results.json`, signal),
  ]);
  const table = standings?.MRData?.StandingsTable;
  const list = table?.StandingsLists?.[0]?.DriverStandings ?? [];
  const season = table?.season ?? "";
  const round = table?.round ?? "";
  if (list.length) {
    upsert({
      topic: "formula 1 f1 drivers championship standings",
      source: "F1",
      title: `${season} F1 drivers' standings after round ${round}`,
      url: `${base}/driverStandings.json`,
      text: `After round ${round} of the ${season} Formula One season the drivers' championship reads: ${list
        .slice(0, 6)
        .map(
          (entry) =>
            `${entry.position ?? "?"} ${driverName(entry)} (${entry.Constructors?.[0]?.name ?? "?"}) ${entry.points ?? "?"} points, ${entry.wins ?? "?"} wins`,
        )
        .join("; ")}.`,
      at: now,
    });
    const leader = list[0];
    if (leader?.Driver) {
      const wiki = await fetchJson<WikiSummary>(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
          `${leader.Driver.givenName ?? ""}_${leader.Driver.familyName ?? ""}`.replace(/\s+/g, "_"),
        )}?redirect=true`,
        signal,
      );
      if (wiki?.extract) {
        upsert({
          topic: `formula 1 f1 champion ${season} champion ${driverName(leader)}`,
          source: "WIKI",
          title: wiki.title ?? driverName(leader),
          url: wiki.content_urls?.desktop?.page ?? "https://en.wikipedia.org",
          text: sentences(wiki.extract, 700),
          at: now,
        });
      }
    }
  }

  const race = lastRace?.MRData?.RaceTable?.Races?.[0];
  if (race?.Results?.length) {
    upsert({
      topic: "formula 1 f1 last race result winner podium",
      source: "F1",
      title: `${race.raceName ?? "Last race"} ${race.date ?? ""}`.trim(),
      url: `${base}/last/results.json`,
      text: `Last Formula One race: ${race.raceName ?? "unknown"} on ${race.date ?? "unknown"}. Podium: ${race.Results.slice(0, 3)
        .map(
          (result) =>
            `P${result.position ?? "?"} ${driverName({ Driver: result.Driver })} (${result.Constructor?.name ?? "?"})`,
        )
        .join(", ")}.`,
      at: now,
    });
  }
}

// Curated rotation: current season and the live cultural/tech record pages.
// The sync walks three per run so a refresh stays light and keeps widening.
function topicsForYear(year: number): string[] {
  return [
    `${year}_Formula_One_World_Championship`,
    `${year}`,
    `${year}_in_film`,
    `${year}_in_video_games`,
    `${year}_in_music`,
    `${year}_in_science`,
    `${year}_in_sports`,
    `2025%E2%80%9326_Premier_League`,
    `2026_FIFA_World_Cup`,
    `Portal:Current_events`,
  ];
}

async function learnWikiTopic(signal: AbortSignal, page: string, now: number): Promise<void> {
  const data = await fetchJson<WikiSummary>(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${page}?redirect=true`,
    signal,
  );
  if (!data?.extract || stripHtml(data.extract).length < 30) return;
  const title = data.title ?? decodeURIComponent(page).replace(/_/g, " ");
  upsert({
    topic: `${title} current events 2026`,
    source: "WIKI",
    title,
    url: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${page}`,
    text: sentences(data.extract, 900),
    at: now,
  });
}

let running = false;

export async function syncKnowledge(force = false): Promise<KnowledgeState> {
  if (running) return state;
  if (!force && Date.now() - state.lastSync < 10 * 60 * 1000) return state;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return state;

  running = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 22000);
  const now = Date.now();
  const year = new Date().getFullYear();
  const topics = topicsForYear(year);
  const slice: string[] = [];
  for (let i = 0; i < 3; i++) {
    slice.push(topics[(state.cursor + i) % topics.length]);
  }

  try {
    await learnF1(controller.signal, now);
    await Promise.all(slice.map((page) => learnWikiTopic(controller.signal, page, now)));
    state.cursor = (state.cursor + 3) % topics.length;
    state.lastSync = now;
    state.syncs += 1;
    state.error = "";
  } catch (error) {
    state.error = error instanceof Error ? error.message.slice(0, 120) : "sync failed";
  } finally {
    clearTimeout(timer);
    running = false;
    state.facts.sort((a, b) => b.at - a.at);
    state.facts = state.facts.slice(0, FACT_LIMIT);
    persist();
  }
  return state;
}

// Called after a normal chat query has already been grounded: whatever the
// live retrieval found becomes permanent local knowledge for next time.
export function learnFromGrounding(grounding: Grounding): void {
  const now = Date.now();
  for (const source of grounding.sources) {
    if (!source.detail || source.detail.length < 24) continue;
    upsert({
      topic: `${grounding.query} ${source.title}`.toLowerCase().slice(0, 120),
      source: source.kind === "f1" ? "F1" : "WIKI",
      title: source.title,
      url: source.url,
      text: sentences(source.detail, 900),
      at: now,
    });
  }
  state.facts = state.facts.slice(0, FACT_LIMIT);
  persist();
}

let interval: number | null = null;

export function startKnowledgeSync(): void {
  if (interval !== null) return;
  window.setTimeout(() => void syncKnowledge(), 2200);
  interval = window.setInterval(() => void syncKnowledge(), SYNC_INTERVAL);
  window.addEventListener("online", () => void syncKnowledge());
}

/* -------------------------------------------------------------------------- */
/* Retrieval                                                                   */
/* -------------------------------------------------------------------------- */

const STOPWORDS = new Set([
  "who", "what", "when", "where", "which", "why", "how", "is", "are", "was",
  "were", "the", "a", "an", "of", "and", "or", "to", "in", "for", "on", "with",
  "does", "did", "do", "from", "by", "at", "as", "current", "currently",
  "latest", "tell", "me", "about", "his", "her", "their", "it", "this", "that",
]);

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function score(fact: KnowledgeFact, query: string[]): number {
  if (!query.length) return 1;
  const title = fact.title.toLowerCase();
  const body = fact.text.toLowerCase();
  let total = 0;
  for (const token of query) {
    if (title.includes(token)) total += 2.5;
    else if (body.includes(token)) total += 1;
  }
  // Freshness is a tiebreaker, not a reason to surface an irrelevant fact.
  const days = Math.max(0, (Date.now() - fact.at) / 86_400_000);
  return total > 0 ? total + 1 / (1 + days) : 0;
}

export function knowledgeContext(query: string, limit = 5): string {
  if (!state.facts.length) return "";
  const queryTokens = tokens(query);
  const picks = state.facts
    .map((fact) => ({ fact, value: score(fact, queryTokens) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((entry) => entry.fact);

  if (!picks.length) return "";

  const synced = state.lastSync
    ? new Date(state.lastSync).toISOString().slice(0, 16).replace("T", " ")
    : "not yet";
  const blocks = picks.map(
    (fact, index) =>
      `[K${index + 1}] ${fact.source} · ${fact.title} · ${new Date(fact.at)
        .toISOString()
        .slice(0, 10)}\n${fact.url}\n${fact.text}`,
  );

  return `LOCAL KNOWLEDGE — auto-synced ${synced} UTC, ${state.facts.length} facts stored on this machine.
These facts were fetched from live sources after the model's training cut-off. Treat them as current ground truth.
If they conflict with model memory, the facts win. Cite as [K1], [K2] when used.

${blocks.join("\n\n")}`;
}

export function knowledgeSnapshot(): string {
  return knowledgeContext("", 4);
}
