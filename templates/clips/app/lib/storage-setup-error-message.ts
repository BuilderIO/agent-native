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

export function storageAwareErrorMessage(
  error: unknown,
  localizedMessage: string,
  fallback: string,
): string {
  const setupMessage = storageSetupErrorMessage(error, localizedMessage);
  if (setupMessage) return setupMessage;

  const candidates =
    typeof error === "string"
      ? [error]
      : error && typeof error === "object"
        ? [
            (error as { error?: unknown }).error,
            (error as { message?: unknown }).message,
          ]
        : [];
  return (
    candidates.find(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.trim().length > 0,
    ) ?? fallback
  );
}
