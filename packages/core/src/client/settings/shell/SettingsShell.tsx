import { Input } from "@agent-native/toolkit/ui/input";
import { Kbd } from "@agent-native/toolkit/ui/kbd";
import {
  IconArrowLeft,
  IconArrowUpRight,
  IconChevronRight,
  IconMenu2,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
} from "react";
import { useInRouterContext, useLocation, useNavigate } from "react-router";

import { STANDARD_APP_ROUTES } from "../../../navigation/index.js";
import {
  SETTINGS_VIEW_STATE_KEY,
  type SettingsViewState,
} from "../../../navigation/settings-redirects.js";
import { appMountedPath } from "../../api-path.js";
import {
  deleteClientAppState,
  writeClientAppState,
} from "../../application-state.js";
import { getBrowserTabId } from "../../browser-tab-id.js";
import {
  getChangelogLatestId,
  useChangelogSeen,
} from "../../changelog/use-changelog-seen.js";
import { Sheet, SheetContent, SheetTitle } from "../../components/ui/sheet.js";
import { useFeatureFlags } from "../../feature-flags/use-feature-flag.js";
import { useT } from "../../i18n.js";
import { useLabs } from "../../labs/use-lab.js";
import { useOrg } from "../../org/hooks.js";
import { cn } from "../../utils.js";
import { getCoreSettingsSearchEntries } from "../agent-settings-search.js";
import { SettingsSkeleton } from "../SettingsSkeleton.js";
import {
  normalizeSettingsSection,
  settingsSectionDomId,
} from "../useSettingsPanelController.js";
import { resolveSettingsAppIdentity } from "./app-identity.js";
import {
  bridgedCoreSearchEntries,
  createSettingsBridge,
  deriveBridgedAppPages,
  type SettingsBridgeInput,
} from "./bridge.js";
import {
  SettingsShellProvider,
  type SettingsPageHeader,
  type SettingsShellContextValue,
} from "./context.js";
import { BridgedTabSettingsPage, CORE_SETTINGS_PAGES } from "./core-pages.js";
import {
  DEFAULT_SETTINGS_PAGE_ID,
  getSettingsPages,
  isSettingsPageVisible,
  sortSettingsPages,
  subscribeSettingsPages,
  type SettingsPageContext,
  type SettingsPageDefinition,
  type SettingsPageGroup,
  type SettingsPageIcon,
} from "./registry.js";
import { readSettingsReturnPath } from "./return-path.js";
import {
  resolveSettingsRoute,
  resolveSettingsTabValue,
  SETTINGS_SECTION_STATE_KEY,
  settingsPageHref,
  settingsPagePath,
  type SettingsLocation,
} from "./routing.js";
import {
  buildSettingsSearchIndex,
  searchSettings,
  type SettingsSearchResult,
} from "./search.js";
import { SettingsShellSkeleton } from "./SettingsShellSkeleton.js";

export interface SettingsShellProps extends SettingsBridgeInput {
  /** The app group's label. Defaults to the template's display name. */
  appName?: string;
  /** The app group's icon. Defaults to the template's icon. */
  appIcon?: SettingsPageIcon;
  /** Scopes the app's changelog unread dot and usage. Defaults to the template id. */
  appId?: string | null;
  /** Raw CHANGELOG.md; enables the What's new unread dot. */
  whatsNewMarkdown?: string;
  enableSearch?: boolean;
  className?: string;
  navClassName?: string;
  contentClassName?: string;
  /** Today's controlled tab id. Changes open the page that answers for it. */
  value?: string;
  /**
   * `value` when Settings first rendered, which is the template's default
   * rather than a choice. Defaults to `value` at the shell's first render; the
   * flag gate passes its own first value because a template can change
   * `value` (a `?section=` deep link) while the gate still shows a skeleton.
   */
  initialValue?: string;
  /** Called with a page's legacy tab id (or its page id) when the viewer opens it. */
  onValueChange?: (tabId: string) => void;
}

// The agent panel module is heavy and already loaded by the app layout; keep
// it out of the shell's own chunk.
const AgentToggleButton = lazy(() =>
  import("../../AgentSidebar.js").then((module) => ({
    default: module.AgentToggleButton,
  })),
);

