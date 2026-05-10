/**
 * Filter out libsignal's chatty multi-line console output.
 *
 * Baileys uses libsignal-protocol-javascript for end-to-end encryption.
 * That library logs Signal protocol session housekeeping events — prekey
 * rotations, MAC mismatches during ratchet sync, "closing session in
 * favor of incoming prekey bundle" — straight to `console.error` /
 * `console.log` rather than through any logger we can configure. These
 * events are NORMAL when:
 *   - A device re-pairs after our auth state was wiped
 *   - WhatsApp rotates contact device keys
 *   - The bot was offline during a ratchet step
 *
 * They are not errors that block messages — actual incoming/outgoing
 * messages still flow. We patch console.error/log here to drop only the
 * very specific patterns libsignal emits, leaving everything else alone.
 *
 * Import this from worker.ts BEFORE any Baileys import so the patches
 * are in place when libsignal starts logging.
 */

const SUPPRESS_PREFIXES = [
  "Failed to decrypt message with any known session",
  "Session error:",
  "Closing open session in favor of incoming prekey bundle",
  "Closing session: SessionEntry",
  "no name present, ignoring presence update",
];

function shouldSuppress(args: unknown[]): boolean {
  const first = args[0];
  if (typeof first !== "string") return false;
  for (const p of SUPPRESS_PREFIXES) {
    if (first.startsWith(p)) return true;
  }
  return false;
}

const origError = console.error;
const origLog = console.log;

console.error = (...args: unknown[]) => {
  if (shouldSuppress(args)) return;
  origError.apply(console, args);
};
console.log = (...args: unknown[]) => {
  if (shouldSuppress(args)) return;
  origLog.apply(console, args);
};
