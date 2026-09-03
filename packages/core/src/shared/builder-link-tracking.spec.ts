import { describe, expect, it } from "vitest";

import { withBuilderUtmTrackingParams } from "./builder-link-tracking.js";

describe("withBuilderUtmTrackingParams", () => {
  it("adds canonical attribution without losing query parameters or fragments", () => {
    expect(
      withBuilderUtmTrackingParams(
        "https://builder.io/account/subscription?plan=pro#billing",
        { campaign: "product", content: "upgrade" },
      ),
    ).toBe(
      "https://builder.io/account/subscription?plan=pro&utm_source=agent-native&utm_medium=product&utm_campaign=product&utm_content=upgrade#billing",
    );
  });

  it("leaves non-Builder destinations unchanged", () => {
    expect(
      withBuilderUtmTrackingParams("https://example.com/account/subscription"),
    ).toBe("https://example.com/account/subscription");
  });

  it("leaves malformed destinations unchanged", () => {
    expect(withBuilderUtmTrackingParams("not a URL")).toBe("not a URL");
  });
});
