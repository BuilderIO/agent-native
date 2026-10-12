// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import type { MotionAudioClip } from "@shared/motion-code";
import type {
  MotionNativeStyleInstance,
  MotionNativeStyleKey,
} from "@shared/motion-native-style";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  formatCurveAxisValue,
  formatMotionRulerTick,
  formatMotionTimeValue,
  getMotionDockPrimaryPresets,
  getMotionDockPrimaryStyles,
  motionZoomScale,
  motionTimelineContentWidth,
  MotionDock,
  AddTrackMenu,
  motionFieldKeyRequiresBlurGuard,
  parseMotionTimeValue,
  type MotionDockTrack,
} from "./MotionDock";

const CATALOG_MESSAGES = {
  designEditor: {
    motion: {
      dockLabel: "Motion dock",
      collapseDock: "Collapse motion dock",
      expandAllTracks: "Expand all tracks",
      collapseAllTracks: "Collapse all tracks",
      play: "Play",
      pause: "Pause",
      resetPlayhead: "Reset playhead",
      reset: "Reset",
      addKeyframeAtPlayhead: "Add keyframe at playhead",
      addKeyframeAtPlayheadForProperty:
        "Add keyframe at playhead ({{property}})",
      selectPropertyRowFirst: "Select a property row first",
      currentTimeMs: "Current time in ms",
      currentTimeSeconds: "Current time in seconds",
      currentTimeLabel: "Current time",
      duration: "Duration",
      durationMs: "Duration in ms",
      editAnimation: "Edit animation",
      type: "Type",
      startTimeMs: "Start time in ms",
      durationSeconds: "Duration in seconds",
      timeFormat: "Time format: {{unit}}",
      changeTimeFormat: "Change time format",
      milliseconds: "Milliseconds",
      seconds: "Seconds",
      timelineZoom: "Timeline zoom ({{percent}}%)",
      timelineZoomLevel: "Timeline zoom level",
      timelineScrubber: "Timeline scrubber",
      timelineDescription:
        "Keyframes timeline. {{tracks}} tracks, {{keyframes}} keyframes.",
      playbackMode: "Playback mode: {{mode}}",
      playbackModeButton: "Play {{mode}}",
      playback: "Playback: {{mode}}",
      loop: "Loop",
      once: "Once",
      pingPong: "Ping-pong",
      toggleAutoKeyframe: "Toggle auto-keyframing",
      addOrRemoveKeyframe: "Add or remove keyframe",
      previousKeyframe: "Previous keyframe",
      toggleAnimationVisibility: "Toggle animation visibility",
      toggleLayerVisibility: "Toggle layer visibility",
      textAnimation: { properties: { scale: "Scale" } },
      animationStyles: {
        hide: "Hide",
        show: "Show",
        removeAnimation: "Remove animation",
        easing: "Easing",
        easingPicker: {
          presets: "Presets",
          libraries: "Libraries",
          newVariable: "New variable",
          searchPlaceholder: "Search easing variables",
          variableSet: "Variable set",
          allLibraries: "All libraries",
          noVariables: "No variables",
          noResults: "No results",
        },
        easingPresets: {
          hold: "Hold",
          linear: "Linear",
          easeIn: "Ease in",
          easeOut: "Ease out",
          easeInOut: "Ease in and out",
          easeInBack: "Ease in back",
          easeOutBack: "Ease out back",
          easeInOutBack: "Ease in and out back",
          gentle: "Gentle",
          quick: "Quick",
          bouncy: "Bouncy",
          slow: "Slow",
        },
        path: "Path",
        text: "Text",
        position: "Position",
        scale: "Scale",
        rotation: "Rotation",
        size: "Size",
        opacity: "Opacity",
      },
      nativeTextStagger: { create: "Text Stagger" },
      autoKeyframe: "Auto-keyframe",
      savingMotion: "Saving motion",
      emptyStateAnimate: "Animate",
      emptyStatePickProperty: ". Pick a property to add the first track.",
      emptyStateNoSelection:
        "Select an element on the canvas, then add a track to animate it.",
      addMotion: "Add animation",
      tabLabel: "Motion",
      text: "Text",
      size: "Size",
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
  editPanel: {
    labels: {
      position: "Position",
      rotation: "Rotation",
      opacity: "Opacity",
      size: "Size",
    },
  },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function render(props: Partial<Parameters<typeof MotionDock>[0]>): string {
  return renderToStaticMarkup(
    <AgentNativeI18nProvider catalog={{ messages: CATALOG_MESSAGES }}>
      <TooltipProvider>
        {createElement(MotionDock, {
          tracks: [],
          durationMs: 2000,
          open: true,
          ...props,
        })}
      </TooltipProvider>
    </AgentNativeI18nProvider>,
  );
}

async function renderInteractive(
  props: Partial<Parameters<typeof MotionDock>[0]> = {},
) {
  await act(async () => {
    root.render(
      <AgentNativeI18nProvider
        persistPreference={false}
        initialLocale="en-US"
        initialPreference="en-US"
        catalog={{ messages: CATALOG_MESSAGES }}
      >
        <TooltipProvider>
          {createElement(MotionDock, {
            tracks: [],
            durationMs: 2000,
            open: true,
            ...props,
          })}
        </TooltipProvider>
      </AgentNativeI18nProvider>,
    );
  });
}

async function clickKeyframe(element: Element, shiftKey = false) {
  const pointerDown = new MouseEvent("pointerdown", {
    bubbles: true,
    button: 0,
    shiftKey,
  });
  Object.defineProperty(pointerDown, "pointerId", { value: 1 });
  const pointerUp = new MouseEvent("pointerup", {
    bubbles: true,
    button: 0,
    shiftKey,
  });
  Object.defineProperty(pointerUp, "pointerId", { value: 1 });
  await act(async () => {
    element.dispatchEvent(pointerDown);
    element.dispatchEvent(pointerUp);
  });
}

async function dispatchPointer(
  element: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  options: {
    clientX: number;
    clientY: number;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  },
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    ...options,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  await act(async () => {
    element.dispatchEvent(event);
  });
}

function setElementRect(
  element: Element,
  rect: { x: number; y: number; width: number; height: number },
) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    ...rect,
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => rect,
  } as DOMRect);
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

const sampleNativeStyle: MotionNativeStyleInstance = {
  type: "FIGMA",
  styleKey: "Position",
  nameKey: "designEditor.motion.animationStyles.position",
  duration: 0.5,
  timelineOffset: 0.2,
  targetNodeId: "hero",
  enabled: true,
  props: { delay: 0.1, direction: "left", extra: { preserved: true } },
};

const sampleAudioClip: MotionAudioClip = {
  id: "audio-clip",
  name: "intro.mp3",
  sourceUrl: "https://cdn.example/intro.mp3",
  timelineStartMs: 0,
  sourceTrimStartMs: 0,
  durationMs: 500,
  volume: 1,
  muted: false,
};

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
    expect(markup).toContain("absolute inset-x-0 bottom-0 z-[90]");
    expect(markup).toContain("translate-y-full");
    expect(markup).not.toContain("absolute inset-x-0 top-0 z-[90]");
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

    expect(markup).toContain('style="height:200px"');
    expect(markup).toContain("translate-y-0");
    expect(markup).not.toContain("translate-y-full");
  });

  it("aligns the track area after the Design navigation rail", () => {
    const markup = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(MotionDock, {
          tracks: [],
          durationMs: 1000,
          open: true,
          layerSidebarInset: 56,
        }),
      ),
    );
    const sidebarStyle = markup.match(
      /data-motion-layer-sidebar[^>]*style="([^"]+)"/,
    )?.[1];
    const timelineStart = markup.indexOf("data-motion-timeline-content");
    const timelineMarkup = markup.slice(
      timelineStart,
      markup.indexOf(">", timelineStart),
    );

    expect(sidebarStyle).toContain("width:297px");
    expect(sidebarStyle).toContain("padding-left:56px");
    expect(timelineMarkup).toContain("width:1433.3px");
    expect(timelineMarkup).toContain("margin-left:18px");
    expect(markup.indexOf("data-motion-ruler")).toBeLessThan(timelineStart);
  });
});

