import {
  isCreditsLimitErrorCode,
  isRejectedRequestErrorCode,
} from "./engine/error-detail.js";

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
  return !isRejectedRequestErrorCode(code) && !isCreditsLimitErrorCode(code);
}
