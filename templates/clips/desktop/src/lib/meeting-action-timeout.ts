export function withMeetingActionTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  let request: Promise<T>;
  try {
    request = Promise.resolve(operation(controller.signal));
  } catch (error) {
    request = Promise.reject(error);
  }

  return Promise.race([request, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}
