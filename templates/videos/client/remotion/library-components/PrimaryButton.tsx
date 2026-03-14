/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PRIMARY BUTTON ATOM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A primary action button with solid background and optional icon.
 * Used for main CTAs like "Send PR" or "Push to Remote".
 *
 * Features:
 * - Solid background color
 * - Optional icon (image URL)
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
  properties: [
    { property: "brightness", from: 1, to: 1 + amount, unit: "" },
  ],
});

export type PrimaryButtonProps = {
  label?: string;
  icon?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  backgroundColor?: string;
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

  cursor.animatedProps.find(p => p.property === "x")!.keyframes = [
    { frame: 0, value: "200" },
    { frame: 15, value: cx },
    { frame: 90, value: cx },
    { frame: 120, value: "1720" },
    { frame: 150, value: "1720" },
  ];
  cursor.animatedProps.find(p => p.property === "y")!.keyframes = [
    { frame: 0, value: "200" },
    { frame: 15, value: cy },
    { frame: 90, value: cy },
    { frame: 120, value: "200" },
    { frame: 150, value: "200" },
  ];
  cursor.animatedProps.find(p => p.property === "isClicking")!.keyframes = [
    { frame: 0, value: "0" },
    { frame: 59, value: "0" },
    { frame: 60, value: "1" },
    { frame: 70, value: "0" },
    { frame: 150, value: "0" },
  ];
  cursor.animatedProps.find(p => p.property === "opacity")!.keyframes = [
    { frame: 0, value: "0" },
    { frame: 5, value: "0" },
    { frame: 15, value: "1" },
    { frame: 90, value: "1" },
    { frame: 100, value: "0" },
    { frame: 150, value: "0" },
  ];

  return tracks;
})();

export const PrimaryButton = createInteractiveComposition<PrimaryButtonProps>({
  fallbackTracks: FALLBACK_TRACKS,

  render: ({ cursorHistory, registerForCursor }, props) => {
    const {
      label = "Send PR",
      icon = "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/81e7eb620e52aae529258200f6dff2cc38027cd8?placeholderIfAbsent=true",
      x = 860,
      y = 524,
      width = 82,
      height = 32,
      backgroundColor = "#48a1ff",
      textColor = "#000000",
    } = props;
    const { width: videoWidth, height: videoHeight } = useVideoConfig();

    const buttonWidth = width;
    const buttonHeight = height;
    const buttonX = typeof x === "number" ? x : (videoWidth - buttonWidth) / 2;
    const buttonY = typeof y === "number" ? y : (videoHeight - buttonHeight) / 2;

    const button = useInteractiveComponent({
      id: "primary-button",
      elementType: "Button",
      label,
      compositionId: "primary-button",
      zone: { x: buttonX, y: buttonY, width: buttonWidth, height: buttonHeight },
      cursorHistory,
      interactiveElementType: "button",
      hoverAnimation: brightnessHover(0.3),
    });

    registerForCursor(button);

    const fontSize = 11;
    const paddingX = 7;
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
            justifyContent: "start",
            gap: icon ? "4px" : "0",
            paddingLeft: paddingX,
            paddingRight: paddingX,
            paddingTop: paddingY,
            paddingBottom: paddingY,
            backgroundColor,
            borderRadius: 6,
            color: textColor,
            fontSize,
            fontWeight: 500,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {icon && (
            <img
              src={icon}
              alt=""
              style={{
                aspectRatio: 1,
                objectFit: "contain",
                objectPosition: "center",
                width: 16,
              }}
            />
          )}
          <span>{label}</span>
        </AnimatedElement>
      </AbsoluteFill>
    );
  },
});
