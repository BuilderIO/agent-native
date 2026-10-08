import { type RefObject, useLayoutEffect, useRef, useState } from "react";

/**
 * A value derived from an element's width, kept as state only when it
 * changes, so a resize re-renders the owner at thresholds, not every frame.
 * `fromWidth` receives the current value to hold a threshold with
 * hysteresis, and `inputs` names anything else it reads, so a change
 * re-derives the value without waiting for a resize. The value stays
 * `initial` until the element has a laid-out width: a box with no width has
 * not been measured yet.
 */
export function useElementWidthValue<T>(
  ref: RefObject<HTMLElement | null>,
  fromWidth: (width: number, current: T) => T,
  initial: T,
  enabled = true,
  inputs?: string | number,
) {
  const [value, setValue] = useState(initial);
  const fromWidthRef = useRef(fromWidth);
  useLayoutEffect(() => {
    fromWidthRef.current = fromWidth;
  });

  // A layout effect so the first measured value replaces `initial` before
  // the browser paints.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const width = element.getBoundingClientRect().width;
      if (width <= 0) return;
      setValue((current) => {
        const next = fromWidthRef.current(width, current);
        return Object.is(next, current) ? current : next;
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [enabled, inputs, ref]);

  return value;
}
