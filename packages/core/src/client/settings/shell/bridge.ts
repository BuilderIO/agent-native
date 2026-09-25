import { IconSettings } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { CHATGPT_SUBSCRIPTION_LAB } from "../../../labs/core-labs.js";
import type { LabDefinition } from "../../../labs/registry.js";
import type {
  SettingsSearchEntry,
  SettingsTabItem,
} from "../SettingsTabsPage.js";
import type {
  SettingsPageDefinition,
  SettingsPageSearchEntry,
} from "./registry.js";

/**
 * Today's `SettingsTabsPage` props, as the shell receives them. Templates keep
 * passing these until their migration task, so every tab stays reachable with
 * the flag on.
 */
export interface SettingsBridgeInput {
  general?: ReactNode;
  account?: ReactNode;
  team?: ReactNode;
  whatsNew?: ReactNode;
  extraTabs?: readonly SettingsTabItem[];
  labs?: readonly LabDefinition[];
  labsLabel?: string;
  labsIntro?: string;
  generalSearchEntries?: readonly SettingsSearchEntry[];
  searchEntries?: readonly SettingsSearchEntry[];
}

export interface SettingsBridge {
  general: ReactNode | null;
  account: ReactNode | null;
  team: ReactNode | null;
  whatsNew: ReactNode | null;
  /** App labs plus the core labs every app shows. */
  labs: readonly LabDefinition[];
  labsLabel?: string;
  labsIntro?: string;
  tabs: readonly SettingsTabItem[];
  /** Tabs marked `settingsPlacement: "app-area"`, shown as tabs on the app's General page. */
  appAreas: readonly SettingsTabItem[];
  generalSearchEntries: readonly SettingsSearchEntry[];
  searchEntries: readonly SettingsSearchEntry[];
  /** The first template tab whose id is one of `ids`, in the order given. */
  tab: (...ids: string[]) => SettingsTabItem | undefined;
  /** The template tab behind a page the bridge derived from `extraTabs`. */
  tabForPage: (pageId: string) => SettingsTabItem | undefined;
}

export const EMPTY_SETTINGS_BRIDGE: SettingsBridge = createSettingsBridge({});

export function createSettingsBridge(
  input: SettingsBridgeInput,
  pageTabs: ReadonlyMap<string, SettingsTabItem> = new Map(),
): SettingsBridge {
  const tabs = input.extraTabs ?? [];
  const labs = input.labs ?? [];
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  return {
    general: input.general ?? null,
    account: input.account ?? null,
    team: input.team ?? null,
    whatsNew: input.whatsNew ?? null,
    labs: labs.some((lab) => lab.key === CHATGPT_SUBSCRIPTION_LAB.key)
      ? labs
      : [CHATGPT_SUBSCRIPTION_LAB, ...labs],
    labsLabel: input.labsLabel,
    labsIntro: input.labsIntro,
    tabs,
    appAreas: tabs.filter((tab) => tab.settingsPlacement === "app-area"),
    generalSearchEntries: input.generalSearchEntries ?? [],
    searchEntries: input.searchEntries ?? [],
    tab: (...ids) => {
      for (const id of ids) {
        const tab = byId.get(id);
        if (tab) return tab;
      }
      return undefined;
    },
    tabForPage: (pageId) => pageTabs.get(pageId),
  };
}

function pageIdFromTabId(tabId: string): string {
  return (
    tabId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "tab"
  );
}

function toPageSearchEntry(
  entry: SettingsSearchEntry,
): SettingsPageSearchEntry {
  return {
    id: entry.id,
    label: entry.label,
    keywords: [entry.keywords, entry.description].filter(Boolean).join(" "),
    anchor: entry.hash?.replace(/^#/, "") || undefined,
  };
}

function searchEntriesFromTab(tab: SettingsTabItem): SettingsPageSearchEntry[] {
  return (tab.searchEntries ?? []).map(toPageSearchEntry);
}

export interface BridgedAppPages {
  pages: SettingsPageDefinition[];
  pageTabs: Map<string, SettingsTabItem>;
}

/**
 * Template tabs no core page claims become pages in the app's group, right
 * after its General page, in the order the template passed them. An id that
 * collides with a core page (Mail's inbox `automations`) gets an `app-`
 * prefix so it never shadows the core page.
 */
export function deriveBridgedAppPages(
  tabs: readonly SettingsTabItem[],
  corePages: readonly SettingsPageDefinition[],
  component: SettingsPageDefinition["component"],
): BridgedAppPages {
  const claimed = new Set(corePages.flatMap((page) => page.legacyTabIds ?? []));
  const taken = new Set(corePages.map((page) => page.id));
  const pages: SettingsPageDefinition[] = [];
  const pageTabs = new Map<string, SettingsTabItem>();
  tabs.forEach((tab, index) => {
    if (claimed.has(tab.id) || tab.settingsPlacement === "app-area") return;
    const base = pageIdFromTabId(tab.id);
    let id = taken.has(base) ? `app-${base}` : base;
    for (let suffix = 2; taken.has(id); suffix += 1)
      id = `app-${base}-${suffix}`;
    taken.add(id);
    pageTabs.set(id, tab);
    pages.push({
      id,
      group: "app",
      order: 11 + index / 1000,
      label: tab.label,
      icon: tab.icon ?? IconSettings,
      component,
      legacyTabIds: [tab.id],
      href: tab.href,
      keywords: tab.keywords,
      searchEntries: searchEntriesFromTab(tab),
    });
  });
  return { pages, pageTabs };
}

/**
 * Search entries today's core tabs carry (their section anchors), keyed by
 * the page that now answers for each. An entry whose link is another page's
 * legacy tab id belongs to that page: the Resources tab lists Memory,
 * Learnings, and Remote agents, and the Files page that claims the tab shows
 * none of them.
 */
export function bridgedCoreSearchEntries(
  bridge: SettingsBridge,
  pages: readonly SettingsPageDefinition[],
): Map<string, SettingsPageSearchEntry[]> {
  const ownerByLegacyId = new Map<string, string>();
  for (const page of pages) {
    for (const id of page.legacyTabIds ?? []) {
      if (!ownerByLegacyId.has(id)) ownerByLegacyId.set(id, page.id);
    }
  }
  const byPage = new Map<string, SettingsPageSearchEntry[]>();
  const add = (pageId: string, entry: SettingsPageSearchEntry) => {
    const entries = byPage.get(pageId);
    if (entries) entries.push(entry);
    else byPage.set(pageId, [entry]);
  };
  const seenTabs = new Set<string>();
  for (const page of pages) {
    // A page derived from a template tab carries that tab's entries itself.
    if (bridge.tabForPage(page.id)) continue;
    for (const id of page.legacyTabIds ?? []) {
      const tab = bridge.tab(id);
      if (!tab || seenTabs.has(tab.id)) continue;
      seenTabs.add(tab.id);
      for (const entry of searchEntriesFromTab(tab)) {
        const owner = entry.anchor && ownerByLegacyId.get(entry.anchor);
        if (owner && owner !== page.id) {
          add(owner, { ...entry, anchor: undefined });
        } else {
          add(page.id, entry);
        }
      }
    }
  }
  for (const entry of bridge.generalSearchEntries) {
    add("app", toPageSearchEntry(entry));
  }
  return byPage;
}