describe("MotionDock audio preview bridge", () => {
  it("loads persisted audio clips into the active canvas iframe", async () => {
    const postMessage = vi.fn();
    const iframe = {
      contentWindow: { postMessage },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLIFrameElement;
    const canvasIframeRef = { current: iframe };

    await renderInteractive({
      audioClips: [sampleAudioClip],
      canvasIframeRef,
    });

    expect(postMessage).toHaveBeenCalledWith(
      { type: "motion-audio-load", clips: [sampleAudioClip] },
      "*",
    );
    expect(iframe.addEventListener).toHaveBeenCalledWith(
      "load",
      expect.any(Function),
    );
  });
});

describe("Motion animation style menu", () => {
  async function renderMenu(
    isText: boolean,
    onCreateText = vi.fn(),
    onCreateStyle = vi.fn(),
    onCreateNativeStyle?: (styleKey: MotionNativeStyleKey) => void,
    isPath = false,
  ) {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          persistPreference={false}
          initialLocale="en-US"
          initialPreference="en-US"
          catalog={{ messages: CATALOG_MESSAGES }}
        >
          <TooltipProvider>
            {createElement(AddTrackMenu, {
              selectedTarget: {
                nodeId: isPath ? "path-1" : "heading",
                label: isPath ? "Path" : "Heading",
                isText,
                isPath,
              },
              onCreateTrack: vi.fn(),
              onCreateStyle,
              onCreateNativeStyle,
              onCreateText,
            })}
          </TooltipProvider>
        </AgentNativeI18nProvider>,
      );
    });
    return onCreateText;
  }

  async function openMenu(label: string) {
    const trigger = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
    expect(trigger).not.toBeNull();
    await act(async () =>
      trigger!.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      ),
    );
  }

  function menuItemLabels() {
    return Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).map((item) => item.textContent?.trim());
  }

  async function selectMenuItem(label: string) {
    const item = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((candidate) => candidate.textContent?.trim() === label);
    expect(item).toBeDefined();
    await act(async () => {
      item!.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      );
      item!.click();
    });
  }

  it("matches Figma's animation choices and order for text layers", async () => {
    await renderMenu(true);
    await openMenu("Add animation");

    const menuItems = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
    expect(menuItems.map((item) => item.textContent?.trim())).toEqual([
      "Position",
      "Scale",
      "Rotation",
      "Size",
      "Opacity",
    ]);
    expect(menuItems.every((item) => item.querySelector("svg"))).toBe(true);
    expect(
      Array.from(document.body.querySelectorAll(".sr-only")).some((element) =>
        element.textContent?.includes('Animate "Heading"'),
      ),
    ).toBe(true);
    expect(
      document.body.querySelector('[role="menu"]')?.classList.contains("w-32"),
    ).toBe(true);
  });

  it("creates a composite Size style through one style callback", async () => {
    const onCreateStyle = vi.fn();
    await renderMenu(false, vi.fn(), onCreateStyle);
    const trigger = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "Add animation");
    await act(async () =>
      trigger!.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      ),
    );
    const sizeItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.trim() === "Size");
    expect(sizeItem).toBeDefined();
    await act(async () => {
      sizeItem!.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      );
      sizeItem!.click();
    });

    expect(onCreateStyle).toHaveBeenCalledOnce();
    expect(onCreateStyle.mock.calls[0]?.[0]).toMatchObject({
      label: "Size",
      kind: "composite",
      preset: { property: "size", additionalProperties: ["width", "height"] },
    });
  });

  it("creates a first-party Position instance when the native adapter is provided", async () => {
    const onCreateNativeStyle = vi.fn();
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          persistPreference={false}
          initialLocale="en-US"
          initialPreference="en-US"
          catalog={{ messages: CATALOG_MESSAGES }}
        >
          <TooltipProvider>
            {createElement(AddTrackMenu, {
              selectedTarget: {
                nodeId: "rectangle",
                label: "Rectangle",
                isText: false,
              },
              onCreateNativeStyle,
              onCreateTrack: vi.fn(),
            })}
          </TooltipProvider>
        </AgentNativeI18nProvider>,
      );
    });
    const trigger = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "Add animation");
    await act(async () =>
      trigger!.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      ),
    );
    const positionItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.trim() === "Position");
    expect(positionItem).toBeDefined();
    expect(
      Array.from(
        document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).some((item) => item.textContent?.trim() === "Text Stagger"),
    ).toBe(false);
    await act(async () => {
      positionItem!.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      );
      positionItem!.click();
    });
    expect(onCreateNativeStyle).toHaveBeenCalledExactlyOnceWith("Position");
  });

  it("keeps native Text Stagger out of Add animation and exposes it in More Motion", async () => {
    const onCreateNativeStyle = vi.fn();
    await renderMenu(true, vi.fn(), vi.fn(), onCreateNativeStyle);
    await openMenu("Add animation");
    expect(menuItemLabels()).toEqual([
      "Position",
      "Scale",
      "Rotation",
      "Size",
      "Opacity",
    ]);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await openMenu("More Motion");
    expect(menuItemLabels()).toEqual(["Text", "Text Stagger"]);
    await selectMenuItem("Text Stagger");
    expect(onCreateNativeStyle).toHaveBeenCalledExactlyOnceWith("TextStagger");
  });

  it("offers Path trim only for SVG path targets", async () => {
    const onCreateNativeStyle = vi.fn();
    await renderMenu(false, vi.fn(), vi.fn(), onCreateNativeStyle, true);
    await openMenu("Add animation");
    expect(menuItemLabels()).toEqual([
      "Position",
      "Scale",
      "Rotation",
      "Size",
      "Opacity",
    ]);
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await openMenu("More Motion");
    expect(menuItemLabels()).toEqual(["Path"]);
    await selectMenuItem("Path");
    expect(onCreateNativeStyle).toHaveBeenCalledExactlyOnceWith("Path");
  });

  it("offers and creates Text animation only for text layers", async () => {
    const onCreateText = vi.fn();
    await renderMenu(true, onCreateText);
    await openMenu("Add animation");
    expect(menuItemLabels()).toEqual([
      "Position",
      "Scale",
      "Rotation",
      "Size",
      "Opacity",
    ]);
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await openMenu("More Motion");
    expect(menuItemLabels()).toEqual(["Text"]);
    await selectMenuItem("Text");
    expect(onCreateText).toHaveBeenCalledOnce();

    await renderMenu(false);
    expect(container.querySelector('button[aria-label="More Motion"]')).toBe(
      null,
    );
  });
});

