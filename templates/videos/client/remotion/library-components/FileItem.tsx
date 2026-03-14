/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FILE ITEM ATOM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A file list item with icon, name, and optional metadata.
 * Demonstrates hover brightness animation.
 *
 * Features:
 * - File icon support
 * - Optional line count badge
 * - Optional file path
 * - Hover brightness effect
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

export type FileItemProps = {
  icon?: string;
  name?: string;
  lineCount?: string;
  path?: string;
  x?: number;
  y?: number;
  tracks?: AnimationTrack[];
};

const FALLBACK_TRACKS: AnimationTrack[] = (() => {
  const tracks = [
    createCameraTrack(150),
    createCursorTrack(150, { startX: 200, startY: 200 }),
  ];
  const cursor = tracks[1];

  cursor.animatedProps.find((p) => p.property === "x")!.keyframes = [
    { frame: 0, value: "200" },
    { frame: 15, value: "890" },
    { frame: 90, value: "890" },
    { frame: 120, value: "1720" },
    { frame: 150, value: "1720" },
  ];
  cursor.animatedProps.find((p) => p.property === "y")!.keyframes = [
    { frame: 0, value: "200" },
    { frame: 15, value: "540" },
    { frame: 90, value: "540" },
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

export const FileItem = createInteractiveComposition<FileItemProps>({
  fallbackTracks: FALLBACK_TRACKS,

  render: ({ cursorHistory, registerForCursor }, props) => {
    const {
      icon = "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/10ff8b681a169f3c2b0c90b4fd672a0e7173771b?placeholderIfAbsent=true",
      name = "KineticText.tsx",
      lineCount = "+ 42",
      path = "client/remotion/compositions",
      x = 760,
      y = 528,
    } = props;

    const itemWidth = 260;
    const itemHeight = 24;

    const item = useInteractiveComponent({
      id: "file-item",
      elementType: "FileItem",
      label: name,
      compositionId: "file-item",
      zone: { x, y, width: itemWidth, height: itemHeight },
      cursorHistory,
      interactiveElementType: "card",
      hoverAnimation: brightnessHover(0.15),
    });

    registerForCursor(item);

    const fontSize = 13;
    const iconSize = 16;
    const gap = 7;

    return (
      <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
        <AnimatedElement
          interactive={item}
          as="div"
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: itemWidth,
            height: itemHeight,
            display: "flex",
            alignItems: "center",
            gap: `${gap}px`,
            cursor: "pointer",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          {/* File Icon */}
          <img
            src={icon}
            alt=""
            style={{
              aspectRatio: 1,
              objectFit: "contain",
              objectPosition: "center",
              width: iconSize,
              flexShrink: 0,
            }}
          />

          {/* File Name */}
          <div
            style={{
              fontSize,
              color: "#a4a4a4",
              flexShrink: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {name}
          </div>

          {/* Line Count Badge */}
          {lineCount && (
            <div
              style={{
                fontSize: 11,
                color: "#4ade80",
                marginLeft: "auto",
                flexShrink: 0,
              }}
            >
              {lineCount}
            </div>
          )}

          {/* File Path */}
          {path && (
            <div
              style={{
                fontSize: 11,
                color: "#8a8a8a",
                flexShrink: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {path}
            </div>
          )}
        </AnimatedElement>
      </AbsoluteFill>
    );
  },
});
