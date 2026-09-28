// @vitest-environment happy-dom

import { buildCodeLayerProjection } from "@shared/code-layer";
import { describe, expect, it, vi } from "vitest";

import {
  registerLinkedScreenPreviewHandlers,
  sendLinkedScreenPreviewStyleChange,
} from "@/components/design/multi-screen/linked-screen-preview";
import type { ElementInfo } from "@/components/design/types";

import { runStyleChange } from "./style-change";
import { runStylesChange } from "./styles-change";

describe("runStyleChange mixed relative expressions", () => {
  it("routes an explicit Mixed expression per target without an absolute fallback", () => {
    const commitRelativeStyleDeltaToSelectedLayers = vi.fn(() => true);
    const commitStylesToSelectedLayers = vi.fn(() => false);
    const commitVisualStyles = vi.fn();

    runStyleChange(
      {
        commitInteractionStateStyles: () => false,
        commitRelativeStyleDeltaToSelectedLayers,
        commitStylesToSelectedLayers,
        commitCapturedStyleTargets: () => {},
        commitVisualStyles,
        handleClearBreakpointOverride: () => false,
        previewInteractionStateStyles: () => {},
        selectedCanvasSelectorCandidates: [],
        selectedElement: null,
        selectedLayerTargetsRef: { current: [] },
        textEditingState: { active: false },
      },
      "width",
      "110px",
      {
        phase: "commit",
        relativeExpression: {
          expression: "Mixed+100",
          unit: "px",
        },
      },
    );

    expect(commitRelativeStyleDeltaToSelectedLayers).toHaveBeenCalledWith(
      "width",
      { expression: "Mixed+100", unit: "px" },
      "commit",
    );
    expect(commitStylesToSelectedLayers).not.toHaveBeenCalled();
    expect(commitVisualStyles).not.toHaveBeenCalled();
  });

  it("does not persist a canceled preview after its caller restores the start value", () => {
    const commitInteractionStateStyles = vi.fn(() => true);
    const commitStylesToSelectedLayers = vi.fn(() => true);
    const commitVisualStyles = vi.fn();
    const previewInteractionStateStyles = vi.fn();

    runStyleChange(
      {
        commitInteractionStateStyles,
        commitRelativeStyleDeltaToSelectedLayers: vi.fn(() => true),
        commitStylesToSelectedLayers,
        commitCapturedStyleTargets: () => {},
        commitVisualStyles,
        handleClearBreakpointOverride: vi.fn(() => true),
        previewInteractionStateStyles,
        selectedCanvasSelectorCandidates: [],
        selectedElement: null,
        selectedLayerTargetsRef: { current: [] },
        textEditingState: { active: false },
      },
      "backgroundColor",
      "rgb(59, 130, 246)",
      { phase: "cancel" },
    );

    expect(commitInteractionStateStyles).not.toHaveBeenCalled();
    expect(commitStylesToSelectedLayers).toHaveBeenCalledOnce();
    expect(commitStylesToSelectedLayers).toHaveBeenCalledWith({}, "cancel");
    expect(commitVisualStyles).not.toHaveBeenCalled();
    expect(previewInteractionStateStyles).not.toHaveBeenCalled();
  });
});

