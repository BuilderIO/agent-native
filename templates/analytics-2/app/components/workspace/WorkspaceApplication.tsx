import { appBasePath } from "@agent-native/core/client/api-path";
import {
  actionErrorMessage,
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { signOut } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useSwitchOrg } from "@agent-native/core/client/org";
import { useDocumentTitle } from "@agent-native/toolkit/app/shared";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  queueCrossTabSearchSubmission,
  queueThreadSubmission,
} from "@/components/agent/search-submission";
import { KeyboardShortcutsProvider } from "@/components/notebook/KeyboardShortcutsDialog";
import { NewComponentDialog } from "@/components/notebook/NewComponentDialog";
import { ImportProjectDialog } from "@/components/projects/ImportProjectDialog";
import { appMountedHref } from "@/components/projects/projectList";
import { useSearchFilterOptions } from "@/components/search/useSearchFilterOptions";
import {
  isWorkspaceSearchRoute,
  WorkspaceSearchNavigation,
} from "@/components/search/WorkspaceSearchNavigation";
import {
  buildAccountMenuHandlers,
  debugInfoText,
} from "@/components/shell/account-menu-handlers";
import {
  applyOptimisticRead,
  type OptimisticRead,
} from "@/components/shell/optimistic-notifications";
import { secondaryFeaturesEnabled } from "@/components/shell/secondary-features";
import {
  WorkspaceShell,
  type WorkspaceShellHandler,
  type WorkspaceShellNotification,
} from "@/components/shell/WorkspaceShell";
import type { ImportedNotebook } from "@/lib/notebook-ipynb-import";
import { searchWorkspace } from "@/lib/workspace-search";
import { RouteFrame, type RouteOutletContext } from "@/routes/routing/frames";
import type { ResolvedRoute } from "@/routes/routing/registry";
import { resolveRoute } from "@/routes/routing/registry";

import {
  ANALYTICS_CONTROL_IDS,
  capabilityAllowed,
} from "../../../shared/analytics-control-ids";
import { preloadHomePage, resolveRoutePage, settingsPageView } from "./pages";
import { ProvisionalNotebook } from "./ProvisionalNotebook";
import { SettingsRouteFallback } from "./SettingsRouteFallback";
import { SettingsShell } from "./SettingsShell";
import type { RoutePageProps, WorkspaceWriteError } from "./types";
import { useCreateNotebook } from "./useCreateNotebook";
import { VIEW_TITLE_KEYS } from "./view-titles";
import { WorkspaceCommands } from "./WorkspaceCommands";
import {
  WorkspaceDataContext,
  type WorkspaceDataValue,
} from "./WorkspaceDataContext";

/**
 * Frames that render outside the workspace shell. These are the application's
 * separate authentication/onboarding/link/redirect landing families.
 */
const PUBLIC_FRAMES = new Set([
  "authentication",
  "onboarding",
  "link",
  "callback",
]);

const EMPTY_FRAME_FRAMES = new Set(["redirect", "server", "asset"]);
const OPEN_OVERLAY_SELECTOR =
  '[role="dialog"]:not([data-state="closed"]):not([data-closed]):not([hidden]), [role="menu"]:not([data-state="closed"]):not([data-closed]):not([hidden])';
const SLASH_SUPPRESSED_FRAMES = new Set([
  "project",
  "published-app",
  "code-project",
  "code-app",
]);

export function shouldOpenWorkspaceSearchShortcut(
  event: KeyboardEvent,
  frame: string,
): boolean {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    document.querySelector(OPEN_OVERLAY_SELECTOR)
  ) {
    return false;
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "k"
  ) {
    return true;
  }
  if (SLASH_SUPPRESSED_FRAMES.has(frame)) return false;
  const target = event.target instanceof HTMLElement ? event.target : null;
  const isEditable =
    target?.isContentEditable === true ||
    target?.closest('[contenteditable="true"]') != null ||
    target?.tagName === "INPUT" ||
    target?.tagName === "TEXTAREA" ||
    target?.tagName === "SELECT";
  return (
    !isEditable &&
    event.key === "/" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  );
}
const RESOURCE_TITLE_ROUTES = new Set([
  "logic",
  "project-base",
  "app",
  "app-latest",
  "app-base",
  "thread",
]);

