import { defineEventHandler, createEventStream } from "h3";

/** Any object with on/off methods (compatible with EventEmitter, TypedEventEmitter, etc.). */
interface EventLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string, listener: (...args: any[]) => void): any;
}

export interface SSEHandlerOptions {
  /** Additional EventEmitters to stream events from (e.g. DB change events). */
  extraEmitters?: Array<{ emitter: EventLike; event: string }>;
}

/**
 * Create an H3 event handler that streams Server-Sent Events.
 *
 * Streams events from DB change emitters (application state, settings).
 *
 * Usage:
 *   router.get("/_agent-native/events", createSSEHandler({ extraEmitters }));
 */
export function createSSEHandler(options: SSEHandlerOptions = {}) {
  return defineEventHandler(async (event) => {
    const stream = createEventStream(event);

    let closed = false;

    // --- Batch mode for startup sync bursts ---
    let batchMode = false;
    const pending: unknown[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const safePush = (data: string) => {
      if (closed) return;
      try {
        stream.push(data);
      } catch {
        // Connection dead — events lost for this client, EventSource will reconnect
      }
    };

    const flush = () => {
      flushTimer = null;
      if (closed || pending.length === 0) return;
      const batch = pending.splice(0);
      safePush(JSON.stringify({ type: "batch", events: batch }));
    };

    const send = (evt: unknown) => {
      if (closed) return;
      if (batchMode) {
        pending.push(evt);
        if (!flushTimer) flushTimer = setTimeout(flush, 150);
      } else {
        safePush(JSON.stringify(evt));
      }
    };

    const cleanups: Array<() => void> = [];

    // Subscribe to extra emitters (DB change events)
    for (const { emitter, event: evtName } of options.extraEmitters ?? []) {
      const handler = (data: unknown) => {
        send(data);
      };
      emitter.on(evtName, handler);
      cleanups.push(() => emitter.off(evtName, handler));
    }

    // Listen for batch mode signals from sync engine
    for (const { emitter } of options.extraEmitters ?? []) {
      const startBatch = () => {
        batchMode = true;
      };
      const endBatch = () => {
        batchMode = false;
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        flush();
      };
      emitter.on("sync-burst-start", startBatch);
      emitter.on("sync-burst-end", endBatch);
      cleanups.push(() => {
        emitter.off("sync-burst-start", startBatch);
        emitter.off("sync-burst-end", endBatch);
      });
    }

    stream.onClosed(() => {
      closed = true;
      if (flushTimer) clearTimeout(flushTimer);
      pending.length = 0;
      for (const cleanup of cleanups) cleanup();
    });

    return stream.send();
  });
}
