/**
 * Recovery for chat streams that close without a terminal event. The server
 * always ends a finished run with `done`/`error`/…; a stream that just stops
 * was dropped (mobile network cut, proxy timeout, hosted background-worker
 * handoff). Reattach to the run's event stream from the last seen seq —
 * mirrors the web adapter's `/runs/:id/events?after=lastSeq+1` reconnect.
 */

import type { WireEvent } from "./types";
import { isTerminalWireEvent } from "./types";

export interface ReattachResult {
  sawTerminal: boolean;
  lastSeq: number;
}

export interface ReattachOptions {
  runId: string;
  /** Seq of the last event already applied; -1 when none arrived. */
  lastSeq: number;
  signal: AbortSignal;
  /** Folds a recovered event into the visible turn state. */
  apply: (event: WireEvent) => void;
  resume: (
    runId: string,
    after: number,
    signal: AbortSignal,
  ) => Promise<{ events: AsyncIterable<WireEvent> }>;
  attempts?: number;
  delayMs?: number;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 1500;

export async function reattachDroppedRun(
  options: ReattachOptions,
): Promise<ReattachResult> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  let lastSeq = options.lastSeq;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (options.signal.aborted) break;
    try {
      const stream = await options.resume(
        options.runId,
        lastSeq + 1,
        options.signal,
      );
      for await (const event of stream.events) {
        if (options.signal.aborted) break;
        if (typeof event.seq === "number") lastSeq = event.seq;
        options.apply(event);
        if (isTerminalWireEvent(event)) {
          return { sawTerminal: true, lastSeq };
        }
      }
    } catch {
      // Resume endpoint unreachable or stream errored — retry below.
    }
    if (options.signal.aborted) break;
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return { sawTerminal: false, lastSeq };
}
