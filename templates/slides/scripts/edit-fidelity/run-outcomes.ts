export class CouldNotRun extends Error {}

export class ActionTransportError extends Error {}

export class ActionRequestTimeoutError extends Error {}

export class ActionHttpError extends Error {
  constructor(
    readonly actionName: string,
    readonly status: number,
  ) {
    super(`${actionName} returned HTTP ${status}`);
  }
}

const PLAYWRIGHT_TARGET_TRANSPORT_FAILURE =
  /Execution context was destroyed|frame was detached|Target page, context or browser has been closed|Target crashed|Page crashed|Navigation failed because page crashed|Protocol error \([^)]*\): Target closed|Cannot find context with specified id/i;

export function isPlaywrightTargetTransportFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return PLAYWRIGHT_TARGET_TRANSPORT_FAILURE.test(message);
}

export function isPlaywrightTimeoutFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    (error instanceof Error && error.name === "TimeoutError") ||
    /\bTimeout \d+ms exceeded\b/i.test(message)
  );
}

export async function runSetupAsCouldNotRun<T>(
  label: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CouldNotRun) throw error;
    throw new CouldNotRun(`${label}: ${String(error)}`);
  }
}

export async function runSetupActionAsCouldNotRun<T>(
  label: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ActionTransportError) {
      throw new CouldNotRun(`${label}: ${String(error)}`);
    }
    throw error;
  }
}

export function getHarnessUnavailableError(error: unknown): CouldNotRun | null {
  if (error instanceof CouldNotRun) return error;
  if (error instanceof ActionTransportError) {
    return new CouldNotRun(
      `authoring action transport failed: ${String(error)}`,
    );
  }
  if (isPlaywrightTargetTransportFailure(error)) {
    return new CouldNotRun(
      `Playwright target transport failed: ${String(error)}`,
    );
  }
  return null;
}

export function shouldUseFreshBrowserPageForCleanup(
  error: unknown,
  pageClosed: boolean,
) {
  return pageClosed || isPlaywrightTargetTransportFailure(error);
}

export function canReuseAuthoringFuzzCleanupPage(
  pageClosed: boolean,
  pageUnavailable: boolean,
) {
  return !pageClosed && !pageUnavailable;
}

export function shouldLookUpAuthoringFuzzScratchDeck(
  createAttempted: boolean,
  deckId: string | null,
  createError: unknown,
) {
  if (!createAttempted || deckId) return false;
  return !(
    createError instanceof ActionHttpError &&
    createError.status >= 400 &&
    createError.status < 500
  );
}

export async function withTimeout<T>(
  label: string,
  timeoutMs: number,
  pending: Promise<T>,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export function rethrowIfHarnessUnavailable(error: unknown): void {
  const unavailable = getHarnessUnavailableError(error);
  if (unavailable) throw unavailable;
}
