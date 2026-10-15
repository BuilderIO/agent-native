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

/** The create-recording response is authoritative: `null` means own storage
 * (uncapped), `undefined` means an older server that omitted the field. */
export function resolveTakeClipLimitMs(
  fromCreate: number | null | undefined,
  probed: number | null,
): number | null {
  return fromCreate === undefined ? probed : fromCreate;
}

let takeClipLimitMs: number | null | undefined;

export function setTakeClipLimitMs(value: unknown): void {
  takeClipLimitMs =
    value === null
      ? null
      : typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : undefined;
}

export function currentTakeClipLimitMs(probed: number | null): number | null {
  return resolveTakeClipLimitMs(takeClipLimitMs, probed);
}
