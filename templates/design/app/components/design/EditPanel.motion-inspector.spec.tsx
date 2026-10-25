// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/uploads", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/uploads")
  >()),
  useFileUploadStatus: () => ({
    isSuccess: true,
    isError: false,
    data: { configured: true },
    refetch: vi.fn(),
  }),
}));

import { createMotionNativeStyleInstance } from "@shared/motion-native-style-runtime";
import type { MotionEase } from "@shared/motion-timeline";

import { TooltipProvider } from "@/components/ui/tooltip";

import { EditPanel } from "./EditPanel";
import type { ElementInfo } from "./types";

const selectedElement: ElementInfo = {
  tagName: "div",
  selector: ".box",
  classes: [],
  computedStyles: {
    display: "block",
    position: "absolute",
    left: "0px",
    top: "0px",
    width: "100px",
    height: "50px",
    scale: "1",
  },
  inlineStyles: { scale: "1" },
  boundingRect: { x: 0, y: 0, width: 100, height: 50 },
  isFlexChild: false,
  isFlexContainer: false,
  hasOwnText: true,
  childElementCount: 0,
  sourceId: "motion-node",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function MotionInspectorHarness({
  onToggle,
  motionInspector,
}: {
  onToggle: (property: string) => void;
  motionInspector: boolean;
}) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <EditPanel
          selectedElement={selectedElement}
          viewMode="single"
          mode="edit"
          motionInspector={motionInspector}
          motionKeyframeState={{
            hasTimeline: true,
            keyframedProperties: ["scale"],
          }}
          onToggleMotionKeyframe={onToggle}
          motionSelectedTarget={{ nodeId: "motion-node", label: "Box" }}
          onCreateMotionTrack={vi.fn()}
          onStyleChange={vi.fn()}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function SegmentEasingHarness({
  onEasingChange,
}: {
  onEasingChange: (ease: MotionEase) => void;
}) {
  const [ease, setEase] = useState<MotionEase>("cubic-bezier(0, 1, 1, 1)");
  return (
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <EditPanel
          selectedElement={null}
          viewMode="single"
          mode="edit"
          motionInspector
          motionEasingSegment={{
            trackId: "motion-track-1",
            targetNodeId: "motion-node",
            property: "opacity",
            label: "Box",
            isTextAnimation: false,
            fromT: 0,
            toT: 1,
            ease,
          }}
          onMotionEasingSegmentChange={(nextEase) => {
            setEase(nextEase);
            onEasingChange(nextEase);
          }}
          onStyleChange={vi.fn()}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

describe("EditPanel Motion inspector context", () => {
  it("returns from segment easing to the Motion inspector without editing the ease", async () => {
    const onMotionEasingSegmentBack = vi.fn();
    const onMotionEasingSegmentChange = vi.fn();
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <TooltipProvider>
            <EditPanel
              selectedElement={null}
              viewMode="single"
              mode="edit"
              motionInspector
              motionEasingSegment={{
                trackId: "motion-track-1",
                targetNodeId: "motion-node",
                property: "opacity",
                label: "Box",
                isTextAnimation: false,
                fromT: 0,
                toT: 1,
                ease: "linear",
              }}
              onMotionEasingSegmentBack={onMotionEasingSegmentBack}
              onMotionEasingSegmentChange={onMotionEasingSegmentChange}
              onStyleChange={vi.fn()}
            />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );

    const backButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="designEditor.responsiveInteract.back"]',
    );
    expect(backButton).not.toBeNull();
    await act(async () => backButton?.click());

    expect(onMotionEasingSegmentBack).toHaveBeenCalledTimes(1);
    expect(onMotionEasingSegmentChange).not.toHaveBeenCalled();
  });

  it("edits the selected timeline segment easing in the inspector without a canvas selection", async () => {
    const onMotionEasingSegmentChange = vi.fn();
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <TooltipProvider>
            <EditPanel
              selectedElement={null}
              viewMode="single"
              mode="edit"
              motionInspector
              motionEasingSegment={{
                trackId: "motion-track-1",
                targetNodeId: "motion-node",
                property: "opacity",
                label: "Box",
                isTextAnimation: false,
                fromT: 0,
                toT: 1,
                ease: "linear",
              }}
              onMotionEasingSegmentChange={onMotionEasingSegmentChange}
              onStyleChange={vi.fn()}
            />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );

    expect(
      container.querySelector(
        '[data-design-inspector-section] h3[aria-label="designEditor.motion.animationStyles.easing"]',
      ),
    ).not.toBeNull();
    expect(
      Array.from(
        container.querySelectorAll("[data-design-inspector-section-header] h3"),
      ).map((heading) => heading.getAttribute("aria-label")),
    ).toEqual([
      "designEditor.motion.animationStyles.easing",
      "designEditor.motion.audio",
    ]);
    const audioHeading = container.querySelector<HTMLElement>(
      '[data-design-inspector-section] h3[aria-label="designEditor.motion.audio"]',
    );
    expect(audioHeading?.classList.contains("ml-2")).toBe(true);
    expect(
      audioHeading
        ?.closest("[data-design-inspector-section]")
        ?.getAttribute("style"),
    ).toContain("--design-section-height: 24px");
    expect(
      container.querySelector(
        '[aria-label="designEditor.motion.emptyStateNoSelection"]',
      ),
    ).toBeNull();
    await act(async () =>
      document.body
        .querySelector<HTMLButtonElement>(
          'button[aria-label="designEditor.motion.animationStyles.easingPresets.linear"]',
        )!
        .click(),
    );
    await act(async () =>
      document.body
        .querySelector<HTMLButtonElement>(
          'button[aria-label="designEditor.motion.animationStyles.easingPresets.easeOut"]',
        )!
        .click(),
    );

    expect(onMotionEasingSegmentChange).toHaveBeenCalledWith(
      "cubic-bezier(0, 0, 0.58, 1)",
    );
  });

  it("switches easing modes without losing the selected segment curve", async () => {
    const onEasingChange = vi.fn();
    await act(async () =>
      root.render(<SegmentEasingHarness onEasingChange={onEasingChange} />),
    );

    const springTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((tab) => tab.textContent === "designEditor.motion.springTab");
    const curveTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ).find((tab) => tab.textContent === "designEditor.motion.curveTab");
    expect(curveTab).not.toBeUndefined();
    expect(springTab).not.toBeUndefined();

    await act(async () => {
      springTab?.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      );
    });
    expect(onEasingChange).toHaveBeenLastCalledWith("spring(0.25)");
    await act(async () => {
      curveTab?.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          ctrlKey: false,
        }),
      );
    });
    expect(onEasingChange).toHaveBeenLastCalledWith("cubic-bezier(0, 1, 1, 1)");
  });

  it("switches to the Motion inspector with no tab and reuses the property keyframe controls", async () => {
    const onToggle = vi.fn();
    await act(async () =>
      root.render(
        <MotionInspectorHarness onToggle={onToggle} motionInspector={false} />,
      ),
    );

    expect(container.querySelector("[data-design-inspector-tab]")).toBeNull();
    expect(container.querySelector("[data-interaction-state]")).not.toBeNull();

    await act(async () =>
      root.render(
        <MotionInspectorHarness onToggle={onToggle} motionInspector />,
      ),
    );

    expect(container.querySelector("[data-design-inspector-tab]")).toBeNull();
    expect(container.querySelector("[data-interaction-state]")).toBeNull();
    expect(
      container.querySelector(
        '[data-design-inspector-section] h3[aria-label="designEditor.motion.animations"]',
      ),
    ).not.toBeNull();

    const scaleKeyframe = container.querySelector<HTMLButtonElement>(
      'button[data-motion-css-property="scale"]',
    );
    expect(scaleKeyframe?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => scaleKeyframe?.click());
    expect(onToggle).toHaveBeenCalledWith("scale");
  });

  it("shows Fill between Appearance and Stroke in the Motion inspector", async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <TooltipProvider>
            <EditPanel
              selectedElement={selectedElement}
              viewMode="single"
              mode="edit"
              motionInspector
              motionSelectedTarget={{ nodeId: "motion-node", label: "Box" }}
              onStyleChange={vi.fn()}
            />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );

    const sectionLabels = Array.from(
      container.querySelectorAll<HTMLElement>(
        "[data-design-inspector-section] h3",
      ),
    ).map((heading) => heading.getAttribute("aria-label"));
    const appearanceIndex = sectionLabels.indexOf("root.commandAppearance");
    const fillIndex = sectionLabels.indexOf("editPanel.sections.fill");
    const strokeIndex = sectionLabels.indexOf("editPanel.sections.stroke");

    expect(appearanceIndex).toBeGreaterThanOrEqual(0);
    expect(fillIndex).toBeGreaterThan(appearanceIndex);
    expect(strokeIndex).toBeGreaterThan(fillIndex);
  });

  it("shows source-backed Audio after Effects in the Motion inspector", async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <TooltipProvider>
            <EditPanel
              selectedElement={selectedElement}
              viewMode="single"
              mode="edit"
              motionInspector
              motionSelectedTarget={{ nodeId: "motion-node", label: "Box" }}
              motionAudioClips={[]}
              onMotionAudioClipsChange={vi.fn()}
              onStyleChange={vi.fn()}
            />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );

    const sectionLabels = Array.from(
      container.querySelectorAll<HTMLElement>(
        "[data-design-inspector-section] h3",
      ),
    ).map((heading) => heading.getAttribute("aria-label"));
    const effectsIndex = sectionLabels.indexOf("editPanel.sections.effects");
    const audioIndex = sectionLabels.indexOf("designEditor.motion.audio");

    expect(effectsIndex).toBeGreaterThanOrEqual(0);
    expect(audioIndex).toBeGreaterThan(effectsIndex);
    expect(
      container.querySelector(
        'button[aria-label="designEditor.motion.addAudio"]',
      ),
    ).not.toBeNull();
  });

  it("shows gap keyframes for auto-layout frames in the Motion Layout section", async () => {
    const onToggle = vi.fn();
    const flexFrame: ElementInfo = {
      ...selectedElement,
      computedStyles: {
        ...selectedElement.computedStyles,
        display: "flex",
        flexDirection: "row",
        gap: "8px",
        paddingTop: "8px",
        paddingRight: "8px",
        paddingBottom: "8px",
        paddingLeft: "8px",
      },
      inlineStyles: { display: "flex", gap: "8px" },
      isFlexContainer: true,
      hasOwnText: false,
      childElementCount: 2,
    };
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <TooltipProvider>
            <EditPanel
              selectedElement={flexFrame}
              viewMode="single"
              mode="edit"
              motionInspector
              motionSelectedTarget={{ nodeId: "motion-node", label: "Box" }}
              motionKeyframeState={{
                hasTimeline: true,
                keyframedProperties: [],
              }}
              onToggleMotionKeyframe={onToggle}
              onStyleChange={vi.fn()}
            />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );

    const gapKeyframe = container.querySelector<HTMLButtonElement>(
      'button[data-motion-css-property="gap"]',
    );
    expect(gapKeyframe).not.toBeNull();
    await act(async () => gapKeyframe?.click());
    expect(onToggle).toHaveBeenCalledWith("gap");
  });

  it("keeps the Motion context read-only for viewers", async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <TooltipProvider>
            <EditPanel
              selectedElement={selectedElement}
              viewMode="single"
              mode="edit"
              readOnly
              motionInspector
              motionSelectedTarget={{ nodeId: "motion-node", label: "Box" }}
              onStyleChange={vi.fn()}
            />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );

    expect(
      container.querySelector(
        '[data-design-inspector-section] h3[aria-label="designEditor.motion.animations"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('button[data-motion-css-property="scale"]'),
    ).toBeNull();
  });

  it("does not infer a Motion target from styles when nothing is selected", async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <TooltipProvider>
            <EditPanel
              selectedElement={selectedElement}
              viewMode="single"
              mode="edit"
              motionInspector
              motionNativeStyles={[
                createMotionNativeStyleInstance({
                  styleKey: "Position",
                  targetNodeId: "first-target",
                }),
                createMotionNativeStyleInstance({
                  styleKey: "Scale",
                  targetNodeId: "last-target",
                }),
              ]}
              onStyleChange={vi.fn()}
            />
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );

    expect(
      container.querySelector(
        '[data-design-inspector-section] h3[aria-label="designEditor.motion.animations"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      "designEditor.motion.emptyStateNoSelection",
    );
    expect(
      container.querySelector("[data-motion-native-style-trigger]"),
    ).toBeNull();
  });
});
