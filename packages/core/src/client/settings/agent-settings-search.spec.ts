import { describe, expect, it } from "vitest";

import { getAgentSettingsSearchTabs } from "./agent-settings-search.js";

describe("getAgentSettingsSearchTabs", () => {
  it("exposes lightweight tab and section metadata with stable hashes", () => {
    const tabs = getAgentSettingsSearchTabs();
    const agent = tabs.find((tab) => tab.id === "agent");
    const integrations = tabs.find((tab) => tab.id === "integrations");

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
  });
});