/**
 * A settings URL names a page only when the page registry has an entry for it.
 * The shell's rail filters on the same question, so an unadvertised slug would
 * otherwise render an empty main instead of the app's own not-found copy.
 */
function settingsViewResolves(
  view: string,
  access?: { isAdmin: boolean },
): boolean {
  return Boolean(
    resolveRoutePage(
      {
        id: "settings",
        view,
      } as unknown as Parameters<typeof resolveRoutePage>[0],
      access,
    ),
  );
}

function FrameMessage({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail?: string;
  onRetry?: () => void;
}) {
  const t = useT();
  return (
    <div
      role={onRetry ? "alert" : "status"}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 480,
        margin: "auto",
        padding: 24,
        fontFamily: "inherit",
        fontSize: 14,
        lineHeight: "20px",
      }}
    >
      <strong style={{ fontSize: 16 }}>{title}</strong>
      {detail ? <span style={{ opacity: 0.75 }}>{detail}</span> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          style={{ width: "fit-content" }}
        >
          {t("error.retry")}
        </button>
      ) : null}
    </div>
  );
}

function WorkspaceLoading({ children }: { children?: ReactNode }) {
  return (
    <div className="ws-root" aria-busy="true">
      <div className="ws-mobile-nav">
        <Skeleton className="h-7 w-36" />
      </div>
      <div className="ws-body">
        <div className="ws-main">
          <div className="hidden w-[265px] shrink-0 space-y-3 p-3 min-[1051px]:block">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
          <main className="ws-content">{children}</main>
        </div>
      </div>
    </div>
  );
}

function WorkspaceUnavailable({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <FrameMessage
      title="Workspace unavailable"
      detail={
        error instanceof Error
          ? error.message
          : "The workspace identity could not be read."
      }
      onRetry={onRetry}
    />
  );
}

function WriteErrorBanner({
  error,
  onRetry,
  onDismiss,
}: {
  error: WorkspaceWriteError;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <div
      role="alert"
      data-workspace-write-error={error.action}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        fontSize: 13,
        lineHeight: "18px",
        borderBottom: "1px solid rgba(120,120,120,0.25)",
      }}
    >
      <span>
        {t("workspaceCreation.threadFailed", { message: error.message })}
      </span>
      <button type="button" onClick={onRetry}>
        {t("error.retry")}
      </button>
      <button type="button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

/**
 * Workspace integration mounted once inside the persistent root providers.
 *
 * It owns the shell identity read and the shell write actions, and supplies
 * `renderFrame` / `renderPage` to the routing catchall through the Outlet
 * context. Root providers stay above this component, so navigation never
 * remounts them.
 */
