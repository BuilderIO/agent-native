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
        xFor: 'todo in todos',
        itemIndex: 2,
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
