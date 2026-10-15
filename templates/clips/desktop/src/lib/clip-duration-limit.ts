/** Only hosted uploads are capped; own storage records with no limit. */
export function hostedClipDurationLimitMs(status: {
  mode: "own" | "hosted" | "none";
  maxClipDurationMs: number;
}): number | null {
  return status.mode === "hosted" ? status.maxClipDurationMs : null;
}

/** True once an unpaused take has run to the hosted per-clip duration cap. */
export function reachedClipDurationLimit(
  state: { paused: boolean; elapsedMs: number },
  maxClipDurationMs: number | null,
): boolean {
  return (
    maxClipDurationMs !== null &&
    maxClipDurationMs > 0 &&
    !state.paused &&
    state.elapsedMs >= maxClipDurationMs
  );
}
