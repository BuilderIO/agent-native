/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CARD COMPONENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A simple interactive card component with text content.
 * Demonstrates hover and click animations controlled by the UI.
 *
 * Features:
 * - Configurable title and description
 * - Default hover animation (scale + shadow)
 * - Default click animation (scale down/up)
 * - Animations stored in animation system (UI-controlled)
 *
 * Usage:
 *   import { Card } from "@/remotion/library-components";
 *   
 *   <Card
 *     title="My Card"
 *     description="Card description"
 *     backgroundColor="#1e293b"
 *     textColor="#f1f5f9"
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

export type CardProps = {
  title?: string;
  description?: string;
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

  // Cursor arrives at center at 0.5s (frame 15), clicks at 2s (frame 60), exits at 3s
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
    { frame: 60, value: "1" }, // Click at 2s
    { frame: 70, value: "0" },
    { frame: 150, value: "0" },
  ];
  // Note: cursor type stays as "default" (set by createCursorTrack)
  // autoCursorType auto-switches to "pointer" while hovering

  return tracks;
})();

export const Card = createInteractiveComposition<CardProps>({
  fallbackTracks: FALLBACK_TRACKS,
  cursorHistorySize: 150,

  render: ({ cursorHistory, registerForCursor }, props) => {
    const {
      title = "Card Title",
      description = "This is a card component with hover and click animations.",
      backgroundColor = "#1e293b",
      textColor = "#f1f5f9",
    } = props;

    const frame = useCurrentFrame();
    const { width, height } = useVideoConfig();

    // Card dimensions and position (centered)
    const cardWidth = 400;
    const cardHeight = 240;
    const cardX = (width - cardWidth) / 2;
    const cardY = (height - cardHeight) / 2;

    // Interactive card component
    const card = useInteractiveComponent({
      id: "card",
      elementType: "Card",
      label: "Card",
      compositionId: "card",
      zone: { x: cardX, y: cardY, width: cardWidth, height: cardHeight },
      cursorHistory,
      interactiveElementType: "card",
      // Default hover animation: noticeable scale up with shadow
      hoverAnimation: {
        duration: 8,
        easing: "expo.out",
        properties: [
          { property: "scale", from: 1, to: 1.15, unit: "" },
          { property: "shadowBlur", from: 10, to: 40, unit: "px" },
        ],
      },
      // Default click animation: scale down then back
      clickAnimation: {
        duration: 10,
        easing: "back.out",
        properties: [
          { property: "scale", from: 1, to: 0.9, unit: "" },
        ],
      },
    });

    // Register for cursor aggregation
    React.useEffect(() => {
      registerForCursor(card);
    }, [card.hover.isHovering, card.click.isClicking, registerForCursor]);

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
              backgroundColor: card.hover.isHovering
                ? "rgba(34, 197, 94, 0.2)"
                : "rgba(100, 116, 139, 0.2)",
              border: `2px solid ${card.hover.isHovering ? "#22c55e" : "#475569"}`,
              transition: "all 0.2s ease",
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: card.hover.isHovering ? "#22c55e" : "#475569",
                boxShadow: card.hover.isHovering ? "0 0 8px #22c55e" : "none",
              }}
            />
            <span style={{ color: card.hover.isHovering ? "#22c55e" : "#94a3b8" }}>
              HOVER
            </span>
          </div>

          {/* Click State Indicator */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              borderRadius: 8,
              backgroundColor: card.click.isClicking
                ? "rgba(59, 130, 246, 0.2)"
                : "rgba(100, 116, 139, 0.2)",
              border: `2px solid ${card.click.isClicking ? "#3b82f6" : "#475569"}`,
              transition: "all 0.2s ease",
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: card.click.isClicking ? "#3b82f6" : "#475569",
                boxShadow: card.click.isClicking ? "0 0 8px #3b82f6" : "none",
              }}
            />
            <span style={{ color: card.click.isClicking ? "#3b82f6" : "#94a3b8" }}>
              CLICK
            </span>
          </div>
        </div>

        {/* Animated card with hover/click interactions */}
        <AnimatedElement
          interactive={card}
          as="div"
          style={{
            position: "absolute",
            left: cardX,
            top: cardY,
            width: cardWidth,
            height: cardHeight,
            backgroundColor,
            borderRadius: 16,
            padding: 32,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 16,
            boxShadow: "0 10px 40px rgba(0, 0, 0, 0.3)",
          }}
        >
          {/* Title */}
          <div
            style={{
              fontSize: 32,
              fontWeight: "bold",
              color: textColor,
              lineHeight: 1.2,
            }}
          >
            {title}
          </div>

          {/* Description */}
          <div
            style={{
              fontSize: 16,
              color: textColor,
              opacity: 0.8,
              lineHeight: 1.5,
            }}
          >
            {description}
          </div>
        </AnimatedElement>
      </AbsoluteFill>
    );
  },
});
