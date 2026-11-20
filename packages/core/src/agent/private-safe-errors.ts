/**
 * Framework error codes whose user-facing message is fixed text, so a private
 * turn can keep its code and message without exposing private content.
 */
const PRIVATE_SAFE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  private_history_unrecoverable:
    "I stopped because an earlier step in this turn was private and did not finish, so I could not tell whether it had already run. Please send the request again.",
  tool_call_journal_unreadable:
    "I stopped because I could not read this turn's run ledger, so I could not tell which steps had already finished. " +
    "Retrying would risk repeating a step that already completed. Please send the request again.",
  private_action_already_completed:
    "I stopped because a private action already ran earlier in this turn and its details are not kept, so running it again could repeat its change. " +
    "Anything completed before this is saved. Send a new message if you need another change.",
};

export function privateSafeErrorMessage(code: unknown): string | undefined {
  return typeof code === "string" &&
    Object.hasOwn(PRIVATE_SAFE_ERROR_MESSAGES, code)
    ? PRIVATE_SAFE_ERROR_MESSAGES[code]
    : undefined;
}

export function requirePrivateSafeErrorMessage(code: string): string {
  const message = privateSafeErrorMessage(code);
  if (message === undefined) {
    throw new Error(`No private-safe message for error code ${code}`);
  }
  return message;
}
