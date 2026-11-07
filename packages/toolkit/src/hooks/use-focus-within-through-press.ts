import * as React from "react";

// A tap moves focus and clicks after its release, within the browser's
// double-tap delay of about 300 ms.
const TAP_CLICK_WAIT_MS = 400;

/**
 * Tracks focus inside an element that shrinks when focus leaves it, such as a
 * reply box that rests as one line.
 *
 * Pressing a control outside the element moves focus on pointer down. Shrinking
 * right then moves everything laid out around the element, so the control can
 * slide out from under the pointer before the release, and the click lands
 * somewhere else. Focus lost during a press only counts once that press's click
 * has fired.
 */
export function useFocusWithinThroughPress(
  ref: React.RefObject<HTMLElement | null>,
) {
  const [focused, setFocused] = React.useState(false);
  const pressing = React.useRef(false);
  const blurredDuringPress = React.useRef(false);

  React.useEffect(() => {
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let tapTimer: ReturnType<typeof setTimeout> | undefined;
    const onPressStart = () => {
      clearTimeout(tapTimer);
      pressing.current = true;
    };
    const onPressEnd = () => {
      clearTimeout(tapTimer);
      pressing.current = false;
      if (!blurredDuringPress.current) return;
      blurredDuringPress.current = false;
      clearTimeout(settleTimer);
      // The click's own handlers run ahead of this timer.
      settleTimer = setTimeout(() => {
        setFocused(Boolean(ref.current?.contains(document.activeElement)));
      });
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== "touch") {
        onPressEnd();
        return;
      }
      clearTimeout(tapTimer);
      tapTimer = setTimeout(onPressEnd, TAP_CLICK_WAIT_MS);
    };
    window.addEventListener("pointerdown", onPressStart, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPressEnd, true);
    window.addEventListener("click", onPressEnd, true);
    // Neither of these reports a release, so a press could otherwise stick.
    window.addEventListener("contextmenu", onPressEnd, true);
    window.addEventListener("blur", onPressEnd);
    return () => {
      clearTimeout(settleTimer);
      clearTimeout(tapTimer);
      window.removeEventListener("pointerdown", onPressStart, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPressEnd, true);
      window.removeEventListener("click", onPressEnd, true);
      window.removeEventListener("contextmenu", onPressEnd, true);
      window.removeEventListener("blur", onPressEnd);
    };
  }, [ref]);

  const focusWithinProps = {
    onFocusCapture: () => {
      blurredDuringPress.current = false;
      setFocused(true);
    },
    onBlurCapture: (event: React.FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && ref.current?.contains(next)) return;
      if (pressing.current) {
        blurredDuringPress.current = true;
        return;
      }
      setFocused(false);
    },
  };

  return { focused, focusWithinProps };
}
