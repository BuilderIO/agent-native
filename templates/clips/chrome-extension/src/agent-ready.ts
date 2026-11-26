export async function waitForAgentReady<T>(
  read: () => T | null,
  signal: AbortSignal,
  {
    timeoutMs,
    timeoutMessage,
    pollMs = 100,
  }: { timeoutMs: number; timeoutMessage: string; pollMs?: number },
): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    signal.throwIfAborted();
    const value = read();
    if (value !== null) return value;
    if (Date.now() - startedAt > timeoutMs) throw new Error(timeoutMessage);
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, pollMs);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
