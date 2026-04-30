import { describe, expect, it } from "vitest";
import { getComposerDraftKey } from "./draft-key.js";

describe("getComposerDraftKey", () => {
  it("uses the legacy key when no scope is available", () => {
    expect(getComposerDraftKey()).toBe("an-composer-draft");
    expect(getComposerDraftKey("   ")).toBe("an-composer-draft");
  });

  it("scopes drafts by thread or tab id", () => {
    expect(getComposerDraftKey("thread-qa")).toBe(
      "an-composer-draft:thread-qa",
    );
    expect(getComposerDraftKey("tab with spaces")).toBe(
      "an-composer-draft:tab%20with%20spaces",
    );
  });
});
