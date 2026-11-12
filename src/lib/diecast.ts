import type { UnlockId } from "./career";

export type DieCastId = "dtm" | "groupb" | "lm" | "f1" | "gt" | "wrc" | "indy" | "hyper";

export type DieCastEntry = {
  id: DieCastId;
  name: string;
  year: string;
  series: string;
  spec: string;
  hex: number;
  css: string;
  unlock: UnlockId | null;
};

/**
 * The 1:18 shelf on the bench. Each model is earned with the career part it
 * represents, so the shelf fills up as the ladder is climbed.
 */
export const DIE_CAST_CATALOG: DieCastEntry[] = [
  {
    id: "dtm",
    name: "M3 DTM",
    year: "1992",
    series: "Deutsche Tourenwagen",
    spec: "2.5L I4 · 340 hp",
    hex: 0x2f5fb0,
    css: "#2f5fb0",
    unlock: null,
  },
  {
    id: "groupb",
    name: "037 RALLY",
    year: "1983",
    series: "Group B",
    spec: "2.1L I5 turbo · 476 hp",
    hex: 0xd9dee4,
    css: "#d9dee4",
    unlock: "wheelCovers",
  },
  {
    id: "lm",
    name: "962 C",
    year: "1987",
    series: "Le Mans",
    spec: "3.0L flat-6 turbo · 700 hp",
    hex: 0x1d3f7a,
    css: "#1d3f7a",
    unlock: "canards",
  },
  {
    id: "f1",
    name: "FW14B",
    year: "1992",
    series: "Formula One",
    spec: "3.5L V10 · 750 hp",
    hex: 0xc02a1e,
    css: "#c02a1e",
    unlock: "flame",
  },
  {
    id: "gt",
    name: "GT-ONE",
    year: "1999",
    series: "GT Endurance",
    spec: "3.6L V8 turbo · 600 hp",
    hex: 0xe7e9ec,
    css: "#e7e9ec",
    unlock: "fullKit",
  },
  {
    id: "wrc",
    name: "QUATTRO S1",
    year: "1985",
    series: "World Rally",
    spec: "2.1L I5 turbo · 550 hp",
    hex: 0xb3bac1,
    css: "#b3bac1",
    unlock: "gurney",
  },
  {
    id: "indy",
    name: "86C INDY",
    year: "1986",
    series: "IndyCar",
    spec: "2.65L V8 turbo · 800 hp",
    hex: 0xd9b430,
    css: "#d9b430",
    unlock: "chrome",
  },
  {
    id: "hyper",
    name: "V12 LM",
    year: "1995",
    series: "Hypercar",
    spec: "6.0L V12 · 670 hp",
    hex: 0x24272b,
    css: "#24272b",
    unlock: "veteran",
  },
];

export function diecastUnlocked(
  entry: DieCastEntry,
  unlocks: ReadonlySet<string>,
): boolean {
  return entry.unlock === null || unlocks.has(entry.unlock);
}
