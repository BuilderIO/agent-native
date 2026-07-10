import { AgentNativeI18nProvider } from "@agent-native/core/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { MotionDock, type MotionDockTrack } from "./MotionDock";

// Minimal catalog covering only the keys MotionDock reads — see the same
// convention/rationale note in BreakpointBar.test.tsx. Full catalog coverage
// across all 11 locales is verified by `guard:i18n-catalogs`, not here.
const CATALOG_MESSAGES = {
  designEditor: {
    motion: {
      dockLabel: "Motion dock",
      collapseDock: "Collapse motion dock",
      play: "Play",
      pause: "Pause",
      resetPlayhead: "Reset playhead",
      reset: "Reset",
      addKeyframeAtPlayhead: "Add keyframe at playhead",
      addKeyframeAtPlayheadForProperty:
        "Add keyframe at playhead ({{property}})",
      selectPropertyRowFirst: "Select a property row first",
      currentTimeMs: "Current time in ms",
      duration: "Duration",
      durationMs: "Duration in ms",
      playbackMode: "Playback mode: {{mode}}",
      playback: "Playback: {{mode}}",
      loop: "Loop",
      once: "Once",
      pingPong: "Ping-pong",
      toggleAutoKeyframe: "Toggle auto-keyframe",
      autoKeyframe: "Auto-keyframe",
      savingMotion: "Saving motion",
      emptyStateAnimate: "Animate",
      emptyStatePickProperty: ". Pick a property to add the first track.",
      emptyStateNoSelection:
        "Select an element on the canvas, then add a track to animate it.",
      addMotion: "Add motion",
      selectElementFirst: "Select an element on the canvas first",
      animateLayer: 'Animate "{{label}}"',
      more: "More",
      addKeyframe: "Add keyframe",
      trackExists:
        'A "{{property}}" track already exists for {{label}}. Edit its keyframes in the timeline instead.',
      layerAnimationSpan: "{{label}} animation span",
      keyframeAt: "Keyframe at {{ms}}ms",
      deleteKeyframe: "Delete keyframe",
      segmentEasing: "Segment easing: {{ease}}",
      curveTab: "Curve",
      springTab: "Spring",
      customBezier: "Custom bezier",
      customSpring: "Custom spring",
      bounce: "Bounce",
      bezierCurveEditor: "Bezier curve editor",
      springCurvePreview: "Spring curve preview",
      defaultEase: "Default",
    },
  },
};

function render(props: Partial<Parameters<typeof MotionDock>[0]>): string {
  return renderToStaticMarkup(
    createElement(AgentNativeI18nProvider, {
      catalog: { messages: CATALOG_MESSAGES },
      children: createElement(
        TooltipProvider,
        null,
        createElement(MotionDock, {
          tracks: [],
          durationMs: 2000,
          open: true,
          ...props,
        }),
      ),
    }),
  );
}

const sampleTracks: MotionDockTrack[] = [
  {
    targetNodeId: "hero",
    property: "translate",
    label: "Hero",
    delayMs: 500,
    durationMs: 1000,
    keyframes: [
      { t: 0, value: "0px 16px", ease: "spring(0.69)" },
      { t: 0.5, value: "0px 4px", ease: "linear" },
      { t: 1, value: "0px 0px" },
    ],
  },
];

describe("MotionDock layout", () => {
  it("frees canvas layout space immediately while the closed panel slides away", () => {
    const markup = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(MotionDock, {
          tracks: [],
          durationMs: 1000,
          open: false,
        }),
      ),
    );

    expect(markup).toContain('style="height:0"');
    expect(markup).toContain("absolute inset-x-0 bottom-0 z-40");
    expect(markup).toContain("translate-y-full");
    expect(markup).not.toContain("absolute inset-x-0 top-0 z-40");
  });

  it("reserves dock layout space only while open", () => {
    const markup = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(MotionDock, {
          tracks: [],
          durationMs: 1000,
          open: true,
        }),
      ),
    );

    expect(markup).toContain('style="height:280px"');
    expect(markup).toContain("translate-y-0");
    expect(markup).not.toContain("translate-y-full");
  });
});

describe("MotionDock — Figma Motion toolbar anatomy", () => {
  it("renders play, add-keyframe ◆, current time, duration, playback mode, and Add motion", () => {
    const markup = render({ tracks: sampleTracks });
    expect(markup).toContain('aria-label="Play"');
    expect(markup).toContain('aria-label="Add keyframe at playhead"');
    expect(markup).toContain('aria-label="Current time in ms"');
    expect(markup).toContain('aria-label="Duration in ms"');
    expect(markup).toContain('aria-label="Playback mode: Once"');
    expect(markup).toContain("Add motion");
    expect(markup).toContain('aria-label="Toggle auto-keyframe"');
  });

  it("reads the playback mode stamped in the tracks JSON", () => {
    const stamped: MotionDockTrack[] = [
      { ...sampleTracks[0], timelinePlaybackMode: "ping-pong" },
    ];
    expect(render({ tracks: stamped })).toContain(
      'aria-label="Playback mode: Ping-pong"',
    );
    expect(render({ tracks: stamped, playbackMode: "loop" })).toContain(
      'aria-label="Playback mode: Loop"',
    );
  });

  it("renders a ms ruler with nice tick steps", () => {
    const markup = render({ tracks: sampleTracks, durationMs: 2000 });
    expect(markup).toContain("200ms");
    expect(markup).toContain("1s");
    expect(markup).toContain("2s");
  });
});

describe("MotionDock — timeline body anatomy", () => {
  it("renders the layer span bar for offset tracks", () => {
    const markup = render({ tracks: sampleTracks });
    expect(markup).toContain('aria-label="Hero animation span"');
    expect(markup).toContain("500ms – 1500ms");
  });

  it("renders clickable easing segments between keyframes", () => {
    const markup = render({ tracks: sampleTracks });
    // Two segments for three keyframes; the first carries the Bouncy spring.
    expect(markup).toContain('aria-label="Segment easing: Bouncy"');
    expect(markup).toContain('aria-label="Segment easing: Linear"');
  });

  it("positions keyframe diamonds using the track's own span (ms tooltips)", () => {
    const markup = render({ tracks: sampleTracks });
    expect(markup).toContain('aria-label="Keyframe at 500ms"');
    expect(markup).toContain('aria-label="Keyframe at 1000ms"');
    expect(markup).toContain('aria-label="Keyframe at 1500ms"');
  });
});
