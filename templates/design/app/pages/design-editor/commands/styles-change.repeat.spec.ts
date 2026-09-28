// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { runStylesChange } from "./styles-change";

const ROW_SELECTOR =
  'ul[data-agent-native-node-id="an-list"] > li:nth-of-type(3)';
const TEMPLATE_BODY_SELECTOR = '[data-agent-native-node-id="an-row"]';

function elementInfo(repeat?: ElementInfo["repeat"]): ElementInfo {
  return {
    tagName: "li",
    selector: ROW_SELECTOR,
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 260, height: 40 },
    isFlexChild: true,
    isFlexContainer: false,
    ...(repeat ? { repeat } : {}),
  };
}

function commitWith(
  selectedElement: ElementInfo,
  styles: Record<string, string> = { backgroundColor: "rgb(1, 2, 3)" },
) {
  const commitVisualStyles = vi.fn();
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
      selectedElement,
      selectedLayerTargetsRef: { current: [] },
      textEditingState: { active: false },
    },
    styles,
  );
  return commitVisualStyles;
}

describe("a style commit on one repeated row", () => {
  it("writes the template body, so every row picks the style up", () => {
    const commitVisualStyles = commitWith(
      elementInfo({
        sourceSelector: TEMPLATE_BODY_SELECTOR,
        instanceCount: 7,
        instanceIndex: 3,
        xFor: "todo in todos",
        itemIndex: 2,
        textBinding: "todo.text",
        keyExpression: "todo.id",
        itemKey: "3",
      }),
    );

    expect(commitVisualStyles).toHaveBeenCalledWith(TEMPLATE_BODY_SELECTOR, {
      backgroundColor: "rgb(1, 2, 3)",
    });
  });

  it("still writes an ordinary element's own selector", () => {
    const commitVisualStyles = commitWith(elementInfo());

    expect(commitVisualStyles).toHaveBeenCalledWith(ROW_SELECTOR, {
      backgroundColor: "rgb(1, 2, 3)",
    });
  });
});

describe("the live preview while dragging", () => {
  it("aims at the same element the commit will write", () => {
    const sent: unknown[] = [];
    (
      window as never as { __designCanvasSendStyle: unknown }
    ).__designCanvasSendStyle = (selector: string, property: string) => {
      sent.push({ selector, property });
      return true;
    };
    try {
      runStylesChange(
        {
          commitInteractionStateStyles: () => false,
          commitRelativeStyleDeltaToSelectedLayers: () => false,
          commitStylesToSelectedLayers: () => false,
          commitCapturedStyleTargets: () => {},
          commitVisualStyles: () => {},
          handleClearBreakpointOverride: () => false,
          previewInteractionStateStyles: () => {},
          selectedCanvasSelectorCandidates: [],
          selectedElement: elementInfo({
            sourceSelector: TEMPLATE_BODY_SELECTOR,
            instanceCount: 7,
            instanceIndex: 3,
            xFor: "todo in todos",
            itemIndex: 2,
            textBinding: "todo.text",
            keyExpression: "todo.id",
            itemKey: "3",
          }),
          selectedLayerTargetsRef: { current: [] },
          textEditingState: { active: false },
        },
        { backgroundColor: "rgb(1, 2, 3)" },
        { phase: "preview" },
      );
    } finally {
      delete (window as never as { __designCanvasSendStyle?: unknown })
        .__designCanvasSendStyle;
    }

    expect(sent).toEqual([
      { selector: TEMPLATE_BODY_SELECTOR, property: "backgroundColor" },
    ]);
  });
});

describe("a canceled style gesture", () => {
  it("does not repeat its restored preview as a source write", () => {
    const commitStylesToSelectedLayers = vi.fn(() => true);
    const commitVisualStyles = vi.fn();
    runStylesChange(
      {
        commitInteractionStateStyles: vi.fn(() => true),
        commitRelativeStyleDeltaToSelectedLayers: vi.fn(() => true),
        commitStylesToSelectedLayers,
        commitCapturedStyleTargets: () => {},
        commitVisualStyles,
        handleClearBreakpointOverride: vi.fn(() => true),
        previewInteractionStateStyles: vi.fn(),
        selectedCanvasSelectorCandidates: [],
        selectedElement: elementInfo(),
        selectedLayerTargetsRef: { current: [] },
        textEditingState: { active: false },
      },
      { backgroundColor: "rgb(59, 130, 246)" },
      { phase: "cancel" },
    );

    expect(commitStylesToSelectedLayers).toHaveBeenCalledOnce();
    expect(commitStylesToSelectedLayers).toHaveBeenCalledWith({}, "cancel");
    expect(commitVisualStyles).not.toHaveBeenCalled();
  });
});

