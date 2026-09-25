import { useEffect, useState } from "react";

export interface LiveDragPosition {
  left: string;
  top: string;
}

/** The dragged element's left/top while a canvas move is still in flight. */
export function useLiveDragPosition(
  selector: string | undefined,
): LiveDragPosition | null {
  const [live, setLive] = useState<LiveDragPosition | null>(null);

  useEffect(() => {
    setLive(null);
    if (!selector) return;
    let frame = 0;
    let pending: LiveDragPosition | null = null;
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (
        data?.type !== "agent-native:live-drag-position" ||
        data.selector !== selector
      ) {
        return;
      }
      pending =
        data.active === true &&
        typeof data.left === "string" &&
        typeof data.top === "string"
          ? { left: data.left, top: data.top }
          : null;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setLive(pending);
      });
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [selector]);

  return live;
}