const GROUP_LABEL_KEYS: Partial<Record<SettingsPageGroup, string>> = {
  account: "agentChat.settingsShell.group.account",
  connections: "agentChat.settingsShell.group.connections",
  agent: "agentChat.settingsShell.group.agent",
  organization: "agentChat.settingsShell.group.organization",
};

const SETTINGS_ROUTE = STANDARD_APP_ROUTES.settings;

interface ShellLocation extends SettingsLocation {
  search: string;
}

/**
 * How the shell reads and changes the URL. `go` takes a router-relative path
 * (`/settings/model?x#y`).
 */
interface ShellNavigator {
  location: ShellLocation;
  go: (path: string, replace: boolean) => void;
}

function readWindowLocation(): ShellLocation {
  if (typeof window === "undefined") {
    return { pathname: "/", hash: "", search: "" };
  }
  return {
    pathname: window.location.pathname,
    hash: window.location.hash,
    search: window.location.search,
  };
}

function pushBrowserPath(path: string, replace: boolean) {
  if (typeof window === "undefined") return;
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  // BrowserRouter listens for popstate; pushState alone doesn't fire it.
  window.dispatchEvent(new Event("popstate"));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
}

function isModifiedClick(event: MouseEvent) {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

function sectionFromHistoryState(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const section = (state as Record<string, unknown>)[
    SETTINGS_SECTION_STATE_KEY
  ];
  return typeof section === "string" && section ? section : null;
}

/**
 * Inside an app, the router owns the URL. A data router commits a location
 * after its loaders run, so writing history behind its back let a template's
 * own `setSearchParams` in `onValueChange` resolve against the previous page
 * and undo the navigation.
 */
function useRouterNavigator(): ShellNavigator {
  const location = useLocation();
  const navigate = useNavigate();
  const go = useCallback(
    (path: string, replace: boolean) => {
      void navigate(path, { replace });
    },
    [navigate],
  );
  const section = sectionFromHistoryState(location.state);
  return useMemo(
    () => ({
      location: {
        pathname: location.pathname,
        hash: location.hash,
        search: location.search,
        section,
      },
      go,
    }),
    [go, location.hash, location.pathname, location.search, section],
  );
}

/** Outside a router, the browser URL is the source of truth. */
function useWindowNavigator(): ShellNavigator {
  const [location, setLocation] = useState(readWindowLocation);
  useEffect(() => {
    const sync = () => {
      const next = readWindowLocation();
      setLocation((current) =>
        current.pathname === next.pathname &&
        current.hash === next.hash &&
        current.search === next.search
          ? current
          : next,
      );
    };
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);
  return useMemo(() => ({ location, go: goWindow }), [location]);
}

function goWindow(path: string, replace: boolean) {
  pushBrowserPath(appMountedPath(path, SETTINGS_ROUTE), replace);
}

type ShellContentProps = SettingsShellProps & { navigator: ShellNavigator };

function RouterSettingsShell(props: SettingsShellProps) {
  return <SettingsShellContent {...props} navigator={useRouterNavigator()} />;
}

function WindowSettingsShell(props: SettingsShellProps) {
  return <SettingsShellContent {...props} navigator={useWindowNavigator()} />;
}

/**
 * Scrolls to a page's row once its lazy chunk mounts, and flashes it for a
 * search hit. Section anchors (`llm`, `limits`) name today's panels, whose
 * element ids carry a prefix.
 */
function revealSettingsAnchor(anchor: string, flash: boolean): () => void {
  let frame = 0;
  let attempts = 0;
  const find = () => {
    const direct = document.getElementById(anchor);
    if (direct) return direct;
    const section = normalizeSettingsSection(anchor);
    return section
      ? document.getElementById(settingsSectionDomId(section))
      : null;
  };
  const step = () => {
    const element = find();
    if (!element) {
      attempts += 1;
      if (attempts < 60) frame = window.requestAnimationFrame(step);
      return;
    }
    element.scrollIntoView({ block: "start", behavior: "smooth" });
    if (!flash) return;
    // Restart the animation when the same row is opened twice in a row.
    element.removeAttribute("data-settings-flash");
    void element.offsetWidth;
    element.setAttribute("data-settings-flash", "");
    window.setTimeout(
      () => element.removeAttribute("data-settings-flash"),
      1600,
    );
  };
  frame = window.requestAnimationFrame(step);
  return () => window.cancelAnimationFrame(frame);
}

/**
 * The redesigned Settings page: five groups in a left nav, one centered
 * column with a sticky header, and a drawer under 760px. Pages come from
 * core, the page registry, and today's `SettingsTabsPage` props (the bridge).
 */
export function SettingsShell(props: SettingsShellProps) {
  const initialValueRef = useRef(
    "initialValue" in props ? props.initialValue : props.value,
  );
  const inRouter = useInRouterContext();
  const orgQuery = useOrg();
  // Hold only until the first answer. A refetch after a failure is loading
  // again with no data, and unmounting the shell for it remounts every
  // `useOrg` below, which refetches again: a skeleton that never ends.
  if (orgQuery.isLoading && !orgQuery.errorUpdatedAt)
    return <SettingsShellSkeleton className={props.className} />;
  return inRouter ? (
    <RouterSettingsShell {...props} initialValue={initialValueRef.current} />
  ) : (
    <WindowSettingsShell {...props} initialValue={initialValueRef.current} />
  );
}

function SettingsShellContent({
  appName,
  appIcon,
  appId: appIdProp,
  whatsNewMarkdown,
  enableSearch = true,
  className,
  navClassName,
  contentClassName,
  value,
  initialValue,
  onValueChange,
  navigator,
  ...bridgeInput
}: ShellContentProps) {
  const t = useT();
  const { location, go } = navigator;

  const { data: org } = useOrg();
  const labs = useLabs();
  const flags = useFeatureFlags();
  const identity = resolveSettingsAppIdentity({
    appId: appIdProp,
    appName,
    appIcon,
  });
  const context = useMemo<SettingsPageContext>(() => {
    const role = org?.role ?? null;
    return {
      role,
      isOwner: role === "owner",
      isAdmin: role === "owner" || role === "admin",
      hasOrganization: org ? Boolean(org.orgId) : null,
      appId: identity.appId,
      labs,
      flags,
    };
  }, [flags, identity.appId, labs, org]);

  const registered = useSyncExternalStore(
    subscribeSettingsPages,
    getSettingsPages,
    getSettingsPages,
  );
  const {
    extraTabs,
    general,
    generalGroups,
    account,
    team,
    whatsNew,
    appAreas,
    notifications,
    notificationsLabel,
    notificationsSearchEntries,
    labs: appLabs,
    labsLabel,
    labsIntro,
    generalSearchEntries,
    searchEntries,
    mcpAbout,
  } = bridgeInput;
  const appGroupLabel =
    identity.name ?? t("agentChat.settingsShell.appFallbackName");
  const { pages, bridge } = useMemo(() => {
    const byId = new Map(CORE_SETTINGS_PAGES.map((page) => [page.id, page]));
    for (const page of registered) byId.set(page.id, page);
    const declared = [...byId.values()];
    const derived = deriveBridgedAppPages(
      extraTabs ?? [],
      declared,
      BridgedTabSettingsPage,
    );
    return {
      pages: sortSettingsPages([...declared, ...derived.pages]),
      bridge: createSettingsBridge(
        {
          extraTabs,
          general,
          generalGroups,
          account,
          team,
          whatsNew,
          appAreas,
          notifications,
          notificationsLabel,
          notificationsSearchEntries,
          labs: appLabs,
          labsLabel,
          labsIntro,
          generalSearchEntries,
          searchEntries,
          mcpAbout,
          appName: appGroupLabel,
          whatsNewMarkdown,
        },
        derived.pageTabs,
      ),
    };
  }, [
    account,
    appAreas,
    appGroupLabel,
    appLabs,
    extraTabs,
    general,
    generalGroups,
    generalSearchEntries,
    labsIntro,
    labsLabel,
    mcpAbout,
    notifications,
    notificationsLabel,
    notificationsSearchEntries,
    registered,
    searchEntries,
    team,
    whatsNew,
    whatsNewMarkdown,
  ]);
  const visiblePages = useMemo(
    () => pages.filter((page) => isSettingsPageVisible(page, context, bridge)),
    [bridge, context, pages],
  );

  const appAreaIds = useMemo(
    () => bridge.appAreas.map((area) => area.id),
    [bridge.appAreas],
  );
  // The template's first `value` is its default, not a choice (Mail starts
  // on "integrations"), so only a later one names a page for bare /settings.
  const tabValue = value !== undefined && value !== initialValue ? value : null;
  const resolved = useMemo(
    () => resolveSettingsRoute(location, pages, { appAreaIds, tabValue }),
    [appAreaIds, location, pages, tabValue],
  );
  const activePage =
    visiblePages.find((page) => page.id === resolved.page) ??
    visiblePages.find((page) => page.id === DEFAULT_SETTINGS_PAGE_ID) ??
    visiblePages[0];
  const routePage = activePage?.id ?? null;
  const routeSub = routePage === resolved.page ? resolved.sub : null;

  const activePageIdRef = useRef(routePage);
  activePageIdRef.current = routePage;
  const pendingNotifyRef = useRef<{ page: string; tab: string } | null>(null);
  // The last `value` prop acted on, and the last tab id reported through
  // `onValueChange`. Kept apart: the same commit that reports a new tab still
  // renders the template's previous `value`, which must not read as a change.
  const seenValueRef = useRef(initialValue);
  const reportedValueRef = useRef<string | undefined>(undefined);
  // Only `useSettingsPageHeader`'s cleanup clears this. Child effects run
  // first, so a reset here on route change would erase the header the new
  // page just set.
  const [header, setHeader] = useState<SettingsPageHeader | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  // Tab ids the template can be told about: its own tabs and the built-in
  // tabs it passed content for. A page with none (Security, Labs) reports
  // nothing, because Brain and Mail turn an unknown id back into "general",
  // which would bounce the viewer to the app's General page.
  const reportableTabIds = useMemo(() => {
    const ids = new Set(bridge.tabs.map((tab) => tab.id));
    ids.add("general");
    if (bridge.account) ids.add("account");
    if (bridge.team) ids.add("team");
    if (bridge.whatsNew) ids.add("whats-new");
    return ids;
  }, [bridge]);

  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const reportableTabIdsRef = useRef(reportableTabIds);
  reportableTabIdsRef.current = reportableTabIds;

  const navigate = useCallback<SettingsShellContextValue["navigate"]>(
    (page, sub = null, options = {}) => {
      const reportable = reportableTabIdsRef.current;
      const target = pagesRef.current.find(
        (candidate) => candidate.id === page,
      );
      if (target?.href) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(target.href)) {
          window.location.assign(target.href);
        } else {
          go(target.href, false);
        }
        return;
      }
      const anchor = options.anchor ? `#${options.anchor}` : "";
      // The query belongs to the page being left (`?connected=`, a template's
      // `?section=`); carrying it over would reopen that page on reload.
      go(`${settingsPagePath(page, sub)}${anchor}`, options.replace ?? false);
      if (!target || options.replace) return;
      setNavOpen(false);
      if (target.id === activePageIdRef.current) return;
      const tab =
        (page === "app" && sub && reportable.has(sub) ? sub : null) ??
        target.legacyTabIds?.find((id) => reportable.has(id));
      pendingNotifyRef.current = tab ? { page: target.id, tab } : null;
    },
    [go],
  );

  // A page the viewer can't see (or an unknown id) lands on Profile, and a
  // legacy link is rewritten to its page's own path, keeping the query
  // (`?connected=`, a template's `?section=`). Once per location: a data
  // router commits asynchronously, and asking again before it does would
  // cancel the redirect (and any click) in flight.
  const redirectedFromRef = useRef<string | null>(null);
  const locationKey = `${location.pathname}${location.search}${location.hash}${location.section ?? ""}`;
  useEffect(() => {
    const visible = resolved.page === activePage?.id;
    if (!resolved.page || !activePage || (visible && !resolved.legacy)) {
      redirectedFromRef.current = null;
      return;
    }
    if (redirectedFromRef.current === locationKey) return;
    redirectedFromRef.current = locationKey;
    if (!visible) {
      navigate(activePage.id, null, { replace: true });
      return;
    }
    const anchor = resolved.anchor ? `#${resolved.anchor}` : "";
    go(
      `${settingsPagePath(activePage.id, resolved.sub)}${location.search}${anchor}`,
      true,
    );
  }, [
    activePage,
    go,
    location.search,
    locationKey,
    navigate,
    resolved.anchor,
    resolved.legacy,
    resolved.page,
    resolved.sub,
  ]);

  // Links that name a row (`/settings/app#ai-providers`) scroll to it once
  // the page has mounted. Search hits also flash it (see `SettingsNav`).
  const anchorOnPage =
    routePage === resolved.page && !resolved.legacy ? resolved.anchor : null;
  useEffect(() => {
    if (!anchorOnPage) return;
    return revealSettingsAnchor(anchorOnPage, false);
  }, [anchorOnPage, routePage]);

  // Controlled bridge: tell the template which of its tabs is showing, after
  // the new location has rendered so its own URL writes see it.
  useEffect(() => {
    const pending = pendingNotifyRef.current;
    if (!pending || pending.page !== routePage) return;
    pendingNotifyRef.current = null;
    reportedValueRef.current = pending.tab;
    onValueChange?.(pending.tab);
  }, [onValueChange, routePage]);

  useEffect(() => {
    if (value === undefined || value === seenValueRef.current) return;
    seenValueRef.current = value;
    // The template echoing the tab the shell just reported.
    if (value === reportedValueRef.current) return;
    const target = resolveSettingsTabValue(value, visiblePages, appAreaIds);
    if (target.page && target.page !== routePage) {
      navigate(target.page, target.sub, {
        replace: true,
        anchor: target.anchor ?? undefined,
      });
    }
  }, [appAreaIds, navigate, routePage, value, visiblePages]);

  const latestChangelogId = getChangelogLatestId(
    bridge.whatsNewMarkdown ?? undefined,
  );
  const changelog = useChangelogSeen(
    identity.appId ?? "app",
    latestChangelogId,
  );
  const markChangelogSeen = changelog.markSeen;
  useEffect(() => {
    if (activePage?.id === "whats-new") markChangelogSeen();
  }, [activePage?.id, markChangelogSeen]);

  const groupLabel = useCallback(
    (group: SettingsPageGroup) => {
      if (group === "app") return appGroupLabel;
      const key = GROUP_LABEL_KEYS[group];
      return key ? t(key) : "";
    },
    [appGroupLabel, t],
  );
  const pageLabel = useCallback(
    (page: SettingsPageDefinition) =>
      page.labelKey ? t(page.labelKey) : (page.label ?? page.id),
    [t],
  );
  const pageIcon = useCallback(
    (page: SettingsPageDefinition) =>
      page.id === "app" ? identity.icon : page.icon,
    [identity.icon],
  );

  // The agent's view of Settings: the page and sub-page this browser tab
  // shows, cleared when Settings unmounts.
  const subpageLabel = routeSub
    ? activePage?.subpages?.find((subpage) => subpage.id === routeSub)
    : undefined;
  const appAreaLabel =
    routeSub && routePage === "app"
      ? bridge.appAreas.find((area) => area.id === routeSub)?.label
      : undefined;
  const settingsViewLabel = activePage
    ? [
        groupLabel(activePage.group),
        pageLabel(activePage),
        subpageLabel?.labelKey
          ? t(subpageLabel.labelKey)
          : (subpageLabel?.label ?? appAreaLabel ?? null),
      ]
        .filter(Boolean)
        .join(" › ")
    : null;
  useEffect(() => {
    if (!routePage) return;
    const view: SettingsViewState = {
      page: routePage,
      sub: routeSub,
      label: settingsViewLabel,
    };
    writeClientAppState(SETTINGS_VIEW_STATE_KEY, view, {
      requestSource: getBrowserTabId(),
    }).catch((error: unknown) => {
      console.warn("[settings] Couldn't record the open Settings page", error);
    });
  }, [routePage, routeSub, settingsViewLabel]);
  useEffect(
    () => () => {
      deleteClientAppState(SETTINGS_VIEW_STATE_KEY, {
        keepalive: true,
        requestSource: getBrowserTabId(),
      }).catch((error: unknown) => {
        console.warn(
          "[settings] Couldn't clear the Settings page state",
          error,
        );
      });
    },
    [],
  );

  const searchIndex = useMemo(() => {
    const bridgedEntries = bridgedCoreSearchEntries(bridge, pages);
    const coreEntries = getCoreSettingsSearchEntries();
    return buildSettingsSearchIndex(
      visiblePages.map((page) => ({
        page: { ...page, icon: pageIcon(page) },
        label: pageLabel(page),
        groupLabel: groupLabel(page.group),
        entries: [
          ...(page.searchEntries ?? []),
          ...(coreEntries.get(page.id) ?? []),
          ...(bridgedEntries.get(page.id) ?? []),
        ],
      })),
      t,
    );
  }, [bridge, groupLabel, pageIcon, pageLabel, pages, t, visiblePages]);

  const shellContext = useMemo<SettingsShellContextValue>(
    () => ({ route: { page: routePage, sub: routeSub }, navigate, setHeader }),
    [navigate, routePage, routeSub],
  );

  const returnPath = useMemo(() => readSettingsReturnPath() ?? "/", []);

  const nav = (
    <SettingsNav
      pages={visiblePages}
      activePageId={routePage}
      groupLabel={groupLabel}
      pageLabel={pageLabel}
      pageIcon={pageIcon}
      appName={appGroupLabel}
      returnHref={appMountedPath(returnPath, SETTINGS_ROUTE)}
      onReturn={() => go(returnPath, false)}
      enableSearch={enableSearch}
      searchIndex={searchIndex}
      unreadPageIds={changelog.unseen ? ["whats-new"] : []}
      onNavigate={navigate}
    />
  );

  const Page = activePage?.component;
  const PrimaryAction = activePage?.primaryAction;
  const subLabel =
    routeSub && activePage
      ? activePage.subpages?.find((subpage) => subpage.id === routeSub)
      : undefined;
  const title =
    header?.title ??
    (subLabel
      ? subLabel.labelKey
        ? t(subLabel.labelKey)
        : subLabel.label
      : null);
  const pageProps = activePage
    ? { pageId: activePage.id, sub: routeSub, context, bridge }
    : null;

  return (
    <SettingsShellProvider value={shellContext}>
      <div
        data-settings-shell=""
        className={cn(
          "flex h-full max-h-dvh min-h-0 w-full min-w-0 overflow-hidden bg-background",
          className,
        )}
      >
        <aside
          className={cn(
            "hidden w-[252px] shrink-0 flex-col border-e border-sidebar-border bg-sidebar min-[760px]:flex",
            navClassName,
          )}
        >
          {nav}
        </aside>
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent
            side="left"
            showClose={false}
            overlayClassName="min-[760px]:hidden"
            className="flex w-[min(300px,86vw)] flex-col gap-0 bg-sidebar p-0 min-[760px]:hidden"
          >
            <SheetTitle className="sr-only">
              {t("agentChat.settingsShell.navLabel")}
            </SheetTitle>
            {nav}
          </SheetContent>
        </Sheet>
        <div
          className={cn(
            "relative min-h-0 min-w-0 flex-1 overflow-y-auto",
            contentClassName,
          )}
        >
          <header className="sticky top-0 z-10 bg-background">
            <div className="mx-auto flex h-[60px] w-full max-w-[824px] items-center gap-2 ps-4 pe-14 min-[760px]:ps-8">
              <button
                type="button"
                onClick={() => setNavOpen(true)}
                aria-label={t("agentChat.settingsShell.openNav")}
                className="-ms-2 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground min-[760px]:hidden"
              >
                <IconMenu2 className="size-4" aria-hidden="true" />
              </button>
              <nav
                aria-label={t("agentChat.settingsShell.breadcrumbLabel")}
                className="flex min-w-0 items-center gap-2 text-sm"
              >
                {activePage && title ? (
                  <>
                    <a
                      href={settingsPageHref(activePage.id)}
                      onClick={(event) => {
                        if (isModifiedClick(event)) return;
                        event.preventDefault();
                        navigate(activePage.id);
                      }}
                      className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {pageLabel(activePage)}
                    </a>
                    <IconChevronRight
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span
                      aria-current="page"
                      className="truncate font-medium text-foreground"
                    >
                      {title}
                    </span>
                  </>
                ) : activePage ? (
                  <span
                    aria-current="page"
                    className="truncate font-medium text-foreground"
                  >
                    {pageLabel(activePage)}
                  </span>
                ) : null}
                {activePage && header?.badge ? (
                  <span className="flex shrink-0 items-center">
                    {header.badge}
                  </span>
                ) : null}
              </nav>
              <div className="ms-auto flex shrink-0 items-center gap-2">
                {header?.action ??
                  (PrimaryAction && pageProps ? (
                    <PrimaryAction {...pageProps} />
                  ) : null)}
              </div>
            </div>
            <div className="absolute end-3.5 top-3.5">
              <Suspense fallback={null}>
                <AgentToggleButton showWhenOpen />
              </Suspense>
            </div>
          </header>
          <div className="mx-auto w-full max-w-[824px] px-4 pb-28 pt-1 min-[760px]:px-8">
            {Page && pageProps ? (
              <Suspense fallback={<SettingsSkeleton lines={3} />}>
                <Page key={activePage.id} {...pageProps} />
              </Suspense>
            ) : null}
          </div>
        </div>
      </div>
    </SettingsShellProvider>
  );
}

