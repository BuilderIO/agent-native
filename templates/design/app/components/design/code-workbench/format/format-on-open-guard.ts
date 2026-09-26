
export function shouldApplyFormatResult(
  currentModelValue: string,
  snapshotContent: string,
  formatted: string,
): boolean {
  if (formatted === snapshotContent) return false;
  return currentModelValue === snapshotContent;
}
