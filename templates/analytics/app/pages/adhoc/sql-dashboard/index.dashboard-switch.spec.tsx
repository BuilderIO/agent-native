// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import {
  MemoryRouter,
  UNSAFE_createClientRoutes,
  Outlet,
  createMemoryRouter,
  RouterProvider,
  Route,
  Routes,
  useNavigate,
  useParams,
  useRouteError,
  type NavigateFunction,
} from "react-router";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHeaderActions } from "@/components/layout/HeaderActions";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  parsePersonalColumnWidths,
  personalColumnWidthsKey,
} from "@/lib/personal-column-widths";
import { loader as dashboardRouteLoader } from "@/routes/dashboards.$id";

import {
  DashboardNameDrafts,
  DashboardNameDraftRouterBridge,
  NameDraftDashboardContext,
  useDashboardNameDraft,
} from "./DashboardNameDrafts";
import SqlDashboardPage from "./index";
import type { SqlPanel } from "./types";

type CardRender = {
  dashboardId: string;
  panelId: string;
  widths: Record<string, number>;
};

const mocks = vi.hoisted(() => ({
  dashboards: {} as Record<string, Record<string, unknown>>,
  saveDashboard: (async () => ({})) as (
    args: Record<string, unknown>,
  ) => Promise<unknown>,
  cardRenders: [] as CardRender[],
  editableRenders: [] as boolean[],
  editorRenders: [] as { open: boolean; dashboardId: string }[],
  submitEditorOn: null as string | null,
  submitViewOn: null as string | null,
  submitFilterOn: null as string | null,
  transientFilter: null as { busy: string | null; disabled: boolean } | null,
  filterBarRenders: [] as {
    routeId: string;
    label: string;
    canSave: boolean;
  }[],
  filterBarMounts: 0,
  retainedFilter: null as {
    update: ReturnType<
      typeof import("./use-filter-search-params").useFilterSearchParams
    >[1];
    canUpdate: () => boolean;
    unmounts: number;
  } | null,
  replayRetainedFilter: false,
  retainedFilterAttempt: null as {
    busy: string | null;
    admitted: boolean;
  } | null,
  transientViewAttempts: 0,
  transientSaveTriggerVisible: false,
  saveView:
    vi.fn<(dashboardId: string | undefined, view: unknown) => Promise<void>>(),
  publicMetadata: vi.fn(async (_id: string): Promise<null> => null),
  session: { email: "viewer@example.com", orgId: "org-a" } as {
    email: string;
    orgId?: string;
  } | null,
  sessionStatus: "authenticated" as
    | "loading"
    | "authenticated"
    | "signing-out"
    | "unauthenticated",
  sessionListeners: new Set<() => void>(),
  sessionHook: vi.fn(),
  noop: () => {},
  mutation: { mutateAsync: async () => ({}), isPending: false },
  revisions: { data: undefined, refetch: async () => ({}) },
  views: {
    views: [],
    isSuccess: true,
    isSettled: true,
    saveView: async () => {},
  },
  userPref: {
    data: undefined as unknown,
    isSuccess: true,
    isError: false,
    isFetching: false,
    save: (() => {}) as (
      value: unknown,
      options?: { onError?: () => void },
    ) => void,
  },
  chatContext: { selectedPanelId: null, selectPanelForChat: () => {} },
  collab: {
    ydoc: null as unknown,
    awareness: null,
    isSynced: false,
    activeUsers: [],
    agentActive: false,
    agentPresent: false,
  },
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  generateTabId: () => "tab-test",
}));

vi.mock("@agent-native/core/client/analytics", () => ({
  trackEvent: () => {},
  captureException: () => {},
}));

vi.mock("@agent-native/core/server", () => ({
  getConfiguredAppBasePath: () => "",
}));

vi.mock("@agent-native/core/shared", () => ({
  AGENT_ACCESS_PARAM: "agent_access",
  scopedAgentAccessResourceId: (prefix: string, id: string) =>
    `${prefix}:${id}`,
  buildResourceSocialMeta: () => [],
  normalizeDocumentTitle: (title: string) => title,
}));

vi.mock("@/pages/adhoc/AdhocRouter", () => ({ default: () => null }));

vi.mock("../../../../server/lib/dashboards-store", () => ({
  getPublicDashboardMetadata: mocks.publicMetadata,
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appPath: (path: string) => path,
}));

vi.mock("@agent-native/core/client/collab", () => ({
  useCollaborativeDoc: () => mocks.collab,
  emailToColor: () => "#000000",
  emailToName: (email: string) => email,
  dedupeCollabUsersByEmail: <T,>(users: T[]) => users,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useSession: () => {
    mocks.sessionHook();
    return {
      session: useSyncExternalStore(
        (listener) => {
          mocks.sessionListeners.add(listener);
          return () => {
            mocks.sessionListeners.delete(listener);
          };
        },
        () => mocks.session,
        () => null,
      ),
      isLoading: false,
      status: useSyncExternalStore(
        (listener) => {
          mocks.sessionListeners.add(listener);
          return () => {
            mocks.sessionListeners.delete(listener);
          };
        },
        () => mocks.sessionStatus,
        () => "loading",
      ),
    };
  },
  callAction: async (name: string, args: Record<string, unknown>) => {
    if (name === "get-sql-dashboard") {
      return mocks.dashboards[args.id as string] ?? null;
    }
    if (name === "update-dashboard") return mocks.saveDashboard(args);
    throw new Error(`Unexpected action ${name}`);
  },
  useChangeVersion: () => 0,
  useActionQuery: () => ({ data: undefined, isError: false, isLoading: false }),
  useActionMutation: () => mocks.mutation,
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useFormatters: () => ({ formatNumber: (value: number) => String(value) }),
}));

vi.mock("@agent-native/core/client/org", () => ({
  useOrgRole: () => ({ canManageOrg: false, org: null }),
}));

vi.mock("@agent-native/creative-context/client", () => ({
  CreativeContextShareSheet: () => null,
  CreativeContextShareTab: () => null,
  useCreativeContextLab: () => false,
}));

vi.mock("@agent-native/toolkit/app/sharing", () => ({
  ShareButton: () => null,
}));

vi.mock("@agent-native/toolkit/collab-ui", () => ({
  PresenceBar: () => null,
}));

vi.mock("@/components/dashboard/DashboardHistoryPanel", () => ({
  DashboardHistoryPanel: () => null,
}));

vi.mock("@/hooks/use-dashboard-chat-context", () => ({
  useDashboardChatContext: () => mocks.chatContext,
}));

vi.mock("@/hooks/use-dashboard-revisions", () => ({
  useDashboardRevisions: () => mocks.revisions,
  useRestoreDashboardRevision: () => mocks.mutation,
}));

vi.mock("@/hooks/use-dashboard-views", () => ({
  useDashboardViews: (dashboardId: string | undefined) => ({
    ...mocks.views,
    saveView: (view: unknown) => mocks.saveView(dashboardId, view),
  }),
}));

vi.mock("./use-filter-search-params", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./use-filter-search-params")>();
  return {
    ...actual,
    useFilterSearchParams: (
      ...args: Parameters<typeof actual.useFilterSearchParams>
    ) => {
      const result = actual.useFilterSearchParams(...args);
      useLayoutEffect(() => {
        if (args[0] !== "dash-a" || mocks.retainedFilter) return;
        const retained = {
          update: result[1],
          canUpdate: result[3],
          unmounts: 0,
        };
        mocks.retainedFilter = retained;
        return () => {
          retained.unmounts++;
        };
      }, []);
      return result;
    },
  };
});

vi.mock("./DashboardFilterBar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./DashboardFilterBar")>();
  return {
    ...actual,
    DashboardFilterBar: function ObservedFilterBar(
      props: ComponentProps<typeof actual.DashboardFilterBar>,
    ) {
      const { id: routeId = "" } = useParams();
      const label = props.filters[0]?.label ?? "";
      useLayoutEffect(() => {
        mocks.filterBarMounts++;
      }, []);
      useLayoutEffect(() => {
        if (
          mocks.replayRetainedFilter &&
          routeId === "dash-a" &&
          label === "Region B"
        ) {
          mocks.replayRetainedFilter = false;
          const retained = mocks.retainedFilter!;
          mocks.retainedFilterAttempt = {
            busy: document
              .querySelector(
                '[role="group"][aria-label="sqlDashboard.filters"]',
              )!
              .getAttribute("aria-busy"),
            admitted: retained.canUpdate(),
          };
          retained.update((prev) => {
            const next = new URLSearchParams(prev);
            next.set("f_oldRegion", "retained-overwrite");
            return next;
          });
        }
        mocks.filterBarRenders.push({
          routeId,
          label,
          canSave: !!props.onSaveView,
        });
        if (routeId === mocks.submitFilterOn && label === "Region A") {
          mocks.submitFilterOn = null;
          const input = document.querySelector<HTMLInputElement>(
            '[role="group"][aria-label="sqlDashboard.filters"] input',
          )!;
          mocks.transientFilter = {
            busy: input.closest('[role="group"]')!.getAttribute("aria-busy"),
            disabled: input.disabled,
          };
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )!.set!.call(input, "old-config-event");
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (routeId === mocks.submitViewOn && label === "Region A") {
          mocks.submitViewOn = null;
          const input = document.querySelector('[role="dialog"] input');
          expect(input).not.toBeNull();
          mocks.transientViewAttempts++;
          mocks.transientSaveTriggerVisible = [
            ...document.querySelectorAll("button"),
          ].some((button) => button.textContent === "sqlDashboard.saveView");
          input!.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
          );
        }
      });
      return <actual.DashboardFilterBar {...props} />;
    },
  };
});

vi.mock("@/hooks/use-user-pref", () => ({
  useUserPref: () => mocks.userPref,
}));

vi.mock("@/lib/item-popularity", () => ({
  incrementItemView: () => {},
}));

vi.mock("./EmailReportDialog", () => ({
  EmailReportDialog: ({
    open,
    dashboardId,
  }: {
    open: boolean;
    dashboardId: string;
  }) =>
    open ? (
      <div data-testid="email-report" data-dashboard-id={dashboardId} />
    ) : null,
}));

vi.mock("./PanelEditorDialog", () => ({
  AddPanelPopover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PanelEditorDialog: function PanelEditorDialog({
    open,
    panel,
    onSave,
    dashboardId,
  }: {
    open: boolean;
    panel: SqlPanel | null;
    onSave: (panel: SqlPanel) => Promise<void>;
    dashboardId: string;
  }) {
    mocks.editorRenders.push({ open, dashboardId });
    const save = () => {
      if (panel) {
        void onSave({ ...panel, title: `${panel.title} edited` }).catch(
          mocks.noop,
        );
      }
    };
    // A layout effect runs after the commit and before the page's effects,
    // like a click that lands before the route reset.
    useLayoutEffect(() => {
      if (open && dashboardId === mocks.submitEditorOn) {
        mocks.submitEditorOn = null;
        save();
      }
    });
    return open ? (
      <div data-testid="panel-editor" data-panel-id={panel?.id ?? ""}>
        <button data-testid="panel-editor-save" onClick={save} />
      </div>
    ) : null;
  },
}));

