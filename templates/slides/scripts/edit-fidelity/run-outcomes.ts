export class CouldNotRun extends Error {}

export class ActionTransportError extends Error {}

const PLAYWRIGHT_TARGET_TRANSPORT_FAILURE =
  /Execution context was destroyed|frame was detached|Target page, context or browser has been closed|Target crashed|Protocol error \([^)]*\): Target closed|Cannot find context with specified id/i;

export function isPlaywrightTargetTransportFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return PLAYWRIGHT_TARGET_TRANSPORT_FAILURE.test(message);
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

export function rethrowIfCouldNotRun(error: unknown): void {
  if (error instanceof CouldNotRun) throw error;
}
