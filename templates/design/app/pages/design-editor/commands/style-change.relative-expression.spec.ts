import { describe, expect, it, vi } from "vitest";

import { runStyleChange } from "./style-change";

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
