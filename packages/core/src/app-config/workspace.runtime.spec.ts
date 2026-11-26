import { describe, expect, it } from "vitest";

import { workspaceConfig } from "./workspace.js";
describe("workspace configuration runtime", () => {
  it("preserves explicit false switches and the authoritative access store", () => {
    const config = {
      isWorkspace: false,
      inlineCommonChunks: false,
      authMode: "isolated",
      appAccessStore: "database",
      appsJson: "[]",
      orgDirectoryUrl: "https://directory.example.test",
      oauthOrigin: "https://auth.example.test",
    };
    expect(workspaceConfig.parse(config)).toEqual(config);
    expect(workspaceConfig.parse({})).toEqual({});
  });
  it.each([
    { isWorkspace: "false" },
    { inlineCommonChunks: 0 },
    { authMode: "fallback" },
    { appAccessStore: "local" },
    { appsJson: "" },
    { gatewayUrl: "" },
    { builtinAgentsJson: "" },
    { orgDirectoryUrl: "" },
    { oauthOrigin: "" },
  ])("rejects invalid settings %j", (input) => {
    expect(workspaceConfig.safeParse(input).success).toBe(false);
  });
});
