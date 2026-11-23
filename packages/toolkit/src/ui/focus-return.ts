import * as React from "react";

/**
 * Where focus goes back to when a dialog closes.
 *
 * Radix returns focus to a dialog's `DialogTrigger` only. Most dialogs here are
 * opened from state (a button's onClick, a menu item's onSelect), so there is no
 * trigger and focus fell to `<body>`: the next Tab started from the top of the
 * page and list shortcuts stopped until a click. Each dialog remembers its opener
 * instead. A menu item is not a usable opener (its menu is gone by then), so the
 * menu's own trigger stands in for it.
 */
export interface FocusReturn {
  target: HTMLElement | null;
}

const focusLayers: Element[] = [];
let pullingFocusBack = false;

function activeFocusLayer() {
  return focusLayers.findLast(
    (layer) => layer.isConnected && layer.getAttribute("data-state") === "open",
  );
}

const RECENT_FOCUS = 8;
interface Recorded {
  element: Element;
  at: number;
}
const recentFocus: Recorded[] = [];
// An interaction opens a dialog within moments; an older record is only an
// opener when its control sits in a dialog that is still open (a nested dialog).
const OPENER_WINDOW_MS = 1500;
let tracking = false;

// A dialog whose field has `autoFocus` has already taken focus by the time its
// content mounts, so the opener is the last element focused outside that
// dialog: inside a parent dialog it is the parent's control, not the page's.
// The listener has to exist before that opener is focused, hence module load.
function remember(target: Element) {
  const at = Date.now();
  const last = recentFocus.at(-1);
  if (last?.element === target) {
    last.at = at;
    return;
  }
  recentFocus.push({ element: target, at });
  if (recentFocus.length > RECENT_FOCUS) recentFocus.shift();
}

// Some browsers do not focus a button on click, so the pressed control is
// remembered too: the click runs before the handler that opens the dialog.
function trackFocus() {
  if (tracking || typeof document === "undefined") return;
  tracking = true;
  document.addEventListener(
    "focusin",
    (event) => {
      if (event.target instanceof Element) remember(event.target);
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const pressed = event.target.closest(
        'button,a[href],[role="button"],[role="menuitem"],[tabindex]',
      );
      if (pressed) remember(pressed);
    },
    true,
  );
}
trackFocus();

function openerOf(active: Element | null): HTMLElement | null {
  let current: Element | null = active;
  // a submenu item resolves to its sub-trigger, which is itself inside a menu
  for (let depth = 0; current && depth < 8; depth += 1) {
    const menu = current.closest('[role="menu"][aria-labelledby]');
    if (!menu) break;
    const triggerId = menu.getAttribute("aria-labelledby");
    current = triggerId ? document.getElementById(triggerId) : null;
  }
  if (!(current instanceof HTMLElement)) return null;
  if (current === document.body || current === document.documentElement) {
    return null;
  }
  return current;
}

export function rememberFocusReturn(content: Element): FocusReturn {
  const active = document.activeElement;
  const now = Date.now();
  const found = recentFocus.findLast(
    ({ element, at }) =>
      element.isConnected &&
      !content.contains(element) &&
      (now - at <= OPENER_WINDOW_MS ||
        element.closest('[role="dialog"],[role="alertdialog"]') !== null),
  );
  if (found) return { target: openerOf(found.element) };
  if (!active || active === document.body || content.contains(active))
    return { target: null };
  return { target: openerOf(active) };
}

const FocusReturnContext =
  React.createContext<React.MutableRefObject<Element | null> | null>(null);

export function FocusReturnScope({ children }: { children: React.ReactNode }) {
  const trigger = React.useRef<Element | null>(null);
  return React.createElement(
    FocusReturnContext.Provider,
    { value: trigger },
    children,
  );
}