describe("MotionDock toolbar layout", () => {
  it("uses the red playhead while auto-keyframing is enabled", async () => {
    await renderInteractive({ tracks: sampleTracks });
    const autoKeyframeToggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle auto-keyframing"]',
    )!;
    const playheads = Array.from(
      container.querySelectorAll<HTMLElement>("[data-motion-playhead]"),
    );
    expect(playheads).toHaveLength(2);
    expect(
      playheads.every(
        (playhead) => !playhead.hasAttribute("data-motion-auto-keyframe"),
      ),
    ).toBe(true);

    await act(async () => autoKeyframeToggle.click());

    expect(autoKeyframeToggle.getAttribute("aria-checked")).toBe("true");
    expect(
      playheads.every(
        (playhead) =>
          playhead.hasAttribute("data-motion-auto-keyframe") &&
          playhead.classList.contains("bg-destructive"),
      ),
    ).toBe(true);
  });

  it("keeps animation creation in the inspector and orders timeline controls", () => {
    const markup = render({ tracks: sampleTracks });
    expect(markup).toContain('aria-label="Play"');
    expect(markup).toContain('aria-label="Toggle auto-keyframing"');
    expect(markup).toContain('aria-label="Current time"');
    expect(markup).toContain('aria-label="Duration"');
    expect(markup).toContain('aria-label="Change time format"');
    expect(markup).toContain('aria-label="Play once"');
    expect(markup).not.toContain("Add animation");

    const order = [
      'aria-label="Play"',
      'aria-label="Toggle auto-keyframing"',
      'aria-label="Current time"',
      'aria-label="Duration"',
      'aria-label="Change time format"',
      'aria-label="Play once"',
    ].map((needle) => markup.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(markup.indexOf('aria-label="Timeline zoom level"')).toBeGreaterThan(
      markup.indexOf('aria-label="Play once"'),
    );
    expect(markup.indexOf('aria-label="Collapse motion dock"')).toBeGreaterThan(
      markup.indexOf('aria-label="Timeline zoom level"'),
    );
    expect(markup).toContain(
      'role="checkbox" aria-label="Toggle auto-keyframing" aria-checked="false"',
    );
  });

  it("reads the playback mode stamped in the tracks JSON", () => {
    const stamped: MotionDockTrack[] = [
      { ...sampleTracks[0], timelinePlaybackMode: "ping-pong" },
    ];
    expect(render({ tracks: stamped })).toContain(
      'aria-label="Play ping-pong"',
    );
    expect(render({ tracks: stamped, playbackMode: "loop" })).toContain(
      'aria-label="Play loop"',
    );
  });

  it("formats ruler labels with Figma units", () => {
    expect([0, 100, 900, 1000, 1500].map(formatMotionRulerTick)).toEqual([
      "0s",
      "100ms",
      "900ms",
      "1s",
      "1.5s",
    ]);
  });

  it("renders millisecond labels for visible sub-second ruler ticks", () => {
    const markup = render({ tracks: sampleTracks, durationMs: 2000 });
    expect(markup).toContain(">500ms</span>");
    expect(markup).toContain(">900ms</span>");
  });

  it("matches Figma's 100ms ruler spacing and labels at 62% zoom", () => {
    const markup = render({ durationMs: 1000 });
    const ticks = Array.from(
      markup.matchAll(
        /data-motion-ruler-tick-ms="(\d+)"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/g,
      ),
      ([, timeMs, label]) => ({ ms: Number(timeMs), label }),
    );

    expect(ticks).toEqual([
      { ms: 0, label: "0s" },
      { ms: 100, label: "100ms" },
      { ms: 200, label: "200ms" },
      { ms: 300, label: "300ms" },
      { ms: 400, label: "400ms" },
      { ms: 500, label: "500ms" },
      { ms: 600, label: "600ms" },
      { ms: 700, label: "700ms" },
      { ms: 800, label: "800ms" },
      { ms: 900, label: "900ms" },
    ]);
  });

  it("switches editable fields to seconds while ruler units stay compact", async () => {
    const onDurationChange = vi.fn();
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          persistPreference={false}
          initialLocale="en-US"
          initialPreference="en-US"
          catalog={{ messages: CATALOG_MESSAGES }}
        >
          <TooltipProvider>
            {createElement(MotionDock, {
              tracks: sampleTracks,
              durationMs: 2000,
              open: true,
              onDurationChange,
            })}
          </TooltipProvider>
        </AgentNativeI18nProvider>,
      );
    });

    const timeFormatButton = container.querySelector(
      'button[aria-label="Change time format"]',
    ) as HTMLButtonElement;
    await act(async () => {
      timeFormatButton.click();
    });

    expect(
      container.querySelector('input[aria-label="Current time"]'),
    ).not.toBeNull();
    expect(
      (
        container.querySelector(
          'input[aria-label="Duration"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("2");
    expect(
      container.querySelector("[data-motion-ruler]")?.textContent,
    ).toContain("500ms");
    expect(
      container.querySelector("[data-motion-ruler]")?.textContent,
    ).not.toContain("0.5s");
    expect(timeFormatButton.textContent).toBe("s");

    const durationInput = container.querySelector(
      'input[aria-label="Duration"]',
    ) as HTMLInputElement;
    const setInputValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    expect(setInputValue).toBeDefined();
    await act(async () => {
      durationInput.focus();
      setInputValue!.call(durationInput, "1.5");
      durationInput.dispatchEvent(new Event("input", { bubbles: true }));
      durationInput.blur();
    });
    expect(onDurationChange).toHaveBeenCalledWith(1500);
  });
});

