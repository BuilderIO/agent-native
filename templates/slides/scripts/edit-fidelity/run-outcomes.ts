export class CouldNotRun extends Error {}

export class ActionTransportError extends Error {}

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
