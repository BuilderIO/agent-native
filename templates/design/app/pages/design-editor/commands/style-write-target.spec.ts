import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { styleWriteTarget } from "./style-write-target";

const ROW = 'ul[data-agent-native-node-id="an-list"] > li:nth-of-type(3)';
const TEMPLATE_BODY = '[data-agent-native-node-id="an-row"]';

function element(extra: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tagName: "li",
    selector: ROW,
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 260, height: 40 },
    isFlexChild: true,
    isFlexContainer: false,
    ...extra,
  };
}

describe("where a style patch lands", () => {
  it("sends a repeated row's patch to the template body every row renders", () => {
    expect(
      styleWriteTarget({
        selector: ROW,
        selectedElement: element({
          repeat: {
            sourceSelector: TEMPLATE_BODY,
            instanceCount: 7,
            instanceIndex: 3,
            xFor: "todo in todos",
            itemIndex: 2,
          },
        }),
      }),
    ).toBe(TEMPLATE_BODY);
  });

  it("leaves an ordinary element on its own selector", () => {
    expect(
      styleWriteTarget({ selector: ROW, selectedElement: element() }),
    ).toBe(ROW);
  });

  it("falls back to the selector when nothing is selected", () => {
    expect(styleWriteTarget({ selector: "body", selectedElement: null })).toBe(
      "body",
    );
  });
});
