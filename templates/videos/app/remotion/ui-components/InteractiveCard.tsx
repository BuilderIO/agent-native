import React from "react";

import { AnimatedElement } from "@/remotion/components/AnimatedElement";
import type { CursorFrame } from "@/remotion/hooks/useCursorHistory";
import { useInteractiveComponent } from "@/remotion/hooks/useInteractiveComponent";
import type { AnimationTrack } from "@/types";

export function InteractiveCard({
  id,
  compositionId,
  title,
  description,
  icon,
  x,
  y,
  width,
  height,
  backgroundColor = "rgba(17, 24, 39, 0.7)",
  borderColor = "#374151",
  accentColor = "#00B5FF",
  cursorHistory,
  tracks,
  registerForCursor,
}: {
  id: string;
  compositionId: string;
  title: string;
  description?: string;
  icon?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor?: string;
  borderColor?: string;
  accentColor?: string;
  cursorHistory: CursorFrame[];
  tracks: AnimationTrack[];
  registerForCursor: (component: any) => void;
}) {
  const interactive = useInteractiveComponent({
    compositionId,
    id,
    elementType: "Card",
    label: title,
    zone: { x, y, width, height },
    cursorHistory,
    tracks,
    interactiveElementType: "button",
  });

  React.useEffect(() => {
    registerForCursor(interactive);
  }, [interactive.hover.isHovering, interactive.click.isClicking]);

  const glow = (interactive.animatedProperties?.glow as number) ?? 0;

  return (
    <AnimatedElement
      interactive={interactive}
      as="div"
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        borderRadius: 16,
        borderWidth: "2px",
        borderStyle: "solid",
        borderColor: borderColor,
        backdropFilter: "blur(10px)",
        padding: 24,
        fontFamily: "Inter, sans-serif",
        backgroundColor,
        cursor: interactive.hover.isHovering ? "pointer" : "default",
      }}
    >
      {icon && (
        <div
          style={{
            fontSize: 48,
            marginBottom: 16,
            filter: `drop-shadow(0 0 ${Math.max(10, glow / 2)}px ${accentColor})`,
          }}
        >
          {icon}
        </div>
      )}

      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: "#f1f5f9",
          marginBottom: 8,
        }}
      >
        {title}
      </div>

      {description && (
        <div
          style={{
            fontSize: 14,
            color: "#94a3b8",
            lineHeight: 1.6,
          }}
        >
          {description}
        </div>
      )}

      <div
        style={{
          marginTop: 16,
          height: 3,
          background: `linear-gradient(90deg, ${accentColor} 0%, transparent 100%)`,
          borderRadius: 2,
          opacity: 0.6 + (interactive.hover.isHovering ? 0.4 : 0),
          transition: "opacity 0.3s ease",
        }}
      />
    </AnimatedElement>
  );
}
