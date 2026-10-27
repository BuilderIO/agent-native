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

  it("ignores and clears a legacy persisted prompt", () => {
    const appId = `legacy-${crypto.randomUUID()}`;
    const key = `agent-native:first-paint-prompt-draft:${appId}`;
    window.sessionStorage.setItem(
      key,
      JSON.stringify({
        text: "Another account's draft",
        source: "composer",
        revision: Date.now(),
      }),
    );

    expect(consumeFirstPaintPromptDraft(appId)).toEqual({ status: "absent" });
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });

  it("keeps prompt text in the in-page bridge only", () => {
    const appId = `stored-${crypto.randomUUID()}`;
    const draft = {
      text: "Design a recipe planner",
      source: "composer",
      revision: Date.now(),
    };
    writeFirstPaintPromptDraft(appId, draft.text);

    expect(
      window.sessionStorage.getItem(
        `agent-native:first-paint-prompt-draft:${appId}`,
      ),
    ).toBeNull();
    expect(consumeFirstPaintPromptDraft(appId)).toEqual({
      status: "present",
      draft: expect.objectContaining({ text: draft.text, source: "composer" }),
    });
  });
});
