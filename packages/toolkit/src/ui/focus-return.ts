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

let lastOutsideLayers: Element | null = null;
let tracking = false;

// A dialog whose field has `autoFocus` has already taken focus by the time its
// content mounts, so the opener is the last element focused outside any dialog.
// The listener has to exist before that opener is focused, hence module load.
function trackFocus() {
  if (tracking || typeof document === "undefined") return;
  tracking = true;
  document.addEventListener(
    "focusin",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[role="dialog"],[role="alertdialog"]')) return;
      lastOutsideLayers = target;
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
  const opener =
    active && content.contains(active) ? lastOutsideLayers : active;
  return { target: openerOf(opener) };
}

/** Focuses the opener when it is still on the page; false when it is not. */
export function restoreFocusReturn(entry: FocusReturn | null): boolean {
  const target = entry?.target;
  if (!target?.isConnected) return false;
  target.focus({ preventScroll: true });
  return document.activeElement === target;
}
