import React from "react";
import { useInteractiveComponent } from "@/remotion/hooks/useInteractiveComponent";
import { AnimatedElement } from "@/remotion/components/AnimatedElement";
import type { CursorFrame } from "@/remotion/hooks/useCursorHistory";
import type { AnimationTrack } from "@/types";

/**
 * InteractiveButton - A reusable button component that demonstrates best practices
 * for creating interactive elements in Video Studio.
 *
 * KEY PRINCIPLES:
 * 1. Always use useInteractiveComponent hook - makes it selectable
 * 2. Define precise zones - accurate hover/click detection
 * 3. Register with cursor system - shows in Cursor Interactions panel
 * 4. Use AnimatedElement - automatically applies ALL animated properties
 * 5. Safe fallbacks built-in - works without animations configured
 *
 * CRITICAL: Use AnimatedElement instead of manual property extraction!
 * This ensures ALL properties added via UI (backgroundColor, scale, blur, etc.) work automatically.
 *
 * @example
 * ```tsx
 * <InteractiveButton
 *   id="my-button"
 *   compositionId="my-comp"
 *   label="Click Me"
 *   x={100}
 *   y={100}
 *   width={200}
 *   height={60}
 *   cursorHistory={context.cursorHistory}
 *   tracks={context.tracks}
 *   registerForCursor={context.registerForCursor}
 * />
 * ```
 */
export function InteractiveButton({
  id,
  compositionId,
  label,
  x,
  y,
  width,
  height,
  backgroundColor = "#6366f1",
  textColor = "#ffffff",
  cursorHistory,
  tracks,
  registerForCursor,
  onClick,
}: {
  id: string;
  compositionId: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor?: string;
  textColor?: string;
  cursorHistory: CursorFrame[];
  tracks: AnimationTrack[];
  registerForCursor: (component: any) => void;
  onClick?: () => void;
}) {
  // Register as interactive component - THIS IS REQUIRED for all interactive elements
  const interactive = useInteractiveComponent({
    compositionId,
    id,
    elementType: "Button",
    label,
    zone: { x, y, width, height },
    cursorHistory,
    tracks,
    interactiveElementType: "button",
  });

  // Register with cursor system so it shows in Cursor Interactions panel
  React.useEffect(() => {
    registerForCursor(interactive);
  }, [interactive.hover.isHovering, interactive.click.isClicking]);

  // Handle click events
  React.useEffect(() => {
    if (interactive.click.isClicking && onClick) {
      onClick();
    }
  }, [interactive.click.isClicking, onClick]);

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
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor,
        borderRadius: 12,
        fontFamily: "Inter, sans-serif",
        fontSize: 16,
        fontWeight: 600,
        color: textColor,
        cursor: interactive.hover.isHovering ? "pointer" : "default",
      }}
    >
      {label}
    </AnimatedElement>
  );
}
