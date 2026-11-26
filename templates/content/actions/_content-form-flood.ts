import { createHash, randomBytes } from "node:crypto";

export const CONTENT_FORM_FLOOD_WINDOW_MS = 60_000;
export const CONTENT_FORM_SOURCE_LIMIT = 10;
export const CONTENT_FORM_FORM_LIMIT = 60;

const MAX_TRACKED_KEYS = 10_000;
const NETWORK_HEADERS = [
  "x-nf-client-connection-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "x-real-ip",
] as const;

const salt = randomBytes(16);
const attempts = new Map<string, number[]>();

function networkAddress(headers: Headers | undefined): string | null {
  if (!headers) return null;
  for (const name of NETWORK_HEADERS) {
    const value = headers.get(name)?.trim();
    if (value) return value;
  }
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const comma = forwarded.indexOf(",");
  return (comma === -1 ? forwarded : forwarded.slice(0, comma)).trim() || null;
}

export function contentFormSourceKey(input: {
  email: string | null;
  headers: Headers | undefined;
}): string {
  const source = input.email
    ? `person:${input.email}`
    : `network:${networkAddress(input.headers) ?? "unknown"}`;
  return createHash("sha256").update(salt).update(source).digest("base64url");
}

function forgetIdleKeys(cutoff: number) {
  if (attempts.size < MAX_TRACKED_KEYS) return;
  for (const [key, times] of attempts) {
    if (times.every((time) => time <= cutoff)) attempts.delete(key);
  }
}

export type ContentFormFloodSlot =
  | { ok: true }
  | { ok: false; key: string; retryAfterSeconds: number };

export function takeContentFormFloodSlot(
  limits: ReadonlyArray<{ key: string; limit: number }>,
  now = Date.now(),
): ContentFormFloodSlot {
  const cutoff = now - CONTENT_FORM_FLOOD_WINDOW_MS;
  forgetIdleKeys(cutoff);
  const windows = limits.map(({ key, limit }) => {
    const recent = (attempts.get(key) ?? []).filter((time) => time > cutoff);
    attempts.set(key, recent);
    return { key, limit, recent };
  });
  const full = windows.find(({ limit, recent }) => recent.length >= limit);
  if (full) {
    const oldest = Math.min(...full.recent);
    return {
      ok: false,
      key: full.key,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((oldest + CONTENT_FORM_FLOOD_WINDOW_MS - now) / 1000),
      ),
    };
  }
  for (const { recent } of windows) recent.push(now);
  return { ok: true };
}

export function resetContentFormFloodForTests() {
  attempts.clear();
}
