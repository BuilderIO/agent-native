export type PendingTextEditKeyAction =
  | { action: "buffer"; char: string }
  | { action: "drop-last" }
  | { action: "swallow" }
  | { action: "clear-and-swallow" }
  | { action: "pass" };

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

export const POINTER_TEXT_EDIT_ACTIVATION_DELAY_MS = 300;

const BEGIN_TEXT_EDIT_FINAL_RETRY_MS = 4200;

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

export const BEGIN_TEXT_EDIT_ACTIVATION_CONFIRM_DELAY_MS = 300;

export const TEXT_EDIT_STATUS_PROBE_TIMEOUT_MS = 250;

export const PENDING_TEXT_EDIT_TIMEOUT_MS =
  BEGIN_TEXT_EDIT_FINAL_RETRY_MS +
  BEGIN_TEXT_EDIT_ACTIVATION_CONFIRM_DELAY_MS +
  TEXT_EDIT_STATUS_PROBE_TIMEOUT_MS;

export const BRIDGE_READINESS_PROBE_INTERVAL_MS = 250;
export const BRIDGE_READINESS_PROBE_ATTEMPTS = 20;

export const PENDING_TEXT_INTERCEPT_CAP_MS =
  PENDING_TEXT_EDIT_TIMEOUT_MS +
  BRIDGE_READINESS_PROBE_INTERVAL_MS * BRIDGE_READINESS_PROBE_ATTEMPTS;
