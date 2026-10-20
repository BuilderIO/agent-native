import { describe, expect, it } from "vitest";

import { withShareLinkAttribution } from "./share-link-attribution.js";

describe("withShareLinkAttribution", () => {
  it("carries via for a logged-in sharer", () => {
    const out = withShareLinkAttribution(
      "https://design.example.com/design/abc",
      "design_share",
      "user_123",
    );
    const url = new URL(out as string);
    expect(url.searchParams.get("ref")).toBe("design_share");
    expect(url.searchParams.get("via")).toBe("user_123");
  });

  it("omits via when there is no user (never emits an empty value)", () => {
    const out = withShareLinkAttribution(
      "https://design.example.com/design/abc",
      "design_share",
    );
    const url = new URL(out as string);
    expect(url.searchParams.get("ref")).toBe("design_share");
    expect(url.searchParams.has("via")).toBe(false);
  });

  it("omits via for blank/whitespace owner ids", () => {
    const out = withShareLinkAttribution(
      "https://design.example.com/design/abc",
      "design_share",
      "   ",
    );
    expect(new URL(out as string).searchParams.has("via")).toBe(false);
  });

  it("preserves existing query params", () => {
    const out = withShareLinkAttribution(
      "https://design.example.com/design/abc?zoom=1.5",
      "design_share",
      "user_123",
    );
    const url = new URL(out as string);
    expect(url.searchParams.get("zoom")).toBe("1.5");
    expect(url.searchParams.get("ref")).toBe("design_share");
  });

  it("returns the input unchanged for non-absolute URLs", () => {
    expect(withShareLinkAttribution("/design/abc", "design_share", "u1")).toBe(
      "/design/abc",
    );
    expect(
      withShareLinkAttribution(undefined, "design_share", "u1"),
    ).toBeUndefined();
  });
});
