import * as React from "react";

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
    const onPressStart = () => {
      pressing.current = true;
    };
    const onPressEnd = () => {
      pressing.current = false;
      if (!blurredDuringPress.current) return;
      blurredDuringPress.current = false;
      clearTimeout(settleTimer);
      // The click fires right after the release, ahead of this timer.
      settleTimer = setTimeout(() => {
        setFocused(Boolean(ref.current?.contains(document.activeElement)));
      });
    };
    window.addEventListener("pointerdown", onPressStart, true);
    window.addEventListener("pointerup", onPressEnd, true);
    window.addEventListener("pointercancel", onPressEnd, true);
    return () => {
      clearTimeout(settleTimer);
      window.removeEventListener("pointerdown", onPressStart, true);
      window.removeEventListener("pointerup", onPressEnd, true);
      window.removeEventListener("pointercancel", onPressEnd, true);
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
