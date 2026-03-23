import React from "react";
import { useInteractiveComponent } from "@/remotion/hooks/useInteractiveComponent";
import { AnimatedElement } from "@/remotion/components/AnimatedElement";
import type { CursorFrame } from "@/remotion/hooks/useCursorHistory";
import type { AnimationTrack } from "@/types";

/**
 * InteractiveCard - A reusable card component that follows Video Studio best practices
 * for creating interactive elements.
 *
 * BEST PRACTICES DEMONSTRATED:
 * ✓ Uses useInteractiveComponent hook for hover/click detection
 * ✓ Registers with cursor system for UI panel integration
 * ✓ Uses AnimatedElement - automatically applies ALL animated properties
 * ✓ Safe fallbacks built-in - works without animations configured
 * ✓ Provides visual feedback for interaction states
 *
 * @example Basic Usage
 * ```tsx
 * <InteractiveCard
 *   id="feature-card"
 *   compositionId="my-comp"
 *   title="My Feature"
 *   description="Click to learn more"
 *   x={100}
 *   y={100}
 *   width={300}
 *   height={200}
 *   cursorHistory={context.cursorHistory}
 *   tracks={context.tracks}
 *   registerForCursor={context.registerForCursor}
 * />
 * ```
 *
 * @example With Custom Styling
 * ```tsx
 * <InteractiveCard
 *   id="custom-card"
 *   compositionId="my-comp"
 *   title="Custom Card"
 *   description="With custom colors"
 *   icon="🎨"
 *   backgroundColor="rgba(59, 130, 246, 0.1)"
 *   borderColor="#3b82f6"
 *   accentColor="#60a5fa"
 *   x={100}
 *   y={100}
 *   width={300}
 *   height={200}
 *   cursorHistory={context.cursorHistory}
 *   tracks={context.tracks}
 *   registerForCursor={context.registerForCursor}
 * />
 * ```
 */
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
  accentColor = "#6366f1",
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
  // STEP 1: Register as interactive component
  // This makes the card selectable and enables hover/click detection
  const interactive = useInteractiveComponent({
    compositionId,
    id,
    elementType: "Card",
    label: title,
    zone: { x, y, width, height },
    cursorHistory,
    tracks,
    interactiveElementType: "button", // or "link" depending on usage
  });

  // STEP 2: Register with cursor system
  // This makes the card appear in the Cursor Interactions panel
  React.useEffect(() => {
    registerForCursor(interactive);
  }, [interactive.hover.isHovering, interactive.click.isClicking]);

  // Extract glow for dynamic effects on child elements (icon, accent line)
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
      {/* Icon */}
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

      {/* Title */}
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

      {/* Description */}
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

      {/* Accent line */}
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

/**
 * USAGE CHECKLIST FOR ANY INTERACTIVE COMPONENT:
 *
 * ✓ Import useInteractiveComponent hook
 * ✓ Import AnimatedElement component
 * ✓ Import CursorFrame and AnimationTrack types
 * ✓ Accept compositionId, id, cursorHistory, tracks, registerForCursor props
 * ✓ Call useInteractiveComponent with proper zone definition
 * ✓ Register component in useEffect watching hover/click states
 * ✓ Wrap element with AnimatedElement - ALL properties applied automatically!
 * ✓ Add visual feedback for hover/click states (optional)
 *
 * CRITICAL: Use AnimatedElement instead of manual property extraction!
 * This ensures ALL properties added via UI work automatically without code changes.
 */
