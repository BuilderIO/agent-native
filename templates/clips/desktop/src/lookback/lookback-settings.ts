import {
  isValidLookbackSeconds,
  rememberLookbackSeconds,
  SCREEN_HISTORY_MAX_SECONDS,
  SCREEN_HISTORY_MIN_SECONDS,
} from "../../../shared/screen-history-context";
import { loadString, saveString } from "../lib/storage";

// 0 means Off. Both keys are per-device convenience, not account state.
export const LOOKBACK_SECONDS_KEY = "lookbackSeconds";
export const RECENT_LOOKBACK_SECONDS_KEY = "recentLookbackSeconds";

export type LookbackUnit = "seconds" | "minutes";

export type LookbackCustomError = "empty" | "invalid" | "too-long";

export type LookbackCustomResult =
  | { ok: true; seconds: number }
  | { ok: false; error: LookbackCustomError };

// Whole numbers only. The cap applies after unit conversion, so "6 min" and
// "360 s" are rejected the same way.
export function parseLookbackCustomInput(
  amount: string,
  unit: LookbackUnit,
): LookbackCustomResult {
  const trimmed = amount.trim();
  if (!trimmed) return { ok: false, error: "empty" };
  if (!/^\d+$/.test(trimmed)) return { ok: false, error: "invalid" };
  const seconds = Number(trimmed) * (unit === "minutes" ? 60 : 1);
  if (seconds < SCREEN_HISTORY_MIN_SECONDS) {
    return { ok: false, error: "invalid" };
  }
  if (seconds > SCREEN_HISTORY_MAX_SECONDS) {
    return { ok: false, error: "too-long" };
  }
  return { ok: true, seconds };
}

export function normalizeLookbackSeconds(value: unknown): number {
  return isValidLookbackSeconds(value) ? value : 0;
}

// Presets are always offered, so only custom values are remembered. Input is
// most-recent first; folding oldest-first lets rememberLookbackSeconds apply
// its dedupe, preset filter, and length cap in one place.
export function normalizeRecentLookbackSeconds(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is number => isValidLookbackSeconds(value))
    .reduceRight<number[]>(
      (recent, seconds) => rememberLookbackSeconds(recent, seconds),
      [],
    );
}

export function loadLookbackSeconds(): number {
  return normalizeLookbackSeconds(
    Number(loadString(LOOKBACK_SECONDS_KEY, "0")),
  );
}

export function saveLookbackSeconds(seconds: number): void {
  saveString(LOOKBACK_SECONDS_KEY, String(normalizeLookbackSeconds(seconds)));
}

export function loadRecentLookbackSeconds(): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(loadString(RECENT_LOOKBACK_SECONDS_KEY, "[]"));
  } catch {
    // A corrupt remembered list only loses its chips; recording is unaffected.
    parsed = [];
  }
  return normalizeRecentLookbackSeconds(parsed);
}

export function saveRecentLookbackSeconds(values: number[]): void {
  saveString(
    RECENT_LOOKBACK_SECONDS_KEY,
    JSON.stringify(normalizeRecentLookbackSeconds(values)),
  );
}

// The setting only applies while the lab is on and Rewind can supply footage.
// The stored value is kept either way, so turning Rewind back on restores it.
export function effectiveLookbackSeconds(state: {
  labEnabled: boolean;
  rewindOn: boolean;
  seconds: number;
}): number {
  return state.labEnabled && state.rewindOn
    ? normalizeLookbackSeconds(state.seconds)
    : 0;
}
