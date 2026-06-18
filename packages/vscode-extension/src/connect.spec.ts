import { describe, expect, it } from "vitest";

import { buildConnectCommand } from "./connect";

describe("buildConnectCommand", () => {
  it("uses the core connect flow for VS Code / GitHub Copilot MCP", () => {
    expect(
      buildConnectCommand({
        appUrl: "https://dispatch.agent-native.com/",
        scope: "project",
      }),
    ).toContain(
      "@agent-native/core@latest connect 'https://dispatch.agent-native.com/' --client github-copilot --scope project",
    );
  });

  it("quotes app URLs for the user's shell", () => {
    const command = buildConnectCommand({
      appUrl: "https://example.com/a path?x='y'",
      scope: "user",
    });

    if (process.platform === "win32") {
      expect(command).toContain("\"https://example.com/a path?x='y'\"");
    } else {
      expect(command).toContain("'https://example.com/a path?x='\\''y'\\'''");
    }
    expect(command).toContain("--scope user");
  });
});
