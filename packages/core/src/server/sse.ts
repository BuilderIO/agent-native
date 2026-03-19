import { watch, type FSWatcher } from "chokidar";
import { EventEmitter } from "events";
import path from "path";
import { defineEventHandler, createEventStream } from "h3";

export type { FSWatcher } from "chokidar";

export interface FileWatcherOptions {
  /** Glob patterns or regex to ignore. */
  ignored?: string | RegExp | string[];
  /** Whether to emit events for the initial file scan. Default: false (ignoreInitial: true) */
  emitInitial?: boolean;
}

/**
 * Create a chokidar file watcher for the given directory.
 * Returns a chokidar.FSWatcher that emits "all" events on file changes.
 */
export function createFileWatcher(
  dir: string | string[],
  options: FileWatcherOptions = {},
): FSWatcher {
  return watch(dir, {
    ignoreInitial: !options.emitInitial,
    ignored: options.ignored,
  });
}

export interface SSEHandlerOptions {
  /** Additional EventEmitters to stream events from (e.g. sync events). */
  extraEmitters?: Array<{ emitter: EventEmitter; event: string }>;
  /** Content root for computing relative paths. If provided, absolute paths are stripped. */
  contentRoot?: string;
}

/**
 * Create an H3 event handler that streams Server-Sent Events for file changes.
 *
 * Usage:
 *   router.get("/api/events", createSSEHandler(watcher));
 */
export function createSSEHandler(
  watcher: FSWatcher,
  options: SSEHandlerOptions = {},
) {
  const projectRoot = options.contentRoot
    ? path.resolve(options.contentRoot, "..")
    : null;

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

    const onChange = (eventName: string, filePath: string) => {
      const relPath = projectRoot
        ? path.relative(projectRoot, filePath)
        : filePath;
      send({ source: "file", type: eventName, path: relPath });
    };

    watcher.on("all", onChange);

    // Subscribe to extra emitters (sync events already have source field)
    const cleanups: Array<() => void> = [];
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
      watcher.off("all", onChange);
      for (const cleanup of cleanups) cleanup();
    });

    return stream.send();
  });
}
