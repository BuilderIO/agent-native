import { Tabs, useDesignSystem } from "@agent-native/toolkit/design-system";
import {
  IconFlask,
  IconHistory,
  IconSearch,
  IconSettings,
  IconUserCircle,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { QueryClientContext } from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { Link, useInRouterContext, useLocation } from "react-router";

import { appMountPath, appMountedPath } from "../../client/api-path.js";
import { SETTINGS_REDESIGN_FLAG } from "../../feature-flags/registry.js";
import { CHATGPT_SUBSCRIPTION_LAB } from "../../labs/core-labs.js";
import type { LabDefinition } from "../../labs/registry.js";
import {
  buildSettingsEntryRoute,
  STANDARD_APP_ROUTES,
} from "../../navigation/index.js";
import { legacySettingsTabIdsForPage } from "../../navigation/settings-redirects.js";
import { useFeatureFlagState } from "../feature-flags/use-feature-flag.js";
import { useT } from "../i18n.js";
import { LabsSettings } from "../labs/LabsSettings.js";
import { cn } from "../utils.js";
import { withAppSettingsTabs } from "./app-settings-tabs.js";
import { SettingsShellSkeleton } from "./shell/SettingsShellSkeleton.js";

const SettingsShell = lazy(() =>
  import("./shell/SettingsShell.js").then((module) => ({
    default: module.SettingsShell,
  })),
);

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
  /** Optional route for settings that live on a canonical page elsewhere. */
  href?: string;
  /** Whether a parent surface may expose a personal/organization scope for this tab. */
  scopeAware?: boolean;
  /**
   * Optional visual navigation group. Adjacent tabs with the same group render
   * together; a quiet divider separates each group on desktop while mobile
   * keeps the compact horizontal tab scroller unchanged.
   */
  group?: string;
  /** Optional human-readable label for the visual navigation group. */
  groupLabel?: string;
  /** Extra space-separated terms so this tab is findable via search. */
  keywords?: string;
  /** Deep-link entries within this tab for the settings search. */
  searchEntries?: SettingsSearchEntry[];
  /**
   * Where the redesigned Settings shell (`settings-redesign` flag) puts this
   * app tab. By default it becomes its own page in the app's group;
   * `"app-area"` makes it a tab on the app's General page (`/settings/app/<id>`).
   * Ignored by today's tabs.
   */
  settingsPlacement?: "page" | "app-area";
  /**
   * For a core tab whose page the redesigned Settings shell rebuilt: the
   * template-supplied part of `content` that page still renders, since the
   * rest of `content` is the old layout it replaces. Ignored by today's tabs.
   */
  shellExtraContent?: ReactNode;
}

/**
 * One of the app's own areas. The redesigned Settings shows it as a tab on
 * the app's General page (`/settings/app/<id>`); today's tabs show it as its
 * own tab.
 */
export interface SettingsAppArea {
  /** Route segment, lowercase and hyphenated: `/settings/app/<id>`. */
  id: string;
  label: string;
  content: ReactNode;
  /** `false` hides the area, for example while the lab behind it is off. */
  visible?: boolean;
  /** Today's tab icon. */
  icon?: SettingsTabIcon;
  keywords?: string;
  /** Row-level search hits. `hash` is the row's `SettingsRow` id. */
  searchEntries?: SettingsSearchEntry[];
}

