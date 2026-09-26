import { describe, expect, it } from "vitest";

import { englishAgentChatMessages } from "../../../localization/core-messages.js";
import { getCoreSettingsSearchEntries } from "../agent-settings-search.js";
import { CORE_SETTINGS_PAGES } from "../shell/core-pages.js";
import {
  PREFERENCES_SEARCH_ENTRIES,
  PROFILE_SEARCH_ENTRIES,
  SECURITY_SEARCH_ENTRIES,
} from "./search-entries.js";

const ALL = [
  ...PROFILE_SEARCH_ENTRIES,
  ...PREFERENCES_SEARCH_ENTRIES,
  ...SECURITY_SEARCH_ENTRIES,
];

describe("account page search entries", () => {
  it("labels every row from the core catalog", () => {
    for (const entry of ALL) {
      const key = entry.labelKey?.replace(/^agentChat\./, "");
      expect(
        key && (englishAgentChatMessages as Record<string, string>)[key],
        entry.id,
      ).toEqual(expect.any(String));
    }
  });

  it("gives each row a unique anchor", () => {
    const anchors = ALL.map((entry) => entry.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it("registers the entries on their pages", () => {
    const byId = new Map(CORE_SETTINGS_PAGES.map((page) => [page.id, page]));
    expect(byId.get("profile")?.searchEntries).toBe(PROFILE_SEARCH_ENTRIES);
    expect(byId.get("preferences")?.searchEntries).toBe(
      PREFERENCES_SEARCH_ENTRIES,
    );
    expect(byId.get("security")?.searchEntries).toBe(SECURITY_SEARCH_ENTRIES);
  });

  it("moves voice off the section catalog so it is listed once", () => {
    const sections = getCoreSettingsSearchEntries().get("preferences") ?? [];
    expect(sections.map((entry) => entry.id)).not.toContain("section:voice");
  });
});
