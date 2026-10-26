export type MobileSessionBootstrapResult<T> =
  | { status: "ready"; value: T }
  | { reason: "read-failed" | "timeout"; status: "error" };

export function shouldShowMobileSessionLoadError(
  hasSuccessfulBootstrap: boolean,
): boolean {
  return !hasSuccessfulBootstrap;
}

export async function settleMobileSessionStorageRead<T>(
  read: () => Promise<T>,
  timeoutMs = 5_000,
): Promise<MobileSessionBootstrapResult<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const request = Promise.resolve()
    .then(read)
    .then<MobileSessionBootstrapResult<T>, MobileSessionBootstrapResult<T>>(
      (value) => ({ status: "ready", value }),
      () => ({ reason: "read-failed", status: "error" }),
    );
  const timeout = new Promise<MobileSessionBootstrapResult<T>>((resolve) => {
    timeoutId = setTimeout(
      () => resolve({ reason: "timeout", status: "error" }),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
