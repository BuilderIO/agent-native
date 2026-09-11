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
): void {
  if (!options.afterPointerGesture) {
    activate();
    return;
  }
  const schedule =
    options.schedule ??
    ((callback: () => void, delayMs: number) =>
      window.setTimeout(callback, delayMs));
  schedule(activate, POINTER_TEXT_EDIT_ACTIVATION_DELAY_MS);
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

export const PENDING_TEXT_EDIT_TIMEOUT_MS = 3000;

// Overview creation patches the target iframe document after persistence.
// Waiting through that bounded replacement avoids opening an edit session in
// the outgoing DOM (visible caret blink, then lost focus). Keystrokes remain
// lossless because DesignCanvas arms its pending buffer before scheduling.
export const POINTER_TEXT_EDIT_ACTIVATION_DELAY_MS = 300;
