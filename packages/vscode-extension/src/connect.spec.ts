import { describe, expect, it } from "vitest";

import { buildConnectCommand, buildDesignConnectCommand } from "./connect";

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

describe("buildDesignConnectCommand", () => {
  it("launches the local Design bridge for a workspace dev server", () => {
    const command = buildDesignConnectCommand({
      devServerUrl: "http://localhost:5173",
      rootPath: "/Users/steve/app",
      port: 7331,
    });

    expect(command).toContain(
      "@agent-native/core@latest design connect --url 'http://localhost:5173'",
    );
    expect(command).toContain("--root '/Users/steve/app'");
    expect(command).toContain("--port 7331");
  });
});
