const FLUSH_REQUEST_EVENT = "agentNative.mobileDeckSaveFlush";
const FLUSH_ACK_TYPE = "agentNative.mobileDeckSaveFlush.ack";
const FLUSH_ACK_TIMEOUT_MS = 15_000;

type FlushAck =
  | { status: "flushed"; activeDeckId: string }
  | { status: "not-target"; activeDeckId: string | null };

type PendingFlush = {
  deckId: string;
  resolve: (ack: FlushAck) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type MobileSlidesWebView = {
  requestFlush: (requestId: string, deckId: string) => Promise<FlushAck>;
  receiveAck: (value: unknown) => boolean;
  dispose: () => void;
};

const slidesWebViews = new Map<string, MobileSlidesWebView>();
let nextWebViewId = 0;

export class MobileDeckSaveFlushError extends Error {
  constructor() {
    super("The Slides editor did not confirm that its current deck was saved.");
    this.name = "MobileDeckSaveFlushError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requestId(): string {
  return `mobile-deck-flush-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildFlushRequestScript(requestId: string, deckId: string): string {
  return `window.dispatchEvent(new CustomEvent(${JSON.stringify(FLUSH_REQUEST_EVENT)},{detail:${JSON.stringify({ requestId, deckId })}})); true;`;
}

export function registerMobileSlidesWebView(
  injectJavaScript: (script: string) => void,
): { receiveAck: (value: unknown) => boolean; dispose: () => void } {
  const id = `slides-webview-${++nextWebViewId}`;
  const pending = new Map<string, PendingFlush>();
  let disposed = false;

  const rejectPending = (entry: PendingFlush) => {
    clearTimeout(entry.timeout);
    entry.reject(new MobileDeckSaveFlushError());
  };

  const webView: MobileSlidesWebView = {
    requestFlush: (requestId, deckId) => {
      if (disposed) return Promise.reject(new MobileDeckSaveFlushError());

      return new Promise<FlushAck>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(requestId);
          reject(new MobileDeckSaveFlushError());
        }, FLUSH_ACK_TIMEOUT_MS);
        const entry = { deckId, resolve, reject, timeout };
        pending.set(requestId, entry);

        try {
          injectJavaScript(buildFlushRequestScript(requestId, deckId));
        } catch {
          pending.delete(requestId);
          rejectPending(entry);
        }
      });
    },
    receiveAck: (value) => {
      const message = asRecord(value);
      if (message?.type !== FLUSH_ACK_TYPE) return false;

      const requestId =
        typeof message.requestId === "string" ? message.requestId : null;
      const entry = requestId ? pending.get(requestId) : undefined;
      if (!entry || !requestId) return true;

      pending.delete(requestId);
      clearTimeout(entry.timeout);
      if (message.requestedDeckId !== entry.deckId) {
        entry.reject(new MobileDeckSaveFlushError());
        return true;
      }

      if (
        message.status === "flushed" &&
        message.activeDeckId === entry.deckId
      ) {
        entry.resolve({ status: "flushed", activeDeckId: entry.deckId });
        return true;
      }

      if (
        message.status === "not-target" &&
        (message.activeDeckId === null ||
          typeof message.activeDeckId === "string")
      ) {
        entry.resolve({
          status: "not-target",
          activeDeckId: message.activeDeckId,
        });
        return true;
      }

      entry.reject(new MobileDeckSaveFlushError());
      return true;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      slidesWebViews.delete(id);
      for (const entry of pending.values()) rejectPending(entry);
      pending.clear();
    },
  };

  slidesWebViews.set(id, webView);
  return {
    receiveAck: webView.receiveAck,
    dispose: webView.dispose,
  };
}

export async function flushMobileSlidesDeckSave(deckId: string): Promise<void> {
  if (!deckId.trim()) throw new MobileDeckSaveFlushError();

  const targets = [...slidesWebViews.entries()];
  if (targets.length === 0) throw new MobileDeckSaveFlushError();

  const currentRequestId = requestId();
  const targetIds = targets.map(([id]) => id).sort();
  const outcomes = await Promise.allSettled(
    targets.map(([, webView]) =>
      webView.requestFlush(currentRequestId, deckId),
    ),
  );
  const currentIds = [...slidesWebViews.keys()].sort();
  if (
    targetIds.length !== currentIds.length ||
    targetIds.some((id, index) => id !== currentIds[index])
  ) {
    throw new MobileDeckSaveFlushError();
  }

  let matchedDeck = false;
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      throw new MobileDeckSaveFlushError();
    }
    if (
      outcome.value.status === "flushed" &&
      outcome.value.activeDeckId === deckId
    ) {
      matchedDeck = true;
    }
  }

  if (!matchedDeck) throw new MobileDeckSaveFlushError();
}
