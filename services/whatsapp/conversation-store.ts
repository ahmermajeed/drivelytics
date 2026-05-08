import type { ChatMessage } from "../../lib/ai/types";

/**
 * In-memory per-phone conversation store.
 *
 * Each entry is keyed by phone (digits only). After `TTL_MS` of inactivity,
 * the next access wipes the entry and returns an empty history — that way a
 * conversation resumed the next morning starts fresh, which is almost always
 * what an operator wants.
 *
 * MVP intentionally does NOT persist to disk:
 *  - we want fresh context after worker restarts,
 *  - the agent always re-fetches state from Postgres anyway, and
 *  - storing chat logs introduces a privacy/compliance surface.
 *
 * If you later need cross-restart memory, swap the Map for a small
 * SQLite/Redis backing — the public API stays the same.
 */

interface Entry {
  history: ChatMessage[];
  lastActivity: number;
}

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_MESSAGES = 40;

const store = new Map<string, Entry>();

export function getHistory(phone: string): ChatMessage[] {
  const entry = store.get(phone);
  if (!entry) return [];
  if (Date.now() - entry.lastActivity > TTL_MS) {
    store.delete(phone);
    return [];
  }
  return entry.history;
}

export function setHistory(phone: string, history: ChatMessage[]): void {
  // Keep the tail; older context is rarely useful and burns tokens.
  const trimmed =
    history.length > MAX_MESSAGES ? history.slice(-MAX_MESSAGES) : history;
  store.set(phone, { history: trimmed, lastActivity: Date.now() });
}

export function clear(phone: string): void {
  store.delete(phone);
}

export function size(): number {
  return store.size;
}
