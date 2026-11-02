// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  consumeFirstPaintPromptDraft,
  writeFirstPaintPromptDraft,
} from "./first-paint-prompt-draft.js";

describe("first paint prompt drafts", () => {
  it("hands typed and suggested prompts to the hydrated composer once", () => {
    const appId = `draft-${crypto.randomUUID()}`;
    writeFirstPaintPromptDraft(appId, "Build a portfolio", "home_suggestion", {
      suggestionId: "design-3",
      submitted: true,
      scope: "design:new:user-a",
    });

    expect(
      consumeFirstPaintPromptDraft(appId, "design:new:user-a"),
    ).toMatchObject({
      status: "present",
      draft: {
        text: "Build a portfolio",
        source: "home_suggestion",
        suggestionId: "design-3",
        submitted: true,
      },
    });
    expect(consumeFirstPaintPromptDraft(appId, "design:new:user-a")).toEqual({
      status: "absent",
    });
    expect(consumeFirstPaintPromptDraft(appId, "design:new:user-b")).toEqual({
      status: "absent",
    });
  });

  it("keeps selected files in the in-page submit handoff", () => {
    const appId = `files-${crypto.randomUUID()}`;
    const files = [new File(["reference"], "reference.txt")];
    writeFirstPaintPromptDraft(appId, "Use these references", "composer", {
      files,
      submitted: true,
    });

    const result = consumeFirstPaintPromptDraft(appId);
    expect(result.status).toBe("present");
    if (result.status !== "present") throw new Error("Expected prompt draft.");
    expect(result.draft.files).toEqual(files);
    expect(result.draft.files?.[0]).toBe(files[0]);
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

  it("carries an anonymous first-paint prompt into the authenticated home", () => {
    const appId = `anonymous-${crypto.randomUUID()}`;
    writeFirstPaintPromptDraft(appId, "Keep this prompt", "composer", {
      scope: "anonymous",
    });

    expect(consumeFirstPaintPromptDraft(appId, "user-a:org-a")).toMatchObject({
      status: "present",
      draft: { text: "Keep this prompt" },
    });
    expect(consumeFirstPaintPromptDraft(appId, "user-b:org-a")).toEqual({
      status: "absent",
    });
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
