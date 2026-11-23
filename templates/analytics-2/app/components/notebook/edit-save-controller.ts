/**
 * Debounced autosave for cell text (sprint-analytics-2 daily-driver P0: unrun
 * SQL/code was lost on reload because a draft lived only in React until Run).
 *
 * The timing rules live here, headless and independent of React, so they can be
 * tested one rule at a time:
 *   - an edit waits `delayMs` before saving, so typing does not save per key;
 *   - edits inside the window collapse into one save that reads the latest text;
 *   - an edit that lands while a save is in flight queues exactly one more save;
 *   - cancelling drops a pending save (the cell was discarded);
 *   - flushing runs a pending save now (the person pressed Run).
 */
export const EDIT_SAVE_DELAY_MS = 500;

type SaveFn = () => Promise<unknown>;

interface Timer {
  schedule: (callback: () => void, delayMs: number) => unknown;
  clear: (handle: unknown) => void;
}

interface Entry {
  timer: unknown;
  save: SaveFn;
  inFlight: boolean;
  queued: boolean;
}

export interface EditSaveController {
  /** Record an edit for `id`; `save` is called once the cell has settled. */
  edit: (id: string, save: SaveFn, delayMs?: number) => void;
  /** Run this cell's pending save immediately, waiting for it and any follow-up. */
  flush: (id: string) => Promise<void>;
  /** Run every pending save now; the page-hide path uses this so a last edit is not lost. */
  flushAll: () => Promise<void>;
  /** Drop any pending save for this cell. */
  cancel: (id: string) => void;
  /** Cells with a save scheduled or running. */
  pendingIds: () => string[];
}

const defaultTimer: Timer = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createEditSaveController({
  delayMs = EDIT_SAVE_DELAY_MS,
  timer = defaultTimer,
}: { delayMs?: number; timer?: Timer } = {}): EditSaveController {
  const entries = new Map<string, Entry>();

  const run = async (id: string): Promise<void> => {
    const entry = entries.get(id);
    if (entry == null) return;
    if (entry.inFlight) {
      // The save already running will pick this edit up when it settles.
      entry.queued = true;
      return;
    }
    entry.inFlight = true;
    entry.queued = false;
    try {
      await entry.save();
    } finally {
      entry.inFlight = false;
      const again = entry.queued;
      entry.queued = false;
      if (again && entries.get(id) === entry) {
        // The text changed while saving, so save the settled value once more.
        void run(id);
      }
    }
  };

  const edit = (id: string, save: SaveFn, delay = delayMs): void => {
    const existing = entries.get(id);
    if (existing != null) {
      timer.clear(existing.timer);
      existing.save = save;
      // Text typed while a save is in flight must land when that save settles,
      // without waiting out another debounce window.
      if (existing.inFlight) existing.queued = true;
      existing.timer = timer.schedule(() => {
        void run(id);
      }, delay);
      return;
    }
    const entry: Entry = {
      timer: timer.schedule(() => {
        void run(id);
      }, delay),
      save,
      inFlight: false,
      queued: false,
    };
    entries.set(id, entry);
  };

  const flush = async (id: string): Promise<void> => {
    const entry = entries.get(id);
    if (entry == null) return;
    timer.clear(entry.timer);
    await run(id);
  };

  const cancel = (id: string): void => {
    const entry = entries.get(id);
    if (entry == null) return;
    timer.clear(entry.timer);
    entries.delete(id);
  };

  const flushAll = async (): Promise<void> => {
    const ids = [...entries.keys()];
    await Promise.all(ids.map((id) => flush(id)));
  };

  return {
    edit,
    flush,
    flushAll,
    cancel,
    pendingIds: () => [...entries.keys()],
  };
}
