export const STALE_CHUNK_EXHAUSTED_KEY =
  "__agentNativeStaleChunkRecoveryExhausted";

/**
 * Fired on `window` the first time a stale chunk could not be recovered by a
 * reload. The shared noise rules drop the raw dynamic-import failure because
 * recovery handles it; this is the one signal that it did not, so a deploy whose
 * chunks are gone for everyone stays visible.
 */
export const STALE_CHUNK_RECOVERY_EXHAUSTED_EVENT =
  "agent-native:stale-chunk-recovery-exhausted";

export type StaleChunkRecoveryExhaustedReason = "cooldown" | "desktop";

export interface StaleChunkRecoveryExhausted {
  reason: StaleChunkRecoveryExhaustedReason;
}

/** The recorded exhaustion for this page session, if recovery ever gave up. */
export function readStaleChunkRecoveryExhausted(
  win: Window | undefined = typeof window === "undefined" ? undefined : window,
): StaleChunkRecoveryExhausted | undefined {
  if (!win) return undefined;
  return (win as unknown as Record<string, unknown>)[
    STALE_CHUNK_EXHAUSTED_KEY
  ] as StaleChunkRecoveryExhausted | undefined;
}
