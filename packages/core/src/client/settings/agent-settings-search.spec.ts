import { describe, expect, it } from "vitest";

import { getAgentSettingsSearchTabs } from "./agent-settings-search.js";

describe("getAgentSettingsSearchTabs", () => {
  it("exposes lightweight tab and section metadata with stable hashes", () => {
    const tabs = getAgentSettingsSearchTabs();
    const agent = tabs.find((tab) => tab.id === "agent");
    const connections = tabs.find((tab) => tab.id === "connections");

    expect(agent?.searchEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Voice Transcription",
          hash: "voice",
        }),
      ]),
    );
    expect(connections?.searchEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "API Keys & Connections",
          hash: "secrets",
        }),
      ]),
    );
  });
});
