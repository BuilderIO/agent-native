import { defineEventHandler, createEventStream } from "h3";

export {
  buildHandshakeFrame,
  parseHandshakeFrame,
  parseTokenFrame,
  REALTIME_CAP_NO_AWARENESS,
  REALTIME_PROTOCOL_VERSION,
  REALTIME_SSE_HANDSHAKE_EVENT,
  REALTIME_SSE_TOKEN_EVENT,
  type RealtimeHandshake,
  type RealtimeTokenFrame,
} from "../realtime-protocol.js";

interface EventLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string, listener: (...args: any[]) => void): any;
}

export interface SSEHandlerOptions {
  extraEmitters?: Array<{ emitter: EventLike; event: string }>;
}

export function createSSEHandler(options: SSEHandlerOptions = {}) {
  return defineEventHandler(async (event) => {
    const stream = createEventStream(event);

    let closed = false;

    let batchMode = false;
    const pending: unknown[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const safePush = (data: string) => {
      if (closed) return;
      try {
        void stream.push(data);
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

    for (const { emitter, event: evtName } of options.extraEmitters ?? []) {
      const handler = (data: unknown) => {
        send(data);
      };
      emitter.on(evtName, handler);
      cleanups.push(() => emitter.off(evtName, handler));
    }

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
