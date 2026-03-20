import { watch, type FSWatcher } from "chokidar";
import { EventEmitter } from "events";
import { defineEventHandler, createEventStream } from "h3";

export type { FSWatcher } from "chokidar";

export interface FileWatcherOptions {
  /** Glob patterns or regex to ignore. */
  ignored?: any;
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
  return defineEventHandler(async (event) => {
    const stream = createEventStream(event);

    const onChange = (eventName: string, filePath: string) => {
      stream.push(JSON.stringify({ type: eventName, path: filePath }));
    };

    watcher.on("all", onChange);

    // Subscribe to extra emitters
    const cleanups: Array<() => void> = [];
    for (const { emitter, event: evtName } of options.extraEmitters ?? []) {
      const handler = (data: any) => {
        stream.push(JSON.stringify(data));
      };
      emitter.on(evtName, handler);
      cleanups.push(() => emitter.off(evtName, handler));
    }

    stream.onClosed(() => {
      watcher.off("all", onChange);
      for (const cleanup of cleanups) cleanup();
    });

    return stream.send();
  });
}