describe("MotionDock selected animation settings", () => {
  it("edits the selected property's timing and easing on the source track", async () => {
    const onTracksChange = vi.fn();
    const tracks = sampleTracks.map((track) => ({
      ...track,
      keyframes: track.keyframes.map((keyframe, index) =>
        index === 0 ? { ...keyframe, ease: "linear" } : keyframe,
      ),
    }));
    await renderInteractive({
      tracks,
      durationMs: 2000,
      onTracksChange,
    });

    const settingsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit animation"]',
    );
    expect(settingsButton).not.toBeNull();
    await act(async () => {
      settingsButton!.dispatchEvent(
        new MouseEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      );
      settingsButton!.click();
    });

    expect(document.body.textContent).toContain("Type");
    expect(document.body.textContent).toContain("Position");
    const durationInput = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="Duration in ms"]',
    );
    expect(durationInput?.value).toBe("1000");
    const setInputValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    expect(setInputValue).toBeDefined();
    await act(async () => {
      durationInput!.focus();
      setInputValue!.call(durationInput, "800");
      durationInput!.dispatchEvent(new Event("input", { bubbles: true }));
      durationInput!.blur();
    });
    expect(onTracksChange).toHaveBeenCalledOnce();
    expect(onTracksChange.mock.lastCall?.[0][0]).toMatchObject({
      delayMs: 500,
      durationMs: 800,
    });

    const easingPicker = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Linear"]',
    );
    expect(easingPicker).not.toBeNull();
    await act(async () => easingPicker!.click());
    const bouncyPreset = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "Bouncy");
    expect(bouncyPreset).toBeDefined();
    await act(async () => bouncyPreset!.click());
    expect(onTracksChange).toHaveBeenCalledTimes(2);
    expect(onTracksChange.mock.lastCall?.[0][0]?.keyframes[0]?.ease).toBe(
      "spring(0.69)",
    );
  });
});

describe("MotionDock time units and Size preset", () => {
  it("opens at Figma's observed timeline zoom level", async () => {
    await renderInteractive();
    const zoom = container.querySelector(
      "[data-motion-timeline-zoom] [role=slider]",
    );
    expect(Number(zoom?.getAttribute("aria-valuenow"))).toBeCloseTo(0.62);
  });

  it("resizes the global timeline duration from its right-edge handle", async () => {
    const onDurationChange = vi.fn();
    await renderInteractive({ durationMs: 2000, onDurationChange });

    const handle = container.querySelector<HTMLButtonElement>(
      "[data-motion-timeline-duration-handle]",
    )!;
    expect(handle.getAttribute("role")).toBe("slider");
    expect(handle.getAttribute("aria-valuenow")).toBe("2000");
    expect(handle.getAttribute("aria-valuemin")).toBe("50");
    expect(handle.style.left).toBe("2866.6px");

    await dispatchPointer(handle, "pointerdown", {
      clientX: 400,
      clientY: 12,
    });
    await dispatchPointer(handle, "pointermove", {
      clientX: 500,
      clientY: 12,
    });
    await dispatchPointer(handle, "pointerup", {
      clientX: 500,
      clientY: 12,
    });

    expect(onDurationChange).toHaveBeenCalledExactlyOnceWith(2070);
  });

  it("supports keyboard duration adjustment and clamps to timeline limits", async () => {
    const onDurationChange = vi.fn();
    await renderInteractive({ durationMs: 2000, onDurationChange });
    const handle = container.querySelector<HTMLButtonElement>(
      "[data-motion-timeline-duration-handle]",
    )!;

    await act(async () => {
      handle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
      handle.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowLeft",
          shiftKey: true,
          bubbles: true,
        }),
      );
      handle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      );
      handle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      );
    });

    expect(onDurationChange.mock.calls).toEqual([
      [2010],
      [1000],
      [50],
      [120000],
    ]);
  });

  it("round-trips millisecond and second inputs without changing stored time", () => {
    expect(formatMotionTimeValue(1250, "ms")).toBe("1250");
    expect(formatMotionTimeValue(1250, "s")).toBe("1.25");
    expect(parseMotionTimeValue("1250", "ms")).toBe(1250);
    expect(parseMotionTimeValue("1.25", "s")).toBe(1250);
    expect(parseMotionTimeValue("invalid", "s")).toBeNull();
    expect(parseMotionTimeValue("", "s")).toBeNull();
  });

  it("exposes Size as a paired width and height animation preset", () => {
    const presets = getMotionDockPrimaryPresets((key) =>
      key === "designEditor.motion.size" ? "Size" : key,
    );
    expect(presets.map((preset) => preset.label)).toEqual([
      "Position",
      "Scale",
      "Rotation",
      "Size",
      "Opacity",
    ]);

    expect(presets.find((preset) => preset.label === "Size")).toMatchObject({
      property: "size",
      additionalProperties: ["width", "height"],
    });

    const styles = getMotionDockPrimaryStyles((key) =>
      key === "designEditor.motion.size" ? "Size" : key,
    );
    expect(styles.find((style) => style.label === "Size")).toMatchObject({
      kind: "composite",
      preset: { additionalProperties: ["width", "height"] },
    });
  });

  it("renders the ruler and keyframes inside one zoomable timeline surface", async () => {
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider
          persistPreference={false}
          initialLocale="en-US"
          initialPreference="en-US"
          catalog={{ messages: CATALOG_MESSAGES }}
        >
          <TooltipProvider>
            {createElement(MotionDock, {
              tracks: sampleTracks,
              durationMs: 2000,
              open: true,
            })}
          </TooltipProvider>
        </AgentNativeI18nProvider>,
      );
    });

    const timeline = container.querySelector(
      "[data-motion-timeline-content]",
    ) as HTMLDivElement;
    const keyframe = container.querySelector(
      '[aria-label="Keyframe at 1000ms"]',
    ) as SVGElement;
    const zoomControl = container.querySelector(
      "[data-motion-timeline-zoom]",
    ) as HTMLElement;
    const zoom = zoomControl.querySelector('[role="slider"]') as HTMLElement;

    expect(zoom.getAttribute("aria-label")).toBe("Timeline zoom level");
    expect(timeline.style.width).toBe("2866.6px");
    expect(timeline.style.marginLeft).toBe("18px");
    expect(container.querySelector("[data-motion-ruler]")).not.toBeNull();
    expect(timeline.querySelector("[data-motion-ruler]")).toBeNull();
    expect(timeline.querySelector("[data-motion-tracks]")).not.toBeNull();
    expect(keyframe.parentElement?.style.left).toBe("50%");

    zoom.focus();
    await act(async () => {
      zoom.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });

    expect(Number.parseFloat(timeline.style.width)).toBeCloseTo(
      2000 * Number((1.4333 * motionZoomScale(0.63)).toFixed(4)),
    );
    expect(keyframe.parentElement?.style.left).toBe("50%");
  });

  it("clamps the shared ruler and track surface width to the zoom range", () => {
    expect(motionTimelineContentWidth(1)).toBe("100%");
    expect(motionTimelineContentWidth(1.25)).toBe("125%");
    expect(motionTimelineContentWidth(12)).toBe("400%");
    expect(motionTimelineContentWidth(0.5)).toBe("100%");
  });

  it("matches Figma's duration-bounded scrubber and timeline guidance", () => {
    const markup = render({ tracks: sampleTracks, durationMs: 2000 });

    expect(markup).toContain(
      'aria-description="Keyframes timeline. 1 tracks, 3 keyframes."',
    );
    expect(markup).toContain('data-motion-scrubber="true" role="slider"');
    expect(markup).toContain('aria-orientation="horizontal"');
    expect(markup).toContain('aria-valuetext="0.000 seconds"');
    expect(markup).toContain('style="left:-4px;width:2910.6px"');
    expect(markup).toContain('aria-label="Motion dock"');
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
    expect(markup).toContain('aria-label="Segment easing: Bouncy"');
    expect(markup).toContain('aria-label="Segment easing: Linear"');
  });

  it("positions keyframe diamonds using the track's own span (ms tooltips)", () => {
    const markup = render({ tracks: sampleTracks });
    expect(markup).toContain('aria-label="Keyframe at 500ms"');
    expect(markup).toContain('aria-label="Keyframe at 1000ms"');
    expect(markup).toContain('aria-label="Keyframe at 1500ms"');
  });

  it("groups native styles under their target layer without keyframe diamonds", () => {
    const markup = render({
      nativeStyles: [sampleNativeStyle],
      layerLabels: new Map([["hero", "Hero"]]),
    });

    expect(markup).toContain('data-motion-native-style-row="Position"');
    expect(markup).toContain('data-motion-native-style-span="Position"');
    expect(markup).toContain('aria-label="Position animation span"');
    expect(markup).toContain('aria-valuetext="300ms – 800ms"');
    expect(markup).not.toContain("data-motion-keyframe");
  });

  it("shows native style visibility/removal actions and preserves source props", async () => {
    const onNativeStyleChange = vi.fn();
    const onNativeStyleRemove = vi.fn();
    await renderInteractive({
      nativeStyles: [sampleNativeStyle],
      onNativeStyleChange,
      onNativeStyleRemove,
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Hide Position"]')!
        .click();
    });
    expect(onNativeStyleChange).toHaveBeenCalledWith(
      { ...sampleNativeStyle, enabled: false },
      0,
    );
    expect(onNativeStyleChange.mock.lastCall?.[0].props).toEqual(
      sampleNativeStyle.props,
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Remove animation Position"]',
        )!
        .click();
    });
    expect(onNativeStyleRemove).toHaveBeenCalledWith(sampleNativeStyle, 0);
  });

  it("drags native style timing spans and renders Path as a runnable bar", async () => {
    const onNativeStyleSpanChange = vi.fn();
    const pathStyle: MotionNativeStyleInstance = {
      ...sampleNativeStyle,
      styleKey: "Path",
      nameKey: "designEditor.motion.animationStyles.path",
      targetNodeId: "path-layer",
    };
    await renderInteractive({
      nativeStyles: [sampleNativeStyle, pathStyle],
      layerLabels: new Map([
        ["hero", "Hero"],
        ["path-layer", "Path layer"],
      ]),
      onNativeStyleSpanChange,
    });

    const span = container.querySelector<HTMLElement>(
      '[data-motion-native-style-span="Position"]',
    )!;
    const row = span.closest("[data-motion-native-style-track-row]")!;
    setElementRect(row, { x: 0, y: 0, width: 2000, height: 24 });

    await dispatchPointer(span, "pointerdown", { clientX: 600, clientY: 12 });
    await dispatchPointer(span, "pointermove", { clientX: 700, clientY: 12 });
    await dispatchPointer(span, "pointerup", { clientX: 700, clientY: 12 });

    expect(onNativeStyleSpanChange).toHaveBeenLastCalledWith(
      sampleNativeStyle,
      0,
      { startMs: 400, durationMs: 500 },
    );
    expect(
      container.querySelector('[data-motion-native-style-span="Path"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-motion-native-style-row="Path"]'),
    ).not.toBeNull();
  });
});