export interface SettingsTabsPageProps {
  /**
   * Today's General tab. The redesigned app General page shows
   * `generalGroups` instead when a template passes both.
   */
  general?: ReactNode;
  /**
   * The app's own groups on its General page in the redesigned Settings,
   * between core's Agent and This browser groups. Today's General tab shows
   * `general` when both are passed, else these.
   */
  generalGroups?: ReactNode;
  /** The app's own areas, as tabs on its General page (see `SettingsAppArea`). */
  appAreas?: readonly SettingsAppArea[];
  /** The app's notification settings. The Notifications page shows only when passed. */
  notifications?: ReactNode;
  /** Today's Notifications tab label. */
  notificationsLabel?: string;
  /** Row-level search hits on the Notifications page. */
  notificationsSearchEntries?: SettingsSearchEntry[];
  /**
   * The MCP server page's about line, naming what an MCP host can do in this
   * app. Already translated.
   */
  mcpAbout?: string;
  account?: ReactNode;
  team?: ReactNode;
  whatsNew?: ReactNode;
  extraTabs?: SettingsTabItem[];
  /** User labs to expose in the searchable settings surface. */
  labs?: readonly LabDefinition[];
  labsLabel?: string;
  labsIntro?: string;
  generalLabel?: string;
  accountLabel?: string;
  teamLabel?: string;
  whatsNewLabel?: string;
  ariaLabel?: string;
  defaultTab?: string;
  className?: string;
  navClassName?: string;
  /** Optional content rendered at the top of the settings navigation rail. */
  navHeader?: ReactNode;
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
   * responsible for URL/app-state sync). Recognized top-level tab hashes still
   * report through `onValueChange`, so shared links such as
   * `/settings/organization` can select the matching controlled Team tab.
   * Legacy hash links remain supported and are canonicalized on load.
   */
  value?: string;
  /**
   * Called whenever the active tab changes via a tab click or a search result
   * selection. Fires in both controlled and uncontrolled modes.
   */
  onValueChange?: (tabId: string) => void;
  /** The redesigned shell's app group label. Defaults to the template's display name. */
  appName?: string;
  /** The redesigned shell's app group icon. Defaults to the template's icon. */
  appIcon?: SettingsTabIcon;
  /** App id for the redesigned shell (changelog unread state, usage). Defaults to the template id. */
  appId?: string;
  /** Raw CHANGELOG.md, for the redesigned shell's What's new unread dot. */
  whatsNewMarkdown?: string;
  /**
   * Set false on surfaces that are not an app's Settings (the desktop shell's
   * own settings) so they never adopt the redesigned shell or wait on the
   * `settings-redesign` flag.
   */
  redesign?: boolean;
}

interface ResolvedSearchEntry extends SettingsSearchEntry {
  tabId: string;
  tabLabel: string;
  icon?: SettingsTabIcon;
  haystack: string;
}

interface SettingsRouterLocation {
  pathname: string;
  hash: string;
}

