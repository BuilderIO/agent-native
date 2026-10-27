import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { MotionDock } from "@/components/design/MotionDock";

import { renderMotionDockPanel } from "./design-editor/view/motion-dock-panel";

function renderRestoredMotionDock(motionLabEnabled: boolean) {
  return renderMotionDockPanel({
    editorCore: { hostOwnsChrome: false },
    editorHistory: {
      motionDockMounted: true,
      motionDockOpen: true,
      hiddenLayerIds: new Set<string>(),
    },
    editorGenerationAndAccess: { motionAutosavePending: false },
    editorActiveScreenAndGeometry: {
      activeFile: { id: "active-screen" },
    },
    editorCanvasAndScreens: { canvasIframeRef: { current: null } },
    editorLayerActions: { handleToggleLayerHidden: () => {} },
    editorLiveEditsAndPresence: {
      initialGenerationChromeLimited: false,
      motionLabEnabled,
      motionTracks: [],
      activeCodeLayerProjection: { nodes: [] },
      motionDurationMs: 1000,
      motionDefaultEase: "ease",
      motionAutoKeyframeEnabled: false,
      setMotionAutoKeyframeEnabled: () => {},
      motionPlayhead: 0,
      setMotionPlayhead: () => {},
      motionSelectedTarget: null,
    },
    editorContentAndComponents: {
      handleMotionTracksChange: () => {},
      handleMotionDurationChange: () => {},
      motionLivePlayheadRef: { current: null },
    },
  } as unknown as Parameters<typeof renderMotionDockPanel>[0]);
}

describe("DesignEditor motion dock transition", () => {
  it("does not mount a restored open dock while the Motion Lab is off", () => {
    const panel = renderRestoredMotionDock(false);

    expect(isValidElement(panel)).toBe(true);
    const children = (panel as ReactElement<{ children?: ReactNode }>).props
      .children;
    expect(children).toBeNull();

    const enabledPanel = renderRestoredMotionDock(true);

    expect(isValidElement(enabledPanel)).toBe(true);
    const enabledChildren = (
      enabledPanel as ReactElement<{ children?: ReactNode }>
    ).props.children;
    expect(isValidElement(enabledChildren)).toBe(true);
    if (isValidElement(enabledChildren)) {
      expect(enabledChildren.type).toBe(MotionDock);
    }
  });
});
