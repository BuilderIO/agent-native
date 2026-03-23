/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SECTION HEADER ATOM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A section header with icon and uppercase text.
 * Used for consistent section labeling like "ALL CHANGES", "ALL FILES", etc.
 *
 * Features:
 * - Icon image support
 * - Uppercase text styling
 * - Consistent typography
 * - Optional chevron/dropdown indicator
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React from "react";
import { AbsoluteFill } from "remotion";
import { createInteractiveComposition } from "@/remotion/hooks/createInteractiveComposition";
import { createCameraTrack, createCursorTrack } from "@/remotion/trackHelpers";
import type { AnimationTrack } from "@/types";

export type SectionHeaderProps = {
  icon?: string;
  iconWidth?: number;
  label?: string;
  chevron?: string;
  chevronWidth?: number;
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

  cursor.animatedProps.find((p) => p.property === "opacity")!.keyframes = [
    { frame: 0, value: "0" },
    { frame: 150, value: "0" },
  ];

  return tracks;
})();

export const SectionHeader = createInteractiveComposition<SectionHeaderProps>({
  fallbackTracks: FALLBACK_TRACKS,

  render: ({ cursorHistory, registerForCursor }, props) => {
    const {
      icon = "https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/f872b16106ef6bbaea80fcefece2392325659d2c?placeholderIfAbsent=true",
      iconWidth = 14,
      label = "ALL CHANGES",
      chevron,
      chevronWidth = 12,
      x = 760,
      y = 528,
    } = props;

    return (
      <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
        <div
          style={{
            position: "absolute",
            left: x,
            top: y,
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontSize: 11,
            fontWeight: 600,
            color: "#a4a4a4",
            letterSpacing: 0.5,
            textTransform: "uppercase",
          }}
        >
          <img
            src={icon}
            alt=""
            style={{
              aspectRatio: 1,
              objectFit: "contain",
              objectPosition: "center",
              width: iconWidth,
            }}
          />
          <span>{label}</span>
          {chevron && (
            <img
              src={chevron}
              alt=""
              style={{
                aspectRatio: 1,
                objectFit: "contain",
                objectPosition: "center",
                width: chevronWidth,
              }}
            />
          )}
        </div>
      </AbsoluteFill>
    );
  },
});