describe("runStyleChange screen routing", () => {
  it("keeps a selected-screen text-range style edit on the live range path", () => {
    const selectedScreenStyleChange = vi.fn();
    const selectedElement: ElementInfo = {
      tagName: "p",
      selector: "#library-copy",
      classes: [],
      computedStyles: { fontWeight: "400" },
      boundingRect: { x: 0, y: 0, width: 100, height: 20 },
      isFlexChild: false,
      isFlexContainer: false,
      sourceLayerIdentity: { screenId: "library", nodeId: "library-copy" },
    };
    runStyleChange(
      {
        commitInteractionStateStyles: () => false,
        commitRelativeStyleDeltaToSelectedLayers: () => false,
        commitStylesToSelectedLayers: () => false,
        commitCapturedStyleTargets: () => {},
        commitVisualStyles: vi.fn(),
        handleClearBreakpointOverride: () => false,
        previewInteractionStateStyles: () => {},
        selectedCanvasSelectorCandidates: ["#library-copy"],
        selectedElement,
        selectedScreenStyleChange,
        selectedLayerTargetsRef: { current: [] },
        textEditingState: {
          active: true,
          selector: "#library-copy",
          hasRange: true,
        },
      },
      "fontWeight",
      "700",
      { phase: "commit" },
    );

    expect(selectedScreenStyleChange).toHaveBeenCalledWith(
      "library",
      "#library-copy",
      { fontWeight: "700" },
      selectedElement,
      { phase: "preview" },
    );
  });

  it("routes inspector edits to the selected layer owner over stale element provenance", () => {
    const selectedScreenStyleChange = vi.fn();
    const selectedElement: ElementInfo = {
      tagName: "button",
      selector: "#settings-button",
      classes: [],
      computedStyles: { opacity: "1" },
      boundingRect: { x: 0, y: 0, width: 100, height: 40 },
      isFlexChild: false,
      isFlexContainer: false,
      sourceLayerIdentity: { screenId: "library", nodeId: "settings-node" },
    };
    const node = buildCodeLayerProjection(
      '<button data-agent-native-node-id="settings-node">Settings</button>',
    ).nodes[0]!;
    const args = {
      commitInteractionStateStyles: () => false,
      commitRelativeStyleDeltaToSelectedLayers: () => false,
      commitStylesToSelectedLayers: () => false,
      commitCapturedStyleTargets: () => {},
      commitVisualStyles: vi.fn(),
      handleClearBreakpointOverride: () => false,
      previewInteractionStateStyles: () => {},
      selectedCanvasSelectorCandidates: [],
      selectedElement,
      selectedScreenStyleChange,
      selectedLayerTargetsRef: {
        current: [
          {
            layerId: "settings-node",
            fileId: "settings",
            node,
            tree: [],
            elementInfo: selectedElement,
          },
        ],
      },
      textEditingState: { active: false },
    };

    runStyleChange(args, "opacity", "0.5");
    expect(selectedScreenStyleChange).toHaveBeenLastCalledWith(
      "settings",
      "#settings-button",
      { opacity: "0.5" },
      selectedElement,
      undefined,
    );

    selectedScreenStyleChange.mockClear();
    runStylesChange(args, { opacity: "0.25" });
    expect(selectedScreenStyleChange).toHaveBeenLastCalledWith(
      "settings",
      "#settings-button",
      { opacity: "0.25" },
      selectedElement,
      undefined,
    );
  });

  it("routes interaction-state edits before active-screen callbacks", () => {
    const selectedScreenStyleChange = vi.fn();
    const commitInteractionStateStyles = vi.fn(() => true);
    const selectedElement: ElementInfo = {
      tagName: "button",
      selector: "#library-button",
      classes: [],
      computedStyles: { opacity: "1" },
      boundingRect: { x: 0, y: 0, width: 100, height: 40 },
      isFlexChild: false,
      isFlexContainer: false,
      sourceLayerIdentity: { screenId: "library", nodeId: "library-node" },
    };

    runStyleChange(
      {
        commitInteractionStateStyles,
        commitRelativeStyleDeltaToSelectedLayers: () => false,
        commitStylesToSelectedLayers: () => false,
        commitCapturedStyleTargets: () => {},
        commitVisualStyles: vi.fn(),
        handleClearBreakpointOverride: () => false,
        previewInteractionStateStyles: () => {},
        selectedCanvasSelectorCandidates: [],
        selectedElement,
        selectedScreenStyleChange,
        selectedLayerTargetsRef: { current: [] },
        textEditingState: { active: false },
      },
      "opacity",
      "0.5",
      { phase: "commit", interactionState: "hover" },
    );

    expect(selectedScreenStyleChange).toHaveBeenCalledWith(
      "library",
      "#library-button",
      { opacity: "0.5" },
      selectedElement,
      expect.objectContaining({
        phase: "commit",
        interactionState: "hover",
      }),
    );
    expect(commitInteractionStateStyles).not.toHaveBeenCalled();
  });

  it("routes preview and commit to the selected element's screen", () => {
    const sent: Array<{
      screenId: string;
      selector: string;
      styles: Record<string, string>;
      phase?: string;
    }> = [];
    const element = (screenId: string): ElementInfo => ({
      tagName: "button",
      selector: `#${screenId}-button`,
      classes: [],
      computedStyles: { opacity: "1" },
      boundingRect: { x: 0, y: 0, width: 100, height: 40 },
      isFlexChild: false,
      isFlexContainer: false,
      sourceLayerIdentity: { screenId, nodeId: `${screenId}-node` },
    });
    const args = (selectedElement: ElementInfo) => ({
      commitInteractionStateStyles: () => false,
      commitRelativeStyleDeltaToSelectedLayers: () => false,
      commitStylesToSelectedLayers: () => false,
      commitCapturedStyleTargets: () => {},
      commitVisualStyles: vi.fn(),
      handleClearBreakpointOverride: () => false,
      previewInteractionStateStyles: () => {},
      selectedCanvasSelectorCandidates: [],
      selectedElement,
      selectedScreenStyleChange: (
        screenId: string,
        selector: string,
        styles: Record<string, string>,
        _elementInfo?: ElementInfo,
        metadata?: { phase?: string },
      ) => sent.push({ screenId, selector, styles, phase: metadata?.phase }),
      selectedLayerTargetsRef: { current: [] },
      textEditingState: { active: false },
    });

    runStyleChange(args(element("library")), "opacity", "0.5", {
      phase: "preview",
    });
    runStyleChange(args(element("settings")), "opacity", "0.25", {
      phase: "commit",
    });

    expect(sent).toEqual([
      {
        screenId: "library",
        selector: "#library-button",
        styles: { opacity: "0.5" },
        phase: "preview",
      },
      {
        screenId: "settings",
        selector: "#settings-button",
        styles: { opacity: "0.25" },
        phase: "commit",
      },
    ]);
  });

  it("applies an edit only to the iframe for the selected non-active screen", () => {
    const frameElements = {
      library: document.createElement("div"),
      settings: document.createElement("div"),
    };
    frameElements.library.style.opacity = "1";
    frameElements.settings.style.opacity = "1";
    const dispose = Object.entries(frameElements).map(([screenId, element]) =>
      registerLinkedScreenPreviewHandlers(screenId, {
        replaceContent: () => false,
        sendStyleChange: (_selector, property, value) => {
          const cssProperty = property.replace(
            /[A-Z]/g,
            (letter) => `-${letter.toLowerCase()}`,
          );
          element.style.setProperty(cssProperty, value);
          return true;
        },
      }),
    );
    const applyToScreen = (
      screenId: string,
      selector: string,
      styles: Record<string, string>,
    ) => {
      for (const [property, value] of Object.entries(styles)) {
        sendLinkedScreenPreviewStyleChange(screenId, selector, property, value);
      }
    };
    const element = (screenId: string): ElementInfo => ({
      tagName: "button",
      selector: `#${screenId}-button`,
      classes: [],
      computedStyles: { opacity: "1" },
      boundingRect: { x: 0, y: 0, width: 100, height: 40 },
      isFlexChild: false,
      isFlexContainer: false,
      sourceLayerIdentity: { screenId, nodeId: `${screenId}-node` },
    });
    const args = (selectedElement: ElementInfo) => ({
      commitInteractionStateStyles: () => false,
      commitRelativeStyleDeltaToSelectedLayers: () => false,
      commitStylesToSelectedLayers: () => false,
      commitCapturedStyleTargets: () => {},
      commitVisualStyles: vi.fn(),
      handleClearBreakpointOverride: () => false,
      previewInteractionStateStyles: () => {},
      selectedCanvasSelectorCandidates: [],
      selectedElement,
      selectedScreenStyleChange: applyToScreen,
      selectedLayerTargetsRef: { current: [] },
      textEditingState: { active: false },
    });

    try {
      runStyleChange(args(element("library")), "opacity", "0.5", {
        phase: "preview",
      });
      expect(frameElements.library.style.opacity).toBe("0.5");
      expect(frameElements.settings.style.opacity).toBe("1");

      runStyleChange(args(element("settings")), "opacity", "0.25", {
        phase: "commit",
      });
      expect(frameElements.library.style.opacity).toBe("0.5");
      expect(frameElements.settings.style.opacity).toBe("0.25");

      runStyleChange(args(element("library")), "opacity", "0.75", {
        phase: "commit",
      });
      expect(frameElements.library.style.opacity).toBe("0.75");
      expect(frameElements.settings.style.opacity).toBe("0.25");

      runStylesChange(
        args(element("settings")),
        { opacity: "0.4", borderRadius: "8px" },
        { phase: "commit" },
      );
      expect(frameElements.library.style.opacity).toBe("0.75");
      expect(frameElements.settings.style.opacity).toBe("0.4");
      expect(frameElements.settings.style.borderRadius).toBe("8px");
    } finally {
      dispose.forEach((unregister) => unregister());
    }
  });

  it("routes a scrub commit before applying its relative expression", () => {
    const selectedScreenStyleChange = vi.fn();
    const commitRelativeStyleDeltaToSelectedLayers = vi.fn(() => true);
    const selectedElement: ElementInfo = {
      tagName: "button",
      selector: "#library-button",
      classes: [],
      computedStyles: { borderRadius: "calc(4px + var(--radius-step))" },
      boundingRect: { x: 0, y: 0, width: 100, height: 40 },
      isFlexChild: false,
      isFlexContainer: false,
      sourceLayerIdentity: { screenId: "library", nodeId: "library-node" },
    };

    runStyleChange(
      {
        commitInteractionStateStyles: () => false,
        commitRelativeStyleDeltaToSelectedLayers,
        commitStylesToSelectedLayers: () => false,
        commitCapturedStyleTargets: () => {},
        commitVisualStyles: vi.fn(),
        handleClearBreakpointOverride: () => false,
        previewInteractionStateStyles: () => {},
        selectedCanvasSelectorCandidates: [],
        selectedElement,
        selectedScreenStyleChange,
        selectedLayerTargetsRef: { current: [] },
        textEditingState: { active: false },
      },
      "borderRadius",
      "12px",
      {
        phase: "commit",
        relativeExpression: { expression: "+8", unit: "px" },
      },
    );

    expect(selectedScreenStyleChange).toHaveBeenCalledWith(
      "library",
      "#library-button",
      { borderRadius: "12px" },
      selectedElement,
      expect.objectContaining({
        relativeExpression: { expression: "+8", unit: "px" },
      }),
    );
    expect(commitRelativeStyleDeltaToSelectedLayers).not.toHaveBeenCalled();
  });

  it("routes batched interaction-state edits to the selected screen", () => {
    const selectedScreenStyleChange = vi.fn();
    const commitInteractionStateStyles = vi.fn(() => true);
    const selectedElement: ElementInfo = {
      tagName: "button",
      selector: "#settings-button",
      classes: [],
      computedStyles: { color: "rgb(0, 0, 0)" },
      boundingRect: { x: 0, y: 0, width: 100, height: 40 },
      isFlexChild: false,
      isFlexContainer: false,
      sourceLayerIdentity: { screenId: "settings", nodeId: "settings-node" },
    };

    runStylesChange(
      {
        commitInteractionStateStyles,
        commitRelativeStyleDeltaToSelectedLayers: () => false,
        commitStylesToSelectedLayers: () => false,
        commitCapturedStyleTargets: () => {},
        commitVisualStyles: vi.fn(),
        handleClearBreakpointOverride: () => false,
        previewInteractionStateStyles: () => {},
        selectedCanvasSelectorCandidates: [],
        selectedElement,
        selectedScreenStyleChange,
        selectedLayerTargetsRef: { current: [] },
        textEditingState: { active: false },
      },
      { color: "red", backgroundColor: "blue" },
      { phase: "commit", interactionState: "focus" },
    );

    expect(selectedScreenStyleChange).toHaveBeenCalledWith(
      "settings",
      "#settings-button",
      { color: "red", backgroundColor: "blue" },
      selectedElement,
      expect.objectContaining({
        phase: "commit",
        interactionState: "focus",
      }),
    );
    expect(commitInteractionStateStyles).not.toHaveBeenCalled();
  });

  it("routes captured fill edits to the captured live screen, not the current selection", () => {
    const library = document.createElement("div");
    const settings = document.createElement("div");
    const unregisterLibrary = registerLinkedScreenPreviewHandlers("library", {
      replaceContent: () => false,
      sendStyleChange: (_selector, property, value) => {
        library.style.setProperty(
          property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
          value,
        );
        return true;
      },
    });
    const unregisterSettings = registerLinkedScreenPreviewHandlers("settings", {
      replaceContent: () => false,
      sendStyleChange: (_selector, property, value) => {
        settings.style.setProperty(
          property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
          value,
        );
        return true;
      },
    });
    const capturedElement: ElementInfo = {
      tagName: "button",
      selector: "#library-button",
      classes: [],
      computedStyles: { backgroundColor: "rgb(255, 255, 255)" },
      boundingRect: { x: 0, y: 0, width: 100, height: 40 },
      isFlexChild: false,
      isFlexContainer: false,
      sourceLayerIdentity: { screenId: "library", nodeId: "library-node" },
    };
    const currentSelection: ElementInfo = {
      ...capturedElement,
      selector: "#settings-heading",
      sourceLayerIdentity: { screenId: "settings", nodeId: "settings-node" },
    };
    const selectedScreenStyleChange = (
      screenId: string,
      selector: string,
      styles: Record<string, string>,
    ) => {
      Object.entries(styles).forEach(([property, value]) =>
        sendLinkedScreenPreviewStyleChange(screenId, selector, property, value),
      );
    };
    const capturedStyleTargets = [
      {
        fileId: "library",
        layerId: "library-node",
        elementInfo: capturedElement,
        upperBoundPx: null,
        lowerBoundPx: null,
      },
    ];

    try {
      runStyleChange(
        {
          canEditLiveScreen: (screenId) => screenId === "library",
          commitInteractionStateStyles: () => false,
          commitRelativeStyleDeltaToSelectedLayers: () => false,
          commitStylesToSelectedLayers: vi.fn(),
          commitCapturedStyleTargets: vi.fn(),
          commitVisualStyles: vi.fn(),
          handleClearBreakpointOverride: () => false,
          previewInteractionStateStyles: vi.fn(),
          selectedCanvasSelectorCandidates: [],
          selectedElement: currentSelection,
          selectedScreenStyleChange,
          selectedLayerTargetsRef: { current: [] },
          textEditingState: { active: false },
        },
        "backgroundColor",
        "rgb(15, 160, 255)",
        { phase: "commit", capturedStyleTargets },
      );

      expect(library.style.backgroundColor).toBe("rgb(15, 160, 255)");
      expect(settings.style.backgroundColor).toBe("");
    } finally {
      unregisterLibrary();
      unregisterSettings();
    }
  });

  it("routes batched captured live styles through the captured screen", () => {
    const selectedScreenStyleChange = vi.fn();
    const capturedElement: ElementInfo = {
      tagName: "p",
      selector: "#library-title",
      classes: [],
      computedStyles: { color: "rgb(0, 0, 0)" },
      boundingRect: { x: 0, y: 0, width: 100, height: 40 },
      isFlexChild: false,
      isFlexContainer: false,
      sourceLayerIdentity: { screenId: "library", nodeId: "library-title" },
    };

    runStylesChange(
      {
        canEditLiveScreen: (screenId) => screenId === "library",
        commitInteractionStateStyles: () => false,
        commitRelativeStyleDeltaToSelectedLayers: () => false,
        commitStylesToSelectedLayers: vi.fn(),
        commitCapturedStyleTargets: vi.fn(),
        commitVisualStyles: vi.fn(),
        handleClearBreakpointOverride: () => false,
        previewInteractionStateStyles: vi.fn(),
        selectedCanvasSelectorCandidates: [],
        selectedElement: null,
        selectedScreenStyleChange,
        selectedLayerTargetsRef: { current: [] },
        textEditingState: { active: false },
      },
      {
        color: "rgb(15, 160, 255)",
        backgroundImage: "linear-gradient(red, blue)",
      },
      {
        phase: "commit",
        capturedStyleTargets: [
          {
            fileId: "library",
            layerId: "library-title",
            elementInfo: capturedElement,
            upperBoundPx: null,
            lowerBoundPx: null,
          },
        ],
      },
    );

    expect(selectedScreenStyleChange).toHaveBeenCalledWith(
      "library",
      "#library-title",
      {
        color: "rgb(15, 160, 255)",
        backgroundImage: "linear-gradient(red, blue)",
      },
      capturedElement,
      expect.objectContaining({ phase: "commit" }),
    );
  });
});

