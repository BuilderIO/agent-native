// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  consumeFirstPaintPromptDraft,
  writeFirstPaintPromptDraft,
} from "./first-paint-prompt-draft.js";

describe("first paint prompt drafts", () => {
  it("hands typed and suggested prompts to the hydrated composer once", () => {
    const appId = `draft-${crypto.randomUUID()}`;
    writeFirstPaintPromptDraft(
      appId,
      "Build a portfolio",
      "home_suggestion",
      "design-3",
    );

    expect(consumeFirstPaintPromptDraft(appId)).toMatchObject({
      status: "present",
      draft: {
        text: "Build a portfolio",
        source: "home_suggestion",
        suggestionId: "design-3",
      },
    });
    expect(consumeFirstPaintPromptDraft(appId)).toEqual({ status: "absent" });
  });

  it("reads a stored draft when the in-page bridge is unavailable", () => {
    const appId = `stored-${crypto.randomUUID()}`;
    const draft = {
      text: "Design a recipe planner",
      source: "composer",
      revision: Date.now(),
    };
    window.sessionStorage.setItem(
      `agent-native:first-paint-prompt-draft:${appId}`,
      JSON.stringify(draft),
    );

    expect(consumeFirstPaintPromptDraft(appId)).toEqual({
      status: "present",
      draft,
    });
    expect(
      window.sessionStorage.getItem(
        `agent-native:first-paint-prompt-draft:${appId}`,
      ),
    ).toBeNull();
  });
});
