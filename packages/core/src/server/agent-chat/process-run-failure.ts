import {
  CLAIMED_BACKGROUND_WORKER_FAILED_ERROR_EVENT,
  finalizeClaimedBackgroundRunFailure,
  readBackgroundRunClaim,
  recordRunDiagnostic,
  RUN_DIAG_STAGE,
} from "../../agent/run-store.js";

type AgentChatProcessRunFailureDeps = {
  readBackgroundRunClaim?: typeof readBackgroundRunClaim;
  recordRunDiagnostic?: typeof recordRunDiagnostic;
  finalizeClaimedBackgroundRunFailure?: typeof finalizeClaimedBackgroundRunFailure;
};

export async function finalizeClaimedAgentChatProcessRunFailure(
  runId: string,
  err: unknown,
  deps: AgentChatProcessRunFailureDeps = {},
): Promise<boolean> {
  const readClaim = deps.readBackgroundRunClaim ?? readBackgroundRunClaim;
  const record = deps.recordRunDiagnostic ?? recordRunDiagnostic;
  const finalizeFailure =
    deps.finalizeClaimedBackgroundRunFailure ??
    finalizeClaimedBackgroundRunFailure;
  const message = err instanceof Error ? err.message : String(err);

  await record(runId, RUN_DIAG_STAGE.routeThrew, message).catch(() => {});

  const claim = await readClaim(runId).catch(() => null);
  if (
    claim?.status !== "running" ||
    claim.dispatchMode !== "background-processing"
  ) {
    return false;
  }

  return finalizeFailure(runId, {
    errorCode: CLAIMED_BACKGROUND_WORKER_FAILED_ERROR_EVENT.errorCode,
    errorDetail: `${CLAIMED_BACKGROUND_WORKER_FAILED_ERROR_EVENT.details} setupError=${message}`,
    event: CLAIMED_BACKGROUND_WORKER_FAILED_ERROR_EVENT,
  });
}