describe("runStylesChange mixed relative margin deltas", () => {
  it("routes only the linked margin sides through the per-target relative path", () => {
    const commitRelativeStyleDeltaToSelectedLayers = vi.fn(() => true);
    const commitStylesToSelectedLayers = vi.fn(() => false);
    const commitVisualStyles = vi.fn();

    runStylesChange(
      {
        commitInteractionStateStyles: () => false,
        commitRelativeStyleDeltaToSelectedLayers,
        commitStylesToSelectedLayers,
        commitCapturedStyleTargets: () => {},
        commitVisualStyles,
        handleClearBreakpointOverride: () => false,
        previewInteractionStateStyles: () => {},
        selectedCanvasSelectorCandidates: [],
        selectedElement: null,
        selectedLayerTargetsRef: { current: [] },
        textEditingState: { active: false },
      },
      { marginLeft: "1px", marginRight: "1px" },
      {
        phase: "commit",
        relativeDelta: 1,
        relativeDeltaProperties: ["marginLeft", "marginRight"],
      },
    );

    expect(commitRelativeStyleDeltaToSelectedLayers).toHaveBeenCalledOnce();
    expect(commitRelativeStyleDeltaToSelectedLayers).toHaveBeenCalledWith(
      ["marginLeft", "marginRight"],
      1,
      "commit",
    );
    expect(commitStylesToSelectedLayers).not.toHaveBeenCalled();
    expect(commitVisualStyles).not.toHaveBeenCalled();
  });

  it("falls back to the absolute patch when no per-target delta is applied", () => {
    const commitVisualStyles = vi.fn();
    const styles = { marginLeft: "1px", marginRight: "1px" };

    runStylesChange(
      {
        commitInteractionStateStyles: () => false,
        commitRelativeStyleDeltaToSelectedLayers: () => false,
        commitStylesToSelectedLayers: () => false,
        commitCapturedStyleTargets: () => {},
        commitVisualStyles,
        handleClearBreakpointOverride: () => false,
        previewInteractionStateStyles: () => {},
        selectedCanvasSelectorCandidates: [],
        selectedElement: null,
        selectedLayerTargetsRef: { current: [] },
        textEditingState: { active: false },
      },
      styles,
      {
        phase: "commit",
        relativeDelta: 1,
        relativeDeltaProperties: ["marginLeft", "marginRight"],
      },
    );

    expect(commitVisualStyles).toHaveBeenCalledWith("body", styles);
  });
});
