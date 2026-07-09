import {
  IconHistory,
  IconSearch,
  IconSettings,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import { cn } from "../utils.js";

type SettingsTabIcon = ComponentType<{ className?: string }>;

/**
 * A single deep-link target inside settings that the settings search can jump
 * to. Entries usually map to a section within a tab (via a `hash`/anchor id),
 * making individual controls discoverable without hunting through every tab.
 */
export interface SettingsSearchEntry {
  /** Stable unique id for the entry. */
  id: string;
  /** Primary label shown in the search results. */
  label: string;
  /** Extra space-separated terms to match against (synonyms, provider names). */
  keywords?: string;
  /** Optional secondary description shown under the label. */
  description?: string;
  /** Tab to activate when the entry is picked. Defaults to the owning tab. */
  tabId?: string;
  /**
   * Optional section id / DOM element id to open + scroll to after switching
   * tabs. Handled by the inner panels' own hash listeners.
   */
  hash?: string;
  /** Optional icon override; defaults to the owning tab's icon. */
  icon?: SettingsTabIcon;
}

export interface SettingsTabItem {
  id: string;
  label: string;
  icon?: SettingsTabIcon;
  content: ReactNode;
  /** Extra space-separated terms so this tab is findable via search. */
  keywords?: string;
  /** Deep-link entries within this tab for the settings search. */
  searchEntries?: SettingsSearchEntry[];
}

export interface SettingsTabsPageProps {
  general: ReactNode;
  team?: ReactNode;
  whatsNew?: ReactNode;
  extraTabs?: SettingsTabItem[];
  generalLabel?: string;
  teamLabel?: string;
  whatsNewLabel?: string;
  ariaLabel?: string;
  defaultTab?: string;
  className?: string;
  navClassName?: string;
  contentClassName?: string;
  /** Whether to render the settings search box. Defaults to true. */
  enableSearch?: boolean;
  /** Placeholder for the settings search box. */
  searchPlaceholder?: string;
  /** Extra global search entries (e.g. anchors within the General tab). */
  searchEntries?: SettingsSearchEntry[];
  /** Deep-link entries for the General tab. */
  generalSearchEntries?: SettingsSearchEntry[];
  /**
   * Controlled active tab id. When provided, the parent owns tab state (and is
   * responsible for URL/app-state sync); the component skips its own hash-based
   * tab tracking. Leave undefined for the default uncontrolled, hash-driven
   * behavior.
   */
  value?: string;
  /**
   * Called whenever the active tab changes via a tab click or a search result
   * selection. Fires in both controlled and uncontrolled modes.
   */
  onValueChange?: (tabId: string) => void;
}

interface ResolvedSearchEntry extends SettingsSearchEntry {
  tabId: string;
  tabLabel: string;
  icon?: SettingsTabIcon;
  haystack: string;
}

function normalizeTabId(value?: string | null): string | null {
  const normalized = value
    ?.replace(/^#/, "")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[\s_]+/g, "-");
  if (!normalized) return null;
  if (
    normalized === "whats-new" ||
    normalized === "what-s-new" ||
    normalized === "changelog" ||
    normalized === "updates"
  ) {
    return "whats-new";
  }
  if (normalized === "workspace" || normalized === "workspace-settings") {
    return "workspace";
  }
  return normalized;
}

function resolveTabId(
  tabs: SettingsTabItem[],
  value?: string | null,
): string | null {
  const normalized = normalizeTabId(value);
  if (!normalized) return null;
  if (tabs.some((tab) => tab.id === normalized)) return normalized;
  if (
    normalized === "organization" ||
    normalized === "org" ||
    normalized === "team"
  ) {
    if (tabs.some((tab) => tab.id === "organization")) return "organization";
    if (tabs.some((tab) => tab.id === "team")) return "team";
  }
  return null;
}

function activeTabFromHash(
  tabs: SettingsTabItem[],
  defaultTab: string,
): string {
  if (typeof window === "undefined") return defaultTab;
  return resolveTabId(tabs, window.location.hash) ?? defaultTab;
}

function updateHashForTab(tabId: string) {
  if (typeof window === "undefined") return;
  const { pathname, search } = window.location;
  const hash = tabId === "general" ? "" : `#${encodeURIComponent(tabId)}`;
  window.history.pushState(null, "", `${pathname}${search}${hash}`);
}

export function SettingsTabsPage({
  general,
  team,
  whatsNew,
  extraTabs = [],
  generalLabel = "General",
  teamLabel = "Team",
  whatsNewLabel = "What's new",
  ariaLabel = "Settings sections",
  defaultTab = "general",
  className,
  navClassName,
  contentClassName,
  enableSearch = true,
  searchPlaceholder = "Search settings",
  searchEntries,
  generalSearchEntries,
  value,
  onValueChange,
}: SettingsTabsPageProps) {
  const tabs = useMemo<SettingsTabItem[]>(() => {
    const hasOrganizationTab = extraTabs.some(
      (tab) => tab.id === "organization",
    );
    const next: SettingsTabItem[] = [
      {
        id: "general",
        label: generalLabel,
        icon: IconSettings,
        content: general,
        searchEntries: generalSearchEntries,
      },
    ];
    next.push(...extraTabs);
    if (team && !hasOrganizationTab) {
      next.push({
        id: "team",
        label: teamLabel,
        icon: IconUsers,
        content: team,
      });
    }
    if (whatsNew) {
      next.push({
        id: "whats-new",
        label: whatsNewLabel,
        icon: IconHistory,
        content: whatsNew,
      });
    }
    return next;
  }, [
    extraTabs,
    general,
    generalLabel,
    generalSearchEntries,
    team,
    teamLabel,
    whatsNew,
    whatsNewLabel,
  ]);

  const fallbackTab = tabs.some((tab) => tab.id === defaultTab)
    ? defaultTab
    : (tabs[0]?.id ?? "general");
  const isControlled = value !== undefined;
  const [internalTab, setInternalTab] = useState(() =>
    activeTabFromHash(tabs, fallbackTab),
  );
  const activeTab = isControlled ? value : internalTab;
  const [query, setQuery] = useState("");

  const changeTab = useCallback(
    (tabId: string) => {
      if (!isControlled) setInternalTab(tabId);
      onValueChange?.(tabId);
    },
    [isControlled, onValueChange],
  );

  useEffect(() => {
    // In controlled mode the parent owns (and validates) the active tab.
    if (isControlled) return;
    if (tabs.some((tab) => tab.id === internalTab)) return;
    setInternalTab(fallbackTab);
  }, [fallbackTab, internalTab, isControlled, tabs]);

  useEffect(() => {
    // Hash-driven tab tracking only applies to the uncontrolled mode. Only
    // react to hashes that name a top-level tab. Section-level hashes
    // (e.g. `#llm`, `#secrets`) are consumed by the inner panels, so leave
    // the active tab untouched to avoid bouncing back to General.
    if (isControlled) return;
    const handleHashChange = () => {
      const fromHash = resolveTabId(tabs, window.location.hash);
      if (fromHash) {
        setInternalTab(fromHash);
      }
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [isControlled, tabs]);

  const selectedTab = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  // Flatten tab + deep-link entries into one searchable index.
  const searchIndex = useMemo<ResolvedSearchEntry[]>(() => {
    const entries: ResolvedSearchEntry[] = [];
    const seen = new Set<string>();
    const add = (entry: ResolvedSearchEntry) => {
      if (seen.has(entry.id)) return;
      seen.add(entry.id);
      entries.push(entry);
    };
    for (const tab of tabs) {
      add({
        id: `tab:${tab.id}`,
        label: tab.label,
        keywords: tab.keywords,
        tabId: tab.id,
        tabLabel: tab.label,
        icon: tab.icon,
        haystack: `${tab.label} ${tab.keywords ?? ""}`.toLowerCase(),
      });
      for (const sub of tab.searchEntries ?? []) {
        add({
          ...sub,
          tabId: sub.tabId ?? tab.id,
          tabLabel: tab.label,
          icon: sub.icon ?? tab.icon,
          haystack:
            `${sub.label} ${sub.keywords ?? ""} ${sub.description ?? ""} ${tab.label}`.toLowerCase(),
        });
      }
    }
    for (const sub of searchEntries ?? []) {
      const owner = tabs.find((tab) => tab.id === (sub.tabId ?? "general"));
      add({
        ...sub,
        tabId: sub.tabId ?? "general",
        tabLabel: owner?.label ?? sub.tabId ?? "General",
        icon: sub.icon ?? owner?.icon,
        haystack:
          `${sub.label} ${sub.keywords ?? ""} ${sub.description ?? ""} ${owner?.label ?? ""}`.toLowerCase(),
      });
    }
    return entries;
  }, [searchEntries, tabs]);

  const trimmedQuery = query.trim().toLowerCase();
  const results = useMemo<ResolvedSearchEntry[]>(() => {
    if (!trimmedQuery) return [];
    const terms = trimmedQuery.split(/\s+/).filter(Boolean);
    return searchIndex
      .filter((entry) => terms.every((term) => entry.haystack.includes(term)))
      .sort((a, b) => {
        const aStarts = a.label.toLowerCase().startsWith(trimmedQuery) ? 0 : 1;
        const bStarts = b.label.toLowerCase().startsWith(trimmedQuery) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.label.localeCompare(b.label);
      });
  }, [searchIndex, trimmedQuery]);

  const selectEntry = (entry: ResolvedSearchEntry) => {
    changeTab(entry.tabId);
    setQuery("");
    if (typeof window === "undefined") return;
    const hash = entry.hash?.replace(/^#/, "");
    if (hash) {
      const { pathname, search } = window.location;
      window.history.pushState(null, "", `${pathname}${search}#${hash}`);
      // Let the inner panels open + scroll to their section.
      window.dispatchEvent(new Event("hashchange"));
      window.requestAnimationFrame(() => {
        document
          .getElementById(hash)
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    } else if (!isControlled) {
      updateHashForTab(entry.tabId);
    }
  };

  const searching = enableSearch && trimmedQuery.length > 0;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background sm:flex-row",
        className,
      )}
    >
      <div
        className={cn(
          "flex shrink-0 flex-col gap-2 border-b border-border bg-background p-2 sm:min-h-0 sm:w-56 sm:overflow-y-auto sm:border-b-0 sm:border-e sm:p-3",
          navClassName,
        )}
      >
        {enableSearch ? (
          <div className="relative sm:mb-1">
            <IconSearch className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setQuery("");
                if (event.key === "Enter" && results[0]) {
                  event.preventDefault();
                  selectEntry(results[0]);
                }
              }}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-8 w-full rounded-md border border-border bg-background ps-8 pe-7 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/30 focus:ring-2 focus:ring-accent/40"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute end-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              >
                <IconX className="size-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}

        {searching ? (
          <div
            role="listbox"
            aria-label="Settings search results"
            className="flex flex-col gap-0.5"
          >
            {results.length === 0 ? (
              <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
                No matching settings
              </p>
            ) : (
              results.map((entry) => {
                const Icon = entry.icon;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => selectEntry(entry)}
                    className="flex items-start gap-2 rounded-md px-2.5 py-2 text-start text-sm text-foreground transition-colors hover:bg-accent/60"
                  >
                    {Icon ? (
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : null}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">
                        {entry.label}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {entry.description ?? entry.tabLabel}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        ) : (
          <nav
            aria-label={ariaLabel}
            role="tablist"
            className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-x-visible"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const selected = tab.id === selectedTab?.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`settings-tabpanel-${tab.id}`}
                  id={`settings-tab-${tab.id}`}
                  onClick={() => {
                    changeTab(tab.id);
                    if (!isControlled) updateHashForTab(tab.id);
                  }}
                  className={cn(
                    "flex min-h-9 shrink-0 items-center gap-2 rounded-md px-3 py-2 text-start text-sm font-medium transition-colors sm:w-full",
                    selected
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  {Icon ? (
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        selected ? "text-foreground" : "text-muted-foreground",
                      )}
                    />
                  ) : null}
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        )}
      </div>
      <div
        id={`settings-tabpanel-${selectedTab?.id ?? "general"}`}
        role="tabpanel"
        aria-labelledby={`settings-tab-${selectedTab?.id ?? "general"}`}
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6",
          contentClassName,
        )}
      >
        {selectedTab?.content}
      </div>
    </div>
  );
}
