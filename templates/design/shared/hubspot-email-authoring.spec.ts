import { describe, expect, it } from "vitest";

import { assertHubSpotEmailFrameContent } from "./hubspot-email-authoring.js";
import { createHubSpotEmailHtml } from "./hubspot-email.js";

describe("HubSpot email frame authoring contract", () => {
  it("rejects changing a marked email into a non-HTML file", () => {
    expect(() =>
      assertHubSpotEmailFrameContent({
        content: createHubSpotEmailHtml(),
        fileType: "jsx",
      }),
    ).toThrow("must be HTML files");
  });
});
