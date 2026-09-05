import { useLayoutEffect, type MutableRefObject } from "react";

export function resizeTextareaToContent(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  const nextHeight = `${textarea.scrollHeight}px`;
  if (textarea.style.height !== nextHeight) textarea.style.height = nextHeight;
}

export function useWidthSensitiveTextareaAutosize(
  ref: MutableRefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useLayoutEffect(() => {
    const textarea = ref.current;
    const widthSource = textarea?.parentElement;
    if (!textarea || !widthSource) return;

    let frame = 0;
    let lastWidth = -1;
    const update = () => {
      const width = widthSource.getBoundingClientRect().width;
      if (width === lastWidth) return;
      lastWidth = width;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => resizeTextareaToContent(textarea));
    };
    const resizeForValue = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => resizeTextareaToContent(textarea));
    };

    resizeForValue();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(widthSource);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, [ref, value]);
}