describe("a batched edit from a non-active screen", () => {
  it("keeps the selected screen identity for preview and commit", () => {
    const sent: Array<{
      screenId: string;
      selector: string;
      styles: Record<string, string>;
      phase?: string;
    }> = [];
    const selectedElement = elementInfo();
    selectedElement.sourceLayerIdentity = {
      screenId: "library",
      nodeId: "library-button",
    };
    const args = {
      commitInteractionStateStyles: vi.fn(() => false),
      commitRelativeStyleDeltaToSelectedLayers: vi.fn(() => false),
      commitStylesToSelectedLayers: vi.fn(() => false),
      commitCapturedStyleTargets: () => {},
      commitVisualStyles: vi.fn(),
      handleClearBreakpointOverride: vi.fn(() => false),
      previewInteractionStateStyles: vi.fn(),
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
    };

    runStylesChange(
      args,
      { opacity: "0.5", borderRadius: "12px" },
      { phase: "preview" },
    );
    runStylesChange(
      args,
      { opacity: "0.5", borderRadius: "12px" },
      { phase: "commit" },
    );

    expect(sent).toEqual([
      {
        screenId: "library",
        selector: ROW_SELECTOR,
        styles: { opacity: "0.5", borderRadius: "12px" },
        phase: "preview",
      },
      {
        screenId: "library",
        selector: ROW_SELECTOR,
        styles: { opacity: "0.5", borderRadius: "12px" },
        phase: "commit",
      },
    ]);
  });

  it("routes a scrub commit to the selected screen before relative fallback", () => {
    const selectedScreenStyleChange = vi.fn();
    const commitRelativeStyleDeltaToSelectedLayers = vi.fn(() => true);
    const selectedElement = elementInfo();
    selectedElement.sourceLayerIdentity = {
      screenId: "library",
      nodeId: "library-row",
    };

    runStylesChange(
      {
        commitInteractionStateStyles: vi.fn(() => false),
        commitRelativeStyleDeltaToSelectedLayers,
        commitStylesToSelectedLayers: vi.fn(() => false),
        commitCapturedStyleTargets: () => {},
        commitVisualStyles: vi.fn(),
        handleClearBreakpointOverride: vi.fn(() => false),
        previewInteractionStateStyles: vi.fn(),
        selectedCanvasSelectorCandidates: [],
        selectedElement,
        selectedScreenStyleChange,
        selectedLayerTargetsRef: { current: [] },
        textEditingState: { active: false },
      },
      { width: "220px" },
      { phase: "commit", relativeDelta: 10 },
    );

    expect(selectedScreenStyleChange).toHaveBeenCalledWith(
      "library",
      ROW_SELECTOR,
      { width: "220px" },
      selectedElement,
      expect.objectContaining({ relativeDelta: 10 }),
    );
    expect(commitRelativeStyleDeltaToSelectedLayers).not.toHaveBeenCalled();
  });

  it("keeps batched relative operations on a non-active live screen", () => {
    const selectedScreenStyleChange = vi.fn();
    const selectedElement = elementInfo();
    const selectedLayerTargetsRef = {
      current: [
        {
          layerId: "row",
          fileId: "library",
          node: {} as any,
          tree: [],
          elementInfo: selectedElement,
        },
      ],
    };
    selectedElement.sourceLayerIdentity = {
      screenId: "library",
      nodeId: "library-row",
    };

    runStylesChange(
      {
        canEditLiveScreen: (screenId) => screenId === "library",
        commitInteractionStateStyles: vi.fn(() => false),
        commitRelativeStyleDeltaToSelectedLayers: vi.fn(() => true),
        commitStylesToSelectedLayers: vi.fn(() => false),
        commitCapturedStyleTargets: () => {},
        commitVisualStyles: vi.fn(),
        handleClearBreakpointOverride: vi.fn(() => false),
        previewInteractionStateStyles: vi.fn(),
        selectedCanvasSelectorCandidates: [],
        selectedElement,
        selectedScreenStyleChange,
        selectedLayerTargetsRef,
        textEditingState: { active: false },
      },
      { marginLeft: "12px", marginRight: "12px", color: "red" },
      {
        phase: "commit",
        relativeDelta: 2,
        relativeDeltaProperties: ["marginLeft", "marginRight"],
      },
    );

    expect(selectedScreenStyleChange).toHaveBeenCalledWith(
      "library",
      ROW_SELECTOR,
      { marginLeft: "12px", marginRight: "12px", color: "red" },
      selectedElement,
      expect.objectContaining({
        relativeDelta: 2,
        relativeDeltaProperties: ["marginLeft", "marginRight"],
      }),
    );
  });

  it("routes a text-range style batch to the owning live screen", () => {
    const selectedScreenStyleChange = vi.fn();
    const selectedElement = elementInfo();
    selectedElement.sourceLayerIdentity = {
      screenId: "library",
      nodeId: "library-text",
    };

    runStylesChange(
      {
        commitInteractionStateStyles: vi.fn(() => false),
        commitRelativeStyleDeltaToSelectedLayers: vi.fn(() => false),
        commitStylesToSelectedLayers: vi.fn(() => false),
        commitCapturedStyleTargets: () => {},
        commitVisualStyles: vi.fn(),
        handleClearBreakpointOverride: vi.fn(() => false),
        previewInteractionStateStyles: vi.fn(),
        selectedCanvasSelectorCandidates: [],
        selectedElement,
        selectedScreenStyleChange,
        selectedLayerTargetsRef: { current: [] },
        textEditingState: {
          active: true,
          selector: ROW_SELECTOR,
          hasRange: true,
        },
      },
      { color: "rgb(255, 0, 0)", fontSize: "20px" },
      {
        phase: "commit",
        relativeExpression: { expression: "+2", unit: "px" },
        relativeDeltaProperties: ["fontSize"],
      },
    );

    expect(selectedScreenStyleChange).toHaveBeenCalledWith(
      "library",
      ROW_SELECTOR,
      { color: "rgb(255, 0, 0)", fontSize: "20px" },
      selectedElement,
      {
        phase: "preview",
        relativeExpression: { expression: "+2", unit: "px" },
        relativeDeltaProperties: ["fontSize"],
      },
    );
  });
});
