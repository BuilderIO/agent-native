// Pure helpers shared by the server actions, the desktop app, and the web app.
// Keep this file free of React, Node, and Tauri imports.

export const SCREEN_HISTORY_KIND = "screen_history" as const;
export const SCREEN_HISTORY_MIN_SECONDS = 1;
export const SCREEN_HISTORY_MAX_SECONDS = 300;
export const SCREEN_HISTORY_PRESETS = [30, 300] as const;
export const SCREEN_HISTORY_RECENT_LIMIT = 3;

export type ScreenHistoryStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed"
  | "removed";

export interface ScreenHistoryWindow {
  startedAt: string;
  endedAt: string;
}

export function isValidLookbackSeconds(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= SCREEN_HISTORY_MIN_SECONDS &&
    value <= SCREEN_HISTORY_MAX_SECONDS
  );
}

// Presets are always offered, so only custom values are remembered.
export function rememberLookbackSeconds(
  recent: readonly number[],
  seconds: number,
): number[] {
  const kept = recent
    .filter((value) => isValidLookbackSeconds(value))
    .filter((value) => value !== seconds);
  if (
    !isValidLookbackSeconds(seconds) ||
    (SCREEN_HISTORY_PRESETS as readonly number[]).includes(seconds)
  ) {
    return kept.slice(0, SCREEN_HISTORY_RECENT_LIMIT);
  }
  return [seconds, ...kept].slice(0, SCREEN_HISTORY_RECENT_LIMIT);
}

export function lookbackLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

// The window ends when the recording started and reaches back `seconds`.
export function screenHistoryWindowBefore(
  endedAt: string,
  seconds: number,
): ScreenHistoryWindow {
  const end = Date.parse(endedAt);
  if (!Number.isFinite(end)) {
    throw new Error("Screen history needs a valid end time.");
  }
  if (!isValidLookbackSeconds(seconds)) {
    throw new Error(
      `Screen history must be ${SCREEN_HISTORY_MIN_SECONDS} to ${SCREEN_HISTORY_MAX_SECONDS} seconds.`,
    );
  }
  return {
    startedAt: new Date(end - seconds * 1000).toISOString(),
    endedAt: new Date(end).toISOString(),
  };
}

// A trimmed window must stay inside the original and keep at least one second.
export function isWindowWithin(
  original: ScreenHistoryWindow,
  next: ScreenHistoryWindow,
): boolean {
  const origStart = Date.parse(original.startedAt);
  const origEnd = Date.parse(original.endedAt);
  const nextStart = Date.parse(next.startedAt);
  const nextEnd = Date.parse(next.endedAt);
  if (![origStart, origEnd, nextStart, nextEnd].every(Number.isFinite)) {
    return false;
  }
  return (
    nextStart >= origStart &&
    nextEnd <= origEnd &&
    nextEnd - nextStart >= SCREEN_HISTORY_MIN_SECONDS * 1000
  );
}