function useForwardedElement<T extends Element>(
  forwardedRef: React.ForwardedRef<T>,
) {
  const node = React.useRef<T | null>(null);
  const attached = React.useRef(forwardedRef);
  const release = React.useRef<(() => void) | null>(null);
  React.useLayoutEffect(() => {
    if (attached.current === forwardedRef) return;
    release.current?.();
    release.current = null;
    attached.current = forwardedRef;
    if (node.current) release.current = assignRef(forwardedRef, node.current);
  });
  const attach = React.useCallback((next: T | null) => {
    node.current = next;
    release.current?.();
    release.current = next ? assignRef(attached.current, next) : null;
  }, []);
  return { node, attach };
}

export function useNativeTriggerRef<T extends Element>(
  forwardedRef: React.ForwardedRef<T>,
) {
  const trigger = React.useContext(FocusReturnContext);
  const { attach } = useForwardedElement(forwardedRef);
  return React.useCallback(
    (next: T | null) => {
      if (trigger) trigger.current = next;
      attach(next);
    },
    [attach, trigger],
  );
}

/** Focuses the opener when it is still on the page; false when it is not. */
export function restoreFocusReturn(entry: FocusReturn | null): boolean {
  const target = entry?.target;
  if (!target?.isConnected) return false;
  target.focus({ preventScroll: true });
  return document.activeElement === target;
}

/**
 * Records the opener when the content mounts and focuses it again on close (see
 * focus-return). A caller's `onCloseAutoFocus` that prevents the default keeps
 * the choice of where focus goes.
 */
export function useFocusReturn<T extends Element>(
  forwardedRef: React.ForwardedRef<T>,
) {
  const entry = React.useRef<FocusReturn | null>(null);
  const { node, attach } = useForwardedElement(forwardedRef);
  const trigger = React.useContext(FocusReturnContext);
  return React.useMemo(
    () => ({
      ref(next: T | null) {
        const previous = node.current;
        const position = previous ? focusLayers.indexOf(previous) : -1;
        if (position >= 0) focusLayers.splice(position, 1);
        if (next) focusLayers.push(next);
        attach(next);
        if (next) entry.current = rememberFocusReturn(next);
      },
      focusOutside(
        event: CustomEvent<{ originalEvent: FocusEvent }>,
        modal: boolean,
      ) {
        const content = node.current;
        if (
          !modal ||
          activeFocusLayer() !== content ||
          event.defaultPrevented ||
          content.getAttribute("data-state") !== "open" ||
          content.getAttribute("aria-hidden") === "true" ||
          content.contains(document.activeElement)
        )
          return;

        if (pullingFocusBack) return;
        pullingFocusBack = true;
        try {
          const previous = event.detail.originalEvent.relatedTarget;
          if (previous instanceof HTMLElement && content.contains(previous))
            previous.focus({ preventScroll: true });
          else if (content instanceof HTMLElement)
            content.focus({ preventScroll: true });
        } finally {
          pullingFocusBack = false;
        }
      },
      close(event: Event, preferTrigger = true) {
        const current = entry.current;
        entry.current = null;
        if (event.defaultPrevented) return;
        const nativeTrigger = trigger?.current;
        const nativeTarget =
          preferTrigger &&
          nativeTrigger instanceof HTMLElement &&
          nativeTrigger.isConnected
            ? nativeTrigger
            : null;
        const target = nativeTarget ?? current?.target;
        const active = activeFocusLayer();
        if (
          active &&
          active !== node.current &&
          (!target || !active.contains(target))
        ) {
          event.preventDefault();
          return;
        }
        if (nativeTarget && nativeTarget === nativeTrigger) return;
        if (!target?.isConnected) return;
        event.preventDefault();
        restoreFocusReturn({ target });
      },
    }),
    [attach, node, trigger],
  );
}

function assignRef<T>(
  target: React.ForwardedRef<T>,
  value: T,
): (() => void) | null {
  if (typeof target === "function") {
    const cleanup = (target as (v: T | null) => void | (() => void))(value);
    return typeof cleanup === "function" ? cleanup : () => target(null);
  }
  if (!target) return null;
  target.current = value;
  return () => {
    target.current = null;
  };
}
