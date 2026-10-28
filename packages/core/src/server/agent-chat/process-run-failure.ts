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

function safeDiagnosticToken(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_]{1,64}$/.test(value)
    ? value
    : undefined;
}

function routeFailureEvidence(err: unknown, message: string): string {
  const error =
    err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const cause =
    error?.cause && typeof error.cause === "object"
      ? (error.cause as Record<string, unknown>)
      : null;
  const errorName = safeDiagnosticToken(error?.name) ?? "NonError";
  const errorCode =
    safeDiagnosticToken(error?.code) ?? safeDiagnosticToken(cause?.code);
  const errorMessage =
    /^Background worker returned HTTP ([45]\d\d)(?: code=([A-Za-z0-9_]{1,64}))?$/.exec(
      message,
    );
  const evidence = [
    `errorName=${errorName}`,
    ...(errorCode ? [`errorCode=${errorCode}`] : []),
    ...(errorMessage?.[1] ? [`httpStatus=${errorMessage[1]}`] : []),
    ...(!errorCode && errorMessage?.[2]
      ? [`errorCode=${errorMessage[2]}`]
      : []),
    ...(safeDiagnosticToken(cause?.name)
      ? [`causeName=${safeDiagnosticToken(cause?.name)}`]
      : []),
  ];
  return `${evidence.join(" ")} failure=${message}`;
}

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

  await record(
    runId,
    RUN_DIAG_STAGE.routeThrew,
    routeFailureEvidence(err, message),
  ).catch(() => {});

  const claim = await readClaim(runId);
  if (
    claim?.status !== "running" ||
    claim.dispatchMode !== "background-processing"
  ) {
    return false;
  }

  return finalizeFailure(runId, {
    errorCode: CLAIMED_BACKGROUND_WORKER_FAILED_ERROR_EVENT.errorCode,
    errorDetail: `${CLAIMED_BACKGROUND_WORKER_FAILED_ERROR_EVENT.details} failure=${message}`,
    event: CLAIMED_BACKGROUND_WORKER_FAILED_ERROR_EVENT,
  });
}
