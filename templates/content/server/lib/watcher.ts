import path from "path";
import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import {
  persistVersionHistory,
  resolveProjectVersionHistoryTarget,
  shouldSuppressWatcherVersionHistory,
  shouldTrackVersionHistory,
} from "./version-history.js";

const contentDir = path.resolve(process.cwd(), "content");
let contentWatcher: FSWatcher | null = null;
const watcherPersistDebounceTimers = new Map<string, NodeJS.Timeout>();
const WATCHER_PERSIST_DEBOUNCE_MS = 250;

const persistHistoryForContentChange = async (changedPath: string) => {
  try {
    if (shouldSuppressWatcherVersionHistory(changedPath)) {
      return;
    }

    const target = resolveProjectVersionHistoryTarget(changedPath);
    if (!target || !shouldTrackVersionHistory(target.filePath)) {
      return;
    }

    const content = await import("fs").then((fs) =>
      fs.promises.readFile(changedPath, "utf-8"),
    );
    await persistVersionHistory({
      filePath: target.historyPath,
      content,
      fallbackTimestamp: Date.now(),
    });
  } catch (error) {
    console.error(
      "Failed to persist version history from file watcher:",
      error,
    );
  }
};

export function getContentWatcher() {
  if (contentWatcher) {
    return contentWatcher;
  }

  contentWatcher = chokidar.watch(contentDir, {
    ignoreInitial: true,
    ignored: /\/media\/\.upload-sessions\//,
  });

  const scheduleHistoryPersistForContentChange = (changedPath: string) => {
    const normalizedPath = path.resolve(changedPath);
    const existingTimer = watcherPersistDebounceTimers.get(normalizedPath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      watcherPersistDebounceTimers.delete(normalizedPath);
      void persistHistoryForContentChange(normalizedPath);
    }, WATCHER_PERSIST_DEBOUNCE_MS);

    watcherPersistDebounceTimers.set(normalizedPath, timer);
  };

  contentWatcher.on("add", scheduleHistoryPersistForContentChange);
  contentWatcher.on("change", scheduleHistoryPersistForContentChange);

  return contentWatcher;
}

export const watcher = getContentWatcher();
