/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PROJECTS SIDEBAR ORGANISM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A vertical navigation sidebar for the Projects tool.
 * Demonstrates Builder.io project navigation patterns.
 *
 * Features:
 * - Builder logo at top
 * - Navigation icons with dividers
 * - Settings/user icon at bottom
 * - Interactive hover states
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

export type ProjectsSidebarProps = {
  backgroundColor?: string;
  x?: number;
  y?: number;
  tracks?: AnimationTrack[];
};

const FALLBACK_TRACKS: AnimationTrack[] = (() => {
  const tracks = [
    createCameraTrack(150),
    createCursorTrack(150, { startX: 200, startY: 900 }),
  ];
  const cursor = tracks[1];

  cursor.animatedProps.find((p) => p.property === "x")!.keyframes = [
    { frame: 0, value: "200" },
    { frame: 15, value: "60" },
    { frame: 40, value: "60" },
    { frame: 60, value: "60" },
    { frame: 90, value: "60" },
    { frame: 120, value: "1720" },
    { frame: 150, value: "1720" },
  ];
  cursor.animatedProps.find((p) => p.property === "y")!.keyframes = [
    { frame: 0, value: "900" },
    { frame: 15, value: "100" },
    { frame: 40, value: "150" },
    { frame: 60, value: "200" },
    { frame: 90, value: "250" },
    { frame: 120, value: "250" },
    { frame: 150, value: "250" },
  ];
  cursor.animatedProps.find((p) => p.property === "isClicking")!.keyframes = [
    { frame: 0, value: "0" },
    { frame: 50, value: "0" },
    { frame: 51, value: "1" },
    { frame: 60, value: "0" },
    { frame: 150, value: "0" },
  ];
  cursor.animatedProps.find((p) => p.property === "opacity")!.keyframes = [
    { frame: 0, value: "0" },
    { frame: 10, value: "1" },
    { frame: 120, value: "1" },
    { frame: 135, value: "0" },
    { frame: 150, value: "0" },
  ];

  return tracks;
})();

export const ProjectsSidebar =
  createInteractiveComposition<ProjectsSidebarProps>({
    fallbackTracks: FALLBACK_TRACKS,

    render: ({ cursorHistory, registerForCursor }, props) => {
      const { backgroundColor = "#191919", x = 50, y = 0 } = props;
      const { height } = useVideoConfig();

      const sidebarWidth = 61;
      const paddingTop = 18;
      const paddingBottom = 18;

      // Interactive navigation icons
      const nav1 = useInteractiveComponent({
        id: "nav-icon-1",
        elementType: "IconButton",
        label: "Navigation 1 (Selected)",
        compositionId: "projects-sidebar",
        zone: {
          x: x + 13,
          y: y + paddingTop + 21 + 17 + 11,
          width: 35,
          height: 35,
        },
        cursorHistory,
        interactiveElementType: "button",
        hoverAnimation: brightnessHover(0.2),
      });

      const nav2 = useInteractiveComponent({
        id: "nav-icon-2",
        elementType: "IconButton",
        label: "Navigation 2",
        compositionId: "projects-sidebar",
        zone: {
          x: x + 18,
          y: y + paddingTop + 21 + 17 + 11 + 35 + 18,
          width: 24,
          height: 24,
        },
        cursorHistory,
        interactiveElementType: "button",
        hoverAnimation: brightnessHover(0.2),
      });

      registerForCursor(nav1);
      registerForCursor(nav2);

      return (
        <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
          <div
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: sidebarWidth,
              maxWidth: 61,
              backgroundColor,
              borderColor: "#434343",
              borderStyle: "solid",
              borderRightWidth: 1,
              paddingTop,
              paddingBottom,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              alignItems: "center",
              height: height,
            }}
          >
            {/* Builder Logo */}
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/170bd169186a73acbfe9e015c52732094e572ab1?placeholderIfAbsent=true"
              alt="Builder"
              style={{
                aspectRatio: 0.87,
                objectFit: "contain",
                objectPosition: "center",
                width: 21,
              }}
            />

            {/* Divider 1 */}
            <div
              style={{
                borderColor: "#434343",
                borderStyle: "solid",
                borderWidth: 1,
                alignSelf: "stretch",
                minHeight: 1,
                marginTop: 17,
                width: "100%",
              }}
            />

            {/* Selected Navigation Icon (larger, rounded) */}
            <AnimatedElement
              interactive={nav1}
              as="img"
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/4f7172a65e571640e01dab37893f7d0461aaa79b?placeholderIfAbsent=true"
              alt=""
              style={{
                aspectRatio: 1,
                objectFit: "contain",
                objectPosition: "center",
                width: 35,
                borderRadius: 6,
                marginTop: 11,
                cursor: "pointer",
              }}
            />

            {/* Navigation Icon 2 */}
            <AnimatedElement
              interactive={nav2}
              as="img"
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/2298477aaf5da309469b1cec3e62da695e0fd19b?placeholderIfAbsent=true"
              alt=""
              style={{
                aspectRatio: 1,
                objectFit: "contain",
                objectPosition: "center",
                width: 24,
                marginTop: 18,
                cursor: "pointer",
              }}
            />

            {/* Divider 2 */}
            <div
              style={{
                borderColor: "#434343",
                borderStyle: "solid",
                borderWidth: 1,
                alignSelf: "stretch",
                minHeight: 1,
                marginTop: 22,
                width: "100%",
              }}
            />

            {/* Icon 3 */}
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/465c0ef162c3c53a8dbeb6a60dd235c33b72f544?placeholderIfAbsent=true"
              alt=""
              style={{
                aspectRatio: 1,
                objectFit: "contain",
                objectPosition: "center",
                width: 24,
                marginTop: 19,
              }}
            />

            {/* Icon 4 */}
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/a5dbcfd1a066c7fe75332e1b626d146eba7eb014?placeholderIfAbsent=true"
              alt=""
              style={{
                aspectRatio: 1,
                objectFit: "contain",
                objectPosition: "center",
                width: 24,
                marginTop: 24,
              }}
            />

            {/* User/Settings Icon (at bottom) */}
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/ab3bc7e3dec1aba837b8e7648c116a83c6463785?placeholderIfAbsent=true"
              alt="User"
              style={{
                aspectRatio: 1,
                objectFit: "contain",
                objectPosition: "center",
                width: 24,
                marginTop: "auto",
              }}
            />
          </div>
        </AbsoluteFill>
      );
    },
  });
