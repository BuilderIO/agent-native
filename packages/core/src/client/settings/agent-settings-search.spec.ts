import { describe, expect, it } from "vitest";

import { getAgentSettingsSearchTabs } from "./agent-settings-search.js";

describe("getAgentSettingsSearchTabs", () => {
  it("exposes lightweight tab and section metadata with stable hashes", () => {
    const tabs = getAgentSettingsSearchTabs();
    const agent = tabs.find((tab) => tab.id === "agent");
    const integrations = tabs.find((tab) => tab.id === "integrations");
    const mcp = tabs.find((tab) => tab.id === "mcp");

    expect(agent?.searchEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Voice Transcription",
          hash: "voice",
        }),
      ]),
    );
    expect(integrations?.searchEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "API keys",
          hash: "secrets",
        }),
      ]),
    );
    expect(integrations?.searchEntries).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Usage" })]),
    );
    expect(tabs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "usage", label: "Usage" }),
      ]),
    );
    expect(mcp).toEqual(
      expect.objectContaining({
        label: "MCP",
        keywords: expect.stringContaining("model context protocol"),
        searchEntries: expect.arrayContaining([
          expect.objectContaining({ label: "MCP server URL" }),
        ]),
      }),
    );
  });

  it("localizes the MCP result metadata", () => {
    const mcp = getAgentSettingsSearchTabs("es-ES").find(
      (tab) => tab.id === "mcp",
    );
    const entry = mcp?.searchEntries?.[0];

    expect(entry).toMatchObject({
      label: "URL del servidor MCP",
      description: "Conectar un host de IA",
    });
    expect(entry?.label).not.toBe("MCP server URL");
  });
});
