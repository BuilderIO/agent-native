import { describe, expect, it } from "vitest";

import {
  aiFilterRuleActionsForMode,
  aiFilterRuleMode,
  type AiFilterRuleMode,
} from "./ai-filter-rules.js";
import { AI_FILTER_LABEL } from "./ai-filter.js";
import { AI_IMPORTANT_LABEL } from "./ai-priority.js";
import type { AutomationAction } from "./types.js";

const classifiedCases: Array<[AutomationAction[], AiFilterRuleMode]> = [
  [[{ type: "archive" }], "archive"],
  [[{ type: "label", labelName: AI_IMPORTANT_LABEL }], "important"],
  [
    [{ type: "label", labelName: AI_FILTER_LABEL }, { type: "archive" }],
    "filtered",
  ],
  [[{ type: "label", labelName: "Receipts" }], "tag"],
  [[{ type: "label", labelName: "Receipts" }, { type: "archive" }], "tag"],
];

const invalidActionCases: AutomationAction[][] = [
  [{ type: "label", labelName: AI_FILTER_LABEL }],
  [{ type: "label", labelName: AI_IMPORTANT_LABEL }, { type: "archive" }],
  [{ type: "label", labelName: "agent_native_important" }],
  [
    { type: "label", labelName: "Receipts" },
    { type: "archive" },
    { type: "archive" },
  ],
];

describe("AI filter rule actions", () => {
  it.each(classifiedCases)("classifies %j as %s", (actions, expectedMode) => {
    expect(aiFilterRuleMode({ actions })).toBe(expectedMode);
  });

  it("rejects noncanonical actions", () => {
    for (const actions of invalidActionCases) {
      expect(aiFilterRuleMode({ actions })).toBeNull();
    }
  });

  it("keeps an archive action when a tag rule prompt is edited", () => {
    expect(
      aiFilterRuleActionsForMode("tag", "Receipts", [
        { type: "label", labelName: "Receipts" },
        { type: "archive" },
      ]),
    ).toEqual([{ type: "label", labelName: "Receipts" }, { type: "archive" }]);
  });
});
