import { describe, expect, it } from "vitest";

import { DESKTOP_DOWNLOAD_URL } from "./desktop-download.js";

describe("DESKTOP_DOWNLOAD_URL", () => {
  it("names the team build installer", () => {
    expect(DESKTOP_DOWNLOAD_URL).toBe(
      "https://github.com/BuilderIO/agent-native-desktop/releases/download/team-latest/Agent-Native-arm64.dmg",
    );
  });
});
