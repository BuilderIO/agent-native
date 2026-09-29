import { IconSettings } from "@tabler/icons-react";
import { Children, isValidElement, type ReactNode } from "react";

import { CHATGPT_SUBSCRIPTION_LAB } from "../../../labs/core-labs.js";
import type { LabDefinition } from "../../../labs/registry.js";
import { isCoreSectionSearchEntryId } from "../agent-settings-search.js";
import { withAppSettingsTabs } from "../app-settings-tabs.js";
import type {
  SettingsAppArea,
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
  /** The app's own General groups; win over `general` on the app General page. */
  generalGroups?: ReactNode;
  account?: ReactNode;
  team?: ReactNode;
  whatsNew?: ReactNode;
  extraTabs?: readonly SettingsTabItem[];
  appAreas?: readonly SettingsAppArea[];
  notifications?: ReactNode;
  notificationsLabel?: string;
  notificationsSearchEntries?: readonly SettingsSearchEntry[];
  labs?: readonly LabDefinition[];
  labsLabel?: string;
  labsIntro?: string;
  generalSearchEntries?: readonly SettingsSearchEntry[];
  searchEntries?: readonly SettingsSearchEntry[];
  /** The MCP server page's about line. Already translated. */
  mcpAbout?: string;
  /** The app group's display name. */
  appName?: string;
  /** Raw CHANGELOG.md behind What's new. */
  whatsNewMarkdown?: string;
}

export interface SettingsBridge {
  /** The app General page's own groups: `generalGroups`, else today's General tab. */
  general: ReactNode | null;
  account: ReactNode | null;
  team: ReactNode | null;
  whatsNew: ReactNode | null;
  /** Raw CHANGELOG.md, passed or read off today's changelog card. */
  whatsNewMarkdown: string | null;
  /** `null` outside the shell, which always names the app group. */
  appName: string | null;
  mcpAbout: string | null;
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
  // The shell names the Notifications page itself, so this tab's label is
  // only read by today's tabs.
  const tabs = withAppSettingsTabs(
    input.extraTabs,
    input,
    input.notificationsLabel ?? "",
  );
  const labs = input.labs ?? [];
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  return {
    general: input.generalGroups ?? input.general ?? null,
    account: input.account ?? null,
    team: input.team ?? null,
    whatsNew: input.whatsNew ?? null,
    whatsNewMarkdown:
      input.whatsNewMarkdown ?? changelogMarkdownFrom(input.whatsNew) ?? null,
    appName: input.appName?.trim() || null,
    mcpAbout: input.mcpAbout?.trim() || null,
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

/**
 * The markdown today's `<ChangelogSettingsCard markdown>` renders, found
 * through the wrappers templates put around it, so What's new gets its dot
 * and its page without a template change.
 */
export function changelogMarkdownFrom(
  node: ReactNode,
  depth = 0,
): string | undefined {
  if (depth > 4 || !isValidElement(node)) return undefined;
  const props = node.props as { markdown?: unknown; children?: ReactNode };
  if (typeof props.markdown === "string") return props.markdown;
  for (const child of Children.toArray(props.children)) {
    const markdown = changelogMarkdownFrom(child, depth + 1);
    if (markdown !== undefined) return markdown;
  }
  return undefined;
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
        // The shell indexes core sections itself, translated and on the page
        // the redirect table sends them to.
        if (isCoreSectionSearchEntryId(entry.id)) continue;
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
  // App areas are tabs on the app's General page, so their hits open it with
  // the area as the sub-page.
  for (const area of bridge.appAreas) {
    add("app", {
      id: `app-area:${area.id}`,
      label: area.label,
      keywords: area.keywords,
      sub: area.id,
    });
    for (const entry of searchEntriesFromTab(area)) {
      add("app", { ...entry, sub: area.id });
    }
  }
  for (const lab of bridge.labs) {
    add("labs", {
      id: `lab:${lab.key}`,
      label: lab.displayName ?? lab.key,
      keywords: [lab.key, lab.keywords, lab.description]
        .filter(Boolean)
        .join(" "),
      anchor: `lab-${lab.key}`,
    });
  }
  return byPage;
}
