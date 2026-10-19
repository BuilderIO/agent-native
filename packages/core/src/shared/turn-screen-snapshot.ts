import { scrubUrl } from "../client/url-scrub.js";

/** Message metadata key carrying the sending tab's screen state. */
export const AGENT_SCREEN_METADATA_KEY = "agentNativeScreen";

/** Tab-scoped keys every app's screen context is built from. */
export const FRAMEWORK_SCREEN_STATE_KEYS = [
  "navigation",
  "__url__",
  "settings-view",
  "selection",
] as const;

export const NAVIGATION_COMMAND_KEYS = ["navigate", "__set_url__"] as const;
export const SCREEN_STATE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const MAX_SCREEN_STATE_KEYS = 16;
export const MAX_SCREEN_STATE_VALUE_CHARS = 16_000;
export const MAX_SCREEN_STATE_TOTAL_CHARS = 48_000;

export interface TurnScreenSnapshot {
  v: 1;
  browserTabId: string;
  capturedAt: number;
  values: Record<string, Record<string, unknown> | null>;
  /** Keys too large or malformed to carry; the turn reads these live. */
  omitted?: string[];
  /** Set once the turn changes the screen itself; continuation segments inherit it. */
  released?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function scrubScreenUrl(url: Record<string, unknown>): Record<string, unknown> {
  const pathname = typeof url.pathname === "string" ? url.pathname : "/";
  const search = typeof url.search === "string" ? url.search : "";
  const hash = typeof url.hash === "string" ? url.hash : "";
  const original = `${pathname}${search}${hash}`;
  const scrubbed = scrubUrl(original);
  if (!scrubbed || scrubbed === original) return url;
  const parsed = new URL(scrubbed, "http://placeholder.local");
  return {
    ...url,
    search: parsed.search,
    hash: parsed.hash,
    searchParams: Object.fromEntries(parsed.searchParams),
  };
}

/**
 * Values over the caps, or that are not app-state objects, go to `omitted`
 * so they are read live rather than silently dropped. Message metadata is
 * persisted, so `__url__` is scrubbed of secrets.
 */
export function buildTurnScreenSnapshot(
  browserTabId: string,
  values: Record<string, unknown>,
  capturedAt = Date.now(),
): TurnScreenSnapshot {
  const kept: TurnScreenSnapshot["values"] = {};
  const omitted: string[] = [];
  let total = 0;
  for (const [key, raw] of Object.entries(values).slice(
    0,
    MAX_SCREEN_STATE_KEYS,
  )) {
    if (raw !== null && !isRecord(raw)) {
      omitted.push(key);
      continue;
    }
    const value = key === "__url__" && raw ? scrubScreenUrl(raw) : raw;
    const size = JSON.stringify(value).length;
    if (
      size > MAX_SCREEN_STATE_VALUE_CHARS ||
      total + size > MAX_SCREEN_STATE_TOTAL_CHARS
    ) {
      omitted.push(key);
      continue;
    }
    total += size;
    kept[key] = value;
  }
  return {
    v: 1,
    browserTabId,
    capturedAt,
    values: kept,
    ...(omitted.length ? { omitted } : {}),
  };
}
