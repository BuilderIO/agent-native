import { describe, expect, it } from "vitest";

import { CHATGPT_SUBSCRIPTION_LAB } from "../../../labs/core-labs.js";
import type { SettingsTabItem } from "../SettingsTabsPage.js";
import {
  bridgedCoreSearchEntries,
  createSettingsBridge,
  deriveBridgedAppPages,
} from "./bridge.js";
import { CORE_SETTINGS_PAGES } from "./core-pages.js";

const Stub = () => null;

function tab(
  id: string,
  extra: Partial<SettingsTabItem> = {},
): SettingsTabItem {
  return { id, label: id, content: id, ...extra };
}

describe("settings shell bridge", () => {
  it("claims today's core tabs and turns the rest into app pages after General", () => {
    const { pages, pageTabs } = deriveBridgedAppPages(
      [
        tab("integrations"),
        tab("agent"),
        tab("organization"),
        tab("drafting", { label: "Drafting" }),
        tab("snippets", { label: "Snippets" }),
      ],
      CORE_SETTINGS_PAGES,
      Stub,
    );
    expect(pages.map((page) => page.id)).toEqual(["drafting", "snippets"]);
    expect(pages.every((page) => page.group === "app")).toBe(true);
    const general = CORE_SETTINGS_PAGES.find((page) => page.id === "app")!;
    const notifications = CORE_SETTINGS_PAGES.find(
      (page) => page.id === "notifications",
    )!;
    for (const page of pages) {
      expect(page.order).toBeGreaterThan(general.order);
      expect(page.order).toBeLessThan(notifications.order);
    }
    expect(pageTabs.get("drafting")?.label).toBe("Drafting");
  });

  it("prefixes an app tab whose id collides with a core page", () => {
    const { pages } = deriveBridgedAppPages(
      [tab("automations", { label: "Inbox rules" })],
      CORE_SETTINGS_PAGES,
      Stub,
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]!.id).toBe("app-automations");
    expect(pages[0]!.legacyTabIds).toEqual(["automations"]);
  });

  it("keeps app-area tabs off the nav", () => {
    const { pages } = deriveBridgedAppPages(
      [tab("recordings", { settingsPlacement: "app-area" })],
      CORE_SETTINGS_PAGES,
      Stub,
    );
    expect(pages).toEqual([]);
    const bridge = createSettingsBridge({
      extraTabs: [tab("recordings", { settingsPlacement: "app-area" })],
    });
    expect(bridge.appAreas.map((area) => area.id)).toEqual(["recordings"]);
  });

  it("always shows the core labs next to the app's", () => {
    const bridge = createSettingsBridge({
      labs: [{ key: "clips.meetings", displayName: "Meetings" }],
    });
    expect(bridge.labs.map((lab) => lab.key)).toEqual([
      CHATGPT_SUBSCRIPTION_LAB.key,
      "clips.meetings",
    ]);
  });

  it("finds a legacy tab by the first id that exists", () => {
    const bridge = createSettingsBridge({
      extraTabs: [tab("connections", { label: "Connections" })],
    });
    expect(bridge.tab("integrations", "connections")?.label).toBe(
      "Connections",
    );
    expect(bridge.tab("keys")).toBeUndefined();
  });

  it("moves a core tab's search entries onto the page that owns it", () => {
    const bridge = createSettingsBridge({
      extraTabs: [
        tab("agent", {
          searchEntries: [
            {
              id: "agent-tone",
              label: "Tone",
              hash: "tone",
              keywords: "voice",
            },
            // Core's own section rows are indexed by the shell, translated.
            { id: "section:llm", label: "LLM", hash: "llm", keywords: "llm" },
          ],
        }),
      ],
      generalSearchEntries: [
        { id: "clips-language", label: "Language", hash: "language" },
      ],
    });
    const entries = bridgedCoreSearchEntries(bridge, CORE_SETTINGS_PAGES);
    expect(entries.get("model")).toEqual([
      { id: "agent-tone", label: "Tone", keywords: "voice", anchor: "tone" },
    ]);
    expect(entries.get("app")).toEqual([
      {
        id: "clips-language",
        label: "Language",
        keywords: "",
        anchor: "language",
      },
    ]);
  });

  it("sends a tab's entry to the page its link names", () => {
    const bridge = createSettingsBridge({
      extraTabs: [
        tab("agent:resources", {
          searchEntries: [
            { id: "files", label: "Files", hash: "agent:resources:files" },
            { id: "memory", label: "Memory", hash: "agent:resources:memory" },
            {
              id: "learnings",
              label: "Learnings",
              hash: "agent:resources:learnings",
            },
            {
              id: "remote-agents",
              label: "Remote agents",
              hash: "agent:resources:remote-agents",
            },
          ],
        }),
      ],
    });
    const entries = bridgedCoreSearchEntries(bridge, CORE_SETTINGS_PAGES);
    const ids = (pageId: string) =>
      (entries.get(pageId) ?? []).map((entry) => entry.id);
    expect(ids("files")).toEqual(["files"]);
    expect(ids("memory")).toEqual(["memory", "learnings"]);
    expect(ids("sub-agents")).toEqual(["remote-agents"]);
    // The link opens the page; it is not a section on it.
    expect(entries.get("sub-agents")?.[0]?.anchor).toBeUndefined();
  });
});
