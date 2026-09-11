export async function reconcileProcessingBackup(args: {
  waitForReady: () => Promise<{ status?: string } | null>;
  onReady: () => Promise<unknown>;
  onUnresolved: () => Promise<unknown>;
  onPollError?: (error: unknown) => void;
}): Promise<"ready" | "unresolved"> {
  try {
    const recovered = await args.waitForReady();
    if (recovered?.status === "ready") {
      await args.onReady();
      return "ready";
    }
  } catch (error) {
    args.onPollError?.(error);
  }

  await args.onUnresolved();
  return "unresolved";
}
