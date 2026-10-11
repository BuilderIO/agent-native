export const OVERLAY_BROADCAST_TIMEOUT_MS = 400;

export type OverlayBroadcastOutcome = "complete" | "timed-out";

export async function broadcastOverlayMessage(
  getTabIds: () => Promise<readonly number[]>,
  send: (tabId: number, message: Record<string, unknown>) => Promise<unknown>,
  message: Record<string, unknown>,
  timeoutMs = OVERLAY_BROADCAST_TIMEOUT_MS,
): Promise<OverlayBroadcastOutcome> {
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const delivery = (async () => {
    const tabIds = await getTabIds();
    if (timedOut) return;
    await Promise.all(tabIds.map((tabId) => send(tabId, message)));
  })();
  const deadline = new Promise<OverlayBroadcastOutcome>((resolve) => {
    timeout = setTimeout(() => {
      timedOut = true;
      resolve("timed-out");
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      delivery.then(() => "complete" as const),
      deadline,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
