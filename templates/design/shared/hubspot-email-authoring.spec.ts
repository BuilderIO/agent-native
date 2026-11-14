import { describe, expect, it } from "vitest";

import { assertHubSpotEmailFileType } from "./hubspot-email-authoring.js";

describe("HubSpot email frame authoring contract", () => {
  it("rejects an email frame that is not an HTML file", () => {
    expect(() =>
      assertHubSpotEmailFileType({
        fileType: "jsx",
        frameType: "hubspot-email",
      }),
    ).toThrow("must be HTML files");
  });

  it("accepts any file type for a web frame", () => {
    expect(() =>
      assertHubSpotEmailFileType({ fileType: "jsx", frameType: null }),
    ).not.toThrow();
  });
});
