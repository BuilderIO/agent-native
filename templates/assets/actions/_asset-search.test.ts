import { describe, expect, it } from "vitest";

import {
  assetMatchesSearch,
  includeCandidatesSchema,
  shouldIncludeAssetInLibraryResults,
} from "./_asset-search.js";

describe("asset search helpers", () => {
  it("matches the original prompt without matching compiled prompt boilerplate", () => {
    const asset = {
      role: "generated",
      status: "saved",
      prompt: "A crisp product hero on a glass desk",
      metadata: JSON.stringify({
        compiledPrompt:
          "Library custom instructions: always use soft brand lighting",
      }),
    };

    expect(assetMatchesSearch(asset, "glass desk")).toBe(true);
    expect(assetMatchesSearch(asset, "soft brand lighting")).toBe(false);
  });

  it("hides unsaved generated candidates unless the caller opts in", () => {
    expect(
      shouldIncludeAssetInLibraryResults({
        role: "generated",
        status: "candidate",
      }),
    ).toBe(false);
    expect(
      shouldIncludeAssetInLibraryResults(
        { role: "generated", status: "candidate" },
        true,
      ),
    ).toBe(true);
    expect(
      shouldIncludeAssetInLibraryResults({
        role: "generated",
        status: "saved",
      }),
    ).toBe(true);
  });

  it("parses URL boolean strings without treating false as truthy", () => {
    expect(includeCandidatesSchema.parse(undefined)).toBe(false);
    expect(includeCandidatesSchema.parse("false")).toBe(false);
    expect(includeCandidatesSchema.parse("0")).toBe(false);
    expect(includeCandidatesSchema.parse("true")).toBe(true);
    expect(includeCandidatesSchema.parse("1")).toBe(true);
  });
});
