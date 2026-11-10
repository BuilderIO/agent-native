export type HoverPeekState = "closed" | "peeking" | "pinned";

export interface HoverPeekOptions {
  openDelayMs: number;
  closeDelayMs: number;
  setExpanded: (expanded: boolean) => void;
}

export interface HoverPeek {
  hover: (hovered: boolean) => void;
  toggle: () => void;
  interact: () => void;
  pin: () => void;
  /** The owner already collapsed the pill natively; forget any peek or pin. */
  reset: () => void;
  setEnabled: (enabled: boolean) => void;
  state: () => HoverPeekState;
  dispose: () => void;
}

/**
 * Expanded is one state with three owners: a hover peek, an explicit pin, and
 * nothing. A peek closes when the pointer leaves; a pin only closes on toggle.
 * Collapsing under the pointer suppresses the next peek until the pointer
 * leaves, or the pill would reopen the moment the user closed it.
 */
export function createHoverPeek(options: HoverPeekOptions): HoverPeek {
  let state: HoverPeekState = "closed";
  let hovered = false;
  let enabled = true;
  let suppressed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const transition = (next: HoverPeekState) => {
    const wasExpanded = state !== "closed";
    state = next;
    const expanded = next !== "closed";
    if (expanded !== wasExpanded) options.setExpanded(expanded);
  };

  const scheduleOpen = () => {
    if (!enabled || suppressed || state !== "closed" || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      if (hovered && enabled && state === "closed") transition("peeking");
    }, options.openDelayMs);
  };

  const collapse = () => {
    clearTimer();
    suppressed = hovered;
    transition("closed");
  };

  return {
    hover(next) {
      hovered = next;
      if (next) {
        if (state === "peeking") clearTimer();
        else scheduleOpen();
        return;
      }
      suppressed = false;
      clearTimer();
      if (state !== "peeking") return;
      timer = setTimeout(() => {
        timer = null;
        if (!hovered && state === "peeking") transition("closed");
      }, options.closeDelayMs);
    },
    toggle() {
      if (state !== "closed") {
        collapse();
        return;
      }
      clearTimer();
      transition("pinned");
    },
    interact() {
      if (state !== "peeking") return;
      clearTimer();
      transition("pinned");
    },
    pin() {
      clearTimer();
      transition("pinned");
    },
    reset() {
      clearTimer();
      suppressed = hovered;
      state = "closed";
    },
    setEnabled(next) {
      enabled = next;
      if (!next) {
        clearTimer();
        if (state === "peeking") transition("closed");
        return;
      }
      if (hovered) scheduleOpen();
    },
    state: () => state,
    dispose: clearTimer,
  };
}
