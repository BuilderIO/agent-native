import { useEffect, useState } from "react";

export interface LiveDragPosition {
  left: string;
  top: string;
}

export function useLiveDragPosition(
  selector: string | undefined,
): LiveDragPosition | null {
  const [live, setLive] = useState<LiveDragPosition | null>(null);

  useEffect(() => {
    setLive(null);
    if (!selector) return;
    const nodeId = /^\[data-agent-native-node-id="([^"]+)"\]$/.exec(
      selector,
    )?.[1];
    let frame = 0;
    let pending: LiveDragPosition | null = null;
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type !== "agent-native:live-drag-position") return;
      const matches =
        data.selector === selector ||
        (nodeId !== undefined && data.sourceId === nodeId);
      if (!matches) return;
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
