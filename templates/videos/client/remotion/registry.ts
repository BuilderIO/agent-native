/**
 * ═══════════════════════════════════════════════════════════════════════════
 * COMPOSITION REGISTRY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This file is the single source of truth for all composition defaults.
 *
 * ⚠️ KEYFRAME SYNC PATTERN:
 *
 * When adding keyframes to a composition track in this registry:
 *
 * 1. If the composition was already loaded in localStorage BEFORE you added
 *    keyframes, users won't see them automatically (localStorage wins).
 *
 * 2. Fix: Users should run this in browser console:
 *    ```
 *    resetTracks('composition-id');  // Then refresh page
 *    ```
 *
 * 3. The merge logic now preserves registry keyframes when localStorage has
 *    empty arrays, so this should auto-fix on next reload.
 *
 * 4. Validation warnings will appear in console if keyframes are missing.
 *
 * 📝 BEST PRACTICE:
 *
 * - Always define keyframes in the registry from the start
 * - If adding keyframes later, announce to users they may need to reset
 * - Use resetCurrent() in console for quick testing during development
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type React from "react";
import {
  KineticText,
  type KineticTextProps,
  LogoReveal,
  type LogoRevealProps,
  Slideshow,
  type SlideshowProps,
  LogoExplode,
  type LogoExplodeProps,
  InteractiveShowcase,
  type InteractiveShowcaseProps,
  UIShowcase,
  type UIShowcaseProps,
  ComponentsDemo,
  type ComponentsDemoProps,
  ProjectsInteractive,
  type ProjectsInteractiveProps,
  SlackShowcase,
  type SlackShowcaseProps,
  JiraInteractive,
  type JiraInteractiveProps,
  SixtySecondBlank,
  type SixtySecondBlankProps,
} from "./compositions";
import { BlankComposition, type BlankCompositionProps } from "./compositions/BlankComposition";
import {
  BranchesScreen,
  type BranchesScreenProps,
  BranchesLayout,
  type BranchesLayoutProps,
  StandardView,
  type StandardViewProps,
} from "./library-components";
import type { AnimationTrack } from "@/types";

export type CompositionEntry = {
  id: string;
  title: string;
  description: string;
  component: React.FC<any>;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  defaultProps: Record<string, any>;
  tracks: AnimationTrack[];
  /**
   * Version number for this composition's data structure.
   * Increment this when you make changes to tracks/props that should
   * invalidate localStorage cache (e.g., adding keyframes, changing structure).
   * If localStorage version < registry version, localStorage will be auto-reset.
   * Defaults to 1 if not specified.
   */
  version?: number;
};

