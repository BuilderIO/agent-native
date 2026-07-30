// During a zoom gesture the constant-size selection chrome is frozen (we don't
// re-render); on commit it recomputes to its fixed screen size. These transitions
// are enabled only for that brief settle, so normal selection, resize, and
// screen-switch geometry stays pinned to the frame.
export const CHROME_SETTLE_MS = 150;
const CHROME_OPACITY_TRANSITION = "opacity 150ms ease-out";
const CHROME_BORDER_SETTLE_TRANSITION = `inset ${CHROME_SETTLE_MS}ms ease-out, border-width ${CHROME_SETTLE_MS}ms ease-out, border-radius ${CHROME_SETTLE_MS}ms ease-out, ${CHROME_OPACITY_TRANSITION}`;
const SELECTION_BOX_SETTLE_TRANSITION = `border-width ${CHROME_SETTLE_MS}ms ease-out, border-radius ${CHROME_SETTLE_MS}ms ease-out, ${CHROME_OPACITY_TRANSITION}`;
const CHROME_HANDLE_SETTLE_TRANSITION = `width ${CHROME_SETTLE_MS}ms ease-out, height ${CHROME_SETTLE_MS}ms ease-out, border-width ${CHROME_SETTLE_MS}ms ease-out, top ${CHROME_SETTLE_MS}ms ease-out, bottom ${CHROME_SETTLE_MS}ms ease-out, left ${CHROME_SETTLE_MS}ms ease-out, right ${CHROME_SETTLE_MS}ms ease-out, ${CHROME_OPACITY_TRANSITION}`;

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

/**
 * Frame header (name + "Interact" button). It is counter-scaled by transform to
 * stay a fixed screen size, and that counter-scale now tracks the live zoom
 * every gesture frame through the `--an-chrome-scale` custom property — so
 * unlike the border/handle/selection chrome above there is no settle-time
 * snap-back to ease, and no `chromeSettling` branch. Transitioning `transform`
 * here would actively lag the label behind the canvas whenever a new zoom tick
 * lands inside the settle window. Opacity is still eased so the button's
 * hover-fade keeps working.
 */
export function getChromeLabelTransition() {
  return CHROME_OPACITY_TRANSITION;
}
