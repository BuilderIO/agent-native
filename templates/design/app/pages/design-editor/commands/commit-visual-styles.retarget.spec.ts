import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { styleWriteIsRetargeted } from "./commit-visual-styles";

const ROW_SELECTOR =
  'ul[data-agent-native-node-id="an-list"] > li:nth-of-type(3)';

function selection(selector?: string): ElementInfo {
  return {
    tagName: "li",
    classes: [],
    computedStyles: {},
    boundingRect: { x: 0, y: 0, width: 260, height: 40 },
    isFlexChild: true,
    isFlexContainer: false,
    ...(selector ? { selector } : {}),
  };
}

describe("deciding whether a style write was retargeted", () => {
  it("treats the paint target as a retarget, so it is not resolved from the row", () => {
    expect(
      styleWriteIsRetargeted(
        '[data-agent-native-node-id="an-label"]',
        selection(ROW_SELECTOR),
      ),
    ).toBe(true);
  });

  it("treats a repeat's template body as a retarget", () => {
    expect(
      styleWriteIsRetargeted(
        '[data-agent-native-node-id="an-row"]',
        selection(ROW_SELECTOR),
      ),
    ).toBe(true);
  });

  it("leaves an ordinary write resolving from the selection", () => {
    expect(styleWriteIsRetargeted(ROW_SELECTOR, selection(ROW_SELECTOR))).toBe(
      false,
    );
  });

  it("leaves a selection with no selector of its own alone", () => {
    expect(
      styleWriteIsRetargeted(
        '[data-agent-native-node-id="an-label"]',
        selection(),
      ),
    ).toBe(false);
  });

  it("ignores an empty or absent selector", () => {
    expect(styleWriteIsRetargeted("", selection(ROW_SELECTOR))).toBe(false);
    expect(styleWriteIsRetargeted(undefined, selection(ROW_SELECTOR))).toBe(
      false,
    );
  });
});

