import { IconHistory, IconSettings, IconUsers } from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import { cn } from "../utils.js";

type SettingsTabIcon = ComponentType<{ className?: string }>;

export interface SettingsTabItem {
  id: string;
  label: string;
  icon?: SettingsTabIcon;
  content: ReactNode;
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
  if (
    normalized === "workspace" ||
    normalized === "workspace-settings" ||
    normalized === "organization" ||
    normalized === "org"
  ) {
    return "team";
  }
  return normalized;
}

function activeTabFromHash(
  tabs: SettingsTabItem[],
  defaultTab: string,
): string {
  if (typeof window === "undefined") return defaultTab;
  const fromHash = normalizeTabId(window.location.hash);
  if (fromHash && tabs.some((tab) => tab.id === fromHash)) return fromHash;
  return defaultTab;
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
}: SettingsTabsPageProps) {
  const tabs = useMemo<SettingsTabItem[]>(() => {
    const next: SettingsTabItem[] = [
      {
        id: "general",
        label: generalLabel,
        icon: IconSettings,
        content: general,
      },
    ];
    if (team) {
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
    next.push(...extraTabs);
    return next;
  }, [
    extraTabs,
    general,
    generalLabel,
    team,
    teamLabel,
    whatsNew,
    whatsNewLabel,
  ]);

  const fallbackTab = tabs.some((tab) => tab.id === defaultTab)
    ? defaultTab
    : (tabs[0]?.id ?? "general");
  const [activeTab, setActiveTab] = useState(() =>
    activeTabFromHash(tabs, fallbackTab),
  );

  useEffect(() => {
    if (tabs.some((tab) => tab.id === activeTab)) return;
    setActiveTab(fallbackTab);
  }, [activeTab, fallbackTab, tabs]);

  useEffect(() => {
    const handleHashChange = () => {
      setActiveTab(activeTabFromHash(tabs, fallbackTab));
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [fallbackTab, tabs]);

  const selectedTab = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  return (
    <div
      className={cn(
        "flex min-h-full w-full flex-col overflow-hidden bg-background sm:flex-row",
        className,
      )}
    >
      <nav
        aria-label={ariaLabel}
        role="tablist"
        className={cn(
          "flex shrink-0 gap-1 overflow-x-auto border-b border-border/50 bg-muted/30 p-2 sm:w-48 sm:flex-col sm:overflow-x-visible sm:border-b-0 sm:border-e",
          navClassName,
        )}
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
                setActiveTab(tab.id);
                updateHashForTab(tab.id);
              }}
              className={cn(
                "flex min-h-9 shrink-0 items-center gap-2 rounded-md px-3 py-2 text-start text-sm font-medium transition-colors sm:w-full",
                selected
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
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
      <div
        id={`settings-tabpanel-${selectedTab?.id ?? "general"}`}
        role="tabpanel"
        aria-labelledby={`settings-tab-${selectedTab?.id ?? "general"}`}
        className={cn(
          "min-w-0 flex-1 overflow-y-auto p-4 sm:p-6",
          contentClassName,
        )}
      >
        {selectedTab?.content}
      </div>
    </div>
  );
}
