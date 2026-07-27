const CALENDAR_CREATE_SURFACE_SELECTOR =
  "[data-calendar-create-surface='true']";
const OUTSIDE_CLICK_SUPPRESSION_MS = 500;

/**
 * Tracks event detail popovers and outside clicks into empty calendar space.
 * Calendar views use this to turn the first empty-space click into a dismiss
 * action instead of creating a new event underneath the closing popover.
 */
const openPopoverTokens = new Set<symbol>();
let popoverInteractOutsideAt = 0;
let pendingEmptySpaceSuppression = false;

function isCalendarCreateSurfaceTarget(target: EventTarget | null) {
  if (typeof Element === "undefined") return false;
  if (!(target instanceof Element)) return false;
  if (target.closest("button")) return false;
  return !!target.closest(CALENDAR_CREATE_SURFACE_SELECTOR);
}

function hasPendingEmptySpaceSuppression() {
  if (!pendingEmptySpaceSuppression) return false;
  if (Date.now() - popoverInteractOutsideAt > OUTSIDE_CLICK_SUPPRESSION_MS) {
    pendingEmptySpaceSuppression = false;
    return false;
  }
  return true;
}

export function createEventDetailPopoverToken() {
  return Symbol("event-detail-popover");
}

export function setEventDetailPopoverOpen(token: symbol, open: boolean) {
  if (open) {
    openPopoverTokens.add(token);
  } else {
    openPopoverTokens.delete(token);
  }
}

export function markPopoverInteractOutside(target: EventTarget | null) {
  if (!isCalendarCreateSurfaceTarget(target)) return;
  popoverInteractOutsideAt = Date.now();
  pendingEmptySpaceSuppression = true;
}

export function shouldSuppressCreatePointerDown() {
  return openPopoverTokens.size > 0 || hasPendingEmptySpaceSuppression();
}

export function shouldSuppressAfterPopoverClose() {
  if (openPopoverTokens.size > 0) return true;
  if (!hasPendingEmptySpaceSuppression()) return false;
  pendingEmptySpaceSuppression = false;
  return true;
}
