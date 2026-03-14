/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FOLDER ITEM ATOM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A collapsible folder item with chevron icon.
 * Demonstrates hover brightness and expand/collapse animation.
 *
 * Features:
 * - Chevron icon (rotates when expanded)
 * - Folder icon
 * - Folder name
 * - Hover brightness effect
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";
import { AbsoluteFill } from "remotion";
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

export type FolderItemProps = {
  name?: string;
  isExpanded?: boolean;
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

  cursor.animatedProps.find(p => p.property === "x")!.keyframes = [
    { frame: 0, value: "200" },
    { frame: 15, value: "890" },
    { frame: 90, value: "890" },
    { frame: 120, value: "1720" },
    { frame: 150, value: "1720" },
  ];
  cursor.animatedProps.find(p => p.property === "y")!.keyframes = [
    { frame: 0, value: "200" },
    { frame: 15, value: "540" },
    { frame: 90, value: "540" },
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

export const FolderItem = createInteractiveComposition<FolderItemProps>({
  fallbackTracks: FALLBACK_TRACKS,

  render: ({ cursorHistory, registerForCursor }, props) => {
    const {
      name = "client",
      isExpanded = true,
      x = 760,
      y = 528,
    } = props;

    const itemWidth = 260;
    const itemHeight = 24;

    const folder = useInteractiveComponent({
      id: "folder-item",
      elementType: "FolderItem",
      label: name,
      compositionId: "folder-item",
      zone: { x, y, width: itemWidth, height: itemHeight },
      cursorHistory,
      interactiveElementType: "card",
      hoverAnimation: brightnessHover(0.12),
    });

    registerForCursor(folder);

    const fontSize = 13;
    const iconSize = 14;
    const gap = 6;

    return (
      <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
        <AnimatedElement
          interactive={folder}
          as="div"
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: itemWidth,
            height: itemHeight,
            display: "flex",
            alignItems: isExpanded ? "end" : "center",
            gap: isExpanded ? "5px" : "4px",
            cursor: "pointer",
          }}
        >
          {/* Chevron Icon */}
          {isExpanded ? (
            <div style={{ display: "flex", paddingLeft: 5, paddingRight: 5, paddingTop: 4, paddingBottom: 4, alignItems: "center", overflow: "hidden", width: 14 }}>
              <img
                src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/2f7e835c418bdf085373048598835166dfbceb0c?placeholderIfAbsent=true"
                alt=""
                style={{
                  aspectRatio: 0.57,
                  objectFit: "contain",
                  objectPosition: "center",
                  width: 4,
                  flexShrink: 0,
                }}
              />
            </div>
          ) : (
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/13dadd4473c8a647901e721f8b909948c3fb26f9?placeholderIfAbsent=true"
              alt=""
              style={{
                aspectRatio: 1,
                objectFit: "contain",
                objectPosition: "center",
                width: 14,
                flexShrink: 0,
              }}
            />
          )}

          {/* Folder Icon + Name Container */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: `${gap}px`,
            }}
          >
            {/* Folder Icon */}
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/0eff81acf5a556bcdb7fe959d106beee500c5274?placeholderIfAbsent=true"
              alt=""
              style={{
                aspectRatio: 1,
                objectFit: "contain",
                objectPosition: "center",
                width: 16,
                flexShrink: 0,
              }}
            />

            {/* Folder Name */}
            <div
              style={{
                fontSize,
                color: "#a4a4a4",
                whiteSpace: "nowrap",
              }}
            >
              {name}
            </div>
          </div>
        </AnimatedElement>
      </AbsoluteFill>
    );
  },
});
