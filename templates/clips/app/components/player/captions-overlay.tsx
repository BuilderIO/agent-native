import { useEffect, useRef, useState } from "react";
import { agentNativePath } from "@agent-native/core/client";

export interface CaptionsOverlayProps {
  text: string;
  /** Optional storage key — defaults to a shared one so position persists across clips. */
  storageKey?: string;
}

/**
 * Draggable captions box at the bottom of the video.
 * Position persists to application_state so the agent can see it.
 */
export function CaptionsOverlay({
  text,
  storageKey = "caption-position",
}: CaptionsOverlayProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ xPct: number; yPct: number }>({
    xPct: 50,
    yPct: 88,
  });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{
    x: number;
    y: number;
    xPct: number;
    yPct: number;
  } | null>(null);

  // Load persisted position from application_state (best-effort).
  useEffect(() => {
    fetch(
      agentNativePath(
        `/_agent-native/application-state/${encodeURIComponent(storageKey)}`,
      ),
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (
          data &&
          typeof data.xPct === "number" &&
          typeof data.yPct === "number"
        ) {
          setPos({ xPct: data.xPct, yPct: data.yPct });
        }
      })
      .catch(() => {});
  }, [storageKey]);

  function onMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      xPct: pos.xPct,
      yPct: pos.yPct,
    };

    const el = ref.current?.parentElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    const onMove = (ev: MouseEvent) => {
      if (!dragStart.current) return;
      const dxPct = ((ev.clientX - dragStart.current.x) / rect.width) * 100;
      const dyPct = ((ev.clientY - dragStart.current.y) / rect.height) * 100;
      setPos({
        xPct: Math.max(5, Math.min(95, dragStart.current.xPct + dxPct)),
        yPct: Math.max(5, Math.min(95, dragStart.current.yPct + dyPct)),
      });
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Persist
      fetch(
        agentNativePath(
          `/_agent-native/application-state/${encodeURIComponent(storageKey)}`,
        ),
        {
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pos),
        },
      ).catch(() => {});
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  if (!text) return null;

  return (
    <div
      ref={ref}
      data-player-ui
      className="absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-move select-none"
      style={{
        left: pos.xPct + "%",
        top: pos.yPct + "%",
      }}
      onMouseDown={onMouseDown}
    >
      <div
        className="rounded-md bg-black/80 text-white px-4 py-1.5 text-[15px] leading-snug font-medium max-w-[70vw] text-center"
        style={{
          outline: dragging ? "2px solid hsl(var(--primary))" : undefined,
        }}
      >
        {text}
      </div>
    </div>
  );
}
