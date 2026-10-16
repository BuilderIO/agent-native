// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useLayoutEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
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
  session: { email: "viewer@example.com" },
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
  useSession: () => ({ session: mocks.session, isLoading: false }),
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
  useDashboardViews: () => mocks.views,
}));

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

describe("SqlDashboardPage dashboard switch", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

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
    mocks.session = { email: "viewer@example.com" };
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
