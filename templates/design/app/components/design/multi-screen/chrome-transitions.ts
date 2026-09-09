// During a zoom gesture the constant-size selection chrome is frozen (we don't
// re-render); on commit it recomputes to its fixed screen size. These transitions
// are enabled only for that brief settle, so normal selection, resize, and
// screen-switch geometry stays pinned to the frame.
export const CHROME_SETTLE_MS = 150;
const CHROME_OPACITY_TRANSITION = "opacity 150ms ease-out";
const CHROME_BORDER_SETTLE_TRANSITION = `inset ${CHROME_SETTLE_MS}ms ease-out, border-width ${CHROME_SETTLE_MS}ms ease-out, border-radius ${CHROME_SETTLE_MS}ms ease-out, ${CHROME_OPACITY_TRANSITION}`;
const SELECTION_BOX_SETTLE_TRANSITION = `border-width ${CHROME_SETTLE_MS}ms ease-out, border-radius ${CHROME_SETTLE_MS}ms ease-out, ${CHROME_OPACITY_TRANSITION}`;
const CHROME_HANDLE_SETTLE_TRANSITION = `width ${CHROME_SETTLE_MS}ms ease-out, height ${CHROME_SETTLE_MS}ms ease-out, border-width ${CHROME_SETTLE_MS}ms ease-out, top ${CHROME_SETTLE_MS}ms ease-out, bottom ${CHROME_SETTLE_MS}ms ease-out, left ${CHROME_SETTLE_MS}ms ease-out, right ${CHROME_SETTLE_MS}ms ease-out, ${CHROME_OPACITY_TRANSITION}`;
const CHROME_LABEL_SETTLE_TRANSITION = `all ${CHROME_SETTLE_MS}ms ease-out`;

export function getChromeBorderTransition(chromeSettling: boolean) {
  return chromeSettling
    ? CHROME_BORDER_SETTLE_TRANSITION
    : CHROME_OPACITY_TRANSITION;
}

export function getSelectionBoxTransition(chromeSettling: boolean) {
  return chromeSettling ? SELECTION_BOX_SETTLE_TRANSITION : "none";
}

export function getChromeHandleTransition(chromeSettling: boolean) {
  return chromeSettling
    ? CHROME_HANDLE_SETTLE_TRANSITION
    : CHROME_OPACITY_TRANSITION;
}

/** Frame labels and their action button should ease into their settled geometry
 * after zooming, but stay pinned during the live gesture. */
export function getChromeLabelTransition(chromeSettling: boolean) {
  return chromeSettling
    ? CHROME_LABEL_SETTLE_TRANSITION
    : CHROME_OPACITY_TRANSITION;
}
