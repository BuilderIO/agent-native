/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SECONDARY BUTTON ATOM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A secondary/outline button with optional icon.
 * Demonstrates hover brightness animation.
 *
 * Features:
 * - Optional icon
 * - Outline style with border
 * - Hover brightness effect
 * - Click animation
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { createInteractiveComposition } from "@/remotion/hooks/createInteractiveComposition";
import { useInteractiveComponent } from "@/remotion/hooks/useInteractiveComponent";
import { AnimatedElement } from "@/remotion/components/AnimatedElement";
import { createCameraTrack, createCursorTrack } from "@/remotion/trackHelpers";
import type { AnimationTrack, AnimationShorthand } from "@/types";

// Custom brightness hover animation
const brightnessHover = (amount: number): AnimationShorthand => ({
  duration: 6,
  easing: "expo.out",
  properties: [{ property: "brightness", from: 1, to: 1 + amount, unit: "" }],
});

export type SecondaryButtonProps = {
  label?: string;
  icon?: string;
  x?: number;
  y?: number;
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  tracks?: AnimationTrack[];
};

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
    { frame: 15, value: cx },
    { frame: 90, value: cx },
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
    { frame: 60, value: "1" },
    { frame: 70, value: "0" },
    { frame: 150, value: "0" },
  ];
  cursor.animatedProps.find((p) => p.property === "opacity")!.keyframes = [
    { frame: 0, value: "0" },
    { frame: 5, value: "0" },
    { frame: 15, value: "1" },
    { frame: 90, value: "1" },
    { frame: 100, value: "0" },
    { frame: 150, value: "0" },
  ];

  return tracks;
})();

export const SecondaryButton =
  createInteractiveComposition<SecondaryButtonProps>({
    fallbackTracks: FALLBACK_TRACKS,

    render: ({ cursorHistory, registerForCursor }, props) => {
      const {
        label = "Share",
        icon = "🔗",
        x = 860,
        y = 524,
        backgroundColor = "#2a2a2a",
        borderColor = "#393939",
        textColor = "#ffffff",
      } = props;
      const { width, height } = useVideoConfig();

      const buttonWidth = 90;
      const buttonHeight = 32;
      const buttonX = typeof x === "number" ? x : (width - buttonWidth) / 2;
      const buttonY = typeof y === "number" ? y : (height - buttonHeight) / 2;

      const button = useInteractiveComponent({
        id: "secondary-button",
        elementType: "Button",
        label,
        compositionId: "secondary-button",
        zone: {
          x: buttonX,
          y: buttonY,
          width: buttonWidth,
          height: buttonHeight,
        },
        cursorHistory,
        interactiveElementType: "button",
        hoverAnimation: brightnessHover(0.2),
      });

      registerForCursor(button);

      const fontSize = 11;
      const paddingX = 11;
      const paddingY = 5;

      return (
        <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
          <AnimatedElement
            interactive={button}
            as="div"
            style={{
              position: "absolute",
              left: buttonX,
              top: buttonY,
              width: buttonWidth,
              height: buttonHeight,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: icon ? "4px" : "0",
              paddingLeft: paddingX,
              paddingRight: paddingX,
              paddingTop: paddingY,
              paddingBottom: paddingY,
              backgroundColor,
              border: `1px solid ${borderColor}`,
              borderRadius: 6,
              color: textColor,
              fontSize,
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {icon && (
              <span style={{ fontSize: 16, lineHeight: "16px" }}>{icon}</span>
            )}
            <span>{label}</span>
          </AnimatedElement>
        </AbsoluteFill>
      );
    },
  });
