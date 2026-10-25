export type GenerationDeckRefreshResult<TDeck> =
  | { status: "ready"; deck: TDeck; endedAt: number }
  | { status: "not_ready"; endedAt: number }
  | { status: "cancelled"; endedAt: number }
  | { status: "failed"; endedAt: number };

function waitForRefreshRetry(signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      resolve(false);
    };
    timeout = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve(true);
    }, 250);
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
    let refreshedDeck = await refreshOpenDeck(deckId);
    if (signal?.aborted) return { status: "cancelled", endedAt };
    if (refreshedDeck === null) {
      const retry = await waitForRefreshRetry(signal);
      if (!retry) return { status: "cancelled", endedAt };
      refreshedDeck = await refreshOpenDeck(deckId);
      if (signal?.aborted) return { status: "cancelled", endedAt };
    }
    return refreshedDeck
      ? { status: "ready", deck: refreshedDeck, endedAt }
      : { status: "not_ready", endedAt };
  } catch {
    if (signal?.aborted) return { status: "cancelled", endedAt };
    return { status: "failed", endedAt };
  }
}