export function WorkspaceApplication() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const switchOrg = useSwitchOrg();
  const [writeError, setWriteError] = useState<WorkspaceWriteError | null>(
    null,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRoute = isWorkspaceSearchRoute(location);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [componentOpen, setComponentOpen] = useState(false);
  const componentSource = useRef<{
    requestId: string;
    title: string;
    projectId?: string;
    scope: string;
  } | null>(null);

  const currentRoute = useMemo(
    () => resolveRoute(location.pathname + location.search + location.hash),
    [location.pathname, location.search, location.hash],
  );
  const isPublicFrame = PUBLIC_FRAMES.has(currentRoute.frame);
  useEffect(() => {
    if (currentRoute.id !== "home" || currentRoute.view !== "home") return;
    void preloadHomePage().catch((error) => {
      console.error("Could not preload Home", error);
    });
  }, [currentRoute.id, currentRoute.view]);
  const t = useT();
  useDocumentTitle(
    [
      t(
        currentRoute.frame === "settings"
          ? "settings.title"
          : currentRoute.id === "context-studio"
            ? "analytics.shell.contextStudio"
            : (VIEW_TITLE_KEYS[currentRoute.view] ?? "analytics.brand"),
      ),
    ],
    undefined,
    !RESOURCE_TITLE_ROUTES.has(currentRoute.id),
  );

  const homeFrame = currentRoute.frame === "home";
  const bootstrapQuery = useActionQuery(
    "get-workspace-bootstrap",
    {},
    { enabled: !isPublicFrame, retry: 1 },
  );
  const verifiedBootstrap =
    !switchingWorkspace && !bootstrapQuery.isError
      ? bootstrapQuery.data
      : undefined;
  const componentScope = verifiedBootstrap
    ? JSON.stringify([
        verifiedBootstrap.workspace.id,
        verifiedBootstrap.user.email,
      ])
    : undefined;
  const componentScopeRef = useRef(componentScope);
  componentScopeRef.current = componentScope;
  useEffect(() => {
    componentSource.current = null;
    setComponentOpen(false);
  }, [componentScope]);
  const openComponent = useCallback(() => {
    componentSource.current = null;
    setComponentOpen(true);
  }, []);
  const closeComponent = useCallback(() => {
    componentSource.current = null;
    setComponentOpen(false);
  }, []);
  const canCreateProject = capabilityAllowed(
    verifiedBootstrap?.capabilities,
    ANALYTICS_CONTROL_IDS.createProject,
  );
  const createNotebook = useCreateNotebook(
    canCreateProject &&
      !isPublicFrame &&
      !importOpen &&
      !componentOpen &&
      !searchOpen,
    verifiedBootstrap &&
      JSON.stringify([
        verifiedBootstrap.workspace.id,
        verifiedBootstrap.user.email,
      ]),
  );
  const onCreateProject = createNotebook.start;
  const quickCreation = useRef<Promise<void> | null>(null);
  const quickCreateProject = useCallback(() => {
    if (quickCreation.current) return quickCreation.current;
    const operation = (async () => {
      try {
        const created = await callAction("create-project", {
          requestId: crypto.randomUUID(),
        });
        void queryClient.invalidateQueries({ queryKey: ["action"] });
        void navigate(created.href);
      } finally {
        quickCreation.current = null;
      }
    })();
    quickCreation.current = operation;
    return operation;
  }, [navigate, queryClient]);
  const newProjectRouteRef = useRef(false);
  useEffect(() => {
    if (currentRoute.id !== "new-project") {
      newProjectRouteRef.current = false;
      return;
    }
    if (isPublicFrame || !verifiedBootstrap || newProjectRouteRef.current)
      return;
    if (!canCreateProject) {
      void navigate("/home", { replace: true });
      return;
    }
    newProjectRouteRef.current = true;
    let active = true;
    void (async () => {
      try {
        const created = await callAction("create-project", {
          requestId: crypto.randomUUID(),
        });
        void queryClient.invalidateQueries({ queryKey: ["action"] });
        if (active) void navigate(created.href, { replace: true });
      } catch (error) {
        newProjectRouteRef.current = false;
        if (active) {
          toast.error(
            actionErrorMessage(
              error,
              error instanceof Error ? error.message : String(error),
            ),
          );
          void navigate("/home", { replace: true });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [
    canCreateProject,
    currentRoute.id,
    isPublicFrame,
    navigate,
    queryClient,
    verifiedBootstrap,
  ]);
  const canBrowseData = capabilityAllowed(
    verifiedBootstrap?.capabilities,
    ANALYTICS_CONTROL_IDS.dataBrowse,
  );
  const detailsOptions = {
    enabled: homeFrame && !!verifiedBootstrap,
    queryKeyScope: [
      verifiedBootstrap?.workspace.id,
      verifiedBootstrap?.user.email,
    ],
    retry: 1,
  };
  const activityQuery = useActionQuery(
    "get-workspace-activity",
    {},
    detailsOptions,
  );
  const activityStatus = activityQuery.isError
    ? "error"
    : activityQuery.isPending
      ? "loading"
      : "ready";
  const navigationQuery = useActionQuery(
    "get-workspace-navigation",
    {},
    detailsOptions,
  );
  const contextSetupQuery = useActionQuery(
    "get-workspace-context-setup",
    {},
    {
      ...detailsOptions,
      enabled:
        detailsOptions.enabled && canBrowseData && currentRoute.view === "home",
    },
  );

  // The shell renders a menu row disabled when it has no handler, and a tester
  // read that as a dead control (sprint-analytics-2#593), so the app passes the
  // handlers it can actually back.
  const menuHandlers = useMemo(
    () =>
      buildAccountMenuHandlers({
        signOut: () => signOut(),
        goHome: () => navigate("/", { replace: true }),
        copyText: (text) => navigator.clipboard.writeText(text),
        debugInfo: () =>
          debugInfoText({
            appId: "analytics-2",
            buildSha: document
              .querySelector('meta[name="agent-native-build-sha"]')
              ?.getAttribute("content"),
            email: verifiedBootstrap?.user.email,
            url: window.location.href,
            userAgent: navigator.userAgent,
          }),
      }),
    [navigate, verifiedBootstrap?.user.email],
  );

  const notificationsQuery = useActionQuery<{
    items: WorkspaceShellNotification[];
    unreadCount: number;
  }>("list-workspace-notifications", {}, { enabled: homeFrame });
  const [optimisticRead, setOptimisticRead] = useState<OptimisticRead>([]);
  const markNotificationsRead = useActionMutation(
    "mark-workspace-notifications-read",
    {
      onSuccess: async () => {
        await notificationsQuery.refetch();
      },
      onError: (error: Error) => toast.error(error.message),
      onSettled: () => setOptimisticRead([]),
    },
  );
  const markRead = useCallback(
    (id?: string) => {
      setOptimisticRead((current) =>
        id === undefined
          ? "all"
          : current === "all"
            ? current
            : [...current, id],
      );
      markNotificationsRead.mutate(id === undefined ? {} : { id });
    },
    [markNotificationsRead],
  );
  const notificationsData = useMemo(
    () =>
      applyOptimisticRead(
        notificationsQuery.data ?? { items: [], unreadCount: 0 },
        optimisticRead,
      ),
    [notificationsQuery.data, optimisticRead],
  );

  const createThread = useActionMutation("create-thread", {
    onSuccess: (result) => {
      setWriteError(null);
      void queryClient.invalidateQueries({ queryKey: ["action"] });
      void navigate(result.href);
    },
    onError: (error: Error) =>
      setWriteError({ action: "create-thread", message: error.message }),
  });

  const onCreateThread = useCallback<WorkspaceShellHandler>(() => {
    if (createThread.isPending) return;
    createThread.mutate({});
  }, [createThread]);

  const uncertainSearchSubmission = useRef(false);
  const searchSubmitting = useRef(false);
  const searchThread = useRef<{
    id: string;
    href: string;
    orgId: string;
  } | null>(null);
  const onSearchCreateThread = useCallback(
    async (query: string, options: { newTab: boolean }) => {
      if (searchSubmitting.current)
        throw new Error(t("analytics.shell.searchThreadFailed"));
      if (uncertainSearchSubmission.current)
        throw new Error(t("analytics.shell.searchThreadUnknown"));
      const target = options.newTab ? window.open("", "_blank") : null;
      if (options.newTab && !target)
        throw new Error(t("analytics.shell.searchThreadFailed"));
      searchSubmitting.current = true;
      let navigating = false;
      try {
        const orgId = verifiedBootstrap?.workspace.id;
        if (!orgId) throw new Error(t("analytics.shell.searchThreadFailed"));
        let created = searchThread.current;
        if (!created || created.orgId !== orgId) {
          const thread = await callAction("create-thread", {});
          created = { ...thread, orgId };
          searchThread.current = created;
        }
        const submission = target
          ? queueCrossTabSearchSubmission(target, created.id, orgId, query)
          : queueThreadSubmission(created.id, orgId, { message: query });
        if (target) {
          target.location.replace(appMountedHref(created.href, appBasePath()));
          navigating = true;
        } else if (location.pathname !== created.href) {
          void navigate(created.href);
        }
        const result = await submission;
        if (!result.delivered) {
          const definitelyNotSent =
            result.reason === "surface-unavailable" ||
            result.reason === "composer-disabled" ||
            result.reason === "engine-not-configured";
          if (!definitelyNotSent) uncertainSearchSubmission.current = true;
          else target?.close();
          throw new Error(
            t(
              definitelyNotSent
                ? "analytics.shell.searchThreadFailed"
                : "analytics.shell.searchThreadUnknown",
            ),
          );
        }
        searchThread.current = null;
        void queryClient.invalidateQueries({ queryKey: ["action"] });
      } catch (error) {
        if (!navigating && target) {
          target.close();
          throw new Error(t("analytics.shell.searchThreadFailed"));
        }
        throw error;
      } finally {
        searchSubmitting.current = false;
      }
    },
    [
      location.pathname,
      navigate,
      queryClient,
      verifiedBootstrap?.workspace.id,
      t,
    ],
  );

  const onOpenSearch = useCallback<WorkspaceShellHandler>(() => {
    setSearchOpen(true);
  }, []);

  useEffect(() => {
    if (
      isPublicFrame ||
      currentRoute.frame === "settings" ||
      searchOpen ||
      searchRoute
    )
      return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!shouldOpenWorkspaceSearchShortcut(event, currentRoute.frame)) return;
      event.preventDefault();
      void onOpenSearch();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    currentRoute.frame,
    isPublicFrame,
    onOpenSearch,
    searchOpen,
    searchRoute,
  ]);

  const openCollection = useCallback(() => {
    void navigate("/home/collections?dialog=create-collection");
  }, [navigate]);
  const onImportProject = useCallback<WorkspaceShellHandler>(() => {
    setImportOpen(true);
  }, []);
  useEffect(() => {
    if (isPublicFrame || !canCreateProject) return;
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        !event.altKey ||
        !event.shiftKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      if (document.querySelector(OPEN_OVERLAY_SELECTOR)) return;
      if (
        event.target instanceof Element &&
        event.target.closest('input,textarea,select,[contenteditable="true"]')
      )
        return;
      if (event.code === "KeyL" || event.key.toLowerCase() === "l") {
        event.preventDefault();
        openCollection();
      } else if (event.code === "KeyU" || event.key.toLowerCase() === "u") {
        event.preventDefault();
        void onImportProject();
      } else if (
        secondaryFeaturesEnabled() &&
        (event.code === "KeyC" || event.key.toLowerCase() === "c")
      ) {
        event.preventDefault();
        openComponent();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [
    isPublicFrame,
    canCreateProject,
    openCollection,
    openComponent,
    onImportProject,
  ]);

  const importNotebook = useCallback(
    async (notebook: ImportedNotebook, title: string) => {
      const result = await callAction("import-project", {
        title,
        cells: notebook.cells.map((cell) =>
          cell.kind === "code"
            ? { kind: "code" as const, source: cell.source }
            : { kind: "markdown" as const, markdown: cell.markdown },
        ),
      });
      setWriteError(null);
      void queryClient.invalidateQueries({ queryKey: ["action"] });
      void navigate(`/project/${encodeURIComponent(result.project.id)}/latest`);
    },
    [navigate, queryClient],
  );

  // The filter bar is only as good as its options: read the workspace's own
  // members and catalogues while the panel is open, never a made-up list.
  const searchFilterOptions = useSearchFilterOptions(searchOpen || searchRoute);

  // A workspace with no work yet gets the starting projects and the sample
  // collection once, on first load. The action is idempotent, so this only does
  // anything for an account that has nothing.
  const ensureSampleWorkspace = useActionMutation<{
    created: boolean;
    projectIds: string[];
  }>("ensure-sample-workspace", {
    onSuccess: (result) => {
      if (result?.created) {
        void queryClient.invalidateQueries({ queryKey: ["action"] });
      }
    },
  });
  const ensureSampleWorkspaceStarted = useRef<string | null>(null);
  useEffect(() => {
    if (!verifiedBootstrap || !activityQuery.data?.needsSampleWorkspace) return;
    const scope = JSON.stringify([
      verifiedBootstrap.workspace.id,
      verifiedBootstrap.user.email,
    ]);
    if (ensureSampleWorkspaceStarted.current === scope) return;
    ensureSampleWorkspaceStarted.current = scope;
    ensureSampleWorkspace.mutate(
      {},
      { onError: (error: Error) => toast.error(error.message) },
    );
  }, [verifiedBootstrap, activityQuery.data, ensureSampleWorkspace]);

  const retryWrite = useCallback(() => createThread.mutate({}), [createThread]);

  const renderPage = useCallback(
    (route: ResolvedRoute): ReactNode => {
      if (
        !secondaryFeaturesEnabled() &&
        ((route.id === "home" &&
          ["tasks", "components", "explorations"].includes(route.view)) ||
          (route.id === "settings" &&
            ["directory-sync", "sso"].includes(route.view)))
      ) {
        return <Navigate to="/home" replace />;
      }
      const entry = resolveRoutePage(route, {
        isAdmin: verifiedBootstrap?.features.isAdmin === true,
      });
      if (!entry) return null;
      const Page = entry.component as ComponentType<RoutePageProps>;
      return (
        <Suspense
          fallback={entry.fallback ?? <Skeleton className="m-6 h-24 w-full" />}
        >
          <Page route={route} />
        </Suspense>
      );
    },
    [t, verifiedBootstrap?.features.isAdmin],
  );

  const renderFrame = useCallback(
    (route: ResolvedRoute, content: ReactNode): ReactNode => {
      if (EMPTY_FRAME_FRAMES.has(route.frame)) return null;

      // Settings has its own navigation, separate from the
      // workspace sidebar.
      if (route.frame === "settings") {
        if (!verifiedBootstrap && !bootstrapQuery.isPending) {
          return (
            <div style={{ display: "flex", minHeight: "100vh", width: "100%" }}>
              <FrameMessage
                title="Settings unavailable"
                detail={
                  bootstrapQuery.error instanceof Error
                    ? bootstrapQuery.error.message
                    : t("workspaceFrame.identityUnreadable")
                }
                onRetry={() => void bootstrapQuery.refetch()}
              />
            </div>
          );
        }
        const isAdmin = verifiedBootstrap?.features.isAdmin === true;
        const waitsForRole =
          !verifiedBootstrap &&
          resolveRoutePage(route, { isAdmin: true }) !==
            resolveRoutePage(route, { isAdmin: false });
        return (
          <SettingsShell
            activeTab={settingsPageView(
              route.view,
              verifiedBootstrap ? { isAdmin } : undefined,
            )}
            canManageWorkspace={isAdmin}
          >
            {waitsForRole ? (
              <FrameMessage title="Loading settings…" />
            ) : settingsViewResolves(route.view, { isAdmin }) ? (
              content
            ) : (
              <SettingsRouteFallback view={route.view} />
            )}
          </SettingsShell>
        );
      }

      // Notebook/project, explore, published apps and the remaining source
      // frames are their own full-page surfaces, not sidebar tabs.
      if (route.frame !== "home") {
        return <RouteFrame route={route}>{content}</RouteFrame>;
      }

      if (switchingWorkspace || bootstrapQuery.isPending) {
        return (
          <WorkspaceLoading>
            {resolveRoutePage(route)?.fallback}
          </WorkspaceLoading>
        );
      }

      if (!verifiedBootstrap) {
        return (
          <div style={{ display: "flex", minHeight: "100vh", width: "100%" }}>
            <WorkspaceUnavailable
              error={bootstrapQuery.error}
              onRetry={() => void bootstrapQuery.refetch()}
            />
          </div>
        );
      }

      const data = verifiedBootstrap;
      return (
        <>
          <WorkspaceShell
            workspace={data.workspace}
            user={data.user}
            features={{
              ...data.features,
              library: navigationQuery.data?.library === true,
            }}
            capabilities={data.capabilities}
            recents={activityQuery.data?.recents ?? []}
            favorites={activityQuery.data?.favorites ?? []}
            detailsStatus={activityStatus}
            onCreateProject={onCreateProject}
            onCreateThread={onCreateThread}
            onOpenSearch={onOpenSearch}
            notifications={
              notificationsQuery.isPending
                ? { status: "loading" }
                : notificationsQuery.isError
                  ? {
                      status: "error",
                      onRetry: () => {
                        void notificationsQuery.refetch();
                      },
                    }
                  : {
                      status: "ready",
                      ...notificationsData,
                      pending: markNotificationsRead.isPending,
                      onMarkAllRead: () => markRead(),
                      onOpenNotification: (item) => {
                        if (!item.read) markRead(item.id);
                        if (item.href) void navigate(item.href);
                      },
                    }
            }
            quickCreate={{
              ...(canCreateProject
                ? {
                    onImportProject,
                    onCreateCollection: () =>
                      void navigate(
                        "/home/collections?dialog=create-collection",
                      ),
                  }
                : {}),
            }}
            workspaceMenu={{
              ...(navigationQuery.data
                ? { workspaces: navigationQuery.data.workspaces }
                : {}),
              onSwitchWorkspace: async (id) => {
                setSwitchingWorkspace(true);
                try {
                  await switchOrg.mutateAsync(id);
                  void navigate("/home");
                } catch (error) {
                  toast.error(
                    actionErrorMessage(
                      error,
                      error instanceof Error ? error.message : String(error),
                    ),
                  );
                } finally {
                  setSwitchingWorkspace(false);
                }
              },
              onLogout: menuHandlers.workspaceMenu.onLogout,
              ...(menuHandlers.workspaceMenu.onLogoutAll
                ? { onLogoutAll: menuHandlers.workspaceMenu.onLogoutAll }
                : {}),
            }}
            accountMenu={{
              onCopyDebugInfo: menuHandlers.accountMenu.onCopyDebugInfo,
            }}
          >
            {writeError ? (
              <WriteErrorBanner
                error={writeError}
                onRetry={retryWrite}
                onDismiss={() => setWriteError(null)}
              />
            ) : null}
            {/* A home URL whose view has no page (typed, bookmarked or stale) gets
              the app's not-found copy instead of an empty main. */}
            {content ?? <SettingsRouteFallback view={route.view} />}
          </WorkspaceShell>
        </>
      );
    },
    [
      onCreateProject,
      onCreateThread,
      onOpenSearch,
      notificationsQuery,
      notificationsData,
      markRead,
      markNotificationsRead,
      navigate,
      onImportProject,
      retryWrite,
      bootstrapQuery,
      verifiedBootstrap,
      activityQuery.data,
      activityStatus,
      navigationQuery.data,
      switchingWorkspace,
      writeError,
      canCreateProject,
      t,
    ],
  );

  // The route resolver decides which home section and page a URL opens, and it
  // also needs to know what this workspace can show. Without these flags every
  // gated section fell back to Home: the sidebar's Tasks row, Folders, Drafts and
  // the admin sections all resolved to the Home tab (row 221).
  const routingContext = useMemo(() => {
    const features = verifiedBootstrap?.features;
    return {
      ...(verifiedBootstrap ? { authenticated: true } : {}),
      ...(features?.isAdmin !== undefined ? { isAdmin: features.isAdmin } : {}),
      ...(features?.folders !== undefined
        ? { foldersEnabled: features.folders }
        : {}),
      ...(features?.tasks !== undefined
        ? { tasksEnabled: features.tasks }
        : {}),
      ...(features?.developerTools !== undefined
        ? { development: features.developerTools }
        : {}),
    };
  }, [verifiedBootstrap]);

  const outletContext: RouteOutletContext = useMemo(
    () => ({ renderPage, renderFrame, routing: routingContext }),
    [renderFrame, renderPage, routingContext],
  );

  const workspaceData = useMemo<WorkspaceDataValue | undefined>(
    () =>
      verifiedBootstrap
        ? {
            shell: verifiedBootstrap,
            activity: activityQuery.data,
            activityStatus,
            contextSetup: canBrowseData ? contextSetupQuery.data : undefined,
            contextSetupPending: canBrowseData && contextSetupQuery.isPending,
            onCreateProject,
            onImportProject,
            quickCreateProject,
            onCreateThread,
          }
        : undefined,
    [
      onCreateProject,
      onImportProject,
      quickCreateProject,
      onCreateThread,
      verifiedBootstrap,
      activityQuery.data,
      activityStatus,
      contextSetupQuery.data,
      contextSetupQuery.isPending,
      canBrowseData,
    ],
  );

  return (
    <KeyboardShortcutsProvider>
      <WorkspaceCommands
        enabled={
          !isPublicFrame &&
          currentRoute.frame !== "settings" &&
          !!verifiedBootstrap
        }
        project={
          RESOURCE_TITLE_ROUTES.has(currentRoute.id) &&
          currentRoute.id !== "thread"
        }
        commands={[
          ...[
            ["home", "/home"],
            ["projects", "/home/all"],
            ["collections", "/home/collections"],
            ["settings", "/settings/profile"],
            ...(canBrowseData ? [["data", "/home/data"]] : []),
          ].map(([id, path]) => ({
            id: id!,
            label: t(`commandPalette.${id}`),
            group: t("commandPalette.navigation"),
            run: () => {
              void navigate(path!);
            },
          })),
          ...(!canCreateProject
            ? []
            : [
                {
                  id: "new-project",
                  label: t("commandPalette.newProject"),
                  group: t("commandPalette.actions"),
                  shortcut: "Alt + Shift + N",
                  run: onCreateProject,
                },
                {
                  id: "import-project",
                  label: t("commandPalette.importProject"),
                  group: t("commandPalette.actions"),
                  shortcut: "Alt + Shift + U",
                  run: onImportProject,
                },
                {
                  id: "new-collection",
                  label: t("commandPalette.newCollection"),
                  group: t("commandPalette.actions"),
                  shortcut: "Alt + Shift + L",
                  run: openCollection,
                },
                ...(secondaryFeaturesEnabled()
                  ? [
                      {
                        id: "new-component",
                        label: t("commandPalette.newComponent"),
                        group: t("commandPalette.actions"),
                        shortcut: "Alt + Shift + C",
                        run: openComponent,
                      },
                    ]
                  : []),
              ]),
        ]}
      >
        <WorkspaceDataContext.Provider value={workspaceData}>
          {createNotebook.creation ? (
            <ProvisionalNotebook {...createNotebook} />
          ) : (
            <Outlet context={outletContext} />
          )}
          {componentOpen ? (
            <NewComponentDialog
              cellCount={1}
              onClose={closeComponent}
              onCreate={async (name) => {
                const scope = componentScopeRef.current;
                if (!scope) throw new Error(t("notebook.component.changed"));
                const source = (componentSource.current ??= {
                  requestId: crypto.randomUUID(),
                  title: name,
                  scope,
                });
                const checkCurrent = () => {
                  if (
                    componentScopeRef.current !== source.scope ||
                    componentSource.current !== source
                  )
                    throw new Error(t("notebook.component.changed"));
                };
                if (!source.projectId) {
                  const created = await callAction("create-project", {
                    requestId: source.requestId,
                    title: source.title,
                    starter: {
                      kind: "cells",
                      cells: [
                        {
                          kind: "code",
                          source: "",
                          language: "python",
                          resultVariable: null,
                          outputResult: false,
                          label: null,
                          hidden: false,
                          gridX: null,
                          gridY: null,
                          gridWidth: null,
                          gridHeight: null,
                        },
                      ],
                    },
                  });
                  source.projectId = created.id;
                  checkCurrent();
                }
                const result = await callAction(
                  "get-project",
                  { projectId: source.projectId },
                  { method: "GET" },
                );
                checkCurrent();
                const cells = result.project.cells;
                const known = await callAction<{
                  components: { sourceProjectId: string; name: string }[];
                }>("list-components", {}, { method: "GET" });
                checkCurrent();
                if (
                  !known.components.some(
                    (component) =>
                      component.sourceProjectId === source.projectId &&
                      component.name === name,
                  )
                )
                  await callAction("manage-component", {
                    operation: "create",
                    projectId: source.projectId,
                    name,
                    cellIds: cells.map((cell) => cell.id),
                  });
                checkCurrent();
                componentSource.current = null;
                void queryClient.invalidateQueries({ queryKey: ["action"] });
                void navigate(
                  `/project/${encodeURIComponent(source.projectId!)}/latest`,
                );
              }}
            />
          ) : null}
          {importOpen ? (
            <ImportProjectDialog
              onClose={() => setImportOpen(false)}
              onImport={importNotebook}
            />
          ) : null}
          <WorkspaceSearchNavigation
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            onSearch={searchWorkspace}
            {...(verifiedBootstrap?.features.canCreateThread
              ? { onCreateThread: onSearchCreateThread }
              : {})}
            filterOptions={searchFilterOptions}
          />
        </WorkspaceDataContext.Provider>
      </WorkspaceCommands>
    </KeyboardShortcutsProvider>
  );
}
