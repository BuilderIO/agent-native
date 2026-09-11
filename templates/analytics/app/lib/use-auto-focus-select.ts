import { useEffect, useRef, type RefObject } from "react";

/** Focus an input/textarea and select its existing value after the next paint. */
export function useAutoFocusSelect<
  T extends HTMLInputElement | HTMLTextAreaElement,
>(enabled: boolean): RefObject<T | null> {
  const inputRef = useRef<T | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [enabled]);

  return inputRef;
}
