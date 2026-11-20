const PRIVATE_SAFE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  private_history_unrecoverable:
    "I stopped because an earlier step in this turn was private and did not finish, so I could not tell whether it had already run. Please send the request again.",
  tool_call_journal_unreadable:
    "I stopped because I could not read this turn's run ledger, so I could not tell which steps had already finished. " +
    "Retrying would risk repeating a step that already completed. Please send the request again.",
};

export const PRIVATE_ACTION_ALREADY_COMPLETED_RESULT =
  "Not run: this action already ran earlier in this turn, and its private details are not kept, so running it again could repeat its change. " +
  "Do not retry it in this turn. Tell the user what was completed and ask them to send a new message if they need another change.";

export function privateSafeErrorMessage(code: unknown): string | undefined {
  return typeof code === "string" &&
    Object.hasOwn(PRIVATE_SAFE_ERROR_MESSAGES, code)
    ? PRIVATE_SAFE_ERROR_MESSAGES[code]
    : undefined;
}
