/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BUTTON COMPONENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * An interactive button component with text.
 * Demonstrates hover and click animations controlled by the UI.
 *
 * Features:
 * - Configurable label and colors
 * - Default hover animation (scale + brightness)
 * - Default click animation (scale down + brightness)
 * - Animations stored in animation system (UI-controlled)
 *
 * Usage:
 *   import { Button } from "@/remotion/library-components";
 *
 *   <Button
 *     label="Click Me"
 *     backgroundColor="#3b82f6"
 *     textColor="#ffffff"
 *   />
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { createInteractiveComposition } from "@/remotion/hooks/createInteractiveComposition";
import { useInteractiveComponent } from "@/remotion/hooks/useInteractiveComponent";
import { AnimatedElement } from "@/remotion/components/AnimatedElement";
import { createCameraTrack, createCursorTrack } from "@/remotion/trackHelpers";
import type { AnimationTrack } from "@/types";

export type ButtonProps = {
  label?: string;
  backgroundColor?: string;
  textColor?: string;
  tracks?: AnimationTrack[];
};

// Fallback tracks using helpers — CRITICAL: cursor type must be "default"
const FALLBACK_TRACKS: AnimationTrack[] = (() => {
  const tracks = [
    createCameraTrack(150),
    createCursorTrack(150, { startX: 200, startY: 200 }),
  ];
  const cursor = tracks[1];

  const cx = String(1920 / 2 - 16);
  const cy = String(1080 / 2 - 16);

  cursor.animatedProps.find((p) => p.property === "x")!.keyframes = [
    { frame: 0, value: "200" },
    { frame: 15, value: cx }, // Arrive at 0.5s
    { frame: 90, value: cx }, // Stay until 3s
    { frame: 120, value: "1720" },
    { frame: 150, value: "1720" },
  ];
  cursor.animatedProps.find((p) => p.property === "y")!.keyframes = [
    { frame: 0, value: "200" },
    { frame: 15, value: cy },
    { frame: 90, value: cy },
    { frame: 120, value: "200" },
    { frame: 150, value: "200" },
  ];
  cursor.animatedProps.find((p) => p.property === "isClicking")!.keyframes = [
    { frame: 0, value: "0" },
    { frame: 59, value: "0" },
    { frame: 60, value: "1" }, // Click at 2s
    { frame: 70, value: "0" },
    { frame: 150, value: "0" },
  ];
  cursor.animatedProps.find((p) => p.property === "opacity")!.keyframes = [
    { frame: 0, value: "0" },
    { frame: 5, value: "0" },
    { frame: 15, value: "1" }, // Fade in with arrival
    { frame: 90, value: "1" },
    { frame: 100, value: "0" }, // Fade out with exit
    { frame: 150, value: "0" },
  ];
  // Note: cursor type stays as "default" (set by createCursorTrack)
  // autoCursorType auto-switches to "pointer" while hovering

  return tracks;
})();

export const Button = createInteractiveComposition<ButtonProps>({
  fallbackTracks: FALLBACK_TRACKS,

  render: ({ cursorHistory, registerForCursor }, props) => {
    const {
      label = "Click Me",
      backgroundColor = "#3b82f6",
      textColor = "#ffffff",
    } = props;

    const frame = useCurrentFrame();
    const { width, height } = useVideoConfig();

    // Button dimensions and position (centered)
    const buttonWidth = 200;
    const buttonHeight = 60;
    const buttonX = (width - buttonWidth) / 2;
    const buttonY = (height - buttonHeight) / 2;

    // Interactive button component
    const button = useInteractiveComponent({
      id: "button",
      elementType: "Button",
      label: "Button",
      compositionId: "button",
      zone: {
        x: buttonX,
        y: buttonY,
        width: buttonWidth,
        height: buttonHeight,
      },
      cursorHistory,
      interactiveElementType: "button",
      // Default hover animation: subtle scale + brightness
      hoverAnimation: {
        duration: 6,
        easing: "expo.out",
        properties: [
          { property: "scale", from: 1, to: 1.05, unit: "" },
          { property: "brightness", from: 1, to: 1.1, unit: "" },
        ],
      },
      // Default click animation: scale down + brightness boost
      clickAnimation: {
        duration: 12,
        easing: "back.out",
        properties: [
          { property: "scale", from: 1, to: 0.95, unit: "" },
          { property: "brightness", from: 1, to: 1.3, unit: "" },
        ],
      },
    });

    // Register for cursor aggregation
    React.useEffect(() => {
      registerForCursor(button);
    }, [button.hover.isHovering, button.click.isClicking, registerForCursor]);

    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#0f172a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* State Indicators - Top Right Corner */}
        <div
          style={{
            position: "absolute",
            top: 20,
            right: 20,
            display: "flex",
            gap: 12,
            fontFamily: "Inter, sans-serif",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {/* Hover State Indicator */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              borderRadius: 8,
              backgroundColor: button.hover.isHovering
                ? "rgba(34, 197, 94, 0.2)"
                : "rgba(71, 85, 105, 0.2)",
              border: `2px solid ${
                button.hover.isHovering ? "#22c55e" : "#475569"
              }`,
              color: button.hover.isHovering ? "#22c55e" : "#94a3b8",
              transition: "all 0.2s ease",
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: button.hover.isHovering
                  ? "#22c55e"
                  : "#475569",
              }}
            />
            HOVER
          </div>

          {/* Click State Indicator */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              borderRadius: 8,
              backgroundColor: button.click.isClicking
                ? "rgba(239, 68, 68, 0.2)"
                : "rgba(71, 85, 105, 0.2)",
              border: `2px solid ${
                button.click.isClicking ? "#ef4444" : "#475569"
              }`,
              color: button.click.isClicking ? "#ef4444" : "#94a3b8",
              transition: "all 0.2s ease",
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: button.click.isClicking
                  ? "#ef4444"
                  : "#475569",
              }}
            />
            CLICK
          </div>
        </div>

        {/* Interactive Button */}
        <AnimatedElement
          interactive={button}
          as="button"
          style={{
            position: "absolute",
            left: buttonX,
            top: buttonY,
            width: buttonWidth,
            height: buttonHeight,
            backgroundColor,
            color: textColor,
            border: "none",
            borderRadius: 12,
            fontSize: 18,
            fontWeight: 600,
            fontFamily: "Inter, sans-serif",
            cursor: "pointer",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.3)",
          }}
        >
          {label}
        </AnimatedElement>

        {/* Debug Info - Bottom Left */}
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: 20,
            fontFamily: "monospace",
            fontSize: 12,
            color: "#64748b",
            backgroundColor: "rgba(15, 23, 42, 0.8)",
            padding: 12,
            borderRadius: 8,
            border: "1px solid #334155",
          }}
        >
          <div>Frame: {frame}</div>
          <div>Hover Progress: {button.hover.progress.toFixed(3)}</div>
          <div>Click Progress: {button.click.progress.toFixed(3)}</div>
        </div>
      </AbsoluteFill>
    );
  },
});
