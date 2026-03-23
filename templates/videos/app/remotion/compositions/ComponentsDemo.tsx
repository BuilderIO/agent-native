/**
 * ═══════════════════════════════════════════════════════════════════════════
 * COMPONENTS DEMO COMPOSITION
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A showcase composition that demonstrates the interactive library components
 * (Button and Card) with cursor interactions.
 *
 * Features:
 * - Uses Button and Card from library-components
 * - Multiple instances with different props
 * - Cursor demonstrates hover and click on each component
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

export type ComponentsDemoProps = {
  tracks?: AnimationTrack[];
};

// Create standard tracks using helper functions to ensure correct cursor type pattern
const FALLBACK_TRACKS: AnimationTrack[] = (() => {
  const tracks = [
    createCameraTrack(300),
    createCursorTrack(300, { startX: 100, startY: 100, startOpacity: 0 }),
  ];

  // Customize cursor movement with keyframes
  const cursorTrack = tracks[1];

  // X position - horizontal movement between components
  const xProp = cursorTrack.animatedProps.find((p) => p.property === "x")!;
  xProp.keyframes = [
    { frame: 0, value: "100" },
    { frame: 30, value: String(1920 / 2 - 200) }, // Move to left button
    { frame: 90, value: String(1920 / 2 - 200) }, // Hover left button
    { frame: 120, value: String(1920 / 2 + 200) }, // Move to right button
    { frame: 180, value: String(1920 / 2 + 200) }, // Hover right button
    { frame: 210, value: String(1920 / 2) }, // Move to card
    { frame: 270, value: String(1920 / 2) }, // Hover card
    { frame: 300, value: "1820" }, // Exit
  ];

  // Y position - vertical movement between components
  const yProp = cursorTrack.animatedProps.find((p) => p.property === "y")!;
  yProp.keyframes = [
    { frame: 0, value: "100" },
    { frame: 30, value: "400" }, // Left button
    { frame: 90, value: "400" },
    { frame: 120, value: "400" }, // Right button
    { frame: 180, value: "400" },
    { frame: 210, value: "700" }, // Card
    { frame: 270, value: "700" },
    { frame: 300, value: "100" },
  ];

  // Click events
  const clickProp = cursorTrack.animatedProps.find(
    (p) => p.property === "isClicking",
  )!;
  clickProp.keyframes = [
    { frame: 0, value: "0" },
    { frame: 59, value: "0" },
    { frame: 60, value: "1" }, // Click left button
    { frame: 70, value: "0" },
    { frame: 149, value: "0" },
    { frame: 150, value: "1" }, // Click right button
    { frame: 160, value: "0" },
    { frame: 239, value: "0" },
    { frame: 240, value: "1" }, // Click card
    { frame: 250, value: "0" },
    { frame: 300, value: "0" },
  ];

  // Opacity - fade in/out
  const opacityProp = cursorTrack.animatedProps.find(
    (p) => p.property === "opacity",
  )!;
  opacityProp.keyframes = [
    { frame: 0, value: "0" },
    { frame: 20, value: "0" },
    { frame: 30, value: "1" }, // Fade in
    { frame: 280, value: "1" }, // Stay visible
    { frame: 290, value: "0" }, // Fade out
    { frame: 300, value: "0" },
  ];

  // NOTE: Cursor type is "default" (no keyframes needed)
  // The autoCursorType system will automatically override to "pointer" when hovering

  return tracks;
})();

export const ComponentsDemo = createInteractiveComposition<ComponentsDemoProps>(
  {
    fallbackTracks: FALLBACK_TRACKS,

    render: ({ cursorHistory, registerForCursor }, props) => {
      const frame = useCurrentFrame();
      const { width, height } = useVideoConfig();

      // Button 1 - Primary (left)
      const button1 = useInteractiveComponent({
        id: "primary-button",
        elementType: "Button",
        label: "Primary Button",
        compositionId: "components-demo",
        zone: { x: width / 2 - 300, y: 370, width: 200, height: 60 },
        cursorHistory,
        interactiveElementType: "button",
      });

      // Button 2 - Secondary (right)
      const button2 = useInteractiveComponent({
        id: "secondary-button",
        elementType: "Button",
        label: "Secondary Button",
        compositionId: "components-demo",
        zone: { x: width / 2 + 100, y: 370, width: 200, height: 60 },
        cursorHistory,
        interactiveElementType: "button",
      });

      // Card (bottom)
      const card = useInteractiveComponent({
        id: "demo-card",
        elementType: "Card",
        label: "Demo Card",
        compositionId: "components-demo",
        zone: { x: width / 2 - 200, y: 580, width: 400, height: 240 },
        cursorHistory,
        interactiveElementType: "card",
      });

      // Register all components
      React.useEffect(() => {
        registerForCursor(button1);
        registerForCursor(button2);
        registerForCursor(card);
      }, [
        button1.hover.isHovering,
        button1.click.isClicking,
        button2.hover.isHovering,
        button2.click.isClicking,
        card.hover.isHovering,
        card.click.isClicking,
        registerForCursor,
      ]);

      return (
        <AbsoluteFill
          style={{
            backgroundColor: "#0f172a",
            fontFamily: "Inter, sans-serif",
          }}
        >
          {/* Title */}
          <div
            style={{
              position: "absolute",
              top: 80,
              left: 0,
              right: 0,
              textAlign: "center",
              color: "#f1f5f9",
            }}
          >
            <h1 style={{ fontSize: 48, fontWeight: 700, margin: 0 }}>
              Interactive Components
            </h1>
            <p style={{ fontSize: 18, color: "#94a3b8", marginTop: 16 }}>
              Hover and click to see smooth animations
            </p>
          </div>

          {/* Button 1 - Primary */}
          <AnimatedElement
            interactive={button1}
            as="button"
            style={{
              position: "absolute",
              left: width / 2 - 300,
              top: 370,
              width: 200,
              height: 60,
              backgroundColor: "#3b82f6",
              color: "#ffffff",
              border: "none",
              borderRadius: 12,
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 10px 30px rgba(59, 130, 246, 0.3)",
            }}
          >
            Primary Action
          </AnimatedElement>

          {/* Button 2 - Secondary */}
          <AnimatedElement
            interactive={button2}
            as="button"
            style={{
              position: "absolute",
              left: width / 2 + 100,
              top: 370,
              width: 200,
              height: 60,
              backgroundColor: "#64748b",
              color: "#ffffff",
              border: "none",
              borderRadius: 12,
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 10px 30px rgba(100, 116, 139, 0.3)",
            }}
          >
            Secondary
          </AnimatedElement>

          {/* Card */}
          <AnimatedElement
            interactive={card}
            style={{
              position: "absolute",
              left: width / 2 - 200,
              top: 580,
              width: 400,
              height: 240,
              backgroundColor: "#1e293b",
              borderRadius: 16,
              padding: 32,
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.4)",
              color: "#f1f5f9",
            }}
          >
            <h3 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>
              Interactive Card
            </h3>
            <p
              style={{
                fontSize: 16,
                color: "#94a3b8",
                marginTop: 12,
                lineHeight: 1.6,
              }}
            >
              This card uses the same animation engine as the buttons. Hover to
              see the scale effect, click for the press animation.
            </p>
          </AnimatedElement>

          {/* Debug Info */}
          <div
            style={{
              position: "absolute",
              bottom: 20,
              left: 20,
              fontFamily: "monospace",
              fontSize: 11,
              color: "#64748b",
              backgroundColor: "rgba(15, 23, 42, 0.8)",
              padding: 12,
              borderRadius: 8,
              border: "1px solid #334155",
            }}
          >
            <div>Frame: {frame}</div>
            <div>
              Button1: H={button1.hover.progress.toFixed(2)} C=
              {button1.click.progress.toFixed(2)}
            </div>
            <div>
              Button2: H={button2.hover.progress.toFixed(2)} C=
              {button2.click.progress.toFixed(2)}
            </div>
            <div>
              Card: H={card.hover.progress.toFixed(2)} C=
              {card.click.progress.toFixed(2)}
            </div>
          </div>
        </AbsoluteFill>
      );
    },
  },
);
