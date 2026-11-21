import crypto from "node:crypto";
import path from "node:path";
import { APEX_HOME, readJson, writeJson } from "./brain.mjs";

/*
 * PERSONAL MEMORY — durable, inspectable notes kept apart from chat history.
 *
 * A conversation is scratch space. This file is the part the assistant is
 * allowed to remember tomorrow: preferences, project facts, standing rules.
 * Every note can be pinned, edited or forgotten, and only pinned or matched
 * notes enter a prompt, so a stale note cannot hijack unrelated answers.
 */

const MEMORY_FILE = path.join(APEX_HOME, "memory.json");
const MAX_NOTES = 400;
const MAX_TEXT = 4000;

let cache = null;

function load() {
  if (cache) return cache;
  const stored = readJson(MEMORY_FILE, { notes: [] });
  const notes = Array.isArray(stored.notes) ? stored.notes : [];
  cache = notes
    .filter((note) => note && typeof note.text === "string" && note.text.trim())
    .slice(0, MAX_NOTES)
    .map((note) => ({
      id: typeof note.id === "string" ? note.id : crypto.randomUUID(),
      text: String(note.text).slice(0, MAX_TEXT),
      tags: Array.isArray(note.tags)
        ? note.tags.map((tag) => String(tag).slice(0, 24)).filter(Boolean).slice(0, 8)
        : [],
      pinned: note.pinned === true,
      source: String(note.source || "manual").slice(0, 40),
      createdAt: String(note.createdAt || new Date().toISOString()),
      updatedAt: String(note.updatedAt || note.createdAt || new Date().toISOString()),
    }));
  return cache;
}

function persist() {
  const notes = load().slice(0, MAX_NOTES);
  writeJson(MEMORY_FILE, { version: 1, notes });
  return notes;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

function cleanTags(value) {
  const list = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(/[,\s]+/)
        .filter(Boolean);
  return [...new Set(list.map((tag) => String(tag).toLowerCase().replace(/[^a-z0-9-_]/g, "").slice(0, 24)).filter(Boolean))].slice(0, 8);
}

export function listNotes({ query = "", tag = "" } = {}) {
  const wanted = String(tag || "").toLowerCase();
  const notes = [...load()].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
  );
  if (wanted) {
    return notes.filter((note) => note.tags.includes(wanted));
  }
  if (query.trim()) return search(query, 50);
  return notes;
}

export function addNote({ text, tags, pinned = false, source = "manual" } = {}) {
  const clean = cleanText(text);
  if (clean.length < 2) throw new Error("A memory note needs at least two characters");
  const notes = load();
  if (notes.length >= MAX_NOTES) {
    // Oldest unpinned note makes room; pinned notes are never evicted silently.
    const victim = [...notes].filter((note) => !note.pinned).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
    if (victim) notes.splice(notes.indexOf(victim), 1);
  }
  const now = new Date().toISOString();
  const note = {
    id: crypto.randomUUID(),
    text: clean,
    tags: cleanTags(tags),
    pinned: pinned === true,
    source: String(source || "manual").slice(0, 40),
    createdAt: now,
    updatedAt: now,
  };
  notes.unshift(note);
  persist();
  return note;
}

export function updateNote(id, patch = {}) {
  const notes = load();
  const note = notes.find((item) => item.id === id);
  if (!note) throw new Error("That memory note no longer exists");
  if (patch.text !== undefined) {
    const clean = cleanText(patch.text);
    if (clean.length < 2) throw new Error("A memory note needs at least two characters");
    note.text = clean;
  }
  if (patch.tags !== undefined) note.tags = cleanTags(patch.tags);
  if (typeof patch.pinned === "boolean") note.pinned = patch.pinned;
  note.updatedAt = new Date().toISOString();
  persist();
  return note;
}

export function forgetNote(id) {
  const notes = load();
  const index = notes.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("That memory note no longer exists");
  const [removed] = notes.splice(index, 1);
  persist();
  return removed;
}

export function search(query, limit = 8) {
  const words = [...new Set(String(query || "").toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])];
  if (!words.length) return [];
  return load()
    .map((note) => {
      const haystack = `${note.text} ${note.tags.join(" ")}`.toLowerCase();
      let score = 0;
      for (const word of words) {
        if (haystack.includes(word)) score += word.length > 5 ? 2 : 1;
      }
      if (note.pinned) score += 0.5;
      return { note, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.note.updatedAt.localeCompare(a.note.updatedAt))
    .slice(0, Math.max(1, limit))
    .map((entry) => ({ ...entry.note, score: entry.score }));
}

/**
 * Prompt context: pinned notes always, plus the notes that match this request.
 * Kept deliberately small so memory informs an answer without dominating it.
 */
export function contextFor(query, { limit = 6 } = {}) {
  const pinned = load().filter((note) => note.pinned).slice(0, 12);
  const matched = query ? search(query, limit) : [];
  const chosen = [];
  const seen = new Set();
  for (const note of [...pinned, ...matched]) {
    if (seen.has(note.id)) continue;
    seen.add(note.id);
    chosen.push(note);
  }
  if (!chosen.length) return "";
  const lines = chosen
    .slice(0, 16)
    .map((note) => `- ${note.pinned ? "[pinned] " : ""}${note.text}`)
    .join("\n");
  return `SAVED MEMORY (the user's own notes, verified preferences and project facts):\n${lines}`;
}

export function memoryStats() {
  const notes = load();
  return {
    count: notes.length,
    pinned: notes.filter((note) => note.pinned).length,
    updatedAt: notes.reduce((at, note) => (note.updatedAt > at ? note.updatedAt : at), ""),
  };
}