function normalizeTabId(value?: string | null): string | null {
  let decoded = value?.replace(/^#/, "").trim() ?? "";
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // coercion-ok: preserve malformed external hashes for routing fallback.
    // Keep the raw hash when an external link contains malformed encoding.
  }
  const normalized = decoded
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

function normalizeSettingsRoute(value: string): string {
  const normalized = normalizeTabId(value) ?? value;
  const legacyPrefixes = [
    ["labs:experiments:experiment-", "labs:lab-"],
    ["experiments:experiment-", "labs:lab-"],
    ["experiment-", "labs:lab-"],
  ] as const;
  for (const [legacyPrefix, canonicalPrefix] of legacyPrefixes) {
    if (normalized.startsWith(legacyPrefix)) {
      return `${canonicalPrefix}${normalized.slice(legacyPrefix.length)}`;
    }
  }
  return normalized;
}

function resolveTabId(
  tabs: SettingsTabItem[],
  value?: string | null,
): string | null {
  const normalized = normalizeSettingsRoute(value ?? "");
  if (!normalized) return null;
  if (tabs.some((tab) => tab.id === normalized)) return normalized;
  // Keep old settings links working after the user-facing tab rename.
  if (
    (normalized === "experiments" || normalized.startsWith("experiments:")) &&
    tabs.some((tab) => tab.id === "labs")
  ) {
    return "labs";
  }
  // Legacy `#browser` deep links: the Browser Automation section now lives
  // inside the merged Integrations tab (id varies by consumer).
  if (normalized === "browser") {
    const browserOwner = tabs.find(
      (tab) => tab.id === "integrations" || tab.id === "connections",
    );
    if (browserOwner) return browserOwner.id;
  }
  const alternateTabId =
    normalized === "connections"
      ? "integrations"
      : normalized === "integrations"
        ? "connections"
        : normalized === "secrets"
          ? "keys"
          : normalized === "keys"
            ? "secrets"
            : null;
  if (alternateTabId && tabs.some((tab) => tab.id === alternateTabId)) {
    return alternateTabId;
  }
  const nestedTab = tabs
    .filter(
      (tab) =>
        normalized.startsWith(`${tab.id}:`) ||
        tab.id.startsWith(`${normalized}:`),
    )
    .sort((a, b) => b.id.length - a.id.length)[0];
  if (nestedTab) return nestedTab.id;
  const section = normalized.split(":", 1)[0];
  if (tabs.some((tab) => tab.id === section)) return section;
  const owner = tabs.find((tab) =>
    tab.searchEntries?.some(
      (entry) => normalizeTabId(entry.hash ?? entry.id) === section,
    ),
  );
  if (owner) return owner.id;
  if (
    normalized === "organization" ||
    normalized === "org" ||
    normalized === "team"
  ) {
    if (tabs.some((tab) => tab.id === "organization")) return "organization";
    if (tabs.some((tab) => tab.id === "team")) return "team";
  }
  // A link built from a redesigned page id (`/settings/model`) opens the tab
  // that holds that page's content today.
  const [pageId = "", sub] = normalized.split(":");
  return (
    legacySettingsTabIdsForPage(pageId, sub).find((id) =>
      tabs.some((tab) => tab.id === id),
    ) ?? null
  );
}

function activeTabFromLocation(
  tabs: SettingsTabItem[],
  defaultTab: string,
  location?: SettingsRouterLocation,
): string {
  if (typeof window === "undefined" && !location) return defaultTab;
  const pathname = appLocalPathname(location?.pathname);
  const hash = location?.hash ?? window.location.hash;
  const settingsPrefix = "/settings";
  if (pathname === settingsPrefix) {
    return resolveTabId(tabs, hash) ?? defaultTab;
  }
  if (pathname.startsWith(`${settingsPrefix}/`)) {
    const segments = pathname
      .slice(`${settingsPrefix}/`.length)
      .split("/")
      .filter(Boolean)
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      });
    for (let length = segments.length; length > 0; length -= 1) {
      const tabId = resolveTabId(tabs, segments.slice(0, length).join(":"));
      if (tabId) return tabId;
    }
  }
  return resolveTabId(tabs, hash) ?? defaultTab;
}

function appLocalPathname(pathname?: string): string {
  if (typeof window === "undefined" && !pathname) return "/";
  const currentPathname = pathname ?? window.location.pathname;
  const mountPath = appMountPath(STANDARD_APP_ROUTES.settings);
  if (
    mountPath &&
    (currentPathname === mountPath ||
      currentPathname.startsWith(`${mountPath}/`))
  ) {
    return currentPathname.slice(mountPath.length) || "/";
  }
  return currentPathname;
}

function updateRouteForTab(tabId: string, section?: string) {
  if (typeof window === "undefined") return;
  const route = buildSettingsEntryRoute(
    tabId,
    section ? normalizeSettingsRoute(section) : section,
  );
  window.history.pushState(
    null,
    "",
    `${appMountedPath(route, STANDARD_APP_ROUTES.settings)}${window.location.search}`,
  );
  window.dispatchEvent(new Event("popstate"));
}

function isEditableElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const tagName = element.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    element.isContentEditable
  );
}

