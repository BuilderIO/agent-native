import { describe, expect, it } from "vitest";

import {
  hasAllRequiredPlatforms,
  INERT_MANIFEST,
  REQUIRED_PLATFORM_KEYS,
} from "../server/routes/api/clips-updater.json.get";

const signedPlatform = {
  url: "https://example.test/clips-update",
  signature: "test-signature",
};

describe("Clips updater platform coverage", () => {
  it("requires the released macOS, Windows, and Linux targets", () => {
    expect(REQUIRED_PLATFORM_KEYS).toContain("linux-x86_64");
    expect(hasAllRequiredPlatforms(INERT_MANIFEST)).toBe(true);
  });

  it("rejects a signed manifest that omits Linux", () => {
    expect(
      hasAllRequiredPlatforms({
        version: "1.0.0",
        platforms: {
          "darwin-aarch64": signedPlatform,
          "darwin-x86_64": signedPlatform,
          "windows-x86_64": signedPlatform,
        },
      }),
    ).toBe(false);
  });
});
