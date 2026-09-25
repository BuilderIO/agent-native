import { describe, expect, it, vi } from "vitest";

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
