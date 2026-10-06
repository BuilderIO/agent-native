const STORAGE_KEY = "agent-native:design:canonical-node-ids";
const MAX_REMEMBERED_FILES = 2_000;

let verdicts: Map<string, string> | undefined;
// Keyed by screen: an older version needs no verdict, and queuing it would
// keep that whole document alive until the idle flush.
let pending = new Map<string, string>();

// The key stands in for the content, so a collision would skip a check that a
// changed screen needs: two independent FNV-1a lanes plus the length.
export function canonicalContentKey(content: string): string {
  let a = 2166136261;
  let b = 0x9e3779b9;
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    a = Math.imul(a ^ code, 16777619) >>> 0;
    b = Math.imul(b ^ code, 2246822519) >>> 0;
  }
  return `${content.length}:${a.toString(36)}:${b.toString(36)}`;
}

function storedVerdicts(): Map<string, string> {
  if (verdicts) return verdicts;
  verdicts = new Map();
  if (typeof localStorage === "undefined") return verdicts;
  let stored: unknown;
  try {
    stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    // An unreadable record only means every screen is checked again.
    return verdicts;
  }
  if (!Array.isArray(stored)) return verdicts;
  for (const entry of stored) {
    if (
      Array.isArray(entry) &&
      typeof entry[0] === "string" &&
      typeof entry[1] === "string"
    ) {
      verdicts.set(entry[0], entry[1]);
    }
  }
  return verdicts;
}

/** Whether this exact content was proven canonical on an earlier load. */
export function isKnownCanonical(fileId: string, content: string): boolean {
  const key = storedVerdicts().get(fileId);
  return key !== undefined && key === canonicalContentKey(content);
}

function flushPending() {
  const remembered = storedVerdicts();
  for (const [fileId, content] of pending) {
    remembered.delete(fileId);
    remembered.set(fileId, canonicalContentKey(content));
  }
  pending = new Map();
  for (const fileId of remembered.keys()) {
    if (remembered.size <= MAX_REMEMBERED_FILES) break;
    remembered.delete(fileId);
  }
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...remembered]));
    // coercion-ok: a full or blocked store only means the next load checks again.
  } catch {}
}

/** Records a canonical verdict while idle, so hashing stays off the load path. */
export function rememberCanonical(fileId: string, content: string): void {
  const flushScheduled = pending.size > 0;
  pending.delete(fileId);
  pending.set(fileId, content);
  if (flushScheduled) return;
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(flushPending, { timeout: 10_000 });
  } else {
    setTimeout(flushPending, 0);
  }
}

export function _pendingCanonicalCountForTests(): number {
  return pending.size;
}
