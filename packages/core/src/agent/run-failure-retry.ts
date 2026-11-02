import { isLlmCredentialError } from "./engine/credential-errors.js";
import {
  isCreditsLimitErrorCode,
  isRejectedRequestErrorCode,
} from "./engine/error-detail.js";

// Codes where the request, the account, or the model selection is at fault, so
// the same prompt sent again fails identically.
const PERSISTENT_FAILURE_CODES = new Set([
  "invalid_attachment",
  "model_not_found",
  "not_found_error",
  "builder_model_unauthorized",
  "builder_auth_error",
  "permission_error",
]);

/**
 * Whether resending the same prompt can succeed after an errored run, judged
 * from its stored `terminal_reason` (`error:<code>`). Clients use it to decide
 * on an automatic retry; a manual retry stays available either way, since the
 * user may change the model or the prompt first.
 */
export function isRunFailureRetryable(terminalReason: string): boolean {
  const code = (
    terminalReason.startsWith("error:")
      ? terminalReason.slice("error:".length)
      : terminalReason
  )
    .trim()
    .toLowerCase();
  // The gateway's masked "internal error" stays retryable on purpose: it is
  // sometimes transient, and a missed retry costs more than an extra one.
  return (
    !isRejectedRequestErrorCode(code) &&
    !isCreditsLimitErrorCode(code) &&
    !PERSISTENT_FAILURE_CODES.has(code) &&
    // Covers the bare `missing_api_key` reason, which has no `error:` prefix.
    code !== "missing_api_key" &&
    !isLlmCredentialError(undefined, code)
  );
}
