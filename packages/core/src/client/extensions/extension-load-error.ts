export type ExtensionLoadError = Error & { status?: number };

export function extensionLoadError(
  status: number,
  message: string,
): ExtensionLoadError {
  const error = new Error(message) as ExtensionLoadError;
  error.status = status;
  return error;
}

export function extensionLoadErrorStatus(error: unknown): number | undefined {
  return error && typeof error === "object" && "status" in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
}

export function shouldRetryExtensionLoad(
  failureCount: number,
  error: unknown,
): boolean {
  const status = extensionLoadErrorStatus(error);
  if (status === 404) return failureCount < 5;
  if (status === 401 || status === 403) return false;
  return failureCount < 1;
}
