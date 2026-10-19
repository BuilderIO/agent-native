const stoppers = new Set<() => void>();

export function registerBackgroundJobStop(stop: () => void): void {
  stoppers.add(stop);
}

export function stopBackgroundJobs(): void {
  const toStop = [...stoppers];
  stoppers.clear();
  for (const stop of toStop) {
    try {
      stop();
    } catch (error) {
      console.error("[agent-native] background job stop failed:", error);
    }
  }
}
