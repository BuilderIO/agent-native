/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STANDARD SIDEBAR ORGANISM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A vertical navigation sidebar showing top-level application routes.
 * Demonstrates Builder.io navigation patterns for /projects, /content, /assets, etc.
 *
 * Features:
 * - Builder logo at top
 * - Navigation icons with consistent spacing
 * - Horizontal divider
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

export type StandardSidebarProps = {
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
    { frame: 40, value: "200" },
    { frame: 60, value: "300" },
    { frame: 90, value: "400" },
    { frame: 120, value: "400" },
    { frame: 150, value: "400" },
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

export const StandardSidebar =
  createInteractiveComposition<StandardSidebarProps>({
    fallbackTracks: FALLBACK_TRACKS,

    render: ({ cursorHistory, registerForCursor }, props) => {
      const { backgroundColor = "#191919", x = 50, y = 0 } = props;
      const { height } = useVideoConfig();

      const sidebarWidth = 61;
      const paddingTop = 18;
      const paddingBottom = 18;

      // Interactive navigation icons
      const projectsIcon = useInteractiveComponent({
        id: "nav-projects",
        elementType: "IconButton",
        label: "Projects",
        compositionId: "standard-sidebar",
        zone: {
          x: x + 18,
          y: y + paddingTop + 21 + 17 + 16,
          width: 24,
          height: 24,
        },
        cursorHistory,
        interactiveElementType: "button",
        hoverAnimation: brightnessHover(0.2),
      });

      const contentIcon = useInteractiveComponent({
        id: "nav-content",
        elementType: "IconButton",
        label: "Content",
        compositionId: "standard-sidebar",
        zone: {
          x: x + 18,
          y: y + paddingTop + 21 + 17 + 16 + 24 + 11,
          width: 24,
          height: 24,
        },
        cursorHistory,
        interactiveElementType: "button",
        hoverAnimation: brightnessHover(0.2),
      });

      const assetsIcon = useInteractiveComponent({
        id: "nav-assets",
        elementType: "IconButton",
        label: "Assets",
        compositionId: "standard-sidebar",
        zone: {
          x: x + 18,
          y: y + paddingTop + 21 + 17 + 16 + 24 + 11 + 24 + 19,
          width: 24,
          height: 24,
        },
        cursorHistory,
        interactiveElementType: "button",
        hoverAnimation: brightnessHover(0.2),
      });

      registerForCursor(projectsIcon);
      registerForCursor(contentIcon);
      registerForCursor(assetsIcon);

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
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/966f87fd9ce8ed77d54c82370920ca1442022a1b?placeholderIfAbsent=true"
              alt="Builder"
              style={{
                aspectRatio: 0.87,
                objectFit: "contain",
                objectPosition: "center",
                width: 21,
              }}
            />

            {/* Divider */}
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

            {/* Projects Icon */}
            <AnimatedElement
              interactive={projectsIcon}
              as="img"
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/42fc1b7f6063134a23dfe7b036d5d0e24e63c032?placeholderIfAbsent=true"
              alt="Projects"
              style={{
                aspectRatio: 1.04,
                objectFit: "contain",
                objectPosition: "center",
                width: 24,
                marginTop: 16,
                cursor: "pointer",
              }}
            />

            {/* Full Width Icon */}
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/e36ac2614b296ed36bdf254bd107955b67f9edd2?placeholderIfAbsent=true"
              alt=""
              style={{
                aspectRatio: 1.42,
                objectFit: "contain",
                objectPosition: "center",
                width: "100%",
                alignSelf: "stretch",
                marginTop: 10,
              }}
            />

            {/* Content Icon */}
            <AnimatedElement
              interactive={contentIcon}
              as="img"
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/2c4b3903a0a1191b0bf7c4542f996b8e862eee8d?placeholderIfAbsent=true"
              alt="Content"
              style={{
                aspectRatio: 1,
                objectFit: "contain",
                objectPosition: "center",
                width: 24,
                marginTop: 11,
                cursor: "pointer",
              }}
            />

            {/* Assets Icon */}
            <AnimatedElement
              interactive={assetsIcon}
              as="img"
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/3e300d3891e92e9b4f2d7313ec72728cdf837742?placeholderIfAbsent=true"
              alt="Assets"
              style={{
                aspectRatio: 1,
                objectFit: "contain",
                objectPosition: "center",
                width: 24,
                marginTop: 19,
                cursor: "pointer",
              }}
            />

            {/* Additional Navigation Icons */}
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/91cb84fd7d3618b896ce78632d230016ca2b821d?placeholderIfAbsent=true"
              alt=""
              style={{
                aspectRatio: 1,
                objectFit: "contain",
                objectPosition: "center",
                width: 24,
                marginTop: 20,
              }}
            />

            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/40ff2803a56a757f6e98235cabbcd6b002eb9364?placeholderIfAbsent=true"
              alt=""
              style={{
                aspectRatio: 1.04,
                objectFit: "contain",
                objectPosition: "center",
                width: 24,
                marginTop: 20,
              }}
            />

            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/e1947f95173604c83cd2469c3cb7999255c70e5c?placeholderIfAbsent=true"
              alt=""
              style={{
                aspectRatio: 1,
                objectFit: "contain",
                objectPosition: "center",
                width: 24,
                marginTop: 19,
              }}
            />

            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/ee47b45dccc99e1b3ebca60dd313ef0ab9f1f1e4?placeholderIfAbsent=true"
              alt=""
              style={{
                aspectRatio: 1,
                objectFit: "contain",
                objectPosition: "center",
                width: 24,
                marginTop: 20,
              }}
            />

            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/76d18c16af1b61f3b40a7b9de216cef5ff520c2f?placeholderIfAbsent=true"
              alt=""
              style={{
                aspectRatio: 1.04,
                objectFit: "contain",
                objectPosition: "center",
                width: 24,
                marginTop: 19,
              }}
            />

            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/93aa6ef23aad32998dce678aa612c0b7a9474a09?placeholderIfAbsent=true"
              alt=""
              style={{
                aspectRatio: 1.04,
                objectFit: "contain",
                objectPosition: "center",
                width: 24,
                marginTop: 21,
              }}
            />

            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/0363f0ba488cfcb5e876036c74712f3478760018?placeholderIfAbsent=true"
              alt=""
              style={{
                aspectRatio: 1,
                objectFit: "contain",
                objectPosition: "center",
                width: 24,
                marginTop: 20,
              }}
            />

            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/43d76a828ee652f47fd45f221377b268a4fb2169?placeholderIfAbsent=true"
              alt=""
              style={{
                aspectRatio: 1,
                objectFit: "contain",
                objectPosition: "center",
                width: 24,
                marginTop: 19,
              }}
            />

            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/fe97c6fbd956ec1632be9e9fc14f7cffa5ebe5a3?placeholderIfAbsent=true"
              alt=""
              style={{
                aspectRatio: 1,
                objectFit: "contain",
                objectPosition: "center",
                width: 24,
                marginTop: 20,
              }}
            />

            {/* User/Settings Icon (at bottom) */}
            <img
              src="https://api.builder.io/api/v1/image/assets/YJIGb4i01jvw0SRdL5Bt/eb90703132a91eddf5530d9e82c1016b7bf1a185?placeholderIfAbsent=true"
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
