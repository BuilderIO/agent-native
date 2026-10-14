import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { MotionDock } from "@/components/design/MotionDock";

import { readDesignEditorSource } from "./design-editor/read-design-editor-source";
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
  const source = readDesignEditorSource();

  it("opens after a painted collapsed frame so height can transition", () => {
    const openStart = source.indexOf("const setMotionDockOpenAnimated");
    const openEnd = source.indexOf(
      "const handleMotionDockExitComplete",
      openStart,
    );
    expect(openStart).toBeGreaterThanOrEqual(0);
    expect(openEnd).toBeGreaterThan(openStart);

    const openBlock = source.slice(openStart, openEnd);
    const mountIndex = openBlock.indexOf("setMotionDockMounted(true)");
    const firstFrameIndex = openBlock.indexOf("window.requestAnimationFrame");
    const secondFrameIndex = openBlock.indexOf(
      "motionDockOpenAnimationFrameRef.current =\n              window.requestAnimationFrame",
      firstFrameIndex + 1,
    );
    const openIndex = openBlock.indexOf(
      "setMotionDockOpen(true)",
      firstFrameIndex,
    );

    expect(mountIndex).toBeGreaterThanOrEqual(0);
    expect(firstFrameIndex).toBeGreaterThan(mountIndex);
    expect(secondFrameIndex).toBeGreaterThan(firstFrameIndex);
    expect(openIndex).toBeGreaterThan(secondFrameIndex);
  });

  it("cancels pending enter animation work on close and unmount", () => {
    expect(source).toContain(
      "clearMotionDockOpenAnimationFrame();\n      if (open)",
    );
    expect(source).toContain("window.cancelAnimationFrame");
    expect(source).toContain("clearMotionDockOpenAnimationFrame();\n    },");
  });

  it("keeps the motion dock behind the Motion Lab without reserving space", () => {
    expect(source).toContain(
      "motionLabEnabled &&\n      !initialGenerationChromeLimited &&\n      activeFile &&\n      motionDockMounted",
    );
    expect(source).toContain('t("designEditor.motion.openDock")');
    expect(source).toContain("editorLiveEditsAndPresence.motionLabEnabled ? (");
  });

  it("switches the inspector to Motion while the dock is open, with no tab to pick", () => {
    expect(source).toContain(
      "motionInspector:\n      editorLiveEditsAndPresence.motionLabEnabled &&\n      motionDockOpen &&\n      Boolean(activeFile?.id),",
    );
    expect(source).not.toContain("setActiveInspectorTab");
  });

  it("requires design edit access for both Motion write gates", () => {
    expect(source).toContain(
      "const canWriteMotion =\n    canEditDesign && editorContentAndComponents.motionControlsWritable;",
    );
    expect(source).toContain(
      "onToggleMotionKeyframe:\n      editorLiveEditsAndPresence.motionLabEnabled &&\n      canEditDesign &&\n      canWriteMotion",
    );
    expect(source).toContain("motionWriteUnavailable: !canWriteMotion,");
  });

  it("keeps inspector motion controls gated and preserves explicit collapse", () => {
    expect(source).toContain(
      "motionKeyframeState:\n      editorLiveEditsAndPresence.motionLabEnabled && canWriteMotion\n        ? motionKeyframeState\n        : undefined,",
    );
    expect(source).toContain(
      "onToggleMotionKeyframe:\n      editorLiveEditsAndPresence.motionLabEnabled &&\n      canEditDesign &&\n      canWriteMotion\n        ? handleToggleMotionKeyframe",
    );
    expect(source).toContain(
      'if (!initialGenerationChromeLimited) return;\n    setActiveLeftPanel("agent");\n  }, [initialGenerationChromeLimited]);',
    );
    expect(source).toContain(
      "if (panel === null && initialGenerationChromeLimited) return;",
    );
  });

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
