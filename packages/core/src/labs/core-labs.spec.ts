import { describe, expect, it } from "vitest";

import { CORE_LABS, MCP_APP_CARDS_LAB } from "./core-labs.js";

describe("core labs", () => {
  it("keeps the keys people's lab choices are saved under", () => {
    // Renaming a key would drop every saved choice for that lab.
    expect(CORE_LABS.map((lab) => lab.key)).toEqual([
      "chatgpt-subscription",
      "mcp-app-cards",
    ]);
  });

  it("names the MCP Apps cards lab in Settings", () => {
    expect(MCP_APP_CARDS_LAB).toMatchObject({
      key: "mcp-app-cards",
      displayName: "App cards in chat apps",
      displayNameKey: "agentChat.settingsShell.appGroup.mcpAppCards",
      descriptionKey: "agentChat.settingsShell.appGroup.mcpAppCardsDescription",
    });
    expect(MCP_APP_CARDS_LAB.keywords).toContain("MCP Apps");
  });
});
