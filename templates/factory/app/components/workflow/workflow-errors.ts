/**
 * What an action failure carries once `useActionMutation` has thrown it: the
 * typed `errorCode` and `details` the action set, and the plain message.
 */
export interface ActionFailure {
  errorCode: string | null;
  status: number | null;
  message: string;
  details: Record<string, unknown>;
}

export function readActionFailure(
  error: unknown,
  unknownMessage: string,
): ActionFailure {
  if (!(error instanceof Error)) {
    return {
      errorCode: null,
      status: null,
      message: typeof error === "string" ? error : unknownMessage,
      details: {},
    };
  }
  const carried = error as Error & {
    errorCode?: unknown;
    status?: unknown;
    actionMessage?: unknown;
    details?: unknown;
  };
  const details =
    carried.details &&
    typeof carried.details === "object" &&
    !Array.isArray(carried.details)
      ? (carried.details as Record<string, unknown>)
      : {};
  return {
    errorCode: typeof carried.errorCode === "string" ? carried.errorCode : null,
    status: typeof carried.status === "number" ? carried.status : null,
    message:
      typeof carried.actionMessage === "string" && carried.actionMessage
        ? carried.actionMessage
        : error.message,
    details,
  };
}

/**
 * An action the server does not have answers 404 with no `errorCode`; every
 * typed "not found" an action raises carries one. That difference is how a
 * call to an action that has not shipped yet is told from a missing record.
 */
export function isUnknownActionError(failure: ActionFailure): boolean {
  return failure.status === 404 && failure.errorCode === null;
}

/** One problem from a refused save, as `graph_invalid` lists it. */
export interface ServerIssue {
  source: "schema" | "graph" | "job";
  code: string;
  path?: string;
  nodeId?: string;
  edgeId?: string;
  port?: string;
  detail?: string;
}

type SaveFailure =
  | {
      kind: "graph_invalid";
      issues: ServerIssue[];
      issueCount: number;
      truncated: boolean;
      message: string;
    }
  | { kind: "version_conflict"; currentVersion: number | null; message: string }
  | {
      kind: "job_sync_failed";
      savedVersion: number | null;
      disabledBySave: boolean;
      message: string;
    }
  | { kind: "workflow_not_found"; message: string }
  | { kind: "other"; code: string | null; message: string };

function readIssues(value: unknown): ServerIssue[] {
  if (!Array.isArray(value)) return [];
  const issues: ServerIssue[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.code !== "string") continue;
    const source =
      raw.source === "schema" || raw.source === "job" ? raw.source : "graph";
    issues.push({
      source,
      code: raw.code,
      ...(typeof raw.path === "string" && raw.path ? { path: raw.path } : {}),
      ...(typeof raw.nodeId === "string" ? { nodeId: raw.nodeId } : {}),
      ...(typeof raw.edgeId === "string" ? { edgeId: raw.edgeId } : {}),
      ...(typeof raw.port === "string" ? { port: raw.port } : {}),
      ...(typeof raw.detail === "string" ? { detail: raw.detail } : {}),
    });
  }
  return issues;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Sorts a failed save, restore, or create into the cases the page answers differently. */
export function classifySaveFailure(
  error: unknown,
  unknownMessage: string,
): SaveFailure {
  const failure = readActionFailure(error, unknownMessage);
  switch (failure.errorCode) {
    case "graph_invalid": {
      const issues = readIssues(failure.details.issues);
      return {
        kind: "graph_invalid",
        issues,
        issueCount: numberOrNull(failure.details.issueCount) ?? issues.length,
        truncated: failure.details.truncated === true,
        message: failure.message,
      };
    }
    case "version_conflict":
      return {
        kind: "version_conflict",
        currentVersion: numberOrNull(failure.details.currentVersion),
        message: failure.message,
      };
    case "job_sync_failed":
      return {
        kind: "job_sync_failed",
        savedVersion: numberOrNull(failure.details.savedVersion),
        disabledBySave: failure.details.disabledBySave === true,
        message: failure.message,
      };
    case "workflow_not_found":
      return { kind: "workflow_not_found", message: failure.message };
    default:
      return {
        kind: "other",
        code: failure.errorCode,
        message: failure.message,
      };
  }
}
