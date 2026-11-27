import { createHash, randomBytes } from "node:crypto";

import { publicClipVisitor } from "../server/lib/clip-public-visitor.js";

export const CONTENT_FORM_FLOOD_WINDOW_MS = 60_000;
export const CONTENT_FORM_SOURCE_LIMIT = 10;
export const CONTENT_FORM_FORM_LIMIT = 60;

const MAX_TRACKED_KEYS = 10_000;

const salt = randomBytes(16);
const attempts = new Map<string, number[]>();

export function contentFormSourceKey(input: {
  email: string | null;
  headers: Headers | undefined;
}): string | null {
  if (input.email) {
    return `person:${createHash("sha256").update(salt).update(input.email).digest("base64url")}`;
  }
  const visitor = publicClipVisitor(input.headers);
  return visitor.key === null ? null : `network:${visitor.key}`;
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
