import {
  deleteSettingIfValue,
  listSettingsByPrefix,
  mutateSetting,
} from "../settings/store.js";

/**
 * A prompt refused for missing AI setup is sent again once after setup. Every
 * open tab sees setup become ready, so each would send it; the first resume of
 * a refused run claims it here and any other is told it already went out.
 */
const CLAIM_KEY_PREFIX = "agent-chat-setup-resume:";
const CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const SETUP_RESUME_METADATA_KEY = "agentNativeResumeAfterSetup";
export const SETUP_RESUME_OF_RUN_METADATA_KEY = "agentNativeRecoveryOfRunId";

/** The refused run a request resumes after AI setup, if it is such a resume. */
export function setupResumeRefusedRunId(body: {
  metadata?: unknown;
}): string | undefined {
  const metadata = body.metadata as { custom?: unknown } | null | undefined;
  const custom = metadata?.custom as Record<string, unknown> | null | undefined;
  const refusedRunId = custom?.[SETUP_RESUME_OF_RUN_METADATA_KEY];
  return custom?.[SETUP_RESUME_METADATA_KEY] === true &&
    typeof refusedRunId === "string" &&
    refusedRunId.trim()
    ? refusedRunId.trim()
    : undefined;
}

export interface SetupResumeClaim {
  /** Gives the claim back if this request is not admitted; only ever our own. */
  release(): Promise<void>;
}

/**
 * The claim for the first resume of a refused run (also for that same turn
 * again), or null when another turn already holds it. A request that is then
 * refused admission releases it, so a later resend is not told it went out.
 */
export async function claimSetupResume(opts: {
  ownerEmail: string;
  threadId: string;
  refusedRunId: string;
  turnId: string;
}): Promise<SetupResumeClaim | null> {
  const threadPrefix = `${CLAIM_KEY_PREFIX}${opts.ownerEmail}:${opts.threadId}:`;
  const key = `${threadPrefix}${opts.refusedRunId}`;
  let claimed = false;
  const held = await mutateSetting(key, (current) => {
    const heldBy = typeof current?.turnId === "string" ? current.turnId : null;
    const live =
      typeof current?.expiresAt === "number" && current.expiresAt > Date.now();
    claimed = !heldBy || !live || heldBy === opts.turnId;
    return claimed
      ? { turnId: opts.turnId, expiresAt: Date.now() + CLAIM_TTL_MS }
      : (current ?? {});
  });
  if (!claimed) return null;
  try {
    // Only a row that is still the expired value is removed, so a claim
    // another request just took over is never swept away.
    for (const { key: staleKey, value } of await listSettingsByPrefix(
      threadPrefix,
    )) {
      if (
        typeof value.expiresAt === "number" &&
        value.expiresAt <= Date.now()
      ) {
        await deleteSettingIfValue(staleKey, value);
      }
    }
  } catch (error) {
    // Cleanup only: the claim above already stands.
    console.warn("[agent-chat] could not sweep expired resume claims:", error);
  }
  return {
    release: async () => {
      await deleteSettingIfValue(key, held);
    },
  };
}
