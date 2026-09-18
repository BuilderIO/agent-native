export type PendingTextEditKeyAction =
  | { action: "buffer"; char: string }
  | { action: "drop-last" }
  | { action: "swallow" }
  | { action: "clear-and-swallow" }
  | { action: "pass" };

/**
 * Run text-edit activation immediately unless it was requested from inside a
 * pointer gesture's mouseup handler. Browsers dispatch the trailing `click`
 * after mouseup; focusing the new editable before that click makes the click
 * immediately blur it again. Deferring one task preserves the already-armed
 * keystroke buffer while letting that trailing click finish first.
 */
export function schedulePendingTextEditActivation(
  activate: () => void,
  options: {
    afterPointerGesture?: boolean;
    schedule?: (callback: () => void, delayMs: number) => void;
  } = {},
): () => void {
  if (!options.afterPointerGesture) {
    activate();
    return () => {};
  }
  let canceled = false;
  const schedule =
    options.schedule ??
    ((callback: () => void, delayMs: number) => {
      window.setTimeout(callback, delayMs);
    });
  schedule(() => {
    if (canceled) return;
    activate();
  }, POINTER_TEXT_EDIT_ACTIVATION_DELAY_MS);
  return () => {
    canceled = true;
  };
}

export function routePendingTextEditKey(event: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
}): PendingTextEditKeyAction {
  if (event.isComposing) return { action: "pass" };
  if (event.metaKey || event.ctrlKey) return { action: "pass" };
  if (event.key === "Escape") return { action: "clear-and-swallow" };
  if (event.key === "Backspace") return { action: "drop-last" };
  if (
    event.key === "Delete" ||
    event.key === "Enter" ||
    event.key === "Tab" ||
    event.key.startsWith("Arrow")
  ) {
    return { action: "swallow" };
  }
  if (event.key.length === 1) return { action: "buffer", char: event.key };
  return { action: "pass" };
}

// Overview creation patches the target iframe document after persistence.
// Waiting through that bounded replacement avoids opening an edit session in
// the outgoing DOM (visible caret blink, then lost focus). Keystrokes remain
// lossless because DesignCanvas arms its pending buffer before scheduling.
export const POINTER_TEXT_EDIT_ACTIVATION_DELAY_MS = 300;

const BEGIN_TEXT_EDIT_FINAL_RETRY_MS = 4200;

/** Attempt schedule of the begin-text-edit retry ladder
 *  (`scheduleBeginTextEditForScreen`). */
export const BEGIN_TEXT_EDIT_RETRY_DELAYS_MS = [
  POINTER_TEXT_EDIT_ACTIVATION_DELAY_MS,
  600,
  900,
  1200,
  1800,
  2400,
  3200,
  BEGIN_TEXT_EDIT_FINAL_RETRY_MS,
];

/** Grace period before re-probing a just-requested activation. */
export const BEGIN_TEXT_EDIT_ACTIVATION_CONFIRM_DELAY_MS = 300;

/** Round-trip budget for one text-edit-status probe. */
export const TEXT_EDIT_STATUS_PROBE_TIMEOUT_MS = 250;

/** The retry ladder's own deadline, through its last confirmation probe. */
export const PENDING_TEXT_EDIT_TIMEOUT_MS =
  BEGIN_TEXT_EDIT_FINAL_RETRY_MS +
  BEGIN_TEXT_EDIT_ACTIVATION_CONFIRM_DELAY_MS +
  TEXT_EDIT_STATUS_PROBE_TIMEOUT_MS;

/** Schedule of DesignCanvas's bridge-readiness probe: a mounted frame that has
 *  not answered it yet is still loading its document. */
export const BRIDGE_READINESS_PROBE_INTERVAL_MS = 250;
export const BRIDGE_READINESS_PROBE_ATTEMPTS = 20;

/**
 * How long a creation holds keystrokes back from the host: the ladder's window
 * (insert published, owner canvas mounted) plus the mounted frame's bridge
 * handshake. Derived, never picked: a board that mounts slowly is still inside
 * the request. It ends interception only — text typed by then is still owed to
 * the node and is delivered whenever the owner becomes ready.
 */
export const PENDING_TEXT_INTERCEPT_CAP_MS =
  PENDING_TEXT_EDIT_TIMEOUT_MS +
  BRIDGE_READINESS_PROBE_INTERVAL_MS * BRIDGE_READINESS_PROBE_ATTEMPTS;
