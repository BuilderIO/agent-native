export class CouldNotRun extends Error {}

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

export function rethrowIfCouldNotRun(error: unknown): void {
  if (error instanceof CouldNotRun) throw error;
}
