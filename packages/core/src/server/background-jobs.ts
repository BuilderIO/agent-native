export type BackgroundJobStop = () => void | Promise<void>;

const stoppers = new Set<BackgroundJobStop>();

export function registerBackgroundJobStop(stop: BackgroundJobStop): void {
  stoppers.add(stop);
}

export async function stopBackgroundJobs(): Promise<void> {
  const toStop = [...stoppers];
  stoppers.clear();
  await Promise.all(
    toStop.map(async (stop) => {
      try {
        await stop();
      } catch (error) {
        console.error("[agent-native] background job stop failed:", error);
      }
    }),
  );
}
