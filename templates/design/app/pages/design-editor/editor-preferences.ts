import { DEFAULT_NUDGE_AMOUNTS, type NudgeAmounts } from "./nudge-intent";

export const DESIGN_EDITOR_PREFERENCES_STORAGE_KEY =
  "agent-native.design.editor-preferences";

export interface DesignEditorPreferences {
  nudge: NudgeAmounts;
}

export const DEFAULT_EDITOR_PREFERENCES: DesignEditorPreferences = {
  nudge: DEFAULT_NUDGE_AMOUNTS,
};

/** Figma allows 1-1000 for both nudge amounts and rejects 0 — a 0 nudge makes
 * the arrow keys look broken rather than doing nothing on purpose. */
export const MIN_NUDGE_AMOUNT = 1;
export const MAX_NUDGE_AMOUNT = 1000;

export function normalizeNudgeAmount(value: unknown, fallback: number): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return fallback;
  return Math.min(
    MAX_NUDGE_AMOUNT,
    Math.max(MIN_NUDGE_AMOUNT, Math.round(parsed)),
  );
}

export type ParseEditorPreferencesResult =
  | { status: "absent"; preferences: DesignEditorPreferences }
  | { status: "ok"; preferences: DesignEditorPreferences }
  | {
      status: "invalid";
      preferences: DesignEditorPreferences;
      reason: string;
    };

/** Never collapses "nothing stored yet" and "stored value is corrupt" into the
 * same result: the caller must be able to tell a first run from a store it
 * should overwrite rather than keep re-reading. */
export function parseEditorPreferences(
  raw: string | null | undefined,
): ParseEditorPreferencesResult {
  if (raw === null || raw === undefined || raw === "") {
    return { status: "absent", preferences: DEFAULT_EDITOR_PREFERENCES };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error) {
    return {
      status: "invalid",
      preferences: DEFAULT_EDITOR_PREFERENCES,
      reason: String(error),
    };
  }
  if (typeof decoded !== "object" || decoded === null) {
    return {
      status: "invalid",
      preferences: DEFAULT_EDITOR_PREFERENCES,
      reason: "expected an object",
    };
  }
  const nudge = (decoded as { nudge?: unknown }).nudge;
  if (nudge !== undefined && (typeof nudge !== "object" || nudge === null)) {
    return {
      status: "invalid",
      preferences: DEFAULT_EDITOR_PREFERENCES,
      reason: "expected nudge to be an object",
    };
  }
  const source = (nudge ?? {}) as { small?: unknown; big?: unknown };
  return {
    status: "ok",
    preferences: {
      nudge: {
        small: normalizeNudgeAmount(source.small, DEFAULT_NUDGE_AMOUNTS.small),
        big: normalizeNudgeAmount(source.big, DEFAULT_NUDGE_AMOUNTS.big),
      },
    },
  };
}

export function serializeEditorPreferences(
  preferences: DesignEditorPreferences,
): string {
  return JSON.stringify({
    nudge: {
      small: normalizeNudgeAmount(
        preferences.nudge.small,
        DEFAULT_NUDGE_AMOUNTS.small,
      ),
      big: normalizeNudgeAmount(
        preferences.nudge.big,
        DEFAULT_NUDGE_AMOUNTS.big,
      ),
    },
  });
}
