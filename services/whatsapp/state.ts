/**
 * In-memory state singleton for the WhatsApp worker.
 *
 * The Baileys connection module pushes status updates here; the HTTP control
 * plane reads from here. There's only ever one connection per worker process,
 * so a module-scoped singleton is the right granularity.
 *
 * "connection" mirrors Baileys' own state vocabulary, plus the bootstrap
 * "qr_pending" we add when an unscanned QR is available.
 */

export type ConnectionStatus =
  | "open" // fully connected and ready
  | "connecting" // socket open, handshake in progress
  | "qr_pending" // waiting for the user to scan
  | "disconnected"; // closed; reconnect is usually in flight

export interface WhatsAppState {
  connection: ConnectionStatus;
  /** Bot's own jid once connected, e.g. "923063004101:7@s.whatsapp.net". */
  jid: string | null;
  /** Most recent QR string from Baileys; null when connected. */
  latestQR: string | null;
  /** Epoch ms of last state mutation. Used for "stale?" UI hints. */
  lastUpdate: number;
}

const initial: WhatsAppState = {
  connection: "connecting",
  jid: null,
  latestQR: null,
  lastUpdate: Date.now(),
};

let current: WhatsAppState = { ...initial };

export function getState(): WhatsAppState {
  return current;
}

export function setState(patch: Partial<WhatsAppState>): void {
  current = { ...current, ...patch, lastUpdate: Date.now() };
}

export function resetState(): void {
  current = { ...initial };
}
