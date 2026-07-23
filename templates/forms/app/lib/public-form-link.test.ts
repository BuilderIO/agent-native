import { describe, expect, it } from "vitest";

import { getPublishedFormUrl } from "./public-form-link";

describe("getPublishedFormUrl", () => {
  it("returns the public URL for a published form without requiring database metadata", () => {
    expect(
      getPublishedFormUrl(
        { status: "published", slug: "customer-survey/abc123" },
        "https://forms.agent-native.com",
      ),
    ).toBe("https://forms.agent-native.com/f/customer-survey/abc123");
  });

  it("does not return a public URL for an unpublished form", () => {
    expect(
      getPublishedFormUrl(
        { status: "draft", slug: "customer-survey/abc123" },
        "https://forms.agent-native.com",
      ),
    ).toBeUndefined();
  });
});
