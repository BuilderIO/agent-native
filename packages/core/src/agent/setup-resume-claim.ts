import {
  deleteSetting,
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

/** True for the first resume of a refused run, and for that same turn again. */
export async function claimSetupResume(opts: {
  ownerEmail: string;
  threadId: string;
  refusedRunId: string;
  turnId: string;
}): Promise<boolean> {
  const threadPrefix = `${CLAIM_KEY_PREFIX}${opts.ownerEmail}:${opts.threadId}:`;
  let claimed = false;
  await mutateSetting(`${threadPrefix}${opts.refusedRunId}`, (current) => {
    const heldBy = typeof current?.turnId === "string" ? current.turnId : null;
    const live =
      typeof current?.expiresAt === "number" && current.expiresAt > Date.now();
    claimed = !heldBy || !live || heldBy === opts.turnId;
    return claimed
      ? { turnId: opts.turnId, expiresAt: Date.now() + CLAIM_TTL_MS }
      : (current ?? {});
  });
  if (claimed) {
    // Claimed first, so a failed sweep cannot lose the claim.
    for (const { key, value } of await listSettingsByPrefix(threadPrefix)) {
      if (
        typeof value.expiresAt === "number" &&
        value.expiresAt <= Date.now()
      ) {
        await deleteSetting(key);
      }
    }
  }
  return claimed;
}