describe("MotionDock keyframe selection and deletion", () => {
  it("cycles playback once, loop, ping-pong, then once like Figma", async () => {
    const onPlaybackModeChange = vi.fn();
    await renderInteractive({ tracks: sampleTracks, onPlaybackModeChange });

    const cycle = async (from: string, to: string) => {
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>(
            `button[aria-label="Play ${from}"]`,
          )!
          .click();
      });
      expect(onPlaybackModeChange).toHaveBeenLastCalledWith(to);
      expect(
        container.querySelector(`button[aria-label="Play ${to}"]`),
      ).not.toBeNull();
    };

    await cycle("once", "loop");
    await cycle("loop", "ping-pong");
    await cycle("ping-pong", "once");
  });

  it("matches Figma's layer visibility control and updates its checked state", async () => {
    const onToggleLayerHidden = vi.fn();
    await renderInteractive({ tracks: sampleTracks, onToggleLayerHidden });
    const visibility = container.querySelector<HTMLButtonElement>(
      '[aria-label="Toggle layer visibility"]',
    )!;

    expect(visibility.getAttribute("aria-checked")).toBe("true");
    await act(async () => visibility.click());
    expect(onToggleLayerHidden).toHaveBeenCalledWith("hero", true);

    await renderInteractive({
      tracks: sampleTracks,
      hiddenLayerIds: new Set(["hero"]),
      onToggleLayerHidden,
    });
    expect(
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Toggle layer visibility"]',
        )
        ?.getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("toggles the playhead keyframe and can hide an animation track", async () => {
    const onTracksChange = vi.fn();
    await renderInteractive({ tracks: sampleTracks, onTracksChange });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Add or remove keyframe"]',
        )!
        .click();
    });
    expect(onTracksChange.mock.lastCall?.[0][0]?.keyframes).toHaveLength(2);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Toggle animation visibility"]',
        )!
        .click();
    });
    expect(onTracksChange.mock.lastCall?.[0][0]?.enabled).toBe(false);
    await renderInteractive({
      tracks: onTracksChange.mock.lastCall?.[0] ?? sampleTracks,
      onTracksChange,
    });
    expect(
      container.querySelector(
        '[aria-label="Toggle animation visibility"][aria-checked="false"]',
      ),
    ).not.toBeNull();
  });

  it("jumps to the previous keyframe in the selected property row", async () => {
    const onPlayheadChange = vi.fn();
    await renderInteractive({
      tracks: sampleTracks,
      onPlayheadChange,
      playhead: 1,
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Previous keyframe"]',
        )!
        .click();
    });

    expect(onPlayheadChange).toHaveBeenCalledWith(0.75);
  });

  it("publishes playback and selected track/keyframe ids for the agent context", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const onLiveStateChange = vi.fn();
    await renderInteractive({ tracks: sampleTracks, onLiveStateChange });

    const keyframe = container.querySelector<SVGElement>(
      '[aria-label="Keyframe at 500ms"]',
    )!;
    await clickKeyframe(keyframe);
    expect(onLiveStateChange).toHaveBeenLastCalledWith({
      previewing: false,
      selectedTrackId: "hero\u001ftranslate",
      selectedKeyframeIds: [JSON.stringify(["hero\u001ftranslate", 0])],
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Play"]')!
        .click();
    });
    expect(
      container.querySelector('button[aria-label="Pause"]'),
    ).not.toBeNull();
    expect(onLiveStateChange).toHaveBeenLastCalledWith({
      previewing: true,
      selectedTrackId: "hero\u001ftranslate",
      selectedKeyframeIds: [JSON.stringify(["hero\u001ftranslate", 0])],
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Pause"]')!
        .click();
    });
    expect(onLiveStateChange).toHaveBeenLastCalledWith({
      previewing: false,
      selectedTrackId: "hero\u001ftranslate",
      selectedKeyframeIds: [JSON.stringify(["hero\u001ftranslate", 0])],
    });
  });

  it("uses the latest playback mode in an active animation frame", async () => {
    let nextFrameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });

    await renderInteractive({ playbackMode: "loop" });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Play"]')!
        .click();
    });
    const [frameId, frame] = frames.entries().next().value!;

    await renderInteractive({ playbackMode: "ping-pong" });
    frames.delete(frameId);
    await act(async () => frame(2500));

    expect(
      container
        .querySelector("[data-motion-scrubber]")
        ?.getAttribute("aria-valuenow"),
    ).toBe("1500000");
  });

  it("stops playback when the dock closes", async () => {
    let nextFrameId = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const cancelAnimationFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((id) => {
        frames.delete(id);
      });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = ++nextFrameId;
      frames.set(id, callback);
      return id;
    });
    const onLiveStateChange = vi.fn();

    await renderInteractive({ playbackMode: "loop", onLiveStateChange });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Play"]')!
        .click();
    });
    const [frameId] = frames.keys();

    await renderInteractive({
      playbackMode: "loop",
      onLiveStateChange,
      open: false,
    });

    expect(cancelAnimationFrame).toHaveBeenCalledWith(frameId);
    expect(frames.size).toBe(0);
    expect(onLiveStateChange.mock.lastCall?.[0].previewing).toBe(false);
  });

  it("disables previous-keyframe navigation before the first keyframe", async () => {
    await renderInteractive({ tracks: sampleTracks, playhead: 0 });

    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Previous keyframe"]',
      )?.disabled,
    ).toBe(true);
  });

  it("double-clicks an empty track row to insert a keyframe at that time", async () => {
    const onTracksChange = vi.fn();
    const onPlayheadChange = vi.fn();
    await renderInteractive({
      tracks: sampleTracks,
      onTracksChange,
      onPlayheadChange,
    });
    const row = container.querySelector<HTMLElement>(
      "[data-motion-track-row]",
    )!;
    setElementRect(row, { x: 100, y: 100, width: 2000, height: 24 });

    await act(async () => {
      row.dispatchEvent(
        new MouseEvent("dblclick", {
          bubbles: true,
          clientX: 1350,
        }),
      );
    });

    expect(onPlayheadChange).toHaveBeenCalledWith(0.625);
    expect(onTracksChange.mock.lastCall?.[0][0]?.keyframes).toHaveLength(4);
    expect(onTracksChange.mock.lastCall?.[0][0]?.keyframes).toContainEqual(
      expect.objectContaining({ t: 0.75, value: "0px 2px" }),
    );
  });

  it("double-clicks a keyframe to move the playhead to its timeline time", async () => {
    const onPlayheadChange = vi.fn();
    await renderInteractive({ tracks: sampleTracks, onPlayheadChange });
    const keyframe = container.querySelector(
      '[aria-label="Keyframe at 1000ms"]',
    )!;

    await act(async () => {
      keyframe.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(onPlayheadChange).toHaveBeenCalledWith(0.5);
    expect(
      (
        container.querySelector(
          'input[aria-label="Current time"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("1000");
  });

  it("collapses and expands all layer groups without collapsing the dock", async () => {
    const tracks = [
      ...sampleTracks,
      { ...sampleTracks[0]!, targetNodeId: "footer", label: "Footer" },
    ];
    await renderInteractive({ tracks });

    const groups = () =>
      Array.from(container.querySelectorAll("[data-motion-layer-group]"));
    expect(
      groups().map((group) => group.getAttribute("aria-expanded")),
    ).toEqual(["true", "true"]);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Collapse all tracks"]',
        )!
        .click();
    });
    expect(
      groups().map((group) => group.getAttribute("aria-expanded")),
    ).toEqual(["false", "false"]);
    expect(
      container.querySelector('button[aria-label="Expand all tracks"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Motion dock"]'),
    ).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Expand all tracks"]',
        )!
        .click();
    });
    expect(
      groups().map((group) => group.getAttribute("aria-expanded")),
    ).toEqual(["true", "true"]);
  });

  it("selects every keyframe on a layer from its layer row", async () => {
    const tracks = [
      ...sampleTracks,
      {
        targetNodeId: "hero",
        property: "opacity",
        label: "Hero",
        keyframes: [
          { t: 0, value: "0" },
          { t: 1, value: "1" },
        ],
      },
    ];
    await renderInteractive({ tracks });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("[data-motion-select-layer]")!
        .click();
    });

    const keyframes = Array.from(
      container.querySelectorAll<SVGElement>('[aria-label^="Keyframe at "]'),
    );
    expect(keyframes).toHaveLength(5);
    expect(
      keyframes.map((keyframe) => keyframe.getAttribute("aria-pressed")),
    ).toEqual(["true", "true", "true", "true", "true"]);
  });

  it("keeps groups collapsed when existing tracks change", async () => {
    await renderInteractive({ tracks: sampleTracks });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Collapse all tracks"]',
        )!
        .click();
    });

    await renderInteractive({
      tracks: [
        {
          ...sampleTracks[0]!,
          keyframes: [
            ...sampleTracks[0]!.keyframes,
            { t: 0.75, value: "0px 2px" },
          ],
        },
      ],
    });

    expect(
      container
        .querySelector("[data-motion-layer-group]")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("selects one keyframe and toggles additional keyframes with Shift-click", async () => {
    await renderInteractive({ tracks: sampleTracks });
    const keyframes = [
      container.querySelector('[aria-label="Keyframe at 500ms"]')!,
      container.querySelector('[aria-label="Keyframe at 1000ms"]')!,
      container.querySelector('[aria-label="Keyframe at 1500ms"]')!,
    ];

    await clickKeyframe(keyframes[0]!);
    expect(keyframes[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(keyframes[1]!.getAttribute("aria-pressed")).toBe("false");

    await clickKeyframe(keyframes[1]!, true);
    await clickKeyframe(keyframes[2]!, true);
    expect(
      keyframes.filter(
        (keyframe) => keyframe.getAttribute("aria-pressed") === "true",
      ),
    ).toHaveLength(3);

    await clickKeyframe(keyframes[1]!, true);
    expect(keyframes[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(keyframes[1]!.getAttribute("aria-pressed")).toBe("false");
    expect(keyframes[2]!.getAttribute("aria-pressed")).toBe("true");
  });

  it("uses outlined brand-accent diamonds for unselected keyframes", async () => {
    await renderInteractive({ tracks: sampleTracks });
    const keyframe = container.querySelector<SVGElement>(
      '[aria-label="Keyframe at 500ms"]',
    )!;
    const diamond = keyframe.querySelector("rect")!;

    expect(keyframe.getAttribute("aria-pressed")).toBe("false");
    expect(diamond.classList.contains("fill-background")).toBe(true);
    expect(diamond.classList.contains("stroke-primary")).toBe(true);

    await clickKeyframe(keyframe);

    expect(keyframe.getAttribute("aria-pressed")).toBe("true");
    expect(diamond.classList.contains("fill-primary")).toBe(true);
    expect(diamond.classList.contains("stroke-primary-foreground")).toBe(true);
  });

  it("adds a keyframe to the selection with Command or Control-click", async () => {
    await renderInteractive({ tracks: sampleTracks });
    const keyframes = [
      container.querySelector('[aria-label="Keyframe at 500ms"]')!,
      container.querySelector('[aria-label="Keyframe at 1000ms"]')!,
    ];

    await clickKeyframe(keyframes[0]!);
    await dispatchPointer(keyframes[1]!, "pointerdown", {
      clientX: 500,
      clientY: 48,
      ctrlKey: true,
    });
    await dispatchPointer(keyframes[1]!, "pointerup", {
      clientX: 500,
      clientY: 48,
      ctrlKey: true,
    });

    expect(
      keyframes.map((keyframe) => keyframe.getAttribute("aria-pressed")),
    ).toEqual(["true", "true"]);
  });

  it("selects keyframes with a marquee gesture", async () => {
    await renderInteractive({ tracks: sampleTracks });
    const trackArea = container.querySelector(
      "[data-motion-tracks]",
    ) as HTMLDivElement;
    const ruler = container.querySelector("[data-motion-ruler]")!;
    const markers = Array.from(
      container.querySelectorAll<HTMLElement>("[data-motion-keyframe]"),
    );
    setElementRect(trackArea, { x: 0, y: 0, width: 1000, height: 160 });
    setElementRect(ruler, { x: 0, y: 0, width: 1000, height: 24 });
    markers.forEach((marker, index) =>
      setElementRect(marker, {
        x: [245, 495, 745][index]!,
        y: 43,
        width: 10,
        height: 10,
      }),
    );

    await dispatchPointer(trackArea, "pointerdown", {
      clientX: 240,
      clientY: 40,
    });
    await dispatchPointer(trackArea, "pointermove", {
      clientX: 510,
      clientY: 56,
    });
    expect(container.querySelector("[data-motion-marquee]")).not.toBeNull();
    await dispatchPointer(trackArea, "pointerup", {
      clientX: 510,
      clientY: 56,
    });

    expect(
      Array.from(
        container.querySelectorAll<SVGElement>('[aria-label^="Keyframe at "]'),
      ).map((keyframe) => keyframe.getAttribute("aria-pressed")),
    ).toEqual(["true", "true", "false"]);
    expect(container.querySelector("[data-motion-marquee]")).toBeNull();
  });

  it("moves a selected group together and preserves timeline spacing", async () => {
    const onTracksChange = vi.fn();
    await renderInteractive({ tracks: sampleTracks, onTracksChange });
    await clickKeyframe(
      container.querySelector('[aria-label="Keyframe at 500ms"]')!,
    );
    await clickKeyframe(
      container.querySelector('[aria-label="Keyframe at 1000ms"]')!,
      true,
    );

    const ruler = container.querySelector("[data-motion-ruler]")!;
    const firstKeyframe = container.querySelector(
      '[aria-label="Keyframe at 500ms"]',
    )!;
    const row = firstKeyframe.closest("[data-motion-track-row]")!;
    setElementRect(ruler, { x: 0, y: 0, width: 1000, height: 48 });
    setElementRect(row, { x: 0, y: 32, width: 1000, height: 24 });

    await dispatchPointer(firstKeyframe, "pointerdown", {
      clientX: 250,
      clientY: 48,
    });
    await dispatchPointer(row, "pointermove", {
      clientX: 350,
      clientY: 48,
    });
    await dispatchPointer(row, "pointerup", {
      clientX: 350,
      clientY: 48,
    });

    const movedTracks = onTracksChange.mock.calls
      .map(([nextTracks]) => nextTracks as MotionDockTrack[])
      .find((nextTracks) => nextTracks[0]?.keyframes[0]?.t === 0.2);
    expect(movedTracks?.[0]?.keyframes.map((keyframe) => keyframe.t)).toEqual([
      0.2, 0.7, 1,
    ]);
    expect(
      movedTracks?.[0]?.keyframes[1]?.t! - movedTracks?.[0]?.keyframes[0]?.t!,
    ).toBeCloseTo(0.5);
  });

  it("snaps a moved keyframe to the playhead", async () => {
    const onTracksChange = vi.fn();
    await renderInteractive({
      tracks: sampleTracks,
      onTracksChange,
      playhead: 0.7,
    });
    const ruler = container.querySelector("[data-motion-ruler]")!;
    const keyframe = container.querySelector(
      '[aria-label="Keyframe at 1500ms"]',
    )!;
    const row = keyframe.closest("[data-motion-track-row]")!;
    setElementRect(ruler, { x: 0, y: 0, width: 1000, height: 48 });
    setElementRect(row, { x: 0, y: 32, width: 1000, height: 24 });

    await dispatchPointer(keyframe, "pointerdown", {
      clientX: 750,
      clientY: 48,
    });
    await dispatchPointer(row, "pointermove", {
      clientX: 701,
      clientY: 48,
      shiftKey: true,
    });
    await dispatchPointer(row, "pointerup", {
      clientX: 701,
      clientY: 48,
    });

    const snappedTracks = onTracksChange.mock.calls
      .map(([nextTracks]) => nextTracks as MotionDockTrack[])
      .find((nextTracks) => nextTracks[0]?.keyframes[2]?.t === 0.9);
    expect(snappedTracks?.[0]?.keyframes.map((keyframe) => keyframe.t)).toEqual(
      [0, 0.5, 0.9],
    );
  });

  it("leaves a moved keyframe at its requested time without Shift", async () => {
    const onTracksChange = vi.fn();
    await renderInteractive({
      tracks: sampleTracks,
      onTracksChange,
      playhead: 0.7,
    });
    const ruler = container.querySelector("[data-motion-ruler]")!;
    const keyframe = container.querySelector(
      '[aria-label="Keyframe at 1500ms"]',
    )!;
    const row = keyframe.closest("[data-motion-track-row]")!;
    setElementRect(ruler, { x: 0, y: 0, width: 1000, height: 48 });
    setElementRect(row, { x: 0, y: 32, width: 1000, height: 24 });

    await dispatchPointer(keyframe, "pointerdown", {
      clientX: 750,
      clientY: 48,
    });
    await dispatchPointer(row, "pointermove", {
      clientX: 706,
      clientY: 48,
    });
    await dispatchPointer(row, "pointerup", {
      clientX: 706,
      clientY: 48,
    });

    const movedTracks = onTracksChange.mock.calls
      .map(([nextTracks]) => nextTracks as MotionDockTrack[])
      .find((nextTracks) => nextTracks[0]?.keyframes[2]?.value === "0px 0px");
    expect(movedTracks?.[0]?.keyframes[2]?.t).toBeCloseTo(0.912);
  });

  it("snaps a moved keyframe to an unmoved keyframe on its own track with Shift", async () => {
    const onTracksChange = vi.fn();
    await renderInteractive({ tracks: sampleTracks, onTracksChange });
    const ruler = container.querySelector("[data-motion-ruler]")!;
    const keyframe = container.querySelector(
      '[aria-label="Keyframe at 500ms"]',
    )!;
    const row = keyframe.closest("[data-motion-track-row]")!;
    setElementRect(ruler, { x: 0, y: 0, width: 1000, height: 48 });
    setElementRect(row, { x: 0, y: 32, width: 1000, height: 24 });

    await dispatchPointer(keyframe, "pointerdown", {
      clientX: 250,
      clientY: 48,
    });
    await dispatchPointer(row, "pointermove", {
      clientX: 494,
      clientY: 48,
      shiftKey: true,
    });
    await dispatchPointer(row, "pointerup", {
      clientX: 494,
      clientY: 48,
      shiftKey: true,
    });

    const snappedTracks = onTracksChange.mock.calls
      .map(([nextTracks]) => nextTracks as MotionDockTrack[])
      .find((nextTracks) => nextTracks[0]?.keyframes[0]?.t === 0.5);
    expect(snappedTracks?.[0]?.keyframes.map((frame) => frame.t)).toEqual([
      0.5, 1,
    ]);
    expect(snappedTracks?.[0]?.keyframes[0]?.value).toBe("0px 16px");
  });

  it.each(["Delete", "Backspace"])(
    "%s removes selected keyframes while retaining their track",
    async (key) => {
      const onTracksChange = vi.fn();
      await renderInteractive({ tracks: sampleTracks, onTracksChange });
      const keyframe = container.querySelector(
        '[aria-label="Keyframe at 1000ms"]',
      ) as SVGElement;
      await clickKeyframe(keyframe);

      await act(async () => {
        keyframe.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        );
      });

      const nextTracks = onTracksChange.mock.lastCall?.[0];
      expect(nextTracks).toHaveLength(1);
      expect(nextTracks[0]).toMatchObject({
        targetNodeId: "hero",
        property: "translate",
      });
      expect(nextTracks[0].keyframes).toHaveLength(2);
    },
  );

  it.each(["Delete", "Backspace"])(
    "%s removes every keyframe from the selected property row",
    async (key) => {
      const onTracksChange = vi.fn();
      await renderInteractive({ tracks: sampleTracks, onTracksChange });
      const propertyRow = container.querySelector<HTMLElement>(
        '[data-motion-property-row="translate"]',
      )!;
      await act(async () => {
        propertyRow.click();
        propertyRow.focus();
        propertyRow.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        );
      });

      expect(onTracksChange.mock.lastCall?.[0]).toEqual([]);
    },
  );

  it("deletes all selected keyframes and removes the now-empty track", async () => {
    const onTracksChange = vi.fn();
    await renderInteractive({ tracks: sampleTracks, onTracksChange });
    for (const time of [500, 1000, 1500]) {
      const keyframe = container.querySelector(
        `[aria-label="Keyframe at ${time}ms"]`,
      )!;
      await clickKeyframe(keyframe, time !== 500);
    }

    const focusedKeyframe = container.querySelector(
      '[aria-label="Keyframe at 1500ms"]',
    ) as SVGElement;
    await act(async () => {
      focusedKeyframe.focus();
      focusedKeyframe.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
      );
    });

    expect(onTracksChange.mock.lastCall?.[0]).toEqual([]);
  });
});

