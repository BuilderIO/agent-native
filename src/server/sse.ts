import { watch, type FSWatcher } from "chokidar";
import { EventEmitter } from "events";
import type { Request, Response } from "express";

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
  dir: string,
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
 * Create an Express route handler that streams Server-Sent Events for file changes.
 *
 * Usage:
 *   app.get("/api/events", createSSEHandler(watcher));
 */
export function createSSEHandler(
  watcher: FSWatcher,
  options: SSEHandlerOptions = {},
): (req: Request, res: Response) => void {
  return (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const onChange = (eventName: string, filePath: string) => {
      res.write(
        `data: ${JSON.stringify({ type: eventName, path: filePath })}\n\n`,
      );
    };

    watcher.on("all", onChange);

    // Subscribe to extra emitters
    const cleanups: Array<() => void> = [];
    for (const { emitter, event } of options.extraEmitters ?? []) {
      const handler = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };
      emitter.on(event, handler);
      cleanups.push(() => emitter.off(event, handler));
    }

    req.on("close", () => {
      watcher.off("all", onChange);
      for (const cleanup of cleanups) cleanup();
    });
  };
}