// The real card hook keeps the personal widths; only the chart is replaced.
vi.mock("./SqlChartCard", async () => {
  const { usePersonalColumnWidths } =
    await import("@/lib/personal-column-widths");
  return {
    dashboardTileElementId: (id: string) => `dashboard-tile-${id}`,
    SqlChartCard: ({
      panel,
      dashboardId = "",
      onEdit,
      onSaveSql,
      onSaveColumns,
      editable = false,
    }: {
      panel: SqlPanel;
      dashboardId?: string;
      onEdit?: () => void;
      onSaveSql?: (sql: string) => Promise<void>;
      onSaveColumns?: (columns: { key: string; width?: number }[]) => void;
      editable?: boolean;
    }) => {
      mocks.editableRenders.push(editable);
      const { widths } = usePersonalColumnWidths(
        dashboardId,
        panel.id,
        panel.config?.columns,
      );
      mocks.cardRenders.push({ dashboardId, panelId: panel.id, widths });
      return (
        <>
          <button data-testid={`edit-${panel.id}`} onClick={onEdit}>
            {panel.title}
          </button>
          <button
            data-testid={`save-sql-${panel.id}`}
            onClick={() => void onSaveSql?.("SELECT 1")}
          />
          <button
            data-testid={`save-columns-first-${panel.id}`}
            onClick={() => onSaveColumns?.([{ key: "first", width: 220 }])}
          />
          <button
            data-testid={`save-columns-second-${panel.id}`}
            onClick={() => onSaveColumns?.([{ key: "second", width: 240 }])}
          />
        </>
      );
    },
  };
});

vi.mock("./ViewsMenu", () => ({
  ViewsMenu: () => null,
}));

function tablePanel(
  title: string,
  sharedWidth: number,
  id = "shared-table",
): SqlPanel {
  return {
    id,
    title,
    sql: "SELECT name FROM accounts",
    source: "first-party",
    chartType: "table",
    width: 1,
    config: { columns: [{ key: "name", width: sharedWidth }] },
  };
}

function dashboardRecord(name: string, panels: SqlPanel[]) {
  return {
    name,
    panels,
    role: "owner",
    canEdit: true,
    canManage: true,
    visibility: "private",
    createdBy: "viewer@example.com",
    createdAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-01T12:00:00.000Z",
  };
}

function HeaderActionsOutlet() {
  return <>{useHeaderActions()}</>;
}

let navigate: NavigateFunction;
function CaptureNavigate() {
  navigate = useNavigate();
  return null;
}

function RootErrorBoundary() {
  const error = useRouteError();
  return (
    <div role="alert">
      {error instanceof Error ? error.message : "Route failure"}
    </div>
  );
}

