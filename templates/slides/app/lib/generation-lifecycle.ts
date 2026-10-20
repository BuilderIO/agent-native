export type GenerationDeckRefreshResult<TDeck> =
  | { status: "ready"; deck: TDeck; endedAt: number }
  | { status: "not_ready"; endedAt: number }
  | { status: "cancelled"; endedAt: number }
  | { status: "failed"; endedAt: number };

function waitForRefreshRetry(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const finish = () => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(signal?.reason);
    };
    const timer = setTimeout(finish, 250);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

export async function refreshDeckForGenerationOutcome<TDeck>(
  refreshOpenDeck: (deckId: string) => Promise<TDeck | null>,
  deckId: string,
  now: () => number = Date.now,
  signal?: AbortSignal,
): Promise<GenerationDeckRefreshResult<TDeck>> {
  const endedAt = now();
  try {
    signal?.throwIfAborted();
    let refreshedDeck = await refreshOpenDeck(deckId);
    signal?.throwIfAborted();
    if (refreshedDeck === null) {
      await waitForRefreshRetry(signal);
      signal?.throwIfAborted();
      refreshedDeck = await refreshOpenDeck(deckId);
      signal?.throwIfAborted();
    }
    return refreshedDeck
      ? { status: "ready", deck: refreshedDeck, endedAt }
      : { status: "not_ready", endedAt };
  } catch (error) {
    if (signal?.aborted && error === signal.reason) {
      return { status: "cancelled", endedAt };
    }
    return { status: "failed", endedAt };
  }
}