export const compositions: CompositionEntry[] = [
  {
    id: "kinetic-text",
    title: "Kinetic Text",
    description: "Bold animated text with spring physics and floating background elements",
    component: KineticText,
    durationInFrames: 120,
    fps: 60,
    width: 1920,
    height: 1080,
    defaultProps: {
      title: "Introducing Builder 2.0",
      subtitle: "Powered by Remotion & React",
      backgroundColor: "#000000",
      textColor: "#ffffff",
      accentColor: "#6366f1"
    } satisfies KineticTextProps,
    tracks: [
      {
        id: "camera",
        label: "Camera",
        startFrame: 0,
        endFrame: 120,
        easing: "linear",
        animatedProps: [
          { property: "translateX", from: "0", to: "0", unit: "px", keyframes: [{ frame: 0, value: "0" }, { frame: 15, value: "0" }, { frame: 63, value: "0", easing: "power4.inOut" }, { frame: 71, value: "-35", easing: "power3.out" }] },
          { property: "translateY", from: "0", to: "0", unit: "px", keyframes: [{ frame: 0, value: "0" }, { frame: 15, value: "0" }, { frame: 63, value: "0", easing: "power4.inOut" }, { frame: 71, value: "0", easing: "power3.out" }] },
          { property: "scale", from: "1", to: "1", unit: "", keyframes: [{ frame: 0, value: "1.5" }, { frame: 15, value: "2.175" }, { frame: 63, value: "1.4849999999999999", easing: "power4.inOut" }, { frame: 71, value: "1.4849999999999999", easing: "power3.out" }] },
          { property: "rotateX", from: "0", to: "0", unit: "deg", keyframes: [{ frame: 0, value: "0" }, { frame: 15, value: "0" }, { frame: 63, value: "0", easing: "power4.inOut" }, { frame: 71, value: "0", easing: "power3.out" }] },
          { property: "rotateY", from: "0", to: "0", unit: "deg", keyframes: [{ frame: 0, value: "0" }, { frame: 15, value: "0" }, { frame: 63, value: "0", easing: "power4.inOut" }, { frame: 71, value: "0", easing: "power3.out" }] },
          { property: "perspective", from: "800", to: "800", unit: "px", keyframes: [{ frame: 0, value: "800" }, { frame: 15, value: "800" }, { frame: 63, value: "800", easing: "power4.inOut" }, { frame: 71, value: "800", easing: "power3.out" }] }
        ]
      },
      {
        id: "kt-title",
        label: "Title Appear",
        startFrame: 3,
        endFrame: 86,
        easing: "sine.out",
        animatedProps: [
          { property: "typing reveal", from: "", to: "", unit: "", programmatic: true, description:
              "Letters appear one by one linearly while the text position drifts from right to left with quartic (power4) easing. Text starts offset to the right and smoothly drifts left to center as characters appear, creating an inertia effect.", parameters: [{ name: "avgCharWidth", label: "Character Width", default: 0.6, min: 0.1, max: 2, step: 0.05 }, { name: "offsetScale", label: "Drift Distance", default: 0.125, min: 0, max: 0.5, step: 0.025 }], parameterValues: { offsetScale: 0.25 }, codeSnippet:
`const charsToShow = Math.floor(titleP * title.length);
const visibleTitle = title.slice(0, charsToShow);

// Drift with quartic easing (power4.out)
const avgCharWidth = params.avgCharWidth ?? 0.6;
const offsetScale = params.offsetScale ?? 0.125;
const pixelsPerChar = fontSize * avgCharWidth;
const totalWidth = title.length * pixelsPerChar;
const startOffset = totalWidth * offsetScale;
const easedProgress = 1 - Math.pow(1 - titleP, 4); // power4.out
const driftX = startOffset * (1 - easedProgress);

transform: \`translateX(\${driftX}px)\`` },
          { property: "scale", from: "1.5", to: "1", unit: "" }
        ]
      },
      {
        id: "kt-explode",
        label: "Text Explode",
        startFrame: 86,
        endFrame: 120,
        easing: "power2.out",
        animatedProps: [
          { property: "explode scatter", from: "", to: "", unit: "", programmatic: true, description:
              "Each character explodes outward from its position. Characters scatter in seeded random directions with rotation and scale, then fade out. The explosion uses power2.out easing for a fast burst that decelerates.", parameters: [{ name: "spread", label: "Spread Distance", default: 800, min: 100, max: 2000, step: 50 }, { name: "rotationAmount", label: "Max Rotation", default: 720, min: 0, max: 1440, step: 45 }, { name: "scaleEnd", label: "End Scale", default: 0, min: 0, max: 2, step: 0.1 }], codeSnippet:
`// Each char gets a seeded random direction
const seed = (i * 7 + 13) % 100 / 100;
const angle = seed * Math.PI * 2;
const dist = spread * (0.5 + seed * 0.5) * progress;
const x = Math.cos(angle) * dist;
const y = Math.sin(angle) * dist;
const rot = (seed - 0.5) * rotationAmount * progress;
const s = 1 + (scaleEnd - 1) * progress;
const opacity = 1 - progress;` }
        ]
      }
    ],
  },
  {
    id: "logo-reveal",
    title: "Logo Reveal",
    description: "Particle-burst logo animation with expanding ring and tagline",
    component: LogoReveal,
    durationInFrames: 90,
    fps: 30,
    width: 1080,
    height: 1080,
    defaultProps: {
      brandName: "ACME",
      tagline: "Build the future",
      primaryColor: "#f472b6",
      bgColor: "#0f0f0f",
    } satisfies LogoRevealProps,
    tracks: [
      {
        id: "camera",
        label: "Camera",
        startFrame: 0,
        endFrame: 90,
        easing: "linear",
        animatedProps: [
          { property: "translateX", from: "0", to: "0", unit: "px" },
          { property: "translateY", from: "0", to: "0", unit: "px" },
          { property: "scale", from: "1", to: "1", unit: "" },
          { property: "rotateX", from: "0", to: "0", unit: "deg" },
          { property: "rotateY", from: "0", to: "0", unit: "deg" },
          { property: "perspective", from: "800", to: "800", unit: "px" },
        ],
      },
      {
        id: "lr-ring", label: "Ring Expand", startFrame: 0, endFrame: 30, easing: "spring",
        animatedProps: [
          { property: "scale",   from: "0", to: "1",   unit: "" },
          { property: "opacity", from: "0", to: "0.4", unit: "" },
        ],
      },
      {
        id: "lr-particles", label: "Particles Burst", startFrame: 8, endFrame: 55, easing: "ease-out",
        animatedProps: [
          {
            property: "radius", from: "0", to: "35", unit: "%",
            description:
              "Controls how far the particles travel from the center. The value is a percentage of the shortest viewport dimension — so 35 means they reach 35% of the way to the edge. Each particle uses its own spring to ease out, meaning the distance grows quickly at first then settles. Adjust 'from' to set where the burst starts and 'to' to change how far it spreads.",
            codeSnippet:
`// Per-particle spring — each dot has its own delayed spring
const p = spring({
  frame,
  fps,
  delay: startFrame + i * 2,   // staggered by 2 frames per dot
  config: { damping: 20 },
});

// Radius converted from % of min(width, height)
const radius = interpolate(p, [0, 1], [
  min(width, height) * (from / 100),   // "from" %
  min(width, height) * (to   / 100),   // "to"   %
]);`,
          },
          {
            property: "opacity", from: "1", to: "0", unit: "",
            description:
              "Each particle fades out on its own schedule, timed relative to when it starts moving. The fade begins 20 frames after the particle's spring fires and completes 20 frames later — so particles that launch later also disappear later, keeping the burst feeling organic. 'From' and 'to' set the opacity range of the fade.",
            codeSnippet:
`// Fade is tied to each particle's personal delay, not the track start
const fadeOut = interpolate(
  frame,
  [delay + 20, delay + 40],   // fade window after burst peak
  [from, to],                 // 1 → 0 by default
  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
);`,
          },
          {
            property: "burst layout",
            from: "", to: "", unit: "",
            programmatic: true,
            description:
              "Determines the shape of the burst. 24 particles are placed evenly around a full 360° circle using trigonometry. Each one launches 2 frames after the previous, so the burst radiates outward as a ripple rather than all exploding at once. The count (24) and stagger (2 frames) are fixed in code — adjust them in the source file to change the burst density or speed.",
            codeSnippet:
`// 24 particles evenly spaced around a full circle,
// each staggered 2 frames apart
Array.from({ length: 24 }).map((_, i) => {
  const angle = (i / 24) * Math.PI * 2;
  const delay = startFrame + i * 2;

  x = cx + Math.cos(angle) * radius;
  y = cy + Math.sin(angle) * radius;
});`,
          },
        ],
      },
      {
        id: "lr-logo", label: "Logo Entrance", startFrame: 12, endFrame: 45, easing: "spring",
        animatedProps: [
          { property: "scale",   from: "0.5", to: "1", unit: "" },
          { property: "opacity", from: "0",   to: "1", unit: "" },
        ],
      },
      {
        id: "lr-tagline", label: "Tagline Fade", startFrame: 25, endFrame: 60, easing: "spring",
        animatedProps: [
          { property: "translateY", from: "20",  to: "0",   unit: "px" },
          { property: "opacity",    from: "0",   to: "0.6", unit: ""   },
        ],
      },
    ],
  },
  {
    id: "logo-explode",
    title: "Logo Explode",
    description: "Builder.io SVG logo pieces reveal then explode outward",
    component: LogoExplode,
    durationInFrames: 120,
    fps: 30,
    width: 1080,
    height: 1080,
    defaultProps: {
      bgColor: "#0a0a0a",
      logoScale: 1,
    } satisfies LogoExplodeProps,
    tracks: [
      {
        id: "camera",
        label: "Camera",
        startFrame: 0,
        endFrame: 120,
        easing: "linear",
        animatedProps: [
          { property: "translateX", from: "0", to: "0", unit: "px" },
          { property: "translateY", from: "0", to: "0", unit: "px" },
          { property: "scale", from: "1", to: "1", unit: "" },
          { property: "rotateX", from: "0", to: "0", unit: "deg" },
          { property: "rotateY", from: "0", to: "0", unit: "deg" },
          { property: "perspective", from: "800", to: "800", unit: "px" },
        ],
      },
      {
        id: "le-logo",
        label: "Logo Entrance",
        startFrame: 0,
        endFrame: 45,
        easing: "spring",
        animatedProps: [
          { property: "scale", from: "0.3", to: "1", unit: "" },
          { property: "opacity", from: "0", to: "1", unit: "" },
        ],
      },
      {
        id: "le-explode",
        label: "Letter Explosion",
        startFrame: 60,
        endFrame: 120,
        easing: "power2.out",
        animatedProps: [
          {
            property: "letter scatter",
            from: "",
            to: "",
            unit: "",
            programmatic: true,
            description:
              "Each piece of the Builder.io SVG logo gets its own random explosion vector \u2014 angle, speed, and rotation direction. Pieces spring outward from their resting position, spin, shrink, and fade out with staggered timing for an organic shatter feel.",
            parameters: [
              { name: "spreadRadius", label: "Spread Radius", default: 500, min: 100, max: 1200, step: 25 },
              { name: "stagger", label: "Stagger (frames)", default: 2, min: 0, max: 8, step: 1 },
            ],
            codeSnippet:
`// Per-letter spring with stagger\nconst p = spring({ frame, fps, delay: startFrame + i * stagger,\n  config: { damping: 20, stiffness: 40 } });\nconst dx = Math.cos(angle) * speed * spreadRadius * p;\nconst dy = Math.sin(angle) * speed * spreadRadius * p;\nconst rot = rotDir * (360 + rand() * 360) * p;\nconst letterOpacity = interpolate(elapsed, [0, dur*0.5, dur], [1, 0.7, 0]);\nconst letterScale = interpolate(elapsed, [0, dur], [1, 0.1]);`,
          },
        ],
      },
    ],
  },
  {
    id: "slideshow",
    title: "Slideshow",
    description: "Multi-slide presentation with animated text entrances",
    component: Slideshow,
    durationInFrames: 270,
    fps: 30,
    width: 1920,
    height: 1080,
    defaultProps: {
      fontColor: "#ffffff",
      slides: [
        {
          title: "Welcome to Remotion",
          body: "Create stunning videos programmatically with React components, spring animations, and the full power of the web platform.",
          color: "#1e1b4b",
        },
        {
          title: "Compose with Code",
          body: "Use familiar React patterns — components, props, hooks — to build dynamic, data-driven video content at scale.",
          color: "#0c4a6e",
        },
        {
          title: "Ship Everywhere",
          body: "Render to MP4, WebM, or GIF. Deploy rendering pipelines to the cloud with Remotion Lambda or self-host with your own infrastructure.",
          color: "#14532d",
        },
      ],
    } satisfies SlideshowProps,
    tracks: [
      {
        id: "camera",
        label: "Camera",
        startFrame: 0,
        endFrame: 270,
        easing: "linear",
        animatedProps: [
          { property: "translateX", from: "0", to: "0", unit: "px" },
          { property: "translateY", from: "0", to: "0", unit: "px" },
          { property: "scale", from: "1", to: "1", unit: "" },
          { property: "rotateX", from: "0", to: "0", unit: "deg" },
          { property: "rotateY", from: "0", to: "0", unit: "deg" },
          { property: "perspective", from: "800", to: "800", unit: "px" },
        ],
      },
      {
        id: "ss-slide1", label: "Slide 1 — Enter", startFrame: 0, endFrame: 90, easing: "spring",
        animatedProps: [
          { property: "translateX", from: "-80", to: "0", unit: "px" },
          { property: "opacity",    from: "0",   to: "1", unit: ""   },
        ],
      },
      {
        id: "ss-slide2", label: "Slide 2 — Enter", startFrame: 90, endFrame: 180, easing: "spring",
        animatedProps: [
          { property: "translateX", from: "-80", to: "0", unit: "px" },
          { property: "opacity",    from: "0",   to: "1", unit: ""   },
        ],
      },
      {
        id: "ss-slide3", label: "Slide 3 — Enter", startFrame: 180, endFrame: 270, easing: "spring",
        animatedProps: [
          { property: "translateX", from: "-80", to: "0", unit: "px" },
          { property: "opacity",    from: "0",   to: "1", unit: ""   },
        ],
      },
    ],
  },
  {
    id: "interactive-showcase",
    title: "Interactive Showcase",
    description: "Comprehensive demo showcasing camera controls, cursor interactions, spring physics, and more",
    component: InteractiveShowcase,
    durationInFrames: 300,
    fps: 60,
    width: 1920,
    height: 1080,
    defaultProps: {
      title: "Video Studio",
      subtitle: "The Future of Video Creation"
    } satisfies InteractiveShowcaseProps,
    tracks: [
      {
        id: "camera",
        label: "Camera",
        startFrame: 0,
        endFrame: 300,
        easing: "linear",
        animatedProps: [
          { property: "translateX", from: "0", to: "0", unit: "px", keyframes: [{ frame: 0, value: "0", easing: "expo.inOut" }, { frame: 182, value: "0", easing: "expo.inOut" }, { frame: 284, value: "-1104", easing: "expo.inOut" }] },
          { property: "translateY", from: "0", to: "0", unit: "px", keyframes: [{ frame: 0, value: "0", easing: "expo.inOut" }, { frame: 182, value: "0", easing: "expo.inOut" }, { frame: 284, value: "234", easing: "expo.inOut" }] },
          { property: "scale", from: "1", to: "1", unit: "", keyframes: [{ frame: 0, value: "1", easing: "expo.inOut" }, { frame: 182, value: "1", easing: "expo.inOut" }, { frame: 284, value: "2.2299999999999973", easing: "expo.inOut" }] },
          { property: "rotateX", from: "0", to: "0", unit: "deg", keyframes: [{ frame: 0, value: "0", easing: "expo.inOut" }, { frame: 182, value: "0", easing: "expo.inOut" }, { frame: 284, value: "0", easing: "expo.inOut" }] },
          { property: "rotateY", from: "0", to: "0", unit: "deg", keyframes: [{ frame: 0, value: "0", easing: "expo.inOut" }, { frame: 182, value: "0", easing: "expo.inOut" }, { frame: 284, value: "0", easing: "expo.inOut" }] },
          { property: "perspective", from: "800", to: "800", unit: "px", keyframes: [{ frame: 0, value: "800", easing: "expo.inOut" }, { frame: 182, value: "800", easing: "expo.inOut" }, { frame: 284, value: "800", easing: "expo.inOut" }] }
        ]
      },
      {
        id: "cursor",
        label: "Cursor",
        startFrame: 0,
        endFrame: 300,
        easing: "expo.inOut",
        animatedProps: [
          { property: "x", from: "960", to: "960", unit: "px", keyframes: [{ frame: 0, value: "372.51517093211714", easing: "expo.inOut" }, { frame: 140, value: "606.9880517130903", easing: "expo.inOut" }, { frame: 287, value: "1555.3005917605822", easing: "expo.inOut" }, { frame: 210, value: "1383.3538125212017", easing: "expo.inOut" }] },
          { property: "y", from: "540", to: "540", unit: "px", keyframes: [{ frame: 0, value: "256.6175417436207", easing: "expo.inOut" }, { frame: 140, value: "535.3797444498888", easing: "expo.inOut" }, { frame: 287, value: "342.5909313633108", easing: "expo.inOut" }, { frame: 210, value: "498.906185217293", easing: "expo.inOut" }] },
          { property: "opacity", from: "1", to: "1", unit: "", keyframes: [{ frame: 33, value: "0", easing: "expo.inOut" }, { frame: 99, value: "1", easing: "expo.inOut" }] },
          { property: "scale", from: "1", to: "1", unit: "" },
          { property: "type", from: "default", to: "default", unit: "" },
          { property: "isClicking", from: "0", to: "0", unit: "", keyframes: [{ frame: 140, value: "1" }] }
        ]
      }
    ],
  },
  {
    id: "ui-showcase",
    title: "UI Showcase",
    description: "Interactive recreation of the Video Studio UI with cursor workflow demonstration",
    component: UIShowcase,
    durationInFrames: 450,
    fps: 60,
    width: 1920,
    height: 1080,
    defaultProps: {
      
    } satisfies UIShowcaseProps,
    tracks: [
      {
        id: "camera",
        label: "Camera",
        startFrame: 0,
        endFrame: 450,
        easing: "linear",
        animatedProps: [
          { property: "translateX", from: "0", to: "0", unit: "px", keyframes: [{ frame: 17, value: "1553", easing: "expo.inOut" }, { frame: 201, value: "1553", easing: "expo.inOut" }, { frame: 239, value: "1593", easing: "expo.inOut" }, { frame: 269, value: "1593", easing: "expo.inOut" }, { frame: 302, value: "-66", easing: "expo.inOut" }, { frame: 332, value: "-66", easing: "expo.inOut" }, { frame: 366, value: "264", easing: "expo.inOut" }] },
          { property: "translateY", from: "0", to: "0", unit: "px", keyframes: [{ frame: 17, value: "870", easing: "expo.inOut" }, { frame: 201, value: "870", easing: "expo.inOut" }, { frame: 239, value: "319", easing: "expo.inOut" }, { frame: 269, value: "319", easing: "expo.inOut" }, { frame: 302, value: "437", easing: "expo.inOut" }, { frame: 332, value: "437", easing: "expo.inOut" }, { frame: 366, value: "1071", easing: "expo.inOut" }] },
          { property: "scale", from: "1", to: "1", unit: "", keyframes: [{ frame: 17, value: "2.6049999999999978", easing: "expo.inOut" }, { frame: 201, value: "2.6049999999999978", easing: "expo.inOut" }, { frame: 239, value: "2.6049999999999978", easing: "expo.inOut" }, { frame: 269, value: "2.6049999999999978", easing: "expo.inOut" }, { frame: 302, value: "1.7949999999999986", easing: "expo.inOut" }, { frame: 332, value: "1.7949999999999986", easing: "expo.inOut" }, { frame: 366, value: "2.799999999999999", easing: "expo.inOut" }] },
          { property: "rotateX", from: "0", to: "0", unit: "deg", keyframes: [{ frame: 17, value: "0", easing: "expo.inOut" }, { frame: 201, value: "0", easing: "expo.inOut" }, { frame: 239, value: "0", easing: "expo.inOut" }, { frame: 269, value: "0", easing: "expo.inOut" }, { frame: 302, value: "0", easing: "expo.inOut" }, { frame: 332, value: "0", easing: "expo.inOut" }, { frame: 366, value: "0", easing: "expo.inOut" }] },
          { property: "rotateY", from: "0", to: "0", unit: "deg", keyframes: [{ frame: 17, value: "0", easing: "expo.inOut" }, { frame: 201, value: "0", easing: "expo.inOut" }, { frame: 239, value: "0", easing: "expo.inOut" }, { frame: 269, value: "0", easing: "expo.inOut" }, { frame: 302, value: "0", easing: "expo.inOut" }, { frame: 332, value: "0", easing: "expo.inOut" }, { frame: 366, value: "0", easing: "expo.inOut" }] },
          { property: "perspective", from: "800", to: "800", unit: "px", keyframes: [{ frame: 17, value: "800", easing: "expo.inOut" }, { frame: 201, value: "800", easing: "expo.inOut" }, { frame: 239, value: "800", easing: "expo.inOut" }, { frame: 269, value: "800", easing: "expo.inOut" }, { frame: 302, value: "800", easing: "expo.inOut" }, { frame: 332, value: "800", easing: "expo.inOut" }, { frame: 366, value: "800", easing: "expo.inOut" }] }
        ]
      },
      {
        id: "cursor",
        label: "Cursor",
        startFrame: 0,
        endFrame: 450,
        easing: "expo.inOut",
        animatedProps: [
          { property: "x", from: "200", to: "800", unit: "px", keyframes: [{ frame: 0, value: "49.3080784575975", easing: "expo.inOut" }, { frame: 54, value: "384.3407722585192", easing: "expo.inOut" }, { frame: 126, value: "356.39664963625205", easing: "expo.inOut" }, { frame: 158, value: "307.919596848118", easing: "expo.inOut" }, { frame: 201, value: "307.919596848118", easing: "expo.inOut" }, { frame: 254, value: "516.1377837822258", easing: "expo.inOut" }, { frame: 312, value: "516.1377837822258", easing: "expo.inOut" }, { frame: 338, value: "872.5643804336235", easing: "expo.inOut" }, { frame: 386, value: "872.5643804336235", easing: "expo.inOut" }, { frame: 430, value: "1207.4815538701678", easing: "expo.inOut" }] },
          { property: "y", from: "100", to: "750", unit: "px", keyframes: [{ frame: 0, value: "177.25062580253206", easing: "expo.inOut" }, { frame: 54, value: "140.24701484541538", easing: "expo.inOut" }, { frame: 126, value: "320.1908467415425", easing: "expo.inOut" }, { frame: 158, value: "190.9876104208169", easing: "expo.inOut" }, { frame: 201, value: "190.9876104208169", easing: "expo.inOut" }, { frame: 254, value: "469.79296862242296", easing: "expo.inOut" }, { frame: 312, value: "469.79296862242296", easing: "expo.inOut" }, { frame: 338, value: "175.56667517533634", easing: "expo.inOut" }, { frame: 386, value: "175.56667517533634", easing: "expo.inOut" }, { frame: 430, value: "344.49113079747247", easing: "expo.inOut" }] },
          { property: "opacity", from: "1", to: "1", unit: "", keyframes: [{ frame: 17, value: "0", easing: "expo.inOut" }, { frame: 34, value: "1", easing: "expo.inOut" }, { frame: 407, value: "1", easing: "expo.inOut" }, { frame: 415, value: "0", easing: "expo.inOut" }] },
          { property: "scale", from: "1", to: "1", unit: "", keyframes: [{ frame: 54, value: "0.8", easing: "expo.inOut" }] },
          { property: "type", from: "default", to: "default", unit: "" },
          { property: "isClicking", from: "0", to: "0", unit: "", keyframes: [{ frame: 58, value: "1" }, { frame: 166, value: "1" }] }
        ]
      },
      {
        id: "ui-entrance",
        label: "UI Entrance",
        startFrame: 0,
        endFrame: 44,
        easing: "power2.out",
        animatedProps: [
          { property: "opacity", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "switch-to-properties",
        label: "Switch to Properties",
        startFrame: 62,
        endFrame: 62,
        easing: "linear",
        animatedProps: [
          { property: "tab state", from: "", to: "", unit: "", programmatic: true, description:
              "Instantly switches the sidebar from Compositions tab to Properties tab. This is a keyframe-style track — drag it to adjust when the tab switch happens." }
        ]
      },
      {
        id: "camera-panel-open",
        label: "Camera Panel Open",
        startFrame: 167,
        endFrame: 227,
        easing: "spring",
        animatedProps: [
          { property: "panelOpen", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "pan-tool-active",
        label: "Pan Tool Active",
        startFrame: 333,
        endFrame: 393,
        easing: "linear",
        animatedProps: [
          { property: "toolActive", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "timeline-playback",
        label: "Timeline Playback",
        startFrame: 0,
        endFrame: 450,
        easing: "linear",
        animatedProps: [
          { property: "progress", from: "0", to: "0.67", unit: "" }
        ]
      }
    ],
  },
  {
    id: "components-demo",
    title: "Components Demo",
    description: "Interactive showcase of library components (Button and Card) with cursor demonstrations",
    component: ComponentsDemo,
    durationInFrames: 300,
    fps: 30,
    width: 1920,
    height: 1080,
    defaultProps: {
      
    } satisfies ComponentsDemoProps,
    tracks: [
      {
        id: "camera",
        label: "Camera",
        startFrame: 0,
        endFrame: 300,
        easing: "linear",
        animatedProps: [
          { property: "translateX", from: "0", to: "0", unit: "px", keyframes: [{ frame: 0, value: "475", easing: "expo.inOut" }, { frame: 51, value: "475", easing: "expo.inOut" }, { frame: 125, value: "-61", easing: "expo.inOut" }, { frame: 152, value: "-61", easing: "expo.inOut" }, { frame: 194, value: "-17", easing: "expo.inOut" }] },
          { property: "translateY", from: "0", to: "0", unit: "px", keyframes: [{ frame: 0, value: "339", easing: "expo.inOut" }, { frame: 51, value: "339", easing: "expo.inOut" }, { frame: 125, value: "338", easing: "expo.inOut" }, { frame: 152, value: "338", easing: "expo.inOut" }, { frame: 194, value: "-340", easing: "expo.inOut" }] },
          { property: "scale", from: "1", to: "1", unit: "", keyframes: [{ frame: 0, value: "2.3950000000000005", easing: "expo.inOut" }, { frame: 51, value: "2.3950000000000005", easing: "expo.inOut" }, { frame: 125, value: "2.3950000000000005", easing: "expo.inOut" }, { frame: 152, value: "2.3950000000000005", easing: "expo.inOut" }, { frame: 194, value: "2.3950000000000005", easing: "expo.inOut" }] },
          { property: "rotateX", from: "0", to: "0", unit: "deg", keyframes: [{ frame: 0, value: "0", easing: "expo.inOut" }, { frame: 51, value: "0", easing: "expo.inOut" }, { frame: 125, value: "0", easing: "expo.inOut" }, { frame: 152, value: "0", easing: "expo.inOut" }, { frame: 194, value: "0", easing: "expo.inOut" }] },
          { property: "rotateY", from: "0", to: "0", unit: "deg", keyframes: [{ frame: 0, value: "0", easing: "expo.inOut" }, { frame: 51, value: "0", easing: "expo.inOut" }, { frame: 125, value: "0", easing: "expo.inOut" }, { frame: 152, value: "0", easing: "expo.inOut" }, { frame: 194, value: "0", easing: "expo.inOut" }] },
          { property: "perspective", from: "800", to: "800", unit: "px", keyframes: [{ frame: 0, value: "800", easing: "expo.inOut" }, { frame: 51, value: "800", easing: "expo.inOut" }, { frame: 125, value: "800", easing: "expo.inOut" }, { frame: 152, value: "800", easing: "expo.inOut" }, { frame: 194, value: "800", easing: "expo.inOut" }] }
        ]
      },
      {
        id: "cursor",
        label: "Cursor",
        startFrame: 0,
        endFrame: 300,
        easing: "linear",
        animatedProps: [
          { property: "x", from: "0", to: "0", unit: "px", keyframes: [{ frame: 0, value: "538.0554208958865", easing: "expo.inOut" }, { frame: 63, value: "741.8832034708407", easing: "expo.inOut" }, { frame: 79, value: "741.8832034708407", easing: "expo.inOut" }, { frame: 120, value: "1107.8288362791563", easing: "expo.inOut" }, { frame: 138, value: "1107.8288362791563", easing: "expo.inOut" }, { frame: 212, value: "986.6601711937363", easing: "expo.inOut" }] },
          { property: "y", from: "0", to: "0", unit: "px", keyframes: [{ frame: 0, value: "247.52361596023508", easing: "expo.inOut" }, { frame: 63, value: "415.15032518210865", easing: "expo.inOut" }, { frame: 79, value: "415.15032518210865", easing: "expo.inOut" }, { frame: 120, value: "412.7893856156034", easing: "expo.inOut" }, { frame: 138, value: "412.7893856156034", easing: "expo.inOut" }, { frame: 212, value: "760.0420608005983", easing: "expo.inOut" }] },
          { property: "isClicking", from: "0", to: "0", unit: "", keyframes: [{ frame: 67, value: "1" }, { frame: 125, value: "1" }, { frame: 217, value: "1" }] },
          { property: "type", from: "default", to: "default", unit: "" },
          { property: "opacity", from: "0", to: "1", unit: "", keyframes: [{ frame: 0, value: "1", easing: "expo.inOut" }] },
          { property: "scale", from: "1", to: "1", unit: "" }
        ]
      }
    ],
  },
  {
    id: "projects-interactive",
    title: "Projects Interactive",
    description: "Interactive showcase of the Projects Screen with typing animation and cursor interactions",
    component: ProjectsInteractive,
    durationInFrames: 405,
    fps: 30,
    width: 1920,
    height: 1080,
    defaultProps: {
      prompt: "Create a modern landing page with hero section and pricing cards"
    } satisfies ProjectsInteractiveProps,
    tracks: [
      {
        id: "camera",
        label: "Camera",
        startFrame: 0,
        endFrame: 405,
        easing: "linear",
        animatedProps: [
          { property: "translateX", from: "0", to: "0", unit: "px", keyframes: [{ frame: 0, value: "1355", easing: "expo.inOut" }, { frame: 67, value: "239", easing: "expo.inOut" }, { frame: 97, value: "239", easing: "expo.inOut" }, { frame: 145, value: "-210", easing: "expo.inOut" }, { frame: 205, value: "-210", easing: "expo.inOut" }, { frame: 277, value: "-78.46378101091818", easing: "expo.inOut" }, { frame: 334, value: "-78.46378101091818", easing: "expo.inOut" }] },
          { property: "translateY", from: "0", to: "0", unit: "px", keyframes: [{ frame: 0, value: "628", easing: "expo.inOut" }, { frame: 67, value: "633", easing: "expo.inOut" }, { frame: 97, value: "633", easing: "expo.inOut" }, { frame: 145, value: "633", easing: "expo.inOut" }, { frame: 205, value: "633", easing: "expo.inOut" }, { frame: 277, value: "405", easing: "expo.inOut" }, { frame: 334, value: "22", easing: "expo.inOut" }] },
          { property: "scale", from: "1", to: "1", unit: "", keyframes: [{ frame: 0, value: "2.004999999999999", easing: "expo.inOut" }, { frame: 67, value: "2.604999999999999", easing: "expo.inOut" }, { frame: 97, value: "2.604999999999999", easing: "expo.inOut" }, { frame: 145, value: "2.604999999999999", easing: "expo.inOut" }, { frame: 205, value: "2.604999999999999", easing: "expo.inOut" }, { frame: 277, value: "2.199999999999996", easing: "expo.inOut" }, { frame: 334, value: "2.199999999999996", easing: "expo.inOut" }] },
          { property: "rotateX", from: "0", to: "0", unit: "deg", keyframes: [{ frame: 0, value: "0", easing: "expo.inOut" }, { frame: 67, value: "0", easing: "expo.inOut" }, { frame: 97, value: "0", easing: "expo.inOut" }, { frame: 145, value: "0", easing: "expo.inOut" }, { frame: 205, value: "0", easing: "expo.inOut" }, { frame: 277, value: "0", easing: "expo.inOut" }, { frame: 334, value: "0", easing: "expo.inOut" }] },
          { property: "rotateY", from: "0", to: "0", unit: "deg", keyframes: [{ frame: 0, value: "0", easing: "expo.inOut" }, { frame: 67, value: "0", easing: "expo.inOut" }, { frame: 97, value: "0", easing: "expo.inOut" }, { frame: 145, value: "0", easing: "expo.inOut" }, { frame: 205, value: "0", easing: "expo.inOut" }, { frame: 277, value: "0", easing: "expo.inOut" }, { frame: 334, value: "0", easing: "expo.inOut" }] },
          { property: "perspective", from: "800", to: "800", unit: "px", keyframes: [{ frame: 0, value: "800", easing: "expo.inOut" }, { frame: 67, value: "800", easing: "expo.inOut" }, { frame: 97, value: "800", easing: "expo.inOut" }, { frame: 145, value: "800", easing: "expo.inOut" }, { frame: 205, value: "800", easing: "expo.inOut" }, { frame: 277, value: "800", easing: "expo.inOut" }, { frame: 334, value: "800", easing: "expo.inOut" }] }
        ]
      },
      {
        id: "screen-entrance",
        label: "Screen Entrance",
        startFrame: 0,
        endFrame: 50,
        easing: "power2.out",
        animatedProps: [
          { property: "opacity", from: "0", to: "1", unit: "" },
          { property: "translateY", from: "40", to: "0", unit: "px" }
        ]
      },
      {
        id: "cursor",
        label: "Cursor",
        startFrame: 0,
        endFrame: 300,
        easing: "linear",
        animatedProps: [
          { property: "x", from: "0", to: "0", unit: "px", keyframes: [{ frame: 6, value: "223.86133590867587", easing: "expo.inOut" }, { frame: 61, value: "682.5057725600618", easing: "expo.inOut" }, { frame: 72, value: "682.5057725600618", easing: "expo.inOut" }, { frame: 80, value: "682.5057725600618", easing: "expo.inOut" }, { frame: 124, value: "1154.4622646479756", easing: "expo.inOut" }, { frame: 134, value: "1156.843418255019", easing: "expo.inOut" }, { frame: 159, value: "1346.3454026150278", easing: "expo.inOut" }, { frame: 175, value: "1346.3454026150278", easing: "expo.inOut" }, { frame: 203, value: "1362.8987368348412", easing: "expo.inOut" }, { frame: 252, value: "851.2565585128442", easing: "expo.inOut" }, { frame: 260, value: "851.2565585128442", easing: "expo.inOut" }, { frame: 290, value: "851.2565585128442", easing: "expo.inOut" }, { frame: 334, value: "899.2214735338998", easing: "expo.inOut" }, { frame: 358, value: "899.2214735338998", easing: "expo.inOut" }, { frame: 405, value: "1433.2120827768952", easing: "expo.inOut" }] },
          { property: "y", from: "0", to: "0", unit: "px", keyframes: [{ frame: 6, value: "190.4947258664596", easing: "expo.inOut" }, { frame: 61, value: "265.22142061013164", easing: "expo.inOut" }, { frame: 72, value: "265.22142061013164", easing: "expo.inOut" }, { frame: 80, value: "265.22142061013164", easing: "expo.inOut" }, { frame: 124, value: "260.2603541375921", easing: "expo.inOut" }, { frame: 134, value: "260.9838922389076", easing: "expo.inOut" }, { frame: 159, value: "370.2381455375379", easing: "expo.inOut" }, { frame: 175, value: "370.2381455375379", easing: "expo.inOut" }, { frame: 203, value: "465.43508557628047", easing: "expo.inOut" }, { frame: 252, value: "459.50883078418246", easing: "expo.inOut" }, { frame: 260, value: "459.50883078418246", easing: "expo.inOut" }, { frame: 290, value: "459.50883078418246", easing: "expo.inOut" }, { frame: 334, value: "701.5305580745593", easing: "expo.inOut" }, { frame: 358, value: "701.5305580745593", easing: "expo.inOut" }, { frame: 405, value: "747.4270746084921", easing: "expo.inOut" }] },
          { property: "isClicking", from: "0", to: "0", unit: "", keyframes: [{ frame: 67, value: "1" }, { frame: 164, value: "1" }, { frame: 268, value: "1" }, { frame: 338, value: "1" }] },
          { property: "type", from: "default", to: "default", unit: "" },
          { property: "opacity", from: "0", to: "1", unit: "", keyframes: [{ frame: 0, value: "0", easing: "expo.inOut" }, { frame: 6, value: "1", easing: "expo.inOut" }, { frame: 61, value: "1", easing: "expo.inOut" }, { frame: 72, value: "1", easing: "expo.inOut" }, { frame: 80, value: "0", easing: "expo.inOut" }, { frame: 124, value: "0", easing: "expo.inOut" }, { frame: 134, value: "1", easing: "expo.inOut" }, { frame: 159, value: "1", easing: "expo.inOut" }, { frame: 175, value: "1", easing: "expo.inOut" }, { frame: 383, value: "1", easing: "expo.inOut" }, { frame: 395, value: "0", easing: "expo.inOut" }] },
          { property: "scale", from: "1", to: "1", unit: "", keyframes: [{ frame: 0, value: "0.7", easing: "expo.inOut" }] }
        ]
      },
      {
        id: "placeholder-hide",
        label: "Placeholder Hide",
        startFrame: 72,
        endFrame: 72,
        easing: "linear",
        animatedProps: [
          { property: "hide", from: "", to: "", unit: "", programmatic: true }
        ]
      },
      {
        id: "typing-reveal",
        label: "Typing Reveal",
        startFrame: 73,
        endFrame: 122,
        easing: "linear",
        animatedProps: [
          { property: "charsVisible", from: "0", to: "1", unit: "", programmatic: true, description:
              "Characters appear one by one as if being typed" }
        ]
      },
      {
        id: "typed-text-hide",
        label: "Typed Text Hide",
        startFrame: 169,
        endFrame: 169,
        easing: "linear",
        animatedProps: [
          { property: "hide", from: "", to: "", unit: "", programmatic: true }
        ]
      },
      {
        id: "dropdown-show",
        label: "Dropdown Show",
        startFrame: 268,
        endFrame: 268,
        easing: "linear",
        animatedProps: [
          { property: "show", from: "", to: "", unit: "", programmatic: true }
        ]
      },
      {
        id: "dropdown-hide",
        label: "Dropdown Hide",
        startFrame: 344,
        endFrame: 344,
        easing: "linear",
        animatedProps: [
          { property: "hide", from: "", to: "", unit: "", programmatic: true }
        ]
      }
    ],
  },
  {
    id: "slack-showcase",
    title: "Slack Showcase",
    description: "Interactive Slack UI interface with cursor tracking",
    component: SlackShowcase,
    durationInFrames: 660,
    fps: 60,
    width: 1920,
    height: 1080,
    defaultProps: {
      
    } satisfies SlackShowcaseProps,
    tracks: [
      {
        id: "camera",
        label: "Camera",
        startFrame: 0,
        endFrame: 660,
        easing: "linear",
        animatedProps: [
          { property: "translateX", from: "0", to: "0", unit: "px", keyframes: [{ frame: 0, value: "0", easing: "expo.inOut" }, { frame: 68, value: "517", easing: "expo.inOut" }, { frame: 185, value: "517", easing: "expo.inOut" }, { frame: 251, value: "-1047", easing: "expo.inOut" }, { frame: 315, value: "-305", easing: "expo.inOut" }, { frame: 366, value: "-305", easing: "expo.inOut" }, { frame: 450, value: "-1048", easing: "expo.inOut" }] },
          { property: "translateY", from: "0", to: "0", unit: "px", keyframes: [{ frame: 0, value: "0", easing: "expo.inOut" }, { frame: 68, value: "-588", easing: "expo.inOut" }, { frame: 185, value: "-588", easing: "expo.inOut" }, { frame: 251, value: "-588", easing: "expo.inOut" }, { frame: 315, value: "-177", easing: "expo.inOut" }, { frame: 366, value: "-177", easing: "expo.inOut" }, { frame: 450, value: "136", easing: "expo.inOut" }] },
          { property: "scale", from: "1", to: "1", unit: "", keyframes: [{ frame: 0, value: "1", easing: "expo.inOut" }, { frame: 68, value: "2.079999999999998", easing: "expo.inOut" }, { frame: 185, value: "2.079999999999998", easing: "expo.inOut" }, { frame: 251, value: "2.079999999999998", easing: "expo.inOut" }, { frame: 315, value: "1.3149999999999988", easing: "expo.inOut" }, { frame: 366, value: "1.3149999999999988", easing: "expo.inOut" }, { frame: 450, value: "1.584999999999998", easing: "expo.inOut" }] },
          { property: "rotateX", from: "0", to: "0", unit: "deg", keyframes: [{ frame: 0, value: "0", easing: "expo.inOut" }, { frame: 68, value: "0", easing: "expo.inOut" }, { frame: 185, value: "0", easing: "expo.inOut" }, { frame: 251, value: "0", easing: "expo.inOut" }, { frame: 315, value: "0", easing: "expo.inOut" }, { frame: 366, value: "0", easing: "expo.inOut" }, { frame: 450, value: "0", easing: "expo.inOut" }] },
          { property: "rotateY", from: "0", to: "0", unit: "deg", keyframes: [{ frame: 0, value: "0", easing: "expo.inOut" }, { frame: 68, value: "0", easing: "expo.inOut" }, { frame: 185, value: "0", easing: "expo.inOut" }, { frame: 251, value: "0", easing: "expo.inOut" }, { frame: 315, value: "0", easing: "expo.inOut" }, { frame: 366, value: "0", easing: "expo.inOut" }, { frame: 450, value: "0", easing: "expo.inOut" }] },
          { property: "perspective", from: "800", to: "800", unit: "px", keyframes: [{ frame: 0, value: "800", easing: "expo.inOut" }, { frame: 68, value: "800", easing: "expo.inOut" }, { frame: 185, value: "800", easing: "expo.inOut" }, { frame: 251, value: "800", easing: "expo.inOut" }, { frame: 315, value: "800", easing: "expo.inOut" }, { frame: 366, value: "800", easing: "expo.inOut" }, { frame: 450, value: "800", easing: "expo.inOut" }] }
        ]
      },
      {
        id: "cursor",
        label: "Cursor",
        startFrame: 0,
        endFrame: 600,
        easing: "expo.inOut",
        animatedProps: [
          { property: "x", from: "960", to: "960", unit: "px", keyframes: [{ frame: 0, value: "1436.3200785851604", easing: "expo.inOut" }, { frame: 71, value: "748.3619634019143", easing: "expo.inOut" }, { frame: 102, value: "748.3619634019143", easing: "expo.inOut" }, { frame: 219, value: "1779.0647666806526", easing: "expo.inOut" }, { frame: 230, value: "1826.1471943056174", easing: "expo.inOut" }, { frame: 260, value: "1835.2088133148804", easing: "expo.inOut" }, { frame: 313, value: "482.66986495188735", easing: "expo.inOut" }, { frame: 350, value: "697.0339617771806", easing: "expo.inOut" }, { frame: 380, value: "688.0478272762598", easing: "expo.inOut" }, { frame: 441, value: "688.0478272762598", easing: "expo.inOut" }, { frame: 496, value: "1553.178717328616", easing: "expo.inOut" }, { frame: 526, value: "1553.178717328616", easing: "expo.inOut" }] },
          { property: "y", from: "540", to: "540", unit: "px", keyframes: [{ frame: 0, value: "792.4981178163858", easing: "expo.inOut" }, { frame: 71, value: "967.786075931569", easing: "expo.inOut" }, { frame: 102, value: "967.786075931569", easing: "expo.inOut" }, { frame: 219, value: "1030.4076230943665", easing: "expo.inOut" }, { frame: 230, value: "1036.5141474600532", easing: "expo.inOut" }, { frame: 260, value: "1026.5463665498637", easing: "expo.inOut" }, { frame: 313, value: "899.6587155779296", easing: "expo.inOut" }, { frame: 350, value: "903.8808771243197", easing: "expo.inOut" }, { frame: 380, value: "901.8174895441344", easing: "expo.inOut" }, { frame: 441, value: "901.8174895441344", easing: "expo.inOut" }, { frame: 496, value: "697.7187631017875", easing: "expo.inOut" }, { frame: 526, value: "697.7187631017875", easing: "expo.inOut" }] },
          { property: "opacity", from: "1", to: "1", unit: "", keyframes: [{ frame: 0, value: "0", easing: "expo.inOut" }, { frame: 82, value: "1", easing: "expo.inOut" }, { frame: 102, value: "0", easing: "expo.inOut" }, { frame: 194, value: "0", easing: "expo.inOut" }, { frame: 230, value: "0", easing: "expo.inOut" }, { frame: 242, value: "1", easing: "expo.inOut" }, { frame: 260, value: "1", easing: "expo.inOut" }, { frame: 276, value: "0", easing: "expo.inOut" }, { frame: 308, value: "0", easing: "expo.inOut" }, { frame: 333, value: "1", easing: "expo.inOut" }] },
          { property: "type", from: "default", to: "default", unit: "", keyframes: [{ frame: 0, value: "default" }, { frame: 219, value: "pointer" }, { frame: 281, value: "default" }] },
          { property: "isClicking", from: "0", to: "0", unit: "", keyframes: [{ frame: 82, value: "1" }, { frame: 253, value: "1" }, { frame: 366, value: "1" }, { frame: 511, value: "1" }] }
        ]
      },
      {
        id: "slack-entrance",
        label: "Slack Entrance",
        startFrame: 0,
        endFrame: 1,
        easing: "linear",
        animatedProps: [
          { property: "opacity", from: "1", to: "1", unit: "" },
          { property: "translateY", from: "0", to: "0", unit: "px" },
          { property: "scale", from: "1", to: "1", unit: "" }
        ]
      },
      {
        id: "typing",
        label: "Typing Animation",
        startFrame: 90,
        endFrame: 186,
        easing: "linear",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "mention-autocomplete",
        label: "Mention Autocomplete",
        startFrame: 95,
        endFrame: 210,
        easing: "power2.out",
        animatedProps: [
          { property: "opacity", from: "0", to: "1", unit: "", keyframes: [{ frame: 180, value: "0" }, { frame: 200, value: "1" }, { frame: 220, value: "1" }, { frame: 230, value: "0" }] }
        ]
      },
      {
        id: "thread-panel",
        label: "Thread Panel",
        startFrame: 375,
        endFrame: 435,
        easing: "expo.inOut",
        animatedProps: [
          { property: "slideProgress", from: "0", to: "1", unit: "" }
        ]
      }
    ],
  },
  {
    id: "jira-interactive",
    title: "Jira Interactive",
    description: "Interactive showcase of Jira task management interface with cursor animations",
    component: JiraInteractive,
    durationInFrames: 450,
    fps: 30,
    width: 1920,
    height: 1080,
    defaultProps: {
      
    } satisfies JiraInteractiveProps,
    tracks: [
      {
        id: "cursor",
        label: "Cursor Movement",
        startFrame: 0,
        endFrame: 450,
        easing: "linear",
        animatedProps: [
          { property: "x", from: "200", to: "750", unit: "px", keyframes: [{ frame: 0, value: "1748.3797392281697", easing: "expo.inOut" }, { frame: 29, value: "1818.1004036759186", easing: "expo.inOut" }, { frame: 93, value: "1818.1004036759186", easing: "expo.inOut" }, { frame: 138, value: "681.1172603741643", easing: "expo.inOut" }, { frame: 162, value: "681.1172603741643", easing: "expo.inOut" }, { frame: 209, value: "488.0446511342436", easing: "expo.inOut" }, { frame: 239, value: "488.0446511342436", easing: "expo.inOut" }, { frame: 267, value: "227.93294146379515", easing: "expo.inOut" }, { frame: 297, value: "227.93294146379515", easing: "expo.inOut" }, { frame: 360, value: "1008.2680704751408", easing: "expo.inOut" }] },
          { property: "y", from: "200", to: "680", unit: "px", keyframes: [{ frame: 0, value: "232.43414916701084", easing: "expo.inOut" }, { frame: 29, value: "438.914578493037", easing: "expo.inOut" }, { frame: 93, value: "438.914578493037", easing: "expo.inOut" }, { frame: 138, value: "643.8626913688539", easing: "expo.inOut" }, { frame: 162, value: "643.8626913688539", easing: "expo.inOut" }, { frame: 209, value: "794.0302763332365", easing: "expo.inOut" }, { frame: 239, value: "794.0302763332365", easing: "expo.inOut" }, { frame: 267, value: "818.1643524882267", easing: "expo.inOut" }, { frame: 297, value: "818.1643524882267", easing: "expo.inOut" }, { frame: 360, value: "618.5793676468519", easing: "expo.inOut" }] },
          { property: "opacity", from: "1", to: "1", unit: "" },
          { property: "isClicking", from: "0", to: "0", unit: "", keyframes: [{ frame: 35, value: "1" }, { frame: 274, value: "1" }] },
          { property: "type", from: "default", to: "default", unit: "", keyframes: [{ frame: 19, value: "pointer", easing: "linear" }, { frame: 111, value: "default", easing: "linear" }, { frame: 253, value: "pointer", easing: "linear" }] },
          { property: "scale", from: "1", to: "1", unit: "" }
        ]
      },
      {
        id: "assignee-dropdown",
        label: "Assignee Dropdown",
        startFrame: 35,
        endFrame: 50,
        easing: "expo.out",
        animatedProps: [
          { property: "opacity", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "assignee-typing",
        label: "Type 'Buil'",
        startFrame: 55,
        endFrame: 68,
        easing: "linear",
        animatedProps: [
          { property: "chars", from: "0", to: "4", unit: "" }
        ]
      },
      {
        id: "assignee-select",
        label: "Select Builder.io Bot",
        startFrame: 70,
        endFrame: 85,
        easing: "expo.out",
        animatedProps: [
          { property: "selected", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "first-comment",
        label: "First Comment Appears",
        startFrame: 150,
        endFrame: 180,
        easing: "linear",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "second-comment",
        label: "Second Comment Appears",
        startFrame: 210,
        endFrame: 240,
        easing: "linear",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      }
    ],
  },
  {
    id: "branches-screen",
    title: "Branches Screen",
    description: "Branches Kanban board view with project prompt",
    component: BranchesScreen,
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
    defaultProps: {} satisfies BranchesScreenProps,
    tracks: [],
  },
  {
    id: "branches-layout",
    title: "Branches Layout",
    description: "Complete Branches Kanban interface with sidebar and project prompt",
    component: BranchesLayout,
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
    defaultProps: {
      
    } satisfies BranchesLayoutProps,
    tracks: [
      
    ],
  },
  {
    id: "standard-view",
    title: "Standard View",
    description: "Standard workspace layout with sidebar, agent panel, and app preview",
    component: StandardView,
    durationInFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
    defaultProps: {
      
    } satisfies StandardViewProps,
    tracks: [
      
    ],
  },
  {
    id: "sixty-second-blank",
    title: "60 Second Blank",
    description: "60-second composition - Announcing Builder 2.0 with cursor typing animation",
    component: SixtySecondBlank,
    durationInFrames: 1800,
    fps: 30,
    width: 1920,
    height: 1080,
    defaultProps: {
      backgroundColor: "#000000"
    } satisfies SixtySecondBlankProps,
    tracks: [
      {
        id: "camera",
        label: "Camera",
        startFrame: 0,
        endFrame: 1800,
        easing: "linear",
        animatedProps: [
          { property: "translateX", from: "0", to: "0", unit: "px", keyframes: [{ frame: 0, value: "400" }, { frame: 41, value: "400" }, { frame: 81, value: "100", easing: "power4.inOut" }, { frame: 88, value: "100", easing: "expo.inOut" }, { frame: 107, value: "-259", easing: "power4.inOut" }, { frame: 112, value: "-344", easing: "expo.inOut" }, { frame: 113, value: "0", easing: "expo.inOut" }, { frame: 174, value: "0", easing: "expo.inOut" }, { frame: 222, value: "461", easing: "expo.inOut" }, { frame: 274, value: "461", easing: "expo.inOut" }, { frame: 327, value: "469", easing: "expo.inOut" }, { frame: 335, value: "469", easing: "expo.inOut" }, { frame: 336, value: "0", easing: "expo.inOut" }, { frame: 393, value: "0", easing: "expo.inOut" }, { frame: 394, value: "-935", easing: "expo.inOut" }, { frame: 448, value: "-408", easing: "expo.inOut" }, { frame: 507, value: "755", easing: "expo.inOut" }, { frame: 601, value: "755", easing: "expo.inOut" }, { frame: 659, value: "-1148", easing: "expo.inOut" }, { frame: 718, value: "-1148", easing: "expo.inOut" }, { frame: 720, value: "0", easing: "expo.inOut" }] },
          { property: "translateY", from: "0", to: "0", unit: "px", keyframes: [{ frame: 0, value: "0" }, { frame: 41, value: "0" }, { frame: 81, value: "0", easing: "power4.inOut" }, { frame: 88, value: "0", easing: "expo.inOut" }, { frame: 107, value: "0", easing: "power4.inOut" }, { frame: 112, value: "0", easing: "expo.inOut" }, { frame: 113, value: "0", easing: "expo.inOut" }, { frame: 174, value: "0", easing: "expo.inOut" }, { frame: 222, value: "269", easing: "expo.inOut" }, { frame: 274, value: "269", easing: "expo.inOut" }, { frame: 327, value: "54", easing: "expo.inOut" }, { frame: 335, value: "54", easing: "expo.inOut" }, { frame: 336, value: "0", easing: "expo.inOut" }, { frame: 393, value: "0", easing: "expo.inOut" }, { frame: 394, value: "540", easing: "expo.inOut" }, { frame: 448, value: "177", easing: "expo.inOut" }, { frame: 507, value: "-317", easing: "expo.inOut" }, { frame: 601, value: "-317", easing: "expo.inOut" }, { frame: 659, value: "424", easing: "expo.inOut" }, { frame: 718, value: "424", easing: "expo.inOut" }, { frame: 720, value: "0", easing: "expo.inOut" }] },
          { property: "scale", from: "1", to: "1", unit: "", keyframes: [{ frame: 0, value: "1" }, { frame: 41, value: "1" }, { frame: 81, value: "1", easing: "power4.inOut" }, { frame: 88, value: "1", easing: "expo.inOut" }, { frame: 107, value: "1", easing: "power4.inOut" }, { frame: 112, value: "1", easing: "expo.inOut" }, { frame: 113, value: "1", easing: "expo.inOut" }, { frame: 174, value: "1", easing: "expo.inOut" }, { frame: 222, value: "1.4750000000000032", easing: "expo.inOut" }, { frame: 274, value: "1.4949999999999952", easing: "expo.inOut" }, { frame: 327, value: "1.4949999999999952", easing: "expo.inOut" }, { frame: 335, value: "1.4949999999999952", easing: "expo.inOut" }, { frame: 336, value: "1", easing: "expo.inOut" }, { frame: 393, value: "1", easing: "expo.inOut" }, { frame: 394, value: "2.454999999999999", easing: "expo.inOut" }, { frame: 448, value: "1.5700000000000003", easing: "expo.inOut" }, { frame: 507, value: "1.9149999999999994", easing: "expo.inOut" }, { frame: 601, value: "1.9149999999999994", easing: "expo.inOut" }, { frame: 659, value: "1.9149999999999994", easing: "expo.inOut" }, { frame: 718, value: "1.9149999999999994", easing: "expo.inOut" }, { frame: 720, value: "1", easing: "expo.inOut" }] },
          { property: "rotateX", from: "0", to: "0", unit: "deg", keyframes: [{ frame: 0, value: "0" }, { frame: 41, value: "0" }, { frame: 81, value: "0", easing: "power4.inOut" }, { frame: 88, value: "0", easing: "expo.inOut" }, { frame: 107, value: "0", easing: "power4.inOut" }, { frame: 112, value: "0", easing: "expo.inOut" }, { frame: 113, value: "0", easing: "expo.inOut" }, { frame: 174, value: "0", easing: "expo.inOut" }, { frame: 222, value: "0", easing: "expo.inOut" }, { frame: 274, value: "0", easing: "expo.inOut" }, { frame: 327, value: "0", easing: "expo.inOut" }, { frame: 335, value: "0", easing: "expo.inOut" }, { frame: 336, value: "0", easing: "expo.inOut" }, { frame: 393, value: "0", easing: "expo.inOut" }, { frame: 394, value: "0", easing: "expo.inOut" }, { frame: 448, value: "0", easing: "expo.inOut" }, { frame: 507, value: "0", easing: "expo.inOut" }, { frame: 601, value: "0", easing: "expo.inOut" }, { frame: 659, value: "0", easing: "expo.inOut" }, { frame: 718, value: "0", easing: "expo.inOut" }, { frame: 720, value: "0", easing: "expo.inOut" }] },
          { property: "rotateY", from: "0", to: "0", unit: "deg", keyframes: [{ frame: 0, value: "0" }, { frame: 41, value: "0" }, { frame: 81, value: "0", easing: "power4.inOut" }, { frame: 88, value: "0", easing: "expo.inOut" }, { frame: 107, value: "0", easing: "power4.inOut" }, { frame: 112, value: "0", easing: "expo.inOut" }, { frame: 113, value: "0", easing: "expo.inOut" }, { frame: 174, value: "0", easing: "expo.inOut" }, { frame: 222, value: "0", easing: "expo.inOut" }, { frame: 274, value: "0", easing: "expo.inOut" }, { frame: 327, value: "0", easing: "expo.inOut" }, { frame: 335, value: "0", easing: "expo.inOut" }, { frame: 336, value: "0", easing: "expo.inOut" }, { frame: 393, value: "0", easing: "expo.inOut" }, { frame: 394, value: "0", easing: "expo.inOut" }, { frame: 448, value: "0", easing: "expo.inOut" }, { frame: 507, value: "0", easing: "expo.inOut" }, { frame: 601, value: "0", easing: "expo.inOut" }, { frame: 659, value: "0", easing: "expo.inOut" }, { frame: 718, value: "0", easing: "expo.inOut" }, { frame: 720, value: "0", easing: "expo.inOut" }] },
          { property: "perspective", from: "800", to: "800", unit: "px", keyframes: [{ frame: 0, value: "800" }, { frame: 41, value: "800" }, { frame: 81, value: "800", easing: "power4.inOut" }, { frame: 88, value: "800", easing: "expo.inOut" }, { frame: 107, value: "800", easing: "power4.inOut" }, { frame: 112, value: "800", easing: "expo.inOut" }, { frame: 113, value: "800", easing: "expo.inOut" }, { frame: 174, value: "800", easing: "expo.inOut" }, { frame: 222, value: "800", easing: "expo.inOut" }, { frame: 274, value: "800", easing: "expo.inOut" }, { frame: 327, value: "800", easing: "expo.inOut" }, { frame: 335, value: "800", easing: "expo.inOut" }, { frame: 336, value: "800", easing: "expo.inOut" }, { frame: 393, value: "800", easing: "expo.inOut" }, { frame: 394, value: "800", easing: "expo.inOut" }, { frame: 448, value: "800", easing: "expo.inOut" }, { frame: 507, value: "800", easing: "expo.inOut" }, { frame: 601, value: "800", easing: "expo.inOut" }, { frame: 659, value: "800", easing: "expo.inOut" }, { frame: 718, value: "800", easing: "expo.inOut" }, { frame: 720, value: "800", easing: "expo.inOut" }] }
        ]
      },
      {
        id: "cursor",
        label: "Cursor",
        startFrame: 0,
        endFrame: 1800,
        easing: "expo.inOut",
        animatedProps: [
          { property: "x", from: "960", to: "960", unit: "px", keyframes: [{ frame: 0, value: "979.6559214966458", easing: "expo.inOut" }, { frame: 22, value: "845.8339319678502", easing: "expo.inOut" }, { frame: 27, value: "846", easing: "expo.inOut" }, { frame: 31, value: "846", easing: "expo.inOut" }, { frame: 152, value: "795.2488447098635", easing: "expo.inOut" }, { frame: 215, value: "548", easing: "expo.inOut" }, { frame: 222, value: "548", easing: "expo.inOut" }, { frame: 248, value: "548", easing: "expo.inOut" }, { frame: 469, value: "784.7445948826846", easing: "expo.inOut" }, { frame: 507, value: "340.35347562963045", easing: "expo.inOut" }, { frame: 626, value: "1733.6879936945086", easing: "expo.inOut" }, { frame: 676, value: "1605.7369869005288", easing: "expo.inOut" }, { frame: 697, value: "1605.7369869005288", easing: "expo.inOut" }, { frame: 718, value: "1686.02274139902", easing: "expo.inOut" }] },
          { property: "y", from: "540", to: "540", unit: "px", keyframes: [{ frame: 0, value: "448.0478560362811", easing: "expo.inOut" }, { frame: 22, value: "515.9012591776424", easing: "expo.inOut" }, { frame: 27, value: "516", easing: "expo.inOut" }, { frame: 31, value: "516", easing: "expo.inOut" }, { frame: 152, value: "650.5152494193464", easing: "expo.inOut" }, { frame: 215, value: "368", easing: "expo.inOut" }, { frame: 222, value: "368", easing: "expo.inOut" }, { frame: 248, value: "368", easing: "expo.inOut" }, { frame: 469, value: "721.4271437907222", easing: "expo.inOut" }, { frame: 507, value: "828.7759640833041", easing: "expo.inOut" }, { frame: 626, value: "186.9130192963505", easing: "expo.inOut" }, { frame: 676, value: "137.70109360635826", easing: "expo.inOut" }, { frame: 697, value: "137.70109360635826", easing: "expo.inOut" }, { frame: 718, value: "452.6574180223085", easing: "expo.inOut" }] },
          { property: "opacity", from: "1", to: "1", unit: "", keyframes: [{ frame: 0, value: "1", easing: "expo.inOut" }, { frame: 22, value: "1", easing: "expo.inOut" }, { frame: 31, value: "1", easing: "expo.inOut" }, { frame: 41, value: "0", easing: "expo.inOut" }, { frame: 169, value: "0", easing: "expo.inOut" }, { frame: 170, value: "1", easing: "expo.inOut" }, { frame: 248, value: "1", easing: "expo.inOut" }, { frame: 272, value: "0", easing: "expo.inOut" }, { frame: 469, value: "0", easing: "expo.inOut" }, { frame: 478, value: "0", easing: "expo.inOut" }, { frame: 507, value: "1", easing: "expo.inOut" }, { frame: 532, value: "0", easing: "expo.inOut" }, { frame: 602, value: "0", easing: "expo.inOut" }, { frame: 638, value: "1", easing: "expo.inOut" }, { frame: 697, value: "1", easing: "expo.inOut" }, { frame: 710, value: "1", easing: "expo.inOut" }, { frame: 717, value: "1", easing: "expo.inOut" }, { frame: 719, value: "0", easing: "expo.inOut" }] },
          { property: "scale", from: "1", to: "1", unit: "" },
          { property: "type", from: "default", to: "default", unit: "", keyframes: [{ frame: 13, value: "text", easing: "expo.inOut" }, { frame: 170, value: "default", easing: "expo.inOut" }, { frame: 197, value: "pointer", easing: "expo.inOut" }, { frame: 469, value: "default", easing: "expo.inOut" }, { frame: 478, value: "default", easing: "expo.inOut" }, { frame: 497, value: "text", easing: "expo.inOut" }, { frame: 507, value: "text", easing: "expo.inOut" }, { frame: 612, value: "default", easing: "expo.inOut" }, { frame: 628, value: "default", easing: "expo.inOut" }, { frame: 653, value: "pointer", easing: "expo.inOut" }, { frame: 704, value: "default", easing: "expo.inOut" }, { frame: 710, value: "pointer", easing: "expo.inOut" }] },
          { property: "isClicking", from: "0", to: "0", unit: "", keyframes: [{ frame: 27, value: "1" }, { frame: 222, value: "1" }, { frame: 511, value: "1" }, { frame: 683, value: "1" }] }
        ]
      },
      {
        id: "typing-reveal",
        label: "Typing Builder 2.0",
        startFrame: 35,
        endFrame: 67,
        easing: "linear",
        animatedProps: [
          { property: "charsVisible", from: "0", to: "1", unit: "", programmatic: true, description:
              "Characters appear one by one as if being typed" }
        ]
      },
      {
        id: "claude-cursor",
        label: "Claude Cursor",
        startFrame: 100,
        endFrame: 157,
        easing: "expo.inOut",
        animatedProps: [
          { property: "x", from: "-400", to: "90", unit: "px" },
          { property: "y", from: "1080", to: "10", unit: "px" },
          { property: "opacity", from: "1", to: "1", unit: "" }
        ]
      },
      {
        id: "codex-cursor",
        label: "Codex Cursor",
        startFrame: 109,
        endFrame: 166,
        easing: "expo.inOut",
        animatedProps: [
          { property: "x", from: "1720", to: "470", unit: "px" },
          { property: "y", from: "1080", to: "10", unit: "px" },
          { property: "opacity", from: "1", to: "1", unit: "" }
        ]
      },
      {
        id: "jira-sidebar",
        label: "Jira Sidebar",
        startFrame: 165,
        endFrame: 217,
        easing: "expo.inOut",
        animatedProps: [
          { property: "x", from: "-650", to: "0", unit: "px", keyframes: [{ frame: 175, value: "0", easing: "expo.inOut" }] },
          { property: "opacity", from: "1", to: "1", unit: "" }
        ]
      },
      {
        id: "works-text",
        label: "Works Text",
        startFrame: 249,
        endFrame: 272,
        easing: "expo.inOut",
        animatedProps: [
          { property: "y", from: "30", to: "0", unit: "px" },
          { property: "opacity", from: "0", to: "1", unit: "", keyframes: [{ frame: 241, value: "1", easing: "linear" }] }
        ]
      },
      {
        id: "where-you-text",
        label: "Where You Text",
        startFrame: 261,
        endFrame: 287,
        easing: "expo.inOut",
        animatedProps: [
          { property: "y", from: "30", to: "0", unit: "px" },
          { property: "opacity", from: "0", to: "1", unit: "", keyframes: [{ frame: 287, value: "1", easing: "linear" }] }
        ]
      },
      {
        id: "work-text",
        label: "Work Text",
        startFrame: 272,
        endFrame: 302,
        easing: "expo.inOut",
        animatedProps: [
          { property: "y", from: "30", to: "0", unit: "px" },
          { property: "opacity", from: "0", to: "1", unit: "", keyframes: [{ frame: 305, value: "1", easing: "linear" }] }
        ]
      },
      {
        id: "team-collab-typing",
        label: "Full Team Collaboration Typing",
        startFrame: 336,
        endFrame: 380,
        easing: "linear",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "second-avatar",
        label: "Second Avatar",
        startFrame: 350,
        endFrame: 365,
        easing: "spring",
        animatedProps: [
          { property: "x", from: "-75", to: "0", unit: "px" },
          { property: "opacity", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "third-avatar",
        label: "Third Avatar",
        startFrame: 370,
        endFrame: 385,
        easing: "spring",
        animatedProps: [
          { property: "x", from: "-75", to: "0", unit: "px" },
          { property: "opacity", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "fourth-avatar",
        label: "Fourth Avatar",
        startFrame: 375,
        endFrame: 390,
        easing: "spring",
        animatedProps: [
          { property: "x", from: "-75", to: "0", unit: "px" },
          { property: "opacity", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "alex-cursor-move",
        label: "Alex Cursor Move to Data",
        startFrame: 400,
        endFrame: 420,
        easing: "expo.inOut",
        animatedProps: [
          { property: "x", from: "20", to: "57", unit: "%" },
          { property: "y", from: "60", to: "32", unit: "%" }
        ]
      },
      {
        id: "alex-cursor-click",
        label: "Alex Cursor Click",
        startFrame: 419,
        endFrame: 424,
        easing: "linear",
        animatedProps: [
          { property: "scale", from: "1", to: "1", unit: "" }
        ]
      },
      {
        id: "data-click",
        label: "Data Click and Outline",
        startFrame: 420,
        endFrame: 425,
        easing: "linear",
        animatedProps: [
          { property: "outline", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "chart-transform",
        label: "List to Chart Transform",
        startFrame: 435,
        endFrame: 460,
        easing: "power2.inOut",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "ask-builder-typing",
        label: "Ask Builder Typing",
        startFrame: 518,
        endFrame: 558,
        easing: "linear",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "component-menu",
        label: "Component Menu Appear",
        startFrame: 525,
        endFrame: 530,
        easing: "power2.out",
        animatedProps: [
          { property: "opacity", from: "0", to: "1", unit: "" },
          { property: "y", from: "10", to: "0", unit: "px" }
        ]
      },
      {
        id: "menu-selection",
        label: "Menu Item Selection",
        startFrame: 540,
        endFrame: 545,
        easing: "power2.out",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "send-message",
        label: "Send Message Animation",
        startFrame: 576,
        endFrame: 581,
        easing: "power2.out",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "mention-hint",
        label: "Mention Hint Message",
        startFrame: 580,
        endFrame: 600,
        easing: "spring",
        animatedProps: [
          { property: "opacity", from: "0", to: "1", unit: "" },
          { property: "y", from: "20", to: "0", unit: "px" },
          { property: "scale", from: "0.8", to: "1", unit: "" }
        ]
      },
      {
        id: "cursor-fade-out",
        label: "Cursor Fade Out",
        startFrame: 500,
        endFrame: 515,
        easing: "linear",
        animatedProps: [
          { property: "opacity", from: "1", to: "0", unit: "" }
        ]
      },
      {
        id: "chart-dehighlight",
        label: "Chart De-highlight",
        startFrame: 500,
        endFrame: 500,
        easing: "linear",
        animatedProps: [
          { property: "highlight", from: "", to: "", unit: "", programmatic: true, description:
              "Removes green outline from chart at frame 500" }
        ]
      },
      {
        id: "review-pr-panel",
        label: "Review PR Panel",
        startFrame: 690,
        endFrame: 701,
        easing: "expo.inOut",
        animatedProps: [
          { property: "opacity", from: "0", to: "1", unit: "" },
          { property: "y", from: "-20", to: "0", unit: "px" },
          { property: "scale", from: "0.95", to: "1", unit: "" }
        ]
      },
      {
        id: "review-typing",
        label: "Get Your Changes Reviewed Typing",
        startFrame: 720,
        endFrame: 753,
        easing: "linear",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "fleet-typing",
        label: "Manage a Fleet of Agents Typing",
        startFrame: 1010,
        endFrame: 1064,
        easing: "linear",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "split-screen-1to2",
        label: "Split Screen 1 to 2",
        startFrame: 810,
        endFrame: 840,
        easing: "power2.inOut",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "split-screen-2to3",
        label: "Split Screen 2 to 3",
        startFrame: 880,
        endFrame: 910,
        easing: "power2.inOut",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "screen1-typing",
        label: "Screen 1 Typing",
        startFrame: 795,
        endFrame: 875,
        easing: "linear",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "screen2-typing",
        label: "Screen 2 Typing",
        startFrame: 825,
        endFrame: 920,
        easing: "linear",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "screen3-typing",
        label: "Screen 3 Typing",
        startFrame: 865,
        endFrame: 960,
        easing: "linear",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "collapse-to-kanban",
        label: "Collapse to Kanban Cards",
        startFrame: 970,
        endFrame: 1010,
        easing: "spring",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "kanban-cards-wave1",
        label: "Kanban Cards Wave 1",
        startFrame: 1020,
        endFrame: 1055,
        easing: "expo.out",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "kanban-cards-wave2",
        label: "Kanban Cards Wave 2",
        startFrame: 1040,
        endFrame: 1075,
        easing: "expo.out",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "kanban-cards-wave3",
        label: "Kanban Cards Wave 3",
        startFrame: 1060,
        endFrame: 1095,
        easing: "expo.out",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "works-anywhere-typing",
        label: "Works Anywhere Typing",
        startFrame: 1157,
        endFrame: 1179,
        easing: "linear",
        animatedProps: [
          { property: "progress", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "phone-slide-in",
        label: "Phone Slide In",
        startFrame: 1171,
        endFrame: 1199,
        easing: "expo.out",
        animatedProps: [
          { property: "x", from: "250", to: "0", unit: "px" },
          { property: "opacity", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "phone2-rotate",
        label: "Phone 2 Rotate In",
        startFrame: 810,
        endFrame: 840,
        easing: "expo.out",
        animatedProps: [
          { property: "rotate", from: "0", to: "-15", unit: "deg" },
          { property: "opacity", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "phone3-rotate",
        label: "Phone 3 Rotate In",
        startFrame: 820,
        endFrame: 850,
        easing: "expo.out",
        animatedProps: [
          { property: "rotate", from: "0", to: "-30", unit: "deg" },
          { property: "opacity", from: "0", to: "1", unit: "" }
        ]
      },
      {
        id: "send-pr-tap",
        label: "Send PR Tap Animation",
        startFrame: 1192,
        endFrame: 1210,
        easing: "power2.out",
        animatedProps: [
          { property: "scale", from: "0", to: "1", unit: "" },
          { property: "opacity", from: "0.6", to: "0", unit: "" }
        ]
      }
    ],
  },
];

// Re-export track helpers from standalone module (avoids circular imports)
export { createCameraTrack, createCursorTrack, createStandardTracks } from "./trackHelpers";

/**
 * Convert a title to a URL-friendly slug
 */
function titleToSlug(title: string): string {
  if (!title || !title.trim()) return "temp";

  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, "") // Remove leading/trailing hyphens
    .replace(/-+/g, "-") // Replace multiple hyphens with single
    || "temp"; // Fallback if result is empty
}

/**
 * Find the next available slug by appending -2, -3, etc.
 */
function getAvailableSlug(baseSlug: string): string {
  let slug = baseSlug;
  let counter = 2;

  while (compositions.some(c => c.id === slug)) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
}

/**
 * Create a new blank composition with camera and cursor tracks
 */
export function createBlankComposition(title: string): CompositionEntry {
  const baseSlug = titleToSlug(title);
  const id = getAvailableSlug(baseSlug);
  const durationInFrames = 240;

  return {
    id,
    title: title.trim() || "Untitled Composition",
    description: "Blank composition",
    component: BlankComposition,
    durationInFrames,
    fps: 30,
    width: 1920,
    height: 1080,
    defaultProps: {} satisfies BlankCompositionProps,
    tracks: createStandardTracks(durationInFrames),
  };
}

/**
 * Add a new composition to the registry
 */
export function addComposition(composition: CompositionEntry) {
  compositions.push(composition);
}