describe("SqlDashboardPage dashboard switch", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let layoutMounts: number;
  let layoutUnmounts: number;

  async function settle() {
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  async function renderAt(path: string) {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <MemoryRouter initialEntries={[path]}>
              <CaptureNavigate />
              <HeaderActionsOutlet />
              <Routes>
                <Route path="/dashboards/:id" element={<SqlDashboardPage />} />
              </Routes>
            </MemoryRouter>
          </TooltipProvider>
        </QueryClientProvider>,
      );
    });
    await settle();
  }

  async function goTo(path: string) {
    await act(async () => {
      void navigate(path);
    });
    await settle();
  }

  async function click(testId: string) {
    const element = container.querySelector(`[data-testid="${testId}"]`);
    expect(element).not.toBeNull();
    await act(async () => {
      (element as HTMLElement).click();
    });
    await settle();
  }

  function byTestId(testId: string) {
    return container.querySelector(`[data-testid="${testId}"]`);
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.localStorage.clear();
    mocks.cardRenders = [];
    mocks.editableRenders = [];
    mocks.editorRenders = [];
    mocks.submitEditorOn = null;
    mocks.submitViewOn = null;
    mocks.submitFilterOn = null;
    mocks.transientFilter = null;
    mocks.filterBarRenders = [];
    mocks.filterBarMounts = 0;
    mocks.retainedFilter = null;
    mocks.replayRetainedFilter = false;
    mocks.retainedFilterAttempt = null;
    mocks.transientViewAttempts = 0;
    mocks.transientSaveTriggerVisible = false;
    mocks.saveView.mockReset();
    mocks.saveView.mockResolvedValue(undefined);
    mocks.session = { email: "viewer@example.com", orgId: "org-a" };
    mocks.sessionStatus = "authenticated";
    mocks.sessionHook.mockClear();
    layoutMounts = 0;
    layoutUnmounts = 0;
    mocks.publicMetadata.mockReset();
    mocks.publicMetadata.mockResolvedValue(null);
    mocks.saveDashboard = async () => ({});
    mocks.collab = {
      ydoc: null,
      awareness: null,
      isSynced: false,
      activeUsers: [],
      agentActive: false,
      agentPresent: false,
    };
    mocks.userPref = {
      data: undefined,
      isSuccess: true,
      isError: false,
      isFetching: false,
      save: () => {},
    };
    mocks.dashboards = {
      "dash-a": dashboardRecord("Dashboard A", [tablePanel("Accounts A", 200)]),
      "dash-b": dashboardRecord("Dashboard B", [tablePanel("Accounts B", 200)]),
    };
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function viewButton(text: string) {
    const button = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((element) => element.textContent?.trim() === text);
    if (!button) throw new Error(`Missing button: ${text}`);
    return button;
  }

  function viewNameInput() {
    return document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
  }

  function viewDefaultCheckbox() {
    return document.querySelector<HTMLButtonElement>(
      '[role="dialog"] [role="checkbox"]',
    )!;
  }

  function enterViewDraft(name: string) {
    act(() => viewButton("sqlDashboard.saveView").click());
    const input = viewNameInput();
    expect(input).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, name);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      viewDefaultCheckbox().click();
    });
    expect(input.value).toBe(name);
    expect(viewDefaultCheckbox().getAttribute("aria-checked")).toBe("true");
  }

  const draftFilter = {
    id: "app",
    label: "App",
    type: "multi-select",
    options: [
      { value: "chat", label: "Chat" },
      { value: "slides", label: "Slides" },
      { value: "design", label: "Design" },
    ],
  };

  function presetInput() {
    return document.querySelector<HTMLInputElement>(
      'input[aria-label="sqlDashboard.groupName"]',
    )!;
  }

  function typeName(input: HTMLInputElement, name: string) {
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, name);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function openPresetDraft() {
    await act(async () => {
      [...container.querySelectorAll<HTMLElement>('[role="radio"]')]
        .find((element) => element.textContent === "dashboardMode.edit")!
        .click();
    });
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[role="group"][aria-label="sqlDashboard.filters"] [aria-haspopup="dialog"]',
        )!
        .click(),
    );
    act(() => viewButton("sqlDashboard.saveAsGroup").click());
    return presetInput();
  }

  async function renderRootErrorRouter() {
    mocks.dashboards["dash-a"].filters = [draftFilter];
    mocks.dashboards["dash-b"].filters = [draftFilter];
    const routes = frameworkRoutes(
      {
        Layout: ({ children }: { children: ReactNode }) => {
          useLayoutEffect(() => {
            layoutMounts++;
            return () => {
              layoutUnmounts++;
            };
          }, []);
          return (
            <>
              <DashboardNameDraftRouterBridge />
              {children}
            </>
          );
        },
        default: () => (
          <>
            <HeaderActionsOutlet />
            <Outlet />
          </>
        ),
        ErrorBoundary: RootErrorBoundary,
      },
      { default: SqlDashboardPage, clientLoader: dashboardRouteLoader },
    );
    const dataRouter = createMemoryRouter(routes, {
      initialEntries: ["/dashboards/dash-a?f_app=chat,slides"],
      hydrationData: { loaderData: { root: null, dashboard: null } },
    });
    await renderDataRouter(dataRouter);
    return dataRouter;
  }

  function frameworkRoutes(
    rootModule: Parameters<typeof UNSAFE_createClientRoutes>[1][string],
    dashboardModule: Parameters<typeof UNSAFE_createClientRoutes>[1][string],
  ) {
    const entry = {
      hasAction: false,
      hasLoader: false,
      hasClientAction: false,
      hasClientLoader: false,
      hasClientMiddleware: false,
      hasErrorBoundary: false,
      module: "test",
      clientActionModule: undefined,
      clientLoaderModule: undefined,
      clientMiddlewareModule: undefined,
      hydrateFallbackModule: undefined,
    };
    return UNSAFE_createClientRoutes(
      {
        root: { ...entry, id: "root", path: "/", hasErrorBoundary: true },
        dashboard: {
          ...entry,
          id: "dashboard",
          parentId: "root",
          path: "dashboards/:id",
          hasClientLoader: !!dashboardModule?.clientLoader,
        },
      },
      { root: rootModule, dashboard: dashboardModule },
      null,
      false,
      false,
    );
  }

  it.each(["authentication", "account", "organization", "sign-out"])(
    "keeps Root and its preloaded QueryClient through %s",
    async (transition) => {
      if (transition === "authentication") {
        mocks.session = null;
        mocks.sessionStatus = "loading";
      }
      let mounts = 0;
      let unmounts = 0;
      const clients: QueryClient[] = [];
      function RootProbe() {
        const [client] = useState(() => {
          const next = new QueryClient();
          next.setQueryData(["preloaded"], "already loaded");
          clients.push(next);
          return next;
        });
        useLayoutEffect(() => {
          mounts++;
          return () => {
            unmounts++;
          };
        }, []);
        return (
          <QueryClientProvider client={client}>
            <Outlet />
          </QueryClientProvider>
        );
      }
      const dataRouter = createMemoryRouter(
        frameworkRoutes(
          {
            Layout: ({ children }: { children: ReactNode }) => (
              <>
                <DashboardNameDraftRouterBridge />
                {children}
              </>
            ),
            default: RootProbe,
            ErrorBoundary: RootErrorBoundary,
          },
          { default: () => null },
        ),
        {
          initialEntries: ["/dashboards/dash-a"],
          hydrationData: { loaderData: { root: null, dashboard: null } },
        },
      );
      try {
        await act(async () =>
          root.render(
            <DashboardNameDrafts>
              <RouterProvider router={dataRouter} />
            </DashboardNameDrafts>,
          ),
        );
        const preloadedClient = clients[0];
        expect(mocks.sessionHook).toHaveBeenCalled();
        act(() => {
          mocks.session =
            transition === "sign-out"
              ? null
              : {
                  email:
                    transition === "account"
                      ? "other@example.com"
                      : "viewer@example.com",
                  orgId: transition === "organization" ? "org-b" : "org-a",
                };
          mocks.sessionStatus =
            transition === "sign-out" ? "unauthenticated" : "authenticated";
          mocks.sessionListeners.forEach((listener) => listener());
        });
        expect({ mounts, unmounts }).toEqual({ mounts: 1, unmounts: 0 });
        expect(clients).toEqual([preloadedClient]);
        expect(clients[0].getQueryData(["preloaded"])).toBe("already loaded");
      } finally {
        dataRouter.dispose();
        clients.forEach((client) => client.clear());
      }
    },
  );

  it.each(["account", "organization", "signing-out", "signed-out"])(
    "resets only both draft records and rejects captured setters across %s and return",
    async (transition) => {
      let mounts = 0;
      let unmounts = 0;
      let currentView!: ReturnType<
        typeof useDashboardNameDraft<{ name: string; isDefault: boolean }>
      >[1];
      let currentPreset!: ReturnType<typeof useDashboardNameDraft<string>>[1];
      function DraftProbe() {
        const [view, setView] = useDashboardNameDraft<{
          name: string;
          isDefault: boolean;
        }>("view", {
          name: "",
          isDefault: false,
        });
        const [preset, setPreset] = useDashboardNameDraft<string>(
          "preset",
          "",
          "app",
        );
        currentView = setView;
        currentPreset = setPreset;
        useLayoutEffect(() => {
          mounts++;
          return () => {
            unmounts++;
          };
        }, []);
        return <output>{JSON.stringify({ view, preset })}</output>;
      }
      const routes = frameworkRoutes(
        {
          Layout: ({ children }: { children: ReactNode }) => (
            <>
              <DashboardNameDraftRouterBridge />
              {children}
            </>
          ),
          default: () => (
            <NameDraftDashboardContext value="dash-a">
              <DraftProbe />
            </NameDraftDashboardContext>
          ),
          ErrorBoundary: RootErrorBoundary,
        },
        { default: () => null },
      );
      const dataRouter = createMemoryRouter(routes, {
        initialEntries: ["/dashboards/dash-a"],
        hydrationData: { loaderData: { root: null, dashboard: null } },
      });
      const names = () =>
        JSON.parse(container.querySelector("output")!.textContent!);
      const empty = { view: { name: "", isDefault: false }, preset: "" };
      try {
        await renderDataRouter(dataRouter);
        act(() => {
          currentView({ name: "Old view", isDefault: true });
          currentPreset("Old preset");
        });
        const oldView = currentView;
        const oldPreset = currentPreset;
        act(() => {
          if (transition === "signed-out") mocks.session = null;
          else if (transition !== "signing-out")
            mocks.session = {
              email:
                transition === "account"
                  ? "other@example.com"
                  : "viewer@example.com",
              orgId: transition === "organization" ? "org-b" : "org-a",
            };
          mocks.sessionStatus =
            transition === "signing-out"
              ? "signing-out"
              : transition === "signed-out"
                ? "unauthenticated"
                : "authenticated";
          mocks.sessionListeners.forEach((listener) => listener());
        });
        expect(names()).toEqual(empty);
        const staleUpdater = vi.fn(() => ({ name: "Stale", isDefault: true }));
        act(() => {
          oldView(staleUpdater);
          oldPreset("Stale preset");
        });
        expect(staleUpdater).not.toHaveBeenCalled();
        expect(names()).toEqual(empty);
        act(() => {
          mocks.session = { email: "viewer@example.com", orgId: "org-a" };
          mocks.sessionStatus = "authenticated";
          mocks.sessionListeners.forEach((listener) => listener());
        });
        expect(names()).toEqual(empty);
        act(() => {
          currentView({ name: "Current view", isDefault: false });
          currentPreset("Current preset");
          oldView(staleUpdater);
          oldPreset("Stale preset");
        });
        expect(names()).toEqual({
          view: { name: "Current view", isDefault: false },
          preset: "Current preset",
        });
        expect(staleUpdater).not.toHaveBeenCalled();
        expect({ mounts, unmounts }).toEqual({ mounts: 1, unmounts: 0 });
      } finally {
        dataRouter.dispose();
      }
    },
  );

  it("hydrates the closed-form shell with a client-only owner and no added DOM", async () => {
    function ClosedForms() {
      const [view] = useDashboardNameDraft("view", {
        name: "",
        isDefault: false,
      });
      const [preset] = useDashboardNameDraft<string>("preset", "", "app");
      return (
        <main>
          <button data-view={view.name}>Save view</button>
          <button data-preset={preset}>Save as group</button>
        </main>
      );
    }
    const routes = frameworkRoutes(
      {
        Layout: ({ children }: { children: ReactNode }) => (
          <>
            <DashboardNameDraftRouterBridge />
            {children}
          </>
        ),
        default: () => (
          <NameDraftDashboardContext value="dash-a">
            <ClosedForms />
          </NameDraftDashboardContext>
        ),
        ErrorBoundary: RootErrorBoundary,
      },
      { default: () => null },
    );
    const dataRouter = createMemoryRouter(routes, {
      initialEntries: ["/dashboards/dash-a"],
      hydrationData: { loaderData: { root: null, dashboard: null } },
    });
    const hydrationContainer = document.createElement("div");
    document.body.appendChild(hydrationContainer);
    const recoverable = vi.fn();
    let hydrated: Root | undefined;
    try {
      const shell = renderToString(<RouterProvider router={dataRouter} />);
      hydrationContainer.innerHTML = shell;
      await act(async () => {
        hydrated = hydrateRoot(
          hydrationContainer,
          <DashboardNameDrafts>
            <RouterProvider router={dataRouter} />
          </DashboardNameDrafts>,
          { onRecoverableError: recoverable },
        );
      });
      expect(recoverable).not.toHaveBeenCalled();
      expect(hydrationContainer.innerHTML).toBe(shell);
      expect(hydrationContainer.querySelectorAll("main > button")).toHaveLength(
        2,
      );
      expect(
        hydrationContainer.querySelector("input, [role=dialog]"),
      ).toBeNull();
    } finally {
      act(() => hydrated?.unmount());
      hydrationContainer.remove();
      dataRouter.dispose();
    }
  });

  async function renderDataRouter(
    dataRouter: ReturnType<typeof createMemoryRouter>,
  ) {
    await act(async () =>
      root.render(
        <DashboardNameDrafts>
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <RouterProvider router={dataRouter} />
            </TooltipProvider>
          </QueryClientProvider>
        </DashboardNameDrafts>,
      ),
    );
    await settle();
  }

  async function failAndRecover(
    dataRouter: ReturnType<typeof createMemoryRouter>,
  ) {
    const mounts = mocks.filterBarMounts;
    const previousLayoutMounts = layoutMounts;
    const previousLayoutUnmounts = layoutUnmounts;
    mocks.publicMetadata.mockRejectedValueOnce(
      new Error("public metadata unavailable"),
    );
    await act(async () => {
      await dataRouter.navigate("/dashboards/dash-b?f_app=slides,design");
    });
    await settle();
    expect(dataRouter.state.errors?.root).toBeInstanceOf(Error);
    expect(container.textContent).toContain("public metadata unavailable");
    expect(
      container.querySelector('[aria-label="sqlDashboard.filters"]'),
    ).toBeNull();
    expect(mocks.retainedFilter!.canUpdate()).toBe(false);
    expect(layoutMounts).toBe(previousLayoutMounts + 1);
    expect(layoutUnmounts).toBe(previousLayoutUnmounts + 1);
    await act(async () => {
      await dataRouter.navigate("/dashboards/dash-a?f_app=slides,design");
    });
    await settle();
    expect(dataRouter.state.errors).toBeNull();
    expect(mocks.filterBarMounts).toBe(mounts + 1);
    expect(layoutMounts).toBe(previousLayoutMounts + 2);
    expect(layoutUnmounts).toBe(previousLayoutUnmounts + 2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  }

  it.each(["view", "preset"])(
    "restores both names (%s) after the actual route loader reaches the root error boundary",
    async (kind) => {
      const dataRouter = await renderRootErrorRouter();
      try {
        if (kind === "preset")
          typeName(await openPresetDraft(), "Preset recovery");
        else enterViewDraft("View recovery");
        await failAndRecover(dataRouter);
        if (kind === "preset") {
          expect((await openPresetDraft()).value).toBe("Preset recovery");
          const saved = vi.fn(async (_args: Record<string, unknown>) => ({}));
          mocks.saveDashboard = saved;
          await act(async () => viewButton("explorer.save").click());
          await settle();
          expect(saved).toHaveBeenCalledTimes(1);
          expect(saved.mock.calls[0][0]).toMatchObject({
            dashboardId: "dash-a",
            config: {
              filters: [
                {
                  id: "app",
                  presets: [
                    { label: "Preset recovery", values: ["slides", "design"] },
                  ],
                },
              ],
            },
          });
          return;
        }
        act(() => viewButton("sqlDashboard.saveView").click());
        expect(viewNameInput().value).toBe("View recovery");
        expect(viewDefaultCheckbox().getAttribute("aria-checked")).toBe("true");
        await act(async () => viewButton("explorer.save").click());
        expect(mocks.saveView).toHaveBeenLastCalledWith("dash-a", {
          id: "view-recovery",
          name: "View recovery",
          filters: { f_app: "slides,design" },
          isDefault: true,
        });
      } finally {
        dataRouter.dispose();
      }
    },
  );

  it.each(
    ["view", "preset"].flatMap((kind) =>
      [
        "account",
        "organization",
        "navigation",
        "cancel",
        "dismiss",
        "success",
      ].map((reason) => [kind, reason]),
    ),
  )("discards root-error %s name draft after %s", async (kind, reason) => {
    const dataRouter = await renderRootErrorRouter();
    try {
      if (kind === "preset")
        typeName(await openPresetDraft(), "Preset recovery");
      else enterViewDraft("View recovery");
      await failAndRecover(dataRouter);
      if (reason === "account" || reason === "organization") {
        mocks.session =
          reason === "account"
            ? { email: "other@example.com", orgId: "org-a" }
            : { email: "viewer@example.com", orgId: "org-b" };
        act(() => mocks.sessionListeners.forEach((listener) => listener()));
        await act(async () => {
          await dataRouter.navigate(
            "/dashboards/dash-a?f_app=slides,design&changed=1",
          );
        });
        await settle();
        // Returning to the former scope must not resurrect its draft either.
        mocks.session = { email: "viewer@example.com", orgId: "org-a" };
        act(() => mocks.sessionListeners.forEach((listener) => listener()));
        await act(async () => {
          await dataRouter.navigate("/dashboards/dash-a?f_app=slides,design");
        });
        await settle();
      } else if (reason === "navigation") {
        await act(async () => {
          await dataRouter.navigate("/dashboards/dash-b?f_app=chat,slides");
        });
        await settle();
        await act(async () => {
          await dataRouter.navigate("/dashboards/dash-a?f_app=slides,design");
        });
        await settle();
      } else {
        if (kind === "preset") {
          await openPresetDraft();
          if (reason === "success")
            act(() => viewButton("explorer.save").click());
          else if (reason === "cancel")
            act(() =>
              presetInput().dispatchEvent(
                new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
              ),
            );
          if (reason !== "success")
            act(() =>
              container
                .querySelector<HTMLButtonElement>(
                  '[role="group"][aria-label="sqlDashboard.filters"] [aria-haspopup="dialog"]',
                )!
                .click(),
            );
        } else {
          act(() => viewButton("sqlDashboard.saveView").click());
          if (reason === "success")
            await act(async () => viewButton("explorer.save").click());
          else if (reason === "cancel")
            act(() => viewButton("sidebar.cancel").click());
          else
            act(() =>
              viewNameInput().dispatchEvent(
                new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
              ),
            );
          await settle();
        }
        await failAndRecover(dataRouter);
      }
      if (kind === "preset") {
        expect((await openPresetDraft()).value).toBe("");
      } else {
        act(() => viewButton("sqlDashboard.saveView").click());
        expect(viewNameInput().value).toBe("");
        expect(viewDefaultCheckbox().getAttribute("aria-checked")).toBe(
          "false",
        );
        act(() => viewButton("sidebar.cancel").click());
      }
    } finally {
      dataRouter.dispose();
    }
  });

  it("starts an empty save-view draft when a cached loaded dashboard replaces another", async () => {
    mocks.dashboards["dash-a"].filters = [
      { id: "region", label: "Region A", type: "text" },
    ];
    mocks.dashboards["dash-b"].filters = [
      { id: "region", label: "Region B", type: "text" },
    ];
    await renderAt("/dashboards/dash-b?f_region=west");
    await goTo("/dashboards/dash-a?f_region=east");
    enterViewDraft("A draft");
    const mounts = mocks.filterBarMounts;

    await goTo("/dashboards/dash-b?f_region=west");

    expect(container.textContent).toContain("Region B");
    expect(mocks.filterBarMounts).toBe(mounts + 1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.saveView).not.toHaveBeenCalled();
    act(() => viewButton("sqlDashboard.saveView").click());
    expect(viewNameInput().value).toBe("");
    expect(viewDefaultCheckbox().getAttribute("aria-checked")).toBe("false");
    expect(viewButton("explorer.save").disabled).toBe(true);
    act(() => viewButton("sidebar.cancel").click());
    enterViewDraft("B draft");
    await act(async () => viewButton("explorer.save").click());
    expect(mocks.saveView.mock.calls).toEqual([
      [
        "dash-b",
        {
          id: "b-draft",
          name: "B draft",
          filters: { f_region: "west" },
          isDefault: true,
        },
      ],
    ]);
  });

  it("does not offer or execute save-view with old config in the new route's pre-effect commit", async () => {
    mocks.dashboards["dash-a"].filters = [
      { id: "region", label: "Region A", type: "text" },
    ];
    mocks.dashboards["dash-b"].filters = [
      { id: "region", label: "Region B", type: "text" },
    ];
    await renderAt("/dashboards/dash-b?f_region=west");
    await goTo("/dashboards/dash-a?f_region=east");
    enterViewDraft("A draft");
    mocks.filterBarRenders = [];
    mocks.submitViewOn = "dash-b";

    await goTo("/dashboards/dash-b?f_region=west");

    expect(mocks.transientViewAttempts).toBe(1);
    expect(mocks.saveView).not.toHaveBeenCalled();
    expect(mocks.transientSaveTriggerVisible).toBe(false);
    expect(mocks.filterBarRenders).toContainEqual({
      routeId: "dash-b",
      label: "Region A",
      canSave: false,
    });
    expect(mocks.filterBarRenders).not.toContainEqual({
      routeId: "dash-b",
      label: "Region A",
      canSave: true,
    });
    expect(mocks.saveView).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Region B");
  });

  it.each([false, true])(
    "blocks an actual old-config input event in the new route's pre-effect commit (cached=%s)",
    async (cached) => {
      mocks.dashboards["dash-a"].filters = [
        { id: "oldRegion", label: "Region A", type: "text" },
      ];
      mocks.dashboards["dash-b"].filters = [
        { id: "country", label: "Country B", type: "text" },
      ];
      if (cached)
        queryClient.setQueryData(
          ["data", "sql-dashboard", "dash-b"],
          mocks.dashboards["dash-b"],
        );
      const loader = vi.fn(() => null);
      const dataRouter = createMemoryRouter(
        [
          {
            path: "/dashboards/:id",
            loader,
            element: <SqlDashboardPage />,
          },
        ],
        { initialEntries: ["/dashboards/dash-a?f_oldRegion=east"] },
      );
      try {
        await act(async () =>
          root.render(
            <QueryClientProvider client={queryClient}>
              <TooltipProvider>
                <RouterProvider router={dataRouter} />
              </TooltipProvider>
            </QueryClientProvider>,
          ),
        );
        await settle();
        mocks.submitFilterOn = "dash-b";
        await act(async () => {
          await dataRouter.navigate("/dashboards/dash-b?f_country=west#target");
        });
        await settle();
        expect(mocks.transientFilter).not.toBeNull();
        expect(dataRouter.state.location.pathname).toBe("/dashboards/dash-b");
        expect(dataRouter.state.location.search).toBe("?f_country=west");
        expect(dataRouter.state.location.hash).toBe("#target");
        expect(loader).toHaveBeenCalledTimes(2);
        expect(mocks.transientFilter).toEqual({ busy: "true", disabled: true });
        expect(container.textContent).toContain("Country B");
      } finally {
        dataRouter.dispose();
      }
    },
  );

  it("does not restore a root-error preset name under a different filter id", async () => {
    const dataRouter = await renderRootErrorRouter();
    try {
      typeName(await openPresetDraft(), "App draft");
      await failAndRecover(dataRouter);
      mocks.dashboards["dash-a"].filters = [{ ...draftFilter, id: "other" }];
      await act(async () => {
        await queryClient.invalidateQueries({
          queryKey: ["data", "sql-dashboard", "dash-a"],
        });
        await dataRouter.navigate("/dashboards/dash-a?f_other=slides,design");
      });
      await settle();
      expect((await openPresetDraft()).value).toBe("");
    } finally {
      dataRouter.dispose();
    }
  });

  it.each(["account", "organization", "signing-out"])(
    "revokes drafts when %s changes while the framework root error is visible",
    async (transition) => {
      const dataRouter = await renderRootErrorRouter();
      try {
        enterViewDraft("Before error");
        mocks.publicMetadata.mockRejectedValueOnce(
          new Error("public metadata unavailable"),
        );
        await act(async () => {
          await dataRouter.navigate("/dashboards/dash-b?f_app=slides,design");
        });
        expect(dataRouter.state.errors?.root).toBeInstanceOf(Error);
        act(() => {
          mocks.session = {
            email:
              transition === "account"
                ? "other@example.com"
                : "viewer@example.com",
            orgId: transition === "organization" ? "org-b" : "org-a",
          };
          mocks.sessionStatus =
            transition === "signing-out" ? "signing-out" : "authenticated";
          mocks.sessionListeners.forEach((listener) => listener());
        });
        act(() => {
          mocks.session = { email: "viewer@example.com", orgId: "org-a" };
          mocks.sessionStatus = "authenticated";
          mocks.sessionListeners.forEach((listener) => listener());
        });
        await act(async () => {
          await dataRouter.navigate("/dashboards/dash-a?f_app=slides,design");
        });
        await settle();
        act(() => viewButton("sqlDashboard.saveView").click());
        expect(viewNameInput().value).toBe("");
        expect(viewDefaultCheckbox().getAttribute("aria-checked")).toBe(
          "false",
        );
      } finally {
        dataRouter.dispose();
      }
    },
  );

  it.each(["error", "recovered"])(
    "clears an unchanged submitted draft when save succeeds after unmount during %s",
    async (completion) => {
      const dataRouter = await renderRootErrorRouter();
      let completeSave!: () => void;
      mocks.saveView.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            completeSave = resolve;
          }),
      );
      try {
        enterViewDraft("Saved draft");
        act(() => viewButton("explorer.save").click());
        if (completion === "recovered") await failAndRecover(dataRouter);
        else {
          mocks.publicMetadata.mockRejectedValueOnce(
            new Error("public metadata unavailable"),
          );
          await act(async () => {
            await dataRouter.navigate("/dashboards/dash-b?f_app=slides,design");
          });
          expect(dataRouter.state.errors?.root).toBeInstanceOf(Error);
        }
        await act(async () => completeSave());
        if (completion === "error") {
          await act(async () => {
            await dataRouter.navigate("/dashboards/dash-a?f_app=slides,design");
          });
          await settle();
        }
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        act(() => viewButton("sqlDashboard.saveView").click());
        expect(viewNameInput().value).toBe("");
        expect(viewDefaultCheckbox().getAttribute("aria-checked")).toBe(
          "false",
        );
        expect(viewButton("explorer.save").disabled).toBe(true);
        act(() => viewButton("explorer.save").click());
        expect(mocks.saveView).toHaveBeenCalledTimes(1);
      } finally {
        dataRouter.dispose();
      }
    },
  );

  it.each(["default", "name restored"])(
    "retains the newer %s version when an unmounted save succeeds",
    async (edit) => {
      const dataRouter = await renderRootErrorRouter();
      let completeSave!: () => void;
      mocks.saveView.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            completeSave = resolve;
          }),
      );
      try {
        enterViewDraft("Original draft");
        act(() => viewButton("explorer.save").click());
        await failAndRecover(dataRouter);
        act(() => viewButton("sqlDashboard.saveView").click());
        if (edit === "default") act(() => viewDefaultCheckbox().click());
        else {
          typeName(viewNameInput(), "Intermediate draft");
          typeName(viewNameInput(), "Original draft");
        }
        await act(async () => completeSave());
        expect(viewNameInput().value).toBe("Original draft");
        expect(viewDefaultCheckbox().getAttribute("aria-checked")).toBe(
          edit === "default" ? "false" : "true",
        );
        expect(viewButton("explorer.save").disabled).toBe(false);
      } finally {
        dataRouter.dispose();
      }
    },
  );

  it("retains the unchanged draft after an unmounted save fails", async () => {
    const dataRouter = await renderRootErrorRouter();
    let failSave!: (error: Error) => void;
    mocks.saveView.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          failSave = reject;
        }),
    );
    try {
      enterViewDraft("Retry draft");
      act(() => viewButton("explorer.save").click());
      await failAndRecover(dataRouter);
      await act(async () => failSave(new Error("save failed")));
      act(() => viewButton("sqlDashboard.saveView").click());
      expect(viewNameInput().value).toBe("Retry draft");
      expect(viewDefaultCheckbox().getAttribute("aria-checked")).toBe("true");
      expect(viewButton("explorer.save").disabled).toBe(false);
    } finally {
      dataRouter.dispose();
    }
  });

  it.each(["account", "organization", "route"])(
    "does not resurrect or clear another draft after %s discard and late success",
    async (transition) => {
      const dataRouter = await renderRootErrorRouter();
      let completeSave!: () => void;
      mocks.saveView.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            completeSave = resolve;
          }),
      );
      try {
        enterViewDraft("Same name");
        act(() => viewButton("explorer.save").click());
        await failAndRecover(dataRouter);
        if (transition === "route") {
          await act(async () => {
            await dataRouter.navigate("/dashboards/dash-b?f_app=chat,slides");
          });
          await settle();
          await act(async () => {
            await dataRouter.navigate("/dashboards/dash-a?f_app=slides,design");
          });
        } else {
          act(() => {
            mocks.session = {
              email:
                transition === "account"
                  ? "other@example.com"
                  : "viewer@example.com",
              orgId: transition === "organization" ? "org-b" : "org-a",
            };
            mocks.sessionListeners.forEach((listener) => listener());
          });
          act(() => {
            mocks.session = { email: "viewer@example.com", orgId: "org-a" };
            mocks.sessionListeners.forEach((listener) => listener());
          });
        }
        await settle();
        act(() => viewButton("sqlDashboard.saveView").click());
        expect(viewNameInput().value).toBe("");
        typeName(viewNameInput(), "Same name");
        act(() => viewDefaultCheckbox().click());
        await act(async () => completeSave());
        expect(viewNameInput().value).toBe("Same name");
        expect(viewDefaultCheckbox().getAttribute("aria-checked")).toBe("true");
      } finally {
        dataRouter.dispose();
      }
    },
  );

  it("does not let an unmounted save clear a new root-error recovery draft", async () => {
    const dataRouter = await renderRootErrorRouter();
    let completeSave!: () => void;
    mocks.saveView.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          completeSave = resolve;
        }),
    );
    try {
      enterViewDraft("Original draft");
      act(() => viewButton("explorer.save").click());
      await failAndRecover(dataRouter);
      act(() => viewButton("sqlDashboard.saveView").click());
      typeName(viewNameInput(), "Recovered draft");
      await act(async () => completeSave());
      expect(viewNameInput().value).toBe("Recovered draft");
    } finally {
      dataRouter.dispose();
    }
  });

  it("revokes an actual page updater after its bar unmounts even when its route returns", async () => {
    mocks.dashboards["dash-a"].filters = [
      { id: "oldRegion", label: "Region A", type: "text" },
    ];
    mocks.dashboards["dash-b"].filters = [
      { id: "country", label: "Region B", type: "text" },
    ];
    const loader = vi.fn(() => null);
    const dataRouter = createMemoryRouter(
      [{ path: "/dashboards/:id", loader, element: <SqlDashboardPage /> }],
      { initialEntries: ["/dashboards/dash-a?f_oldRegion=first"] },
    );
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <RouterProvider router={dataRouter} />
            </TooltipProvider>
          </QueryClientProvider>,
        ),
      );
      await settle();
      const retained = mocks.retainedFilter!;
      expect(retained.canUpdate()).toBe(true);
      await act(async () => {
        await dataRouter.navigate("/dashboards/dash-b?f_country=west#b");
      });
      await settle();
      expect(retained.unmounts).toBe(1);
      expect(container.textContent).toContain("Region B");
      mocks.replayRetainedFilter = true;
      await act(async () => {
        await dataRouter.navigate(
          "/dashboards/dash-a?f_oldRegion=return#target",
        );
      });
      await settle();
      expect(mocks.replayRetainedFilter).toBe(false);
      expect(dataRouter.state.location.pathname).toBe("/dashboards/dash-a");
      expect(dataRouter.state.location.hash).toBe("#target");
      expect(dataRouter.state.location.search).toBe("?f_oldRegion=return");
      expect(mocks.retainedFilterAttempt).toEqual({
        busy: "true",
        admitted: false,
      });
      expect(retained.canUpdate()).toBe(false);
      expect(loader).toHaveBeenCalledTimes(3);
      expect(container.textContent).toContain("Region A");
    } finally {
      dataRouter.dispose();
    }
  });

  it("discards a preset draft and old selection when the loaded dashboard remounts the bar", async () => {
    const filter = {
      id: "app",
      label: "App",
      type: "multi-select",
      options: [
        { value: "chat", label: "Chat" },
        { value: "slides", label: "Slides" },
        { value: "design", label: "Design" },
      ],
    };
    mocks.dashboards["dash-a"].filters = [filter];
    mocks.dashboards["dash-b"].filters = [{ ...filter, label: "App B" }];
    await renderAt("/dashboards/dash-a?f_app=chat,slides");
    const editMode = () =>
      [...container.querySelectorAll<HTMLElement>('[role="radio"]')].find(
        (element) => element.textContent === "dashboardMode.edit",
      )!;
    const trigger = () =>
      container.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
    await act(async () => editMode().click());
    act(() => trigger().click());
    act(() => viewButton("sqlDashboard.saveAsGroup").click());
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="sqlDashboard.groupName"]',
    )!;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "A preset draft");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const mounts = mocks.filterBarMounts;
    await goTo("/dashboards/dash-b?f_app=slides,design");
    expect(mocks.filterBarMounts).toBe(mounts + 1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => editMode().click());
    expect(trigger().textContent).toBe("Slides, Design");
    act(() => trigger().click());
    act(() => viewButton("sqlDashboard.saveAsGroup").click());
    expect(
      document.querySelector<HTMLInputElement>(
        'input[aria-label="sqlDashboard.groupName"]',
      )!.value,
    ).toBe("");
  });

  it("retains the save-view draft through same-dashboard URL and filter-config replacement", async () => {
    mocks.dashboards["dash-a"].filters = [
      { id: "region", label: "Region A", type: "text" },
    ];
    await renderAt("/dashboards/dash-a?f_region=east");
    enterViewDraft("A draft");
    const input = viewNameInput();
    const mounts = mocks.filterBarMounts;
    await goTo("/dashboards/dash-a?f_region=west");
    mocks.dashboards["dash-a"] = {
      ...mocks.dashboards["dash-a"],
      filters: [{ id: "region", label: "Updated region", type: "text" }],
      updatedAt: "2026-10-02T12:00:00.000Z",
    };
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ["data", "sql-dashboard", "dash-a"],
      });
    });
    await settle();
    expect(container.textContent).toContain("Updated region");
    expect(mocks.filterBarMounts).toBe(mounts);
    expect(viewNameInput()).toBe(input);
    expect(input.value).toBe("A draft");
    expect(viewDefaultCheckbox().getAttribute("aria-checked")).toBe("true");
    await act(async () => viewButton("explorer.save").click());
    expect(mocks.saveView.mock.calls).toEqual([
      [
        "dash-a",
        {
          id: "a-draft",
          name: "A draft",
          filters: { f_region: "west" },
          isDefault: true,
        },
      ],
    ]);
  });

  it("applies each keyboard resize step while earlier saves are pending", async () => {
    const savedHeights: number[] = [];
    mocks.saveDashboard = async (args) => {
      const config = args.config as { panels: SqlPanel[] };
      savedHeights.push(config.panels[0].height ?? 0);
      return {};
    };
    await renderAt("/dashboards/dash-a");
    const editMode = [...container.querySelectorAll('[role="radio"]')].find(
      (element) => element.textContent === "dashboardMode.edit",
    );
    expect(editMode).toBeDefined();
    await act(async () => {
      (editMode as HTMLElement).click();
    });
    await settle();

    const heightSlider = container.querySelector(
      '[role="slider"][aria-label="sqlDashboard.resizePanelHeight"]',
    );
    expect(heightSlider).not.toBeNull();
    await act(async () => {
      heightSlider?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      heightSlider?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await settle();

    expect(savedHeights).toEqual([2, 3]);
    expect(heightSlider?.getAttribute("aria-valuenow")).toBe("3");
  });

  it("persists a panel height after pointer-drag resizing", async () => {
    const savedConfigs: { panels: SqlPanel[] }[] = [];
    mocks.dashboards["dash-a"] = dashboardRecord("Dashboard A", [
      { ...tablePanel("Accounts A", 200), height: 2 },
    ]);
    mocks.saveDashboard = async (args) => {
      savedConfigs.push(args.config as { panels: SqlPanel[] });
      return {};
    };
    await renderAt("/dashboards/dash-a");
    const editMode = [...container.querySelectorAll('[role="radio"]')].find(
      (element) => element.textContent === "dashboardMode.edit",
    );
    expect(editMode).toBeDefined();
    await act(async () => {
      (editMode as HTMLElement).click();
    });
    await settle();

    const heightSlider = container.querySelector<HTMLButtonElement>(
      '[role="slider"][aria-label="sqlDashboard.resizePanelHeight"]',
    );
    expect(heightSlider).not.toBeNull();
    Object.defineProperty(heightSlider, "setPointerCapture", {
      value: vi.fn(),
    });
    await act(async () => {
      heightSlider?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: 1,
          clientY: 100,
        }),
      );
      heightSlider?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: 1,
          clientY: 280,
        }),
      );
      heightSlider?.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: 1,
          clientY: 280,
        }),
      );
    });
    await settle();

    expect(savedConfigs).toHaveLength(1);
    expect(savedConfigs[0].panels[0].height).toBe(3);
    expect(heightSlider?.getAttribute("aria-valuenow")).toBe("3");
  });

  it("does not re-add a panel deleted while its editor is open", async () => {
    const original = dashboardRecord("Dashboard A", [
      tablePanel("Accounts A", 200, "table-a"),
    ]);
    let collabContent = JSON.stringify(original);
    let signalCollabChange: (() => void) | undefined;
    const ytext = {
      toJSON: () => collabContent,
      observe: (handler: () => void) => {
        signalCollabChange = handler;
      },
      unobserve: (handler: () => void) => {
        if (signalCollabChange === handler) signalCollabChange = undefined;
      },
    };
    const savedPanels: SqlPanel[][] = [];
    mocks.dashboards["dash-a"] = original;
    mocks.collab = {
      ydoc: { clientID: 1, getText: () => ytext },
      awareness: null,
      isSynced: true,
      activeUsers: [],
      agentActive: false,
      agentPresent: false,
    };
    mocks.saveDashboard = async (args) => {
      const config = args.config as { panels: SqlPanel[] };
      savedPanels.push(config.panels.map((panel) => ({ ...panel })));
      return {};
    };

    await renderAt("/dashboards/dash-a");
    await click("edit-table-a");
    expect(byTestId("panel-editor")).not.toBeNull();
    expect(signalCollabChange).toBeDefined();

    collabContent = JSON.stringify(dashboardRecord("Dashboard A", []));
    await act(async () => signalCollabChange?.());
    await settle();
    expect(byTestId("edit-table-a")).toBeNull();
    expect(byTestId("panel-editor")).not.toBeNull();

    await click("panel-editor-save");
    expect(savedPanels).toEqual([]);
  });

  it("keeps separate panel resizes in later queued dashboard saves", async () => {
    const savedPanels: SqlPanel[][] = [];
    let releaseFirstSave: (() => void) | undefined;
    let signalFirstSaveStarted!: () => void;
    const firstSaveStarted = new Promise<void>((resolve) => {
      signalFirstSaveStarted = resolve;
    });
    mocks.dashboards["dash-a"] = dashboardRecord("Dashboard A", [
      tablePanel("Accounts A", 200, "table-a"),
      tablePanel("Accounts B", 200, "table-b"),
    ]);
    mocks.saveDashboard = async (args) => {
      const config = args.config as { panels: SqlPanel[] };
      savedPanels.push(config.panels.map((panel) => ({ ...panel })));
      if (savedPanels.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstSave = resolve;
          signalFirstSaveStarted();
        });
      }
      return {};
    };
    await renderAt("/dashboards/dash-a");
    const editMode = [...container.querySelectorAll('[role="radio"]')].find(
      (element) => element.textContent === "dashboardMode.edit",
    );
    expect(editMode).toBeDefined();
    await act(async () => {
      (editMode as HTMLElement).click();
    });
    await settle();

    const heightSliders = () =>
      container.querySelectorAll(
        '[role="slider"][aria-label="sqlDashboard.resizePanelHeight"]',
      );
    await act(async () => {
      heightSliders()[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await firstSaveStarted;
    await act(async () => {
      heightSliders()[1].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(savedPanels).toHaveLength(1);

    await act(async () => {
      releaseFirstSave?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(savedPanels).toHaveLength(2);
    expect(savedPanels[1].map((panel) => panel.height)).toEqual([2, 2]);
  });

  it("does not adopt a confirmed collaboration echo over later queued edits", async () => {
    let releaseFirstSave: (() => void) | undefined;
    let releaseSecondSave: (() => void) | undefined;
    let signalCollabChange: (() => void) | undefined;
    let collabContent = "";
    const savedConfigs: { panels: SqlPanel[] }[] = [];
    const errorToast = vi.spyOn(toast, "error").mockReturnValue("error-toast");
    const ytext = {
      toJSON: () => collabContent,
      observe: (handler: () => void) => {
        signalCollabChange = handler;
      },
      unobserve: (handler: () => void) => {
        if (signalCollabChange === handler) signalCollabChange = undefined;
      },
    };
    mocks.collab = {
      ydoc: { clientID: 1, getText: () => ytext },
      awareness: null,
      isSynced: true,
      activeUsers: [],
      agentActive: false,
      agentPresent: false,
    };
    mocks.dashboards["dash-a"] = dashboardRecord("Dashboard A", [
      { ...tablePanel("Accounts A", 200, "table-a"), height: 2 },
      { ...tablePanel("Accounts B", 200, "table-b"), height: 2 },
    ]);
    mocks.saveDashboard = async (args) => {
      savedConfigs.push(
        JSON.parse(JSON.stringify(args.config)) as { panels: SqlPanel[] },
      );
      if (savedConfigs.length === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstSave = resolve;
        });
        return { updatedAt: "2026-10-01T12:01:00.000Z" };
      }
      if (savedConfigs.length === 2) {
        await new Promise<void>((resolve) => {
          releaseSecondSave = resolve;
        });
        return { updatedAt: "2026-10-01T12:02:00.000Z" };
      }
      return { updatedAt: "2026-10-01T12:03:00.000Z" };
    };

    await renderAt("/dashboards/dash-a");
    const editMode = [...container.querySelectorAll('[role="radio"]')].find(
      (element) => element.textContent === "dashboardMode.edit",
    );
    expect(editMode).toBeDefined();
    await act(async () => {
      (editMode as HTMLElement).click();
    });
    await settle();

    const heightSliders = () =>
      container.querySelectorAll(
        '[role="slider"][aria-label="sqlDashboard.resizePanelHeight"]',
      );
    await act(async () => {
      heightSliders()[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await vi.waitFor(() => expect(savedConfigs).toHaveLength(1));
    await act(async () => {
      heightSliders()[1].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await act(async () => {
      releaseFirstSave?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(() => expect(savedConfigs).toHaveLength(2));

    collabContent = JSON.stringify(savedConfigs[0]);
    await act(async () => {
      signalCollabChange?.();
    });
    await act(async () => {
      heightSliders()[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await settle();
    expect(savedConfigs).toHaveLength(2);

    await act(async () => {
      releaseSecondSave?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(() => expect(savedConfigs).toHaveLength(3));
    expect(savedConfigs[2].panels.map((panel) => panel.height)).toEqual([4, 3]);
    expect(errorToast).not.toHaveBeenCalled();
    await settle();
  });

  it("reports a failed dashboard save while a later queued save succeeds", async () => {
    const savedPanels: SqlPanel[][] = [];
    let rejectFirstSave: ((error: Error) => void) | undefined;
    let signalFirstSaveStarted!: () => void;
    const firstSaveStarted = new Promise<void>((resolve) => {
      signalFirstSaveStarted = resolve;
    });
    const errorToast = vi.spyOn(toast, "error").mockReturnValue("error-toast");
    mocks.saveDashboard = async (args) => {
      const config = args.config as { panels: SqlPanel[] };
      savedPanels.push(config.panels.map((panel) => ({ ...panel })));
      if (savedPanels.length === 1) {
        await new Promise<never>((_resolve, reject) => {
          rejectFirstSave = reject;
          signalFirstSaveStarted();
        });
      }
      return { updatedAt: `2026-10-01T12:0${savedPanels.length}:00.000Z` };
    };
    await renderAt("/dashboards/dash-a");

    const editMode = [...container.querySelectorAll('[role="radio"]')].find(
      (element) => element.textContent === "dashboardMode.edit",
    );
    expect(editMode).toBeDefined();
    await act(async () => {
      (editMode as HTMLElement).click();
    });
    await settle();

    await click("save-columns-first-shared-table");
    await firstSaveStarted;
    await click("save-columns-second-shared-table");
    await act(async () => {
      rejectFirstSave?.(new Error("offline"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(savedPanels).toHaveLength(2);
    expect(savedPanels[1][0].config?.columns).toEqual([
      { key: "second", width: 240 },
    ]);
    expect(errorToast).toHaveBeenCalledWith(
      "sqlDashboard.saveFailedWithMessage",
    );
  });

  it("does not persist a failed resize through a later queued resize", async () => {
    const savedPanels: SqlPanel[][] = [];
    let rejectFirstSave: ((error: Error) => void) | undefined;
    let signalFirstSaveStarted!: () => void;
    const firstSaveStarted = new Promise<void>((resolve) => {
      signalFirstSaveStarted = resolve;
    });
    mocks.dashboards["dash-a"] = dashboardRecord("Dashboard A", [
      { ...tablePanel("Accounts A", 200, "table-a"), height: 2 },
      { ...tablePanel("Accounts B", 200, "table-b"), height: 2 },
    ]);
    mocks.saveDashboard = async (args) => {
      const config = args.config as { panels: SqlPanel[] };
      savedPanels.push(config.panels.map((panel) => ({ ...panel })));
      if (savedPanels.length === 1) {
        await new Promise<never>((_resolve, reject) => {
          rejectFirstSave = reject;
          signalFirstSaveStarted();
        });
      }
      return { updatedAt: "2026-10-01T12:01:00.000Z" };
    };
    await renderAt("/dashboards/dash-a");
    const editMode = [...container.querySelectorAll('[role="radio"]')].find(
      (element) => element.textContent === "dashboardMode.edit",
    );
    expect(editMode).toBeDefined();
    await act(async () => {
      (editMode as HTMLElement).click();
    });
    await settle();

    const heightSliders = container.querySelectorAll(
      '[role="slider"][aria-label="sqlDashboard.resizePanelHeight"]',
    );
    await act(async () => {
      heightSliders[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await firstSaveStarted;
    await act(async () => {
      heightSliders[1].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(savedPanels).toHaveLength(1);

    await act(async () => {
      rejectFirstSave?.(new Error("offline"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(savedPanels).toHaveLength(2);
    expect(savedPanels[0].map((panel) => panel.height)).toEqual([3, 2]);
    expect(savedPanels[1].map((panel) => panel.height)).toEqual([2, 3]);
    const savedHeightSliders = container.querySelectorAll(
      '[role="slider"][aria-label="sqlDashboard.resizePanelHeight"]',
    );
    expect(savedHeightSliders[0].getAttribute("aria-valuenow")).toBe("2");
    expect(savedHeightSliders[1].getAttribute("aria-valuenow")).toBe("3");
  });

  it("does not carry a failed width resize into a queued height resize", async () => {
    const savedPanels: SqlPanel[][] = [];
    let rejectFirstSave: ((error: Error) => void) | undefined;
    let signalFirstSaveStarted!: () => void;
    const firstSaveStarted = new Promise<void>((resolve) => {
      signalFirstSaveStarted = resolve;
    });
    mocks.dashboards["dash-a"] = dashboardRecord("Dashboard A", [
      { ...tablePanel("Accounts A", 200), height: 2 },
    ]);
    mocks.saveDashboard = async (args) => {
      const config = args.config as { panels: SqlPanel[] };
      savedPanels.push(config.panels.map((panel) => ({ ...panel })));
      if (savedPanels.length === 1) {
        await new Promise<never>((_resolve, reject) => {
          rejectFirstSave = reject;
          signalFirstSaveStarted();
        });
      }
      return { updatedAt: "2026-10-01T12:01:00.000Z" };
    };
    await renderAt("/dashboards/dash-a");
    const editMode = [...container.querySelectorAll('[role="radio"]')].find(
      (element) => element.textContent === "dashboardMode.edit",
    );
    expect(editMode).toBeDefined();
    await act(async () => {
      (editMode as HTMLElement).click();
    });
    await settle();

    const widthSlider = container.querySelector(
      '[role="slider"][aria-label="sqlDashboard.resizePanelWidth"]',
    );
    const heightSlider = container.querySelector(
      '[role="slider"][aria-label="sqlDashboard.resizePanelHeight"]',
    );
    expect(widthSlider).not.toBeNull();
    expect(heightSlider).not.toBeNull();
    await act(async () => {
      widthSlider?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    await firstSaveStarted;
    await act(async () => {
      heightSlider?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    expect(savedPanels).toHaveLength(1);

    await act(async () => {
      rejectFirstSave?.(new Error("offline"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(savedPanels).toHaveLength(2);
    expect(savedPanels[0][0]).toMatchObject({ width: 2, height: 2 });
    expect(savedPanels[1][0]).toMatchObject({ width: 1, height: 3 });
    expect(widthSlider?.getAttribute("aria-valuenow")).toBe("1");
    expect(heightSlider?.getAttribute("aria-valuenow")).toBe("3");
  });

  it("rolls back a failed axis while another resize save is still pending", async () => {
    const savedPanels: SqlPanel[][] = [];
    let rejectFirstSave: ((error: Error) => void) | undefined;
    let resolveSecondSave: ((result: unknown) => void) | undefined;
    let signalFirstSaveStarted!: () => void;
    let signalSecondSaveStarted!: () => void;
    const firstSaveStarted = new Promise<void>((resolve) => {
      signalFirstSaveStarted = resolve;
    });
    const secondSaveStarted = new Promise<void>((resolve) => {
      signalSecondSaveStarted = resolve;
    });
    const errorToast = vi.spyOn(toast, "error").mockReturnValue("error-toast");
    mocks.dashboards["dash-a"] = dashboardRecord("Dashboard A", [
      { ...tablePanel("Accounts A", 200), height: 2 },
    ]);
    mocks.saveDashboard = async (args) => {
      const config = args.config as { panels: SqlPanel[] };
      savedPanels.push(config.panels.map((panel) => ({ ...panel })));
      if (savedPanels.length === 1) {
        await new Promise<never>((_resolve, reject) => {
          rejectFirstSave = reject;
          signalFirstSaveStarted();
        });
      }
      if (savedPanels.length === 2) {
        await new Promise<unknown>((resolve) => {
          resolveSecondSave = resolve;
          signalSecondSaveStarted();
        });
      }
      return { updatedAt: `2026-10-01T12:0${savedPanels.length}:00.000Z` };
    };
    await renderAt("/dashboards/dash-a");
    const editMode = [...container.querySelectorAll('[role="radio"]')].find(
      (element) => element.textContent === "dashboardMode.edit",
    );
    expect(editMode).toBeDefined();
    await act(async () => {
      (editMode as HTMLElement).click();
    });
    await settle();

    const widthSlider = () =>
      container.querySelector(
        '[role="slider"][aria-label="sqlDashboard.resizePanelWidth"]',
      );
    const heightSlider = () =>
      container.querySelector(
        '[role="slider"][aria-label="sqlDashboard.resizePanelHeight"]',
      );
    await act(async () => {
      widthSlider()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    await firstSaveStarted;
    await act(async () => {
      heightSlider()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });

    await act(async () => {
      rejectFirstSave?.(new Error("offline"));
      await secondSaveStarted;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(errorToast).toHaveBeenCalledWith(
      "sqlDashboard.saveFailedWithMessage",
    );
    expect(widthSlider()?.getAttribute("aria-valuenow")).toBe("1");
    expect(heightSlider()?.getAttribute("aria-valuenow")).toBe("3");
    await act(async () => {
      widthSlider()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(savedPanels).toHaveLength(2);

    await act(async () => {
      resolveSecondSave?.({ updatedAt: "2026-10-01T12:02:00.000Z" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(() => expect(savedPanels).toHaveLength(3));
    await settle();

    expect(savedPanels[0][0]).toMatchObject({ width: 2, height: 2 });
    expect(savedPanels[1][0]).toMatchObject({ width: 1, height: 3 });
    expect(savedPanels[2][0]).toMatchObject({ width: 2, height: 3 });
    expect(widthSlider()?.getAttribute("aria-valuenow")).toBe("2");
    expect(heightSlider()?.getAttribute("aria-valuenow")).toBe("3");
  });

  it("keeps a failed resize rolled back while an editor save is pending", async () => {
    const savedPanels: SqlPanel[][] = [];
    let rejectFirstSave: ((error: Error) => void) | undefined;
    let resolveSecondSave: ((result: unknown) => void) | undefined;
    let signalFirstSaveStarted!: () => void;
    let signalSecondSaveStarted!: () => void;
    const firstSaveStarted = new Promise<void>((resolve) => {
      signalFirstSaveStarted = resolve;
    });
    const secondSaveStarted = new Promise<void>((resolve) => {
      signalSecondSaveStarted = resolve;
    });
    mocks.dashboards["dash-a"] = dashboardRecord("Dashboard A", [
      { ...tablePanel("Accounts A", 200), height: 2 },
    ]);
    mocks.saveDashboard = async (args) => {
      const config = args.config as { panels: SqlPanel[] };
      savedPanels.push(config.panels.map((panel) => ({ ...panel })));
      if (savedPanels.length === 1) {
        await new Promise<never>((_resolve, reject) => {
          rejectFirstSave = reject;
          signalFirstSaveStarted();
        });
      }
      if (savedPanels.length === 2) {
        await new Promise<unknown>((resolve) => {
          resolveSecondSave = resolve;
          signalSecondSaveStarted();
        });
      }
      return { updatedAt: `2026-10-01T12:0${savedPanels.length}:00.000Z` };
    };
    await renderAt("/dashboards/dash-a");
    const editMode = [...container.querySelectorAll('[role="radio"]')].find(
      (element) => element.textContent === "dashboardMode.edit",
    );
    expect(editMode).toBeDefined();
    await act(async () => {
      (editMode as HTMLElement).click();
    });
    await settle();

    const widthSlider = () =>
      container.querySelector(
        '[role="slider"][aria-label="sqlDashboard.resizePanelWidth"]',
      );
    await act(async () => {
      widthSlider()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    await firstSaveStarted;
    await click("edit-shared-table");
    await click("panel-editor-save");

    await act(async () => {
      rejectFirstSave?.(new Error("offline"));
      await secondSaveStarted;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(widthSlider()?.getAttribute("aria-valuenow")).toBe("1");
    await act(async () => {
      widthSlider()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(savedPanels).toHaveLength(2);

    await act(async () => {
      resolveSecondSave?.({ updatedAt: "2026-10-01T12:02:00.000Z" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(() => expect(savedPanels).toHaveLength(3));
    await settle();

    expect(savedPanels[0][0]).toMatchObject({ width: 2, height: 2 });
    expect(savedPanels[1][0]).toMatchObject({
      title: "Accounts A edited",
      width: 1,
      height: 2,
    });
    expect(savedPanels[2][0]).toMatchObject({
      title: "Accounts A edited",
      width: 2,
      height: 2,
    });
    expect(widthSlider()?.getAttribute("aria-valuenow")).toBe("2");
  });

  it("applies an inline SQL save to the confirmed panel after a failed resize", async () => {
    const savedPanels: SqlPanel[][] = [];
    let rejectFirstSave: ((error: Error) => void) | undefined;
    let signalFirstSaveStarted!: () => void;
    const firstSaveStarted = new Promise<void>((resolve) => {
      signalFirstSaveStarted = resolve;
    });
    mocks.dashboards["dash-a"] = dashboardRecord("Dashboard A", [
      { ...tablePanel("Accounts A", 200), height: 2 },
    ]);
    mocks.saveDashboard = async (args) => {
      const config = args.config as { panels: SqlPanel[] };
      savedPanels.push(config.panels.map((panel) => ({ ...panel })));
      if (savedPanels.length === 1) {
        await new Promise<never>((_resolve, reject) => {
          rejectFirstSave = reject;
          signalFirstSaveStarted();
        });
      }
      return { updatedAt: `2026-10-01T12:0${savedPanels.length}:00.000Z` };
    };
    await renderAt("/dashboards/dash-a");

    const editMode = [...container.querySelectorAll('[role="radio"]')].find(
      (element) => element.textContent === "dashboardMode.edit",
    );
    expect(editMode).toBeDefined();
    await act(async () => {
      (editMode as HTMLElement).click();
    });
    await settle();

    const widthSlider = container.querySelector(
      '[role="slider"][aria-label="sqlDashboard.resizePanelWidth"]',
    );
    expect(widthSlider).not.toBeNull();
    await act(async () => {
      widthSlider?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    await firstSaveStarted;
    await click("save-sql-shared-table");
    await act(async () => {
      rejectFirstSave?.(new Error("offline"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(savedPanels).toHaveLength(2);
    expect(savedPanels[1][0]).toMatchObject({
      width: 1,
      height: 2,
      sql: "SELECT 1",
    });
  });

  it("does not render a height resize handle or preview for section panels", async () => {
    mocks.dashboards["dash-a"] = dashboardRecord("Dashboard A", [
      {
        id: "section-a",
        title: "Overview",
        sql: "",
        source: "first-party",
        chartType: "section",
        width: 1,
      },
    ]);
    await renderAt("/dashboards/dash-a");

    const editMode = [...container.querySelectorAll('[role="radio"]')].find(
      (element) => element.textContent === "dashboardMode.edit",
    );
    expect(editMode).toBeDefined();
    await act(async () => {
      (editMode as HTMLElement).click();
    });
    await settle();

    expect(
      container.querySelector(
        '[role="slider"][aria-label="sqlDashboard.resizePanelHeight"]',
      ),
    ).toBeNull();
    const sectionCell = container.querySelector<HTMLElement>(
      ".dashboard-section-cell",
    );
    expect(sectionCell).not.toBeNull();
    expect(sectionCell?.hasAttribute("data-panel-height")).toBe(false);
    expect(sectionCell?.style.height).toBe("");
  });

  it("resets a fixed panel height to content-based sizing", async () => {
    const savedConfigs: { panels: SqlPanel[] }[] = [];
    mocks.dashboards["dash-a"] = dashboardRecord("Dashboard A", [
      { ...tablePanel("Accounts A", 200), height: 3 },
    ]);
    mocks.saveDashboard = async (args) => {
      savedConfigs.push(args.config as { panels: SqlPanel[] });
      return {};
    };
    await renderAt("/dashboards/dash-a");

    const editMode = [...container.querySelectorAll('[role="radio"]')].find(
      (element) => element.textContent === "dashboardMode.edit",
    );
    expect(editMode).toBeDefined();
    await act(async () => {
      (editMode as HTMLElement).click();
    });
    await settle();

    const resetButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="sqlDashboard.resetPanelHeight"]',
    );
    expect(resetButton).not.toBeNull();
    await act(async () => {
      resetButton?.click();
    });
    await settle();

    expect(savedConfigs).toHaveLength(1);
    expect(savedConfigs[0].panels[0]).not.toHaveProperty("height");
    expect(
      container.querySelector(
        'button[aria-label="sqlDashboard.resetPanelHeight"]',
      ),
    ).toBeNull();
  });

  it("keeps a resize made while the panel editor is open", async () => {
    const savedConfigs: { panels: SqlPanel[] }[] = [];
    mocks.dashboards["dash-a"] = dashboardRecord("Dashboard A", [
      { ...tablePanel("Accounts A", 200), height: 2 },
    ]);
    mocks.saveDashboard = async (args) => {
      savedConfigs.push(args.config as { panels: SqlPanel[] });
      return {
        updatedAt: `2026-10-01T12:0${savedConfigs.length}:00.000Z`,
      };
    };
    await renderAt("/dashboards/dash-a");
    const editMode = [...container.querySelectorAll('[role="radio"]')].find(
      (element) => element.textContent === "dashboardMode.edit",
    );
    expect(editMode).toBeDefined();
    await act(async () => {
      (editMode as HTMLElement).click();
    });
    await settle();
    await click("edit-shared-table");

    const widthSlider = container.querySelector(
      '[role="slider"][aria-label="sqlDashboard.resizePanelWidth"]',
    );
    expect(widthSlider).not.toBeNull();
    await act(async () => {
      widthSlider?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    await settle();
    expect(savedConfigs[0].panels[0].width).toBe(2);

    const heightSlider = container.querySelector(
      '[role="slider"][aria-label="sqlDashboard.resizePanelHeight"]',
    );
    expect(heightSlider).not.toBeNull();
    await act(async () => {
      heightSlider?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await settle();
    expect(savedConfigs[1].panels[0]).toMatchObject({ width: 2, height: 3 });

    await click("panel-editor-save");

    expect(savedConfigs).toHaveLength(3);
    expect(savedConfigs[2].panels[0]).toMatchObject({
      title: "Accounts A edited",
      width: 2,
      height: 3,
    });
  });

  it("rolls a failed resize back before refetch and bases later edits on saved dimensions", async () => {
    const savedPanels: SqlPanel[][] = [];
    let rejectFirstSave: ((error: Error) => void) | undefined;
    let signalFirstSaveStarted!: () => void;
    let releaseRefetch!: () => void;
    const firstSaveStarted = new Promise<void>((resolve) => {
      signalFirstSaveStarted = resolve;
    });
    const refetchHeld = new Promise<void>((resolve) => {
      releaseRefetch = resolve;
    });
    mocks.dashboards["dash-a"] = dashboardRecord("Dashboard A", [
      { ...tablePanel("Accounts A", 200), height: 2 },
    ]);
    mocks.saveDashboard = async (args) => {
      const config = args.config as { panels: SqlPanel[] };
      savedPanels.push(config.panels.map((panel) => ({ ...panel })));
      if (savedPanels.length === 1) {
        await new Promise<never>((_resolve, reject) => {
          rejectFirstSave = reject;
          signalFirstSaveStarted();
        });
      }
      return { updatedAt: "2026-10-01T12:01:00.000Z" };
    };
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(async () => {
      await refetchHeld;
    });
    await renderAt("/dashboards/dash-a");
    const editMode = [...container.querySelectorAll('[role="radio"]')].find(
      (element) => element.textContent === "dashboardMode.edit",
    );
    expect(editMode).toBeDefined();
    await act(async () => {
      (editMode as HTMLElement).click();
    });
    await settle();

    const widthSlider = container.querySelector(
      '[role="slider"][aria-label="sqlDashboard.resizePanelWidth"]',
    );
    const heightSlider = container.querySelector(
      '[role="slider"][aria-label="sqlDashboard.resizePanelHeight"]',
    );
    expect(widthSlider).not.toBeNull();
    expect(heightSlider).not.toBeNull();
    await act(async () => {
      widthSlider?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    await firstSaveStarted;

    await act(async () => {
      rejectFirstSave?.(new Error("offline"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(widthSlider?.getAttribute("aria-valuenow")).toBe("1");
    await act(async () => {
      heightSlider?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await settle();

    expect(savedPanels).toHaveLength(2);
    expect(savedPanels[0][0]).toMatchObject({ width: 2, height: 2 });
    expect(savedPanels[1][0]).toMatchObject({ width: 1, height: 3 });
    expect(widthSlider?.getAttribute("aria-valuenow")).toBe("1");
    expect(heightSlider?.getAttribute("aria-valuenow")).toBe("3");

    releaseRefetch();
    await settle();
  });

  it("resyncs panel dimensions from collaboration after a resize save settles", async () => {
    let releaseFirstSave: (() => void) | undefined;
    let signalFirstSaveStarted!: () => void;
    let signalCollabChange: (() => void) | undefined;
    let saveCount = 0;
    let collabContent = JSON.stringify({
      name: "Dashboard A",
      panels: [tablePanel("Accounts A", 200)],
    });
    const firstSaveStarted = new Promise<void>((resolve) => {
      signalFirstSaveStarted = resolve;
    });
    const savedHeights: number[] = [];
    const ytext = {
      toJSON: () => collabContent,
      observe: (handler: () => void) => {
        signalCollabChange = handler;
      },
      unobserve: (handler: () => void) => {
        if (signalCollabChange === handler) signalCollabChange = undefined;
      },
    };
    mocks.collab = {
      ydoc: { clientID: 1, getText: () => ytext },
      awareness: null,
      isSynced: true,
      activeUsers: [],
      agentActive: false,
      agentPresent: false,
    };
    mocks.saveDashboard = async (args) => {
      const config = args.config as { panels: SqlPanel[] };
      savedHeights.push(config.panels[0].height ?? 0);
      saveCount += 1;
      if (saveCount === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstSave = resolve;
          signalFirstSaveStarted();
        });
      }
      return {};
    };
    await renderAt("/dashboards/dash-a");
    const editMode = [...container.querySelectorAll('[role="radio"]')].find(
      (element) => element.textContent === "dashboardMode.edit",
    );
    expect(editMode).toBeDefined();
    await act(async () => {
      (editMode as HTMLElement).click();
    });
    await settle();

    const heightSlider = container.querySelector(
      '[role="slider"][aria-label="sqlDashboard.resizePanelHeight"]',
    );
    expect(heightSlider).not.toBeNull();
    await act(async () => {
      heightSlider?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await firstSaveStarted;

    const externallyUpdatedPanel = {
      ...tablePanel("Accounts A", 200),
      height: 5,
    };
    collabContent = JSON.stringify({
      name: "Dashboard A",
      panels: [externallyUpdatedPanel],
    });
    mocks.dashboards["dash-a"] = {
      ...mocks.dashboards["dash-a"],
      panels: [externallyUpdatedPanel],
      updatedAt: "2026-10-01T12:01:00.000Z",
    };
    await act(async () => {
      signalCollabChange?.();
    });

    await act(async () => {
      releaseFirstSave?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(heightSlider?.getAttribute("aria-valuenow")).toBe("5");
    await act(async () => {
      heightSlider?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    await settle();
    expect(savedHeights).toEqual([2, 6]);
  });

  it("announces the measured height for an auto-height panel", async () => {
    await renderAt("/dashboards/dash-a");
    const cell = container.querySelector(
      ".dashboard-grid-cell",
    ) as HTMLElement | null;
    expect(cell).not.toBeNull();
    vi.spyOn(cell as HTMLElement, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 640,
      height: 540,
      top: 0,
      right: 640,
      bottom: 540,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const editMode = [...container.querySelectorAll('[role="radio"]')].find(
      (element) => element.textContent === "dashboardMode.edit",
    );
    expect(editMode).toBeDefined();
    await act(async () => {
      (editMode as HTMLElement).click();
    });
    await settle();

    expect(
      container
        .querySelector(
          '[role="slider"][aria-label="sqlDashboard.resizePanelHeight"]',
        )
        ?.getAttribute("aria-valuenow"),
    ).toBe("3");
  });

  it("reports a failed resize save and keeps the last saved dimensions", async () => {
    mocks.saveDashboard = async () => {
      throw new Error("offline");
    };
    const errorToast = vi.spyOn(toast, "error").mockReturnValue("error-toast");
    await renderAt("/dashboards/dash-a");
    const editMode = [...container.querySelectorAll('[role="radio"]')].find(
      (element) => element.textContent === "dashboardMode.edit",
    );
    expect(editMode).toBeDefined();
    await act(async () => {
      (editMode as HTMLElement).click();
    });
    await settle();

    const widthSlider = container.querySelector(
      '[role="slider"][aria-label="sqlDashboard.resizePanelWidth"]',
    );
    expect(widthSlider).not.toBeNull();
    await act(async () => {
      widthSlider?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    await settle();

    expect(errorToast).toHaveBeenCalledWith(
      "sqlDashboard.saveFailedWithMessage",
    );
    expect(widthSlider?.getAttribute("aria-valuenow")).toBe("1");
  });

  it("never shows or saves a panel editor opened on one dashboard on the next", async () => {
    const savedTo: unknown[] = [];
    mocks.saveDashboard = async (args) => {
      savedTo.push(args.dashboardId);
      return {};
    };
    await renderAt("/dashboards/dash-a");
    await click("edit-shared-table");
    expect(byTestId("panel-editor")).not.toBeNull();

    mocks.submitEditorOn = "dash-b";
    await goTo("/dashboards/dash-b");

    expect(savedTo).not.toContain("dash-b");
    expect(mocks.editorRenders).not.toContainEqual({
      open: true,
      dashboardId: "dash-b",
    });
    expect(container.textContent).toContain("Accounts B");
  });

  it("never shows or saves a panel editor opened under another account on the same dashboard", async () => {
    const savedTo: unknown[] = [];
    mocks.saveDashboard = async (args) => {
      savedTo.push(args.dashboardId);
      return {};
    };
    await renderAt("/dashboards/dash-a");
    await click("edit-shared-table");
    expect(byTestId("panel-editor")).not.toBeNull();

    mocks.editorRenders = [];
    mocks.submitEditorOn = "dash-a";
    mocks.session = { email: "other@example.com" };
    await renderAt("/dashboards/dash-a");

    expect(savedTo).toEqual([]);
    expect(mocks.editorRenders).not.toContainEqual({
      open: true,
      dashboardId: "dash-a",
    });
    expect(byTestId("panel-editor")).toBeNull();
  });

  it("never offers editing under a new account until its access loads", async () => {
    await renderAt("/dashboards/dash-a");
    const editMode = [...container.querySelectorAll('[role="radio"]')].find(
      (element) => element.textContent === "dashboardMode.edit",
    );
    expect(editMode).toBeDefined();
    await act(async () => {
      (editMode as HTMLElement).click();
    });
    await settle();
    expect(mocks.editableRenders[mocks.editableRenders.length - 1]).toBe(true);

    mocks.editableRenders = [];
    mocks.session = { email: "other@example.com" };
    await renderAt("/dashboards/dash-a");

    expect(mocks.editableRenders.length).toBeGreaterThan(0);
    expect(mocks.editableRenders).not.toContain(true);
  });

  it("closes report settings opened on one dashboard when the route moves to another", async () => {
    await renderAt("/dashboards/dash-a?reportSettings=1");
    expect(byTestId("email-report")?.getAttribute("data-dashboard-id")).toBe(
      "dash-a",
    );

    await goTo("/dashboards/dash-b");

    expect(container.textContent).toContain("Accounts B");
    expect(byTestId("email-report")).toBeNull();
  });

  it("still opens report settings that a link to another dashboard asks for", async () => {
    await renderAt("/dashboards/dash-a?reportSettings=1");

    await goTo("/dashboards/dash-b?reportSettings=1");

    expect(byTestId("email-report")?.getAttribute("data-dashboard-id")).toBe(
      "dash-b",
    );
  });

  it("keeps the next dashboard's personal widths when a panel save resolves after the switch", async () => {
    const dashBKey = personalColumnWidthsKey("dash-b", "shared-table");
    window.localStorage.setItem(
      dashBKey,
      JSON.stringify({ name: { width: 320, base: 200 } }),
    );
    mocks.dashboards["dash-a"] = dashboardRecord("Dashboard A", [
      tablePanel("Accounts A", 100),
    ]);
    let resolveSave: (value: unknown) => void = () => {};
    mocks.saveDashboard = () =>
      new Promise((resolve) => {
        resolveSave = resolve;
      });

    // Visiting B first caches it, so returning to B swaps dashboards with no
    // loading render in between.
    await renderAt("/dashboards/dash-b");
    await goTo("/dashboards/dash-a");
    await click("edit-shared-table");
    await click("panel-editor-save");
    await goTo("/dashboards/dash-b");
    await act(async () => {
      resolveSave({ updatedAt: "2026-10-02T12:00:00.000Z" });
    });
    await settle();

    expect(container.textContent).toContain("Accounts B");
    expect(container.textContent).not.toContain("Accounts A edited");
    expect(
      parsePersonalColumnWidths(window.localStorage.getItem(dashBKey)),
    ).toEqual({ name: { width: 320, base: 200 } });
  });

  it("never shows one dashboard's personal widths on another dashboard's table", async () => {
    window.localStorage.setItem(
      personalColumnWidthsKey("dash-a", "shared-table"),
      JSON.stringify({ name: { width: 320, base: 200 } }),
    );

    // As above: with B cached, the switch back renders B's panels straight
    // over A's, where a card for the shared panel id could be reused.
    await renderAt("/dashboards/dash-b");
    await goTo("/dashboards/dash-a");
    expect(mocks.cardRenders[mocks.cardRenders.length - 1]).toEqual({
      dashboardId: "dash-a",
      panelId: "shared-table",
      widths: { name: 320 },
    });
    await goTo("/dashboards/dash-b");

    const dashBRenders = mocks.cardRenders.filter(
      (render) => render.dashboardId === "dash-b",
    );
    expect(dashBRenders.length).toBeGreaterThan(0);
    for (const render of dashBRenders) expect(render.widths).toEqual({});
  });

  it("saves filters again after a failed write once they come back, even while the preference rereads", async () => {
    const writes: unknown[] = [];
    let failNextWrite = true;
    mocks.userPref = {
      data: { filters: { f_region: "eu" } },
      isSuccess: true,
      isError: false,
      isFetching: false,
      save: (value, options) => {
        writes.push(value);
        if (failNextWrite) {
          failNextWrite = false;
          options?.onError?.();
        }
      },
    };
    async function afterSaveDelay() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1600));
      });
    }

    await renderAt("/dashboards/dash-a?f_region=eu");
    await goTo("/dashboards/dash-a?f_region=us");
    await afterSaveDelay();
    expect(writes).toEqual([{ filters: { f_region: "us" } }]);

    // The failed write rereads the saved preference; that must not resend it.
    mocks.userPref = {
      ...mocks.userPref,
      data: { filters: { f_region: "eu" } },
    };
    await renderAt("/dashboards/dash-a?f_region=us");
    await afterSaveDelay();
    expect(writes).toHaveLength(1);

    // Leaving them counts while the preference is still being reread.
    mocks.userPref = { ...mocks.userPref, isFetching: true };
    await goTo("/dashboards/dash-a?f_region=eu");
    await afterSaveDelay();
    mocks.userPref = { ...mocks.userPref, isFetching: false };
    await goTo("/dashboards/dash-a?f_region=us");
    await afterSaveDelay();
    expect(writes).toEqual([
      { filters: { f_region: "us" } },
      { filters: { f_region: "us" } },
    ]);
  }, 15_000);
});
