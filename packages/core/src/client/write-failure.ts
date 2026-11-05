import {
  actionErrorStatus,
  isActionCircuitOpenError,
} from "./action-failure-circuit.js";
import {
  actionErrorMessage,
  isAbortError,
  isActionTimeout,
  isNetworkLevelFailure,
} from "./use-action.js";

export {
  WRITE_FAILURE_EVENT,
  reportWriteFailure,
  type WriteFailureDetail,
} from "./write-failure-event.js";

export type WriteFailureKind =
  | "offline"
  | "timeout"
  | "forbidden"
  | "refused"
  | "server"
  | "unknown";

export type WriteFailureClassification =
  | { skip: true }
  | { skip: false; kind: WriteFailureKind; authoredMessage?: string };

/**
 * Decide whether a failed write earns a toast and what it should say. A 401 is
 * skipped because the session recheck already owns it; an abort is the caller
 * cancelling on purpose.
 */
export function classifyWriteFailure(
  error: unknown,
): WriteFailureClassification {
  if (isAbortError(error)) return { skip: true };
  const status = actionErrorStatus(error);
  if (status === 401) return { skip: true };
  if (isActionCircuitOpenError(error)) return { skip: false, kind: "server" };
  if (isActionTimeout(error)) return { skip: false, kind: "timeout" };
  if (isNetworkLevelFailure(error)) return { skip: false, kind: "offline" };
  if (status === 403) return { skip: false, kind: "forbidden" };
  if (status !== undefined && status >= 400 && status < 500) {
    const message = actionErrorMessage(error);
    return message
      ? { skip: false, kind: "refused", authoredMessage: message }
      : { skip: false, kind: "refused" };
  }
  // A 5xx body is the server's masked "Internal server error", so it never
  // becomes the toast text.
  if (status !== undefined && status >= 500) {
    return { skip: false, kind: "server" };
  }
  return { skip: false, kind: "unknown" };
}

/**
 * The error to report for a raw `fetch` write that came back not ok. It carries
 * the status, so a 401 stays silent, a 403 says permission and a 5xx stays
 * generic.
 */
export function writeFailureFromResponse(
  response: Pick<Response, "status">,
): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${response.status}`), {
    status: response.status,
  });
}

/**
 * For a raw `useMutation` that is not `useActionMutation`: pass as `meta` so
 * the toaster reports its failure.
 */
export function surfaceMutationError(label?: string): {
  surfaceError: true;
  errorLabel?: string;
} {
  return label === undefined
    ? { surfaceError: true }
    : { surfaceError: true, errorLabel: label };
}
