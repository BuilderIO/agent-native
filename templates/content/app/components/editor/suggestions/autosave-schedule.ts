export const SUGGESTION_AUTOSAVE_IDLE_MS = 1000;
const SUGGESTION_AUTOSAVE_MAX_WAIT_MS = 5000;
const SUGGESTION_AUTOSAVE_RETRY_MS = 2000;
const SUGGESTION_AUTOSAVE_MAX_RETRY_MS = 30_000;

export interface SuggestionAutosave {
  timer: ReturnType<typeof setTimeout> | null;
  /** The queued timer is a failed save's backoff retry. */
  retrying: boolean;
  dirtySince: number | null;
  retryDelay: number;
  disposed: boolean;
}

export function createSuggestionAutosave(): SuggestionAutosave {
  return {
    timer: null,
    retrying: false,
    dirtySince: null,
    retryDelay: 0,
    disposed: false,
  };
}

/**
 * The draft changed, or a save has to wait for one in flight. Returns false
 * once the editor has unmounted, when no timer will run the save.
 */
export function queueSuggestionAutosave(
  autosave: SuggestionAutosave,
  save: () => void,
  minimumDelay = 0,
): boolean {
  if (autosave.disposed) return false;
  // Typing must not pull a queued retry earlier, or an outage becomes a
  // request per keystroke.
  if (!autosave.retrying)
    setSuggestionAutosaveTimer(autosave, save, minimumDelay, false);
  return true;
}

/** A save failed; try again after a growing backoff. */
export function retrySuggestionAutosave(
  autosave: SuggestionAutosave,
  save: () => void,
) {
  autosave.retryDelay = Math.min(
    Math.max(autosave.retryDelay * 2, SUGGESTION_AUTOSAVE_RETRY_MS),
    SUGGESTION_AUTOSAVE_MAX_RETRY_MS,
  );
  if (autosave.disposed) return;
  // Replaces any typing timer queued while the failed save was in flight; it
  // would otherwise fire before the backoff.
  setSuggestionAutosaveTimer(autosave, save, 0, true);
}

export function markSuggestionAutosaveSaved(
  autosave: SuggestionAutosave,
  draftUnchanged: boolean,
) {
  autosave.retryDelay = 0;
  if (draftUnchanged) autosave.dirtySince = null;
}

export function resetSuggestionAutosave(autosave: SuggestionAutosave) {
  if (autosave.timer) clearTimeout(autosave.timer);
  autosave.timer = null;
  autosave.retrying = false;
  autosave.dirtySince = null;
  autosave.retryDelay = 0;
}

function setSuggestionAutosaveTimer(
  autosave: SuggestionAutosave,
  save: () => void,
  minimumDelay: number,
  retrying: boolean,
) {
  const now = Date.now();
  autosave.dirtySince ??= now;
  if (autosave.timer) clearTimeout(autosave.timer);
  // The max-wait deadline bounds only the typing debounce, which reaches zero
  // once it passes; retries and waits behind an in-flight save keep their own
  // delay or they would spin.
  const debounce = Math.min(
    SUGGESTION_AUTOSAVE_IDLE_MS,
    Math.max(0, autosave.dirtySince + SUGGESTION_AUTOSAVE_MAX_WAIT_MS - now),
  );
  autosave.retrying = retrying;
  autosave.timer = setTimeout(
    () => {
      autosave.timer = null;
      autosave.retrying = false;
      save();
    },
    Math.max(debounce, autosave.retryDelay, minimumDelay),
  );
}
