export function storageSetupErrorMessage(
  error: unknown,
  localizedMessage: string,
): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  return (error as { errorCode?: unknown }).errorCode ===
    "storage_setup_required"
    ? localizedMessage
    : undefined;
}
