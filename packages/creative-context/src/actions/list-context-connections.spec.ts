import { describe, expect, it } from "vitest";

import { creativeContextConnectionPath } from "./list-context-connections.js";

describe("creative context connection paths", () => {
  it.each([
    ["figma", "assets"],
    ["google_drive", "slides"],
    ["notion", "content"],
  ] as const)(
    "binds the %s OAuth flow to the consuming app and Library return tab",
    (provider, appId) => {
      const path = creativeContextConnectionPath({ provider, appId });
      const url = new URL(path, "https://app.example.com");

      expect(url.pathname).toBe(
        `/_agent-native/connections/oauth/${provider}/start`,
      );
      expect(url.searchParams.get("appId")).toBe(appId);
      expect(url.searchParams.get("return")).toBe("/agent#library");
    },
  );
});
