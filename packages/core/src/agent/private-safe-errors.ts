const PRIVATE_RESUME_FAILED_MESSAGE =
  "I stopped because this turn's private steps could not be safely resumed, so I could not confirm whether an earlier step already finished. Check what was saved before sending the request again.";

const PRIVATE_SAFE_ERROR_DETAILS: ReadonlyMap<string, string> = new Map([
  ["private_history_unrecoverable", PRIVATE_RESUME_FAILED_MESSAGE],
  ["tool_call_journal_unreadable", PRIVATE_RESUME_FAILED_MESSAGE],
]);

export function privateSafeErrorDetail(code: unknown): string | undefined {
  return typeof code === "string"
    ? PRIVATE_SAFE_ERROR_DETAILS.get(code)
    : undefined;
}
