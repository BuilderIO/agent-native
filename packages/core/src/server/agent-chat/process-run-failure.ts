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

function readFailureMessage(err: unknown): {
  message: string;
  readable: boolean;
} {
  try {
    return {
      message: err instanceof Error ? err.message : String(err),
      readable: true,
    };
  } catch {
    return { message: "unreadable thrown value", readable: false };
  }
}

function routeFailureEvidence(
  err: unknown,
  message: string,
  messageReadable: boolean,
): string {
  try {
    const error = err as Record<string, unknown> | null | undefined;
    const cause = error?.cause as Record<string, unknown> | null | undefined;
    const errorName =
      safeDiagnosticToken(error?.name) ??
      (err instanceof Error ? "unknown" : "NonError");
    const errorCode =
      safeDiagnosticToken(error?.code) ?? safeDiagnosticToken(cause?.code);
    const causeName = safeDiagnosticToken(cause?.name);
    const errorMessage =
      /^Background worker returned HTTP ([45]\d\d)(?: code=([A-Za-z0-9_]{1,64}))?$/.exec(
        message,
      );
    const evidence = [
      ...(!messageReadable ? ["errorMetadata=unreadable"] : []),
      `errorName=${errorName}`,
      ...(errorCode ? [`errorCode=${errorCode}`] : []),
      ...(errorMessage?.[1] ? [`httpStatus=${errorMessage[1]}`] : []),
      ...(!errorCode && errorMessage?.[2]
        ? [`errorCode=${errorMessage[2]}`]
        : []),
      ...(causeName ? [`causeName=${causeName}`] : []),
    ];
    return `${evidence.join(" ")} failure=${message}`;
  } catch {
    return `errorMetadata=unreadable failure=${message}`;
  }
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
  const { message, readable } = readFailureMessage(err);

  await record(
    runId,
    RUN_DIAG_STAGE.routeThrew,
    routeFailureEvidence(err, message, readable),
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
