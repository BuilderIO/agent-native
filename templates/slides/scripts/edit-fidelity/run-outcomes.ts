export class CouldNotRun extends Error {}

export function rethrowIfCouldNotRun(error: unknown): void {
  if (error instanceof CouldNotRun) throw error;
}
