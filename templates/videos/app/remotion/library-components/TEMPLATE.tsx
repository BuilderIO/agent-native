/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INTERACTIVE COMPONENT TEMPLATE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Copy this file to create a new interactive library component.
 * All the boilerplate is set up correctly for the three-state model:
 *
 *   STANDARD ──[hover in]──▶ HOVER ──[click in]──▶ CLICK
 *                 ◀──[hover out]──         ◀──[click out (returns to HOVER)]──
 *
 * CHECKLIST FOR NEW COMPONENTS:
 * 1. Rename MyComponent / MyComponentProps throughout
 * 2. Define the zone (x, y, width, height) based on component size
 * 3. Set hoverAnimation — the standard→hover transition
 * 4. Set clickAnimation — the hover→click transition (from: is ignored, only to: matters)
 * 5. Add your visual JSX inside AnimatedElement
 * 6. Register in componentRegistry.ts + library-components/index.ts
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

// ─── Props ────────────────────────────────────────────────────────────────────

export type MyComponentProps = {
  // Add your props here
  label?: string;
  backgroundColor?: string;
  textColor?: string;
  // Required by createInteractiveComposition — do not remove
  tracks?: AnimationTrack[];
};

// ─── Fallback Tracks ──────────────────────────────────────────────────────────
// Used when no tracks are provided (e.g. in component library preview)
// ALWAYS use createCameraTrack + createCursorTrack helpers — never write raw tracks!

const COMPONENT_WIDTH = 200;
const COMPONENT_HEIGHT = 60;
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const DURATION = 150; // 5s @ 30fps — standard component preview duration

const FALLBACK_TRACKS: AnimationTrack[] = (() => {
  const tracks = [
    createCameraTrack(DURATION),
    createCursorTrack(DURATION, {
      startX: 200,
      startY: 200,
      startOpacity: 0, // Fade in if desired
    }),
  ];

  const cursor = tracks[1];
  const cx = String(CANVAS_WIDTH / 2 - 16); // Center the cursor on the component
  const cy = String(CANVAS_HEIGHT / 2 - 16);

  // Timeline: arrive at 0.5s (frame 15), click at 2s (frame 60), exit at 3.5s (frame 105)
  cursor.animatedProps.find((p) => p.property === "x")!.keyframes = [
    { frame: 0, value: "200" },
    { frame: 15, value: cx }, // Cursor arrives
    { frame: 90, value: cx }, // Hover period
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
    { frame: 60, value: "1" }, // Click
    { frame: 70, value: "0" },
    { frame: 150, value: "0" },
  ];
  cursor.animatedProps.find((p) => p.property === "opacity")!.keyframes = [
    { frame: 0, value: "0" },
    { frame: 5, value: "0" },
    { frame: 15, value: "1" }, // Fade in
    { frame: 90, value: "1" },
    { frame: 100, value: "0" }, // Fade out
    { frame: 150, value: "0" },
  ];
  // NOTE: cursor type stays "default" — autoCursorType switches to "pointer" on hover

  return tracks;
})();

// ─── Component ────────────────────────────────────────────────────────────────

export const MyComponent = createInteractiveComposition<MyComponentProps>({
  fallbackTracks: FALLBACK_TRACKS,

  render: ({ cursorHistory, registerForCursor }, props) => {
    const {
      label = "Click Me",
      backgroundColor = "#3b82f6",
      textColor = "#ffffff",
    } = props;

    const { width, height } = useVideoConfig();

    // Center component on canvas
    const compX = (width - COMPONENT_WIDTH) / 2;
    const compY = (height - COMPONENT_HEIGHT) / 2;

    // ─── Three-State Animation Setup ────────────────────────────────────────
    // The system handles: STANDARD → HOVER → CLICK → HOVER → STANDARD
    // hoverAnimation: defines what changes from standard → hover
    // clickAnimation: defines the peak click state (hover→click→hover)
    //   NOTE: `from` values in clickAnimation are IGNORED when hovering.
    //         Only `to` matters — it defines the peak click state.
    //         Click animate-out returns to HOVER state, not standard.
    const interactive = useInteractiveComponent({
      id: "my-component",
      elementType: "MyComponent",
      label: "My Component",
      compositionId: "my-component",
      zone: {
        x: compX,
        y: compY,
        width: COMPONENT_WIDTH,
        height: COMPONENT_HEIGHT,
      },
      cursorHistory,
      interactiveElementType: "button", // or "card" for card-like components

      // HOVER: standard → hover
      hoverAnimation: {
        duration: 6,
        easing: "expo.out",
        properties: [
          { property: "scale", from: 1, to: 1.05, unit: "" },
          { property: "brightness", from: 1, to: 1.1, unit: "" },
        ],
      },

      // CLICK: hover → click (from: ignored, only to: matters)
      clickAnimation: {
        duration: 8,
        easing: "expo.out",
        properties: [
          { property: "scale", from: 1, to: 0.95, unit: "" }, // from: ignored!
          { property: "brightness", from: 1, to: 1.3, unit: "" },
        ],
      },
    });

    // Register for autoCursorType (pointer on hover)
    React.useEffect(() => {
      registerForCursor(interactive);
    }, [
      interactive.hover.isHovering,
      interactive.click.isClicking,
      registerForCursor,
    ]);

    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#0f172a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/*
          AnimatedElement automatically applies ALL animated properties.
          Add hover/click animations via the UI — no code changes needed!
          The three-state model is handled by the underlying system.
        */}
        <AnimatedElement
          interactive={interactive}
          as="div"
          style={{
            position: "absolute",
            left: compX,
            top: compY,
            width: COMPONENT_WIDTH,
            height: COMPONENT_HEIGHT,
            backgroundColor,
            color: textColor,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
            fontWeight: 600,
            fontFamily: "Inter, sans-serif",
            cursor: "pointer",
          }}
        >
          {label}
        </AnimatedElement>
      </AbsoluteFill>
    );
  },
});