interface SettingsNavProps {
  pages: readonly SettingsPageDefinition[];
  activePageId: string | null;
  groupLabel: (group: SettingsPageGroup) => string;
  pageLabel: (page: SettingsPageDefinition) => string;
  pageIcon: (page: SettingsPageDefinition) => SettingsPageIcon;
  appName: string;
  returnHref: string;
  onReturn: () => void;
  enableSearch: boolean;
  searchIndex: readonly SettingsSearchResult[];
  unreadPageIds: readonly string[];
  onNavigate: SettingsShellContextValue["navigate"];
}

function SettingsNav({
  pages,
  activePageId,
  groupLabel,
  pageLabel,
  pageIcon,
  appName,
  returnHref,
  onReturn,
  enableSearch,
  searchIndex,
  unreadPageIds,
  onNavigate,
}: SettingsNavProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const results = useMemo(
    () => searchSettings(searchIndex, query),
    [query, searchIndex],
  );

  useEffect(() => {
    if (!enableSearch) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isEditableTarget(event.target)) return;
      const input = inputRef.current;
      // Both the rail and the drawer mount a nav; only the visible one takes it.
      if (!input || input.offsetParent === null) return;
      event.preventDefault();
      input.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enableSearch]);

  const openResult = (result: SettingsSearchResult) => {
    setQuery("");
    onNavigate(result.page, result.sub, {
      anchor: result.anchor ?? undefined,
    });
    if (result.anchor) revealSettingsAnchor(result.anchor, true);
  };

  const groups = useMemo(() => {
    const byGroup = new Map<SettingsPageGroup, SettingsPageDefinition[]>();
    for (const page of pages) {
      const list = byGroup.get(page.group) ?? [];
      list.push(page);
      byGroup.set(page.group, list);
    }
    return byGroup;
  }, [pages]);

  const renderItem = (page: SettingsPageDefinition) => {
    const Icon = pageIcon(page);
    const selected = page.id === activePageId;
    const href = page.href
      ? appMountedPath(page.href, SETTINGS_ROUTE)
      : settingsPageHref(page.id);
    return (
      <a
        key={page.id}
        href={href}
        data-settings-page={page.id}
        aria-current={selected ? "page" : undefined}
        onClick={(event) => {
          if (isModifiedClick(event)) return;
          event.preventDefault();
          onNavigate(page.id);
        }}
        className={cn(
          "flex h-[30px] items-center gap-2 rounded-md px-2 text-[13px] font-medium transition-colors",
          selected
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
        )}
      >
        <Icon
          className={cn(
            "size-4 shrink-0",
            selected ? "text-foreground" : "text-muted-foreground",
          )}
        />
        <span className="truncate">{pageLabel(page)}</span>
        {page.href ? (
          <IconArrowUpRight
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        ) : null}
        {unreadPageIds.includes(page.id) ? (
          <span
            role="img"
            aria-label={t("agentChat.settingsShell.unread")}
            className="ms-auto size-1.5 shrink-0 rounded-full bg-primary"
          />
        ) : null}
      </a>
    );
  };

  const searching = enableSearch && query.trim().length > 0;
  const footerPages = groups.get("footer") ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-2.5 pt-3">
        <a
          href={returnHref}
          onClick={(event) => {
            if (isModifiedClick(event)) return;
            event.preventDefault();
            onReturn();
          }}
          className="flex h-[30px] items-center gap-2 rounded-md px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
        >
          <IconArrowLeft className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {t("agentChat.settingsShell.backToApp", { app: appName })}
          </span>
        </a>
        {enableSearch ? (
          <div className="relative mb-1.5 mt-2">
            <IconSearch
              aria-hidden="true"
              className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setQuery("");
                }
                if (event.key === "Enter" && results[0]) {
                  event.preventDefault();
                  openResult(results[0]);
                }
              }}
              placeholder={t("agentChat.settingsShell.searchPlaceholder")}
              aria-label={t("agentChat.settingsShell.searchPlaceholder")}
              autoComplete="off"
              className="agent-native-search-input h-8 py-0 ps-8 pe-8 text-[13px] focus-visible:ring-offset-0 md:text-[13px]"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={t("agentChat.settingsShell.clearSearch")}
                className="absolute end-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <IconX className="size-3.5" aria-hidden="true" />
              </button>
            ) : (
              <Kbd className="pointer-events-none absolute end-1.5 top-1/2 -translate-y-1/2 border border-border bg-background">
                /
              </Kbd>
            )}
          </div>
        ) : null}
      </div>
      {searching ? (
        <div
          role="listbox"
          aria-label={t("agentChat.settingsShell.resultsLabel")}
          className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3"
        >
          {results.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {t("agentChat.settingsShell.noResults")}
            </p>
          ) : (
            results.slice(0, 50).map((result, index) => {
              const Icon = result.icon;
              return (
                <button
                  key={result.id}
                  type="button"
                  role="option"
                  aria-selected={index === 0}
                  onClick={() => openResult(result)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-start transition-colors hover:bg-sidebar-accent/60",
                    index === 0 && "bg-sidebar-accent/60",
                  )}
                >
                  <Icon
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium text-foreground">
                      {result.label}
                    </span>
                    <span className="truncate text-[11.5px] text-muted-foreground">
                      {result.where}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      ) : (
        <nav
          aria-label={t("agentChat.settingsShell.navLabel")}
          className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3"
        >
          {(["account", "connections", "agent", "organization", "app"] as const)
            .filter((group) => (groups.get(group) ?? []).length > 0)
            .map((group) => (
              <div
                key={group}
                data-settings-group={group}
                className="mt-3.5 flex flex-col gap-px"
              >
                <div className="truncate px-2 pb-1 text-[11.5px] font-medium text-muted-foreground">
                  {groupLabel(group)}
                </div>
                {(groups.get(group) ?? []).map(renderItem)}
              </div>
            ))}
        </nav>
      )}
      {footerPages.length > 0 ? (
        <div
          data-settings-group="footer"
          className="flex shrink-0 flex-col gap-px px-2.5 pb-3 pt-2"
        >
          {footerPages.map(renderItem)}
        </div>
      ) : null}
    </div>
  );
}
