export function originalUserPrompt(
  value: string,
  approvalPrompt: string,
  approvedContinuationPrompt: string,
): string {
  if (value.trim() === approvedContinuationPrompt) return approvalPrompt;
  const continuationIndex = value.indexOf(approvedContinuationPrompt);
  if (
    continuationIndex >= 0 &&
    value.slice(0, continuationIndex).trim() === ""
  ) {
    return approvalPrompt;
  }
  const frameworkSuffixes = [
    "\n\n<current-time>",
    "\n\n<current-screen>",
    "\n\nContinue from where you left off",
    approvedContinuationPrompt,
  ];
  const suffixIndexes = frameworkSuffixes
    .map((suffix) => value.indexOf(suffix))
    .filter((index) => index >= 0);
  const end =
    suffixIndexes.length > 0 ? Math.min(...suffixIndexes) : value.length;
  return value.slice(0, end).trim();
}