describe("motionFieldKeyRequiresBlurGuard (Enter/Escape double-commit guard)", () => {
  it("requires the blur guard for Enter (the commit-then-blur key)", () => {
    expect(motionFieldKeyRequiresBlurGuard("Enter")).toBe(true);
  });

  it("requires the blur guard for Escape (the revert-then-blur key)", () => {
    expect(motionFieldKeyRequiresBlurGuard("Escape")).toBe(true);
  });

  it("does not guard keys that never trigger an explicit .blur() call", () => {
    expect(motionFieldKeyRequiresBlurGuard("Tab")).toBe(false);
    expect(motionFieldKeyRequiresBlurGuard("a")).toBe(false);
    expect(motionFieldKeyRequiresBlurGuard("ArrowLeft")).toBe(false);
  });
});

describe("formatCurveAxisValue (bezier control-point field display)", () => {
  it("rounds to 2 decimal places", () => {
    expect(formatCurveAxisValue(0.4234)).toBe("0.42");
    expect(formatCurveAxisValue(1.005)).toBe("1");
  });

  it("formats whole numbers without a trailing decimal", () => {
    expect(formatCurveAxisValue(1)).toBe("1");
    expect(formatCurveAxisValue(0)).toBe("0");
  });

  it("preserves sign for overshoot (back-curve) control points", () => {
    expect(formatCurveAxisValue(-0.56)).toBe("-0.56");
    expect(formatCurveAxisValue(1.56)).toBe("1.56");
  });
});
