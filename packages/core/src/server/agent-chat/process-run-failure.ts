import {
  CLAIMED_BACKGROUND_WORKER_FAILED_ERROR_EVENT,
  ensureTerminalRunEvent,
  readBackgroundRunClaim,
  recordRunDiagnostic,
  RUN_DIAG_STAGE,
  setRunError,
  setRunTerminalReason,
  updateRunStatusIfRunning,
} from "../../agent/run-store.js";

type AgentChatProcessRunFailureDeps = {
  readBackgroundRunClaim?: typeof readBackgroundRunClaim;
  recordRunDiagnostic?: typeof recordRunDiagnostic;
  setRunError?: typeof setRunError;
  setRunTerminalReason?: typeof setRunTerminalReason;
  updateRunStatusIfRunning?: typeof updateRunStatusIfRunning;
  ensureTerminalRunEvent?: typeof ensureTerminalRunEvent;
};

export async function finalizeClaimedAgentChatProcessRunFailure(
  runId: string,
  err: unknown,
  deps: AgentChatProcessRunFailureDeps = {},
): Promise<boolean> {
  const readClaim = deps.readBackgroundRunClaim ?? readBackgroundRunClaim;
  const record = deps.recordRunDiagnostic ?? recordRunDiagnostic;
  const setError = deps.setRunError ?? setRunError;
  const setTerminalReason = deps.setRunTerminalReason ?? setRunTerminalReason;
  const updateStatus =
    deps.updateRunStatusIfRunning ?? updateRunStatusIfRunning;
  const ensureTerminal = deps.ensureTerminalRunEvent ?? ensureTerminalRunEvent;
  const message = err instanceof Error ? err.message : String(err);

  await record(runId, RUN_DIAG_STAGE.routeThrew, message).catch(() => {});

  const claim = await readClaim(runId).catch(() => null);
  if (
    claim?.status !== "running" ||
    claim.dispatchMode !== "background-processing"
  ) {
    return false;
  }

  await setError(
    runId,
    CLAIMED_BACKGROUND_WORKER_FAILED_ERROR_EVENT.errorCode,
    `${CLAIMED_BACKGROUND_WORKER_FAILED_ERROR_EVENT.details} setupError=${message}`,
  ).catch(() => {});
  const statusUpdated = await updateStatus(runId, "errored").catch(() => false);
  if (statusUpdated) {
    await setTerminalReason(
      runId,
      CLAIMED_BACKGROUND_WORKER_FAILED_ERROR_EVENT.errorCode,
    ).catch(() => {});
  }
  await ensureTerminal(
    runId,
    CLAIMED_BACKGROUND_WORKER_FAILED_ERROR_EVENT,
  ).catch(() => {});
  return true;
}