function SettingsTabsPageContent({
  general: generalTab,
  generalGroups,
  account,
  team,
  whatsNew,
  extraTabs: templateTabs,
  appAreas,
  notifications,
  notificationsLabel,
  notificationsSearchEntries,
  generalLabel = "General",
  accountLabel = "Account",
  teamLabel = "Team",
  whatsNewLabel = "What's new",
  ariaLabel = "Settings sections",
  defaultTab = "general",
  className,
  navClassName,
  navHeader,
  contentClassName,
  enableSearch = true,
  searchPlaceholder = "Search settings",
  searchEntries,
  generalSearchEntries,
  labs = [],
  labsLabel = "Labs",
  labsIntro,
  value,
  onValueChange,
  routerLocation,
}: SettingsTabsPageProps & { routerLocation?: SettingsRouterLocation }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const autoFocusedSearchRef = useRef(false);
  const controlledHashRef = useRef<string | null>(null);
  const t = useT();
  const general = generalTab ?? generalGroups;
  const notificationsFallbackLabel = t(
    "agentChat.settingsShell.page.notifications",
  );
  const extraTabs = useMemo(
    () =>
      withAppSettingsTabs(
        templateTabs,
        {
          appAreas,
          notifications,
          notificationsLabel,
          notificationsSearchEntries,
        },
        notificationsFallbackLabel,
      ),
    [
      appAreas,
      notifications,
      notificationsFallbackLabel,
      notificationsLabel,
      notificationsSearchEntries,
      templateTabs,
    ],
  );
  const visibleLabs = useMemo(() => {
    if (labs.some((lab) => lab.key === CHATGPT_SUBSCRIPTION_LAB.key)) {
      return labs;
    }
    return [CHATGPT_SUBSCRIPTION_LAB, ...labs];
  }, [labs]);
  const tabs = useMemo<SettingsTabItem[]>(() => {
    const hasOrganizationTab = extraTabs.some(
      (tab) => tab.id === "organization",
    );
    const inlineTabs = extraTabs.filter((tab) => !tab.href);
    const linkedTabs = extraTabs.filter((tab) => tab.href);
    const next: SettingsTabItem[] = [
      {
        id: "general",
        label: generalLabel,
        icon: IconSettings,
        content: general,
        searchEntries: generalSearchEntries,
      },
    ];
    if (account) {
      next.push({
        id: "account",
        label: accountLabel,
        icon: IconUserCircle,
        content: account,
        keywords: "profile photo avatar identity signed in email name",
      });
    }
    next.push(...inlineTabs);
    if (visibleLabs.length > 0) {
      next.push({
        id: "labs",
        label: labsLabel,
        icon: IconFlask,
        keywords: "experimental unstable beta bugs feedback",
        content: (
          <LabsSettings
            labs={visibleLabs}
            title={labsLabel}
            intro={labsIntro}
          />
        ),
        searchEntries: visibleLabs.map((lab) => ({
          id: `lab:${lab.key}`,
          label: lab.displayName ?? lab.key,
          keywords: `${lab.key} ${lab.keywords ?? ""}`,
          description: lab.description,
          hash: `lab-${lab.key}`,
        })),
      });
    }
    if (team && !hasOrganizationTab) {
      next.push({
        id: "team",
        label: teamLabel,
        icon: IconUsers,
        group: "workspace",
        content: team,
      });
    }
    if (whatsNew) {
      next.push({
        id: "whats-new",
        label: whatsNewLabel,
        icon: IconHistory,
        group: "app",
        content: whatsNew,
      });
    }
    next.push(...linkedTabs);
    return next;
  }, [
    account,
    accountLabel,
    extraTabs,
    visibleLabs,
    labsIntro,
    labsLabel,
    general,
    generalLabel,
    generalSearchEntries,
    team,
    teamLabel,
    whatsNew,
    whatsNewLabel,
    t,
  ]);

  const fallbackTab = tabs.some((tab) => tab.id === defaultTab)
    ? defaultTab
    : (tabs[0]?.id ?? "general");
  const tabGroups = useMemo(() => {
    // Keyed by group id so tabs sharing a group merge into one section even
    // when another group's tabs sit between them in `tabs` — adjacency-only
    // merging left same-id groups duplicated (and rendered with duplicate
    // React keys) whenever the tab list interleaved groups.
    const groupsById = new Map<
      string,
      { id: string; tabs: SettingsTabItem[] }
    >();
    for (const tab of tabs) {
      const groupId = tab.group ?? "app";
      const group = groupsById.get(groupId);
      if (group) {
        group.tabs.push(tab);
      } else {
        groupsById.set(groupId, { id: groupId, tabs: [tab] });
      }
    }
    return Array.from(groupsById.values());
  }, [tabs]);
  const tabGroupLabels: Record<string, string> = {
    app: "Personal",
    automation: "Automation",
    integrations: "Integrations",
    workspace: "Workspace",
    agent: "Agent",
  };
  const isControlled = value !== undefined;
  const [internalTab, setInternalTab] = useState(() =>
    activeTabFromLocation(tabs, fallbackTab, routerLocation),
  );
  const activeTab = isControlled ? value : internalTab;
  const [query, setQuery] = useState("");
  const designSystem = useDesignSystem();
  const hasLinkedTabs = tabs.some((tab) => Boolean(tab.href));
  const hasCustomTabs =
    Boolean(designSystem?.components?.Tabs) && !hasLinkedTabs;

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
    if (isControlled) return;
    const syncLocation = (event?: Event) => {
      // Native history events carry the live browser URL. Reading the
      // render-captured router location here would re-canonicalize the same
      // legacy hash before BrowserRouter has rerendered.
      const location = event ? undefined : routerLocation;
      const pathname = location?.pathname ?? window.location.pathname;
      const hash = location?.hash ?? window.location.hash;
      const fromPath = activeTabFromLocation(tabs, fallbackTab, location);
      if (fromPath) setInternalTab(fromPath);
      if (appLocalPathname(pathname).startsWith("/settings/")) return;
      const hashValue = hash.replace(/^#/, "");
      const fromHash = resolveTabId(tabs, hashValue);
      if (!fromHash || !hashValue) return;
      const isTabHash = fromHash === hashValue;
      updateRouteForTab(fromHash, isTabHash ? undefined : hashValue);
    };
    syncLocation();
    window.addEventListener("hashchange", syncLocation);
    window.addEventListener("popstate", syncLocation);
    return () => {
      window.removeEventListener("hashchange", syncLocation);
      window.removeEventListener("popstate", syncLocation);
    };
  }, [fallbackTab, isControlled, routerLocation, tabs]);

  useEffect(() => {
    if (!isControlled) return;
    const syncControlledLocation = () => {
      const pathname = routerLocation?.pathname ?? window.location.pathname;
      const hash = routerLocation?.hash ?? window.location.hash;
      const fromPath = appLocalPathname(pathname).startsWith("/settings/")
        ? activeTabFromLocation(tabs, defaultTab, routerLocation)
        : null;
      const hashValue = hash.replace(/^#/, "");
      const fromHash = hashValue ? resolveTabId(tabs, hashValue) : null;
      const next = fromPath ?? fromHash;
      const key = `${pathname}${hash}`;
      if (!next || next === value || controlledHashRef.current === key) {
        controlledHashRef.current = key;
        return;
      }
      controlledHashRef.current = key;
      onValueChange?.(next);
    };
    syncControlledLocation();
    window.addEventListener("hashchange", syncControlledLocation);
    window.addEventListener("popstate", syncControlledLocation);
    return () => {
      window.removeEventListener("hashchange", syncControlledLocation);
      window.removeEventListener("popstate", syncControlledLocation);
    };
  }, [defaultTab, isControlled, onValueChange, routerLocation, tabs, value]);

  useEffect(() => {
    if (!enableSearch || autoFocusedSearchRef.current) return;
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    if (window.matchMedia("(max-width: 767px)").matches) return;

    const frame = window.requestAnimationFrame(() => {
      autoFocusedSearchRef.current = true;
      const input = searchInputRef.current;
      if (!input) return;

      const activeElement = document.activeElement;
      const activeInsideSettings =
        !!activeElement && rootRef.current?.contains(activeElement);
      if (
        activeElement !== input &&
        (isEditableElement(activeElement) || activeInsideSettings)
      ) {
        return;
      }

      input.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [enableSearch]);

  const selectedTab = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  useEffect(() => {
    if (!selectedTab) return;
    const pathname = appLocalPathname(routerLocation?.pathname);
    if (!pathname.startsWith("/settings/")) return;
    const routeValue = pathname
      .slice("/settings/".length)
      .split("/")
      .filter(Boolean)
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .join(":");
    const canonicalRouteValue = normalizeSettingsRoute(routeValue);
    const prefix = `${selectedTab.id}:`;
    if (!canonicalRouteValue.startsWith(prefix)) return;
    const section = canonicalRouteValue.slice(prefix.length);
    const targetId =
      selectedTab.searchEntries?.find(
        (entry) => normalizeTabId(entry.hash ?? entry.id) === section,
      )?.hash ?? section;
    if (!targetId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(targetId.replace(/^#/, ""))?.scrollIntoView?.({
        block: "start",
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [routerLocation, selectedTab]);

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
    const section = entry.hash?.replace(/^#/, "");
    if (section) {
      updateRouteForTab(entry.tabId, section);
      // Let the inner panels open + scroll to their section.
      window.dispatchEvent(new Event("hashchange"));
      window.requestAnimationFrame(() => {
        document
          .getElementById(section)
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    } else if (!isControlled) {
      updateRouteForTab(entry.tabId);
    }
  };

  const searching = enableSearch && trimmedQuery.length > 0;

  return (
    <div
      ref={rootRef}
      className={cn(
        // Bound to the viewport when the host page gives no height, so the
        // content pane scrolls and the rail stays put instead of the page.
        "flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background sm:max-h-dvh sm:flex-row",
        className,
      )}
    >
      <div
        className={cn(
          "flex shrink-0 flex-col gap-2 border-b border-border/60 bg-background p-2 sm:min-h-0 sm:w-56 sm:flex-none sm:overflow-y-auto sm:border-b-0 sm:p-4 lg:w-60 xl:w-64",
          navClassName,
        )}
      >
        {navHeader}
        {enableSearch ? (
          <div className="relative sm:mb-2">
            <IconSearch className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
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
              className="agent-native-search-input h-8 w-full rounded-md border border-border bg-background ps-8 pe-7 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/30 focus:ring-2 focus:ring-accent/40"
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
                const tab = tabs.find(
                  (candidate) => candidate.id === entry.tabId,
                );
                const entryHash = entry.hash?.replace(/^#/, "");
                const resultHref = tab?.href
                  ? entryHash
                    ? buildSettingsEntryRoute(entry.tabId, entryHash)
                    : tab.href
                  : buildSettingsEntryRoute(entry.tabId, entryHash);
                const result = (
                  <>
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
                  </>
                );
                return resultHref ? (
                  <Link
                    key={entry.id}
                    to={resultHref}
                    role="option"
                    aria-selected={false}
                    className="flex items-start gap-2 rounded-md px-2.5 py-2 text-start text-sm text-foreground transition-colors hover:bg-accent/60"
                  >
                    {result}
                  </Link>
                ) : (
                  <button
                    key={entry.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => selectEntry(entry)}
                    className="flex items-start gap-2 rounded-md px-2.5 py-2 text-start text-sm text-foreground transition-colors hover:bg-accent/60"
                  >
                    {result}
                  </button>
                );
              })
            )}
          </div>
        ) : hasCustomTabs ? (
          <Tabs
            items={tabs.map((tab) => ({
              value: tab.id,
              label: tab.label,
              icon: tab.icon ? <tab.icon className="size-4 shrink-0" /> : null,
              // The panel stays outside this navigation rail so settings
              // keeps its existing scroll container and deep-link behavior.
              content: null,
            }))}
            value={activeTab}
            onChange={(tabId) => {
              const nextTab = String(tabId);
              changeTab(nextTab);
              if (!isControlled) updateRouteForTab(nextTab);
            }}
            orientation="vertical"
            aria-label={ariaLabel}
            className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-x-visible"
          />
        ) : (
          <nav
            aria-label={ariaLabel}
            role="tablist"
            className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-x-visible"
          >
            {tabGroups.map((group, groupIndex) => (
              <div
                key={group.id}
                data-settings-tab-group={group.id}
                className={cn(
                  "contents sm:block",
                  groupIndex > 0 && "sm:mt-3 sm:pt-1",
                )}
              >
                <div className="contents sm:flex sm:flex-col sm:gap-1">
                  <div className="hidden px-3 pb-1 pt-1 text-[11px] font-medium text-muted-foreground sm:block">
                    {group.tabs.find((tab) => tab.groupLabel)?.groupLabel ??
                      tabGroupLabels[group.id] ??
                      group.id}
                  </div>
                  {group.tabs.map((tab) => {
                    const Icon = tab.icon;
                    const selected = tab.id === selectedTab?.id;
                    const tabContent = (
                      <>
                        {Icon ? (
                          <Icon
                            className={cn(
                              "size-4 shrink-0",
                              selected
                                ? "text-foreground"
                                : "text-muted-foreground",
                            )}
                          />
                        ) : null}
                        <span className="truncate">{tab.label}</span>
                      </>
                    );
                    if (tab.href) {
                      return (
                        <Link
                          key={tab.id}
                          role="tab"
                          aria-selected={selected}
                          to={tab.href}
                          className={cn(
                            "flex min-h-9 shrink-0 items-center gap-2 rounded-md px-3 py-2 text-start text-sm font-medium transition-colors sm:w-full",
                            selected
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                          )}
                        >
                          {tabContent}
                        </Link>
                      );
                    }
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
                          if (!isControlled) updateRouteForTab(tab.id);
                        }}
                        className={cn(
                          "flex min-h-9 shrink-0 items-center gap-2 rounded-md px-3 py-2 text-start text-sm font-medium transition-colors sm:w-full",
                          selected
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                        )}
                      >
                        {tabContent}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        )}
      </div>
      <div
        id={`settings-tabpanel-${selectedTab?.id ?? "general"}`}
        role="tabpanel"
        aria-labelledby={`settings-tab-${selectedTab?.id ?? "general"}`}
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:pt-4 sm:pb-6 lg:px-8 lg:pt-4 lg:pb-8",
          contentClassName,
        )}
      >
        <div className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6">
          {selectedTab?.content}
        </div>
      </div>
    </div>
  );
}

function SettingsTabsPageWithRouter(props: SettingsTabsPageProps) {
  const location = useLocation();
  return <SettingsTabsPageContent {...props} routerLocation={location} />;
}

function LegacySettingsTabsPage(props: SettingsTabsPageProps) {
  const inRouterContext = useInRouterContext();
  return inRouterContext ? (
    <SettingsTabsPageWithRouter {...props} />
  ) : (
    <SettingsTabsPageContent {...props} />
  );
}

function RedesignedSettingsTabsPage(props: SettingsTabsPageProps) {
  const flag = useFeatureFlagState(SETTINGS_REDESIGN_FLAG.key);
  const initialValueRef = useRef(props.value);
  // Hold the shell's geometry until the answer arrives; painting today's tabs
  // first and swapping is the flash this gate exists to prevent.
  if (flag.status === "loading") {
    return <SettingsShellSkeleton className={props.className} />;
  }
  if (!flag.enabled) return <LegacySettingsTabsPage {...props} />;
  return (
    <Suspense fallback={<SettingsShellSkeleton className={props.className} />}>
      <SettingsShell
        general={props.general}
        generalGroups={props.generalGroups}
        appAreas={props.appAreas}
        notifications={props.notifications}
        notificationsLabel={props.notificationsLabel}
        notificationsSearchEntries={props.notificationsSearchEntries}
        mcpAbout={props.mcpAbout}
        account={props.account}
        team={props.team}
        whatsNew={props.whatsNew}
        extraTabs={props.extraTabs}
        labs={props.labs}
        labsLabel={props.labsLabel}
        labsIntro={props.labsIntro}
        generalSearchEntries={props.generalSearchEntries}
        searchEntries={props.searchEntries}
        enableSearch={props.enableSearch}
        className={props.className}
        navClassName={props.navClassName}
        contentClassName={props.contentClassName}
        value={props.value}
        initialValue={initialValueRef.current}
        onValueChange={props.onValueChange}
        appName={props.appName}
        appIcon={props.appIcon}
        appId={props.appId}
        whatsNewMarkdown={props.whatsNewMarkdown}
      />
    </Suspense>
  );
}

export function SettingsTabsPage(props: SettingsTabsPageProps) {
  // No query client means no action surface to read the flag from, so the
  // flag fails closed exactly as it does for a signed-out viewer.
  const queryClient = useContext(QueryClientContext);
  if (props.redesign === false || !queryClient) {
    return <LegacySettingsTabsPage {...props} />;
  }
  return <RedesignedSettingsTabsPage {...props} />;
}
