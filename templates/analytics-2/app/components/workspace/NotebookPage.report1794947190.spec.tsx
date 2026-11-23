// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  createMemoryRouter,
  MemoryRouter,
  RouterProvider,
  useLocation,
} from "react-router";
import { expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";
import type { CellContents } from "@/lib/model/contracts";

import type getProject from "../../../actions/get-project";
import { notebookUndoRequestSchema } from "../../../shared/notebook-undo";
import {
  SAMPLE_DATA_SOURCE_ID,
  SAMPLE_DATA_SOURCE_NAME,
} from "../../../shared/sample-data-contract";
import { NotebookPage } from "./NotebookPage";

const projectReadMetadata: Omit<
  Awaited<ReturnType<typeof getProject.run>>,
  "project"
> = {
  viewer: { email: "qa-fleet@builder.io", orgId: "org" },
  canEdit: true,
  capabilities: [],
  outputs: {},
  queryStates: {},
  selectedConnections: [],
  importedConnectionIds: [],
};
const sampleConnection = {
  id: SAMPLE_DATA_SOURCE_ID,
  status: "available",
  name: SAMPLE_DATA_SOURCE_NAME,
  type: "sample",
} as const;

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  queue: vi.fn(),
  readiness: vi.fn(async (): Promise<string> => "configured"),
  props: null as {
    emptyState: { onAskDataQuestion: (question: string) => Promise<void> };
    onSaveCell: (
      id: string,
      contents: unknown,
      expectedUpdatedAt?: string,
    ) => Promise<unknown>;
    canEdit: boolean;
    onAddCell: (kind: "sql" | "input") => Promise<string>;
    onDeleteCell: (id: string) => Promise<void>;
    onDuplicateCell: (id: string) => Promise<void>;
    onMoveCell: (id: string, direction: "up" | "down") => Promise<void>;
    onUndoCellEdit: (redo: boolean) => Promise<void>;
    project: { title: string };
    outputs: Record<string, unknown>;
    error: string | null;
    loading: boolean;
  } | null,
  session: { email: "qa-fleet@builder.io" },
  sessionLoading: false,
  org: "org",
  orgPending: false,
  orgError: false,
  canCreate: true,
  projectCanEdit: true,
  projectError: false,
  shellReady: true,
  notebookEnabled: false,
  mutation: { mutateAsync: vi.fn(async (_input?: unknown) => ({})) },
  undo: vi.fn(async (_input?: unknown) => ({})),
  operationReceipt: vi.fn(async (_input?: unknown) => ({})),
}));
vi.mock("@agent-native/core/client/agent-engine-readiness", () => ({
  fetchAgentEngineConfiguredState: mocks.readiness,
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChatAndConfirm: mocks.send,
}));
vi.mock("@/components/agent/search-submission", () => ({
  queueThreadSubmission: mocks.queue,
}));
vi.mock("./WorkspaceDataContext", () => ({
  useWorkspaceData: () =>
    mocks.shellReady
      ? {
          shell: {
            workspace: { id: "org" },
            user: { email: "qa-fleet@builder.io" },
            features: { canCreateProject: mocks.canCreate },
          },
        }
      : undefined,
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    session: mocks.session,
    isLoading: mocks.sessionLoading,
  }),
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({
    data: { orgId: mocks.org },
    isPending: mocks.orgPending,
    isError: mocks.orgError,
  }),
}));
vi.mock("@/components/notebook", () => ({
  ProjectEditor: (props: unknown) => {
    mocks.props = props as typeof mocks.props;
    return null;
  },
}));
vi.mock("@/components/agent", () => ({
  NotebookAgentComposerSuppressed: () => null,
  WorkspaceAgent: () => null,
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@agent-native/core/client/hooks")>();
  return {
    ...original,
    callAction: (name: string, input: unknown, options: unknown) =>
      name === "create-notebook-thread"
        ? Promise.resolve({ threadId: "bound-thread" })
        : name === "get-notebook-operation"
          ? mocks.operationReceipt(input)
          : Reflect.apply(original.callAction, undefined, [
              name,
              input,
              options,
            ]),
    useActionMutation: (name: string) =>
      name === "undo-notebook-operation"
        ? { mutateAsync: mocks.undo }
        : mocks.mutation,
    useActionQuery: (name: string) =>
      name === "get-workspace-bootstrap"
        ? {
            data: {
              workspace: { id: "org" },
              user: { email: "qa-fleet@builder.io" },
              features: { canCreateProject: true },
            },
            isPending: false,
            isError: false,
          }
        : name === "get-project"
          ? {
              data: {
                ...projectReadMetadata,
                outputs: {
                  secret: {
                    status: "success",
                    output: { type: "text", text: "private output" },
                  },
                },
                canEdit: mocks.projectCanEdit,
                ...(mocks.notebookEnabled
                  ? {
                      notebook: {
                        snapshot: { head: { versionId: "v1", revision: "r1" } },
                      },
                    }
                  : {}),
                project: {
                  id: "project-1",
                  ownerEmail: "owner@example.com",
                  workingVersionId: "v1",
                  title: "On Demand Billing Test",
                  cells: [],
                },
              },
              isPending: false,
              isError: mocks.projectError,
              error: mocks.projectError
                ? new Error("Project read failed")
                : null,
              refetch: vi.fn(),
            }
          : name === "get-notebook-execution"
            ? { isPending: false, isError: false, refetch: vi.fn() }
            : { data: { connections: [] }, isPending: false, isError: false },
  };
});

it("report 1794947190: sends an empty project's question to its project agent", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.send.mockResolvedValue({ delivered: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <NotebookPage
            route={{ params: { projectLocator: "project-1" } } as never}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  expect(mocks.props?.emptyState.onAskDataQuestion).toBeTypeOf("function");
  await mocks.props?.emptyState.onAskDataQuestion("Show billing");
  expect(mocks.send).toHaveBeenCalledWith(
    expect.objectContaining({
      message: "Show billing",
      context: expect.stringContaining("project-1"),
      chatTarget: "local",
      submit: true,
    }),
  );
  await act(async () => root.unmount());
  container.remove();
});

it("B8: asks the question Home handed over exactly once and clears it from the navigation state", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.send.mockReset().mockResolvedValue({ delivered: true });
  const seen: Array<{ state: unknown; search: string }> = [];
  function Probe() {
    const { state, search } = useLocation();
    seen.push({ state, search });
    return null;
  }
  const question = "How's my Agent-Native metrics doing in my V3 dashboard?";
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter
          initialEntries={[
            {
              pathname: "/project/project-1/latest",
              state: { askQuestion: question },
            },
          ]}
        >
          <Probe />
          <NotebookPage
            route={{ params: { projectLocator: "project-1" } } as never}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
  expect(mocks.send).toHaveBeenCalledWith(
    expect.objectContaining({
      message: question,
      context: expect.stringContaining("project-1"),
      chatTarget: "local",
      submit: true,
    }),
  );
  await vi.waitFor(() => expect(seen.at(-1)?.state).toBeNull());
  expect(seen.at(-1)?.search).toContain("notebookView=agent");
  await act(async () => root.unmount());
  container.remove();
  expect(mocks.send).toHaveBeenCalledTimes(1);
});

it("B8: submits a handed-off question to the already bound notebook thread", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.notebookEnabled = true;
  mocks.queue.mockReset().mockResolvedValue({ delivered: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter
            initialEntries={[
              {
                pathname: "/project/project-1/latest",
                state: { askQuestion: "How is this dashboard doing?" },
              },
            ]}
          >
            <NotebookPage
              route={{ params: { projectLocator: "project-1" } } as never}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(() => expect(mocks.queue).toHaveBeenCalledTimes(1));
    expect(mocks.queue).toHaveBeenCalledWith(
      "bound-thread",
      "org",
      expect.objectContaining({ message: "How is this dashboard doing?" }),
    );
  } finally {
    mocks.notebookEnabled = false;
    await act(async () => root.unmount());
    container.remove();
  }
});

it("B8: preserves handed-off question if location.state is replaced before project read resolves", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.send.mockReset().mockResolvedValue({ delivered: true });
  const originalOrg = mocks.org;
  mocks.org = "";
  const question = "How's my Agent-Native metrics doing in my V3 dashboard?";
  const { useNavigate } = await import("react-router");
  let triggerReplace!: () => void;
  function SiblingReplace() {
    const navigate = useNavigate();
    triggerReplace = () =>
      void navigate("/project/project-1/latest?notebookThread=thr_old", {
        replace: true,
      });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const queryClient = new QueryClient();
  const renderPage = () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[
            {
              pathname: "/project/project-1/latest",
              state: { askQuestion: question },
            },
          ]}
        >
          <SiblingReplace />
          <NotebookPage
            route={{ params: { projectLocator: "project-1" } } as never}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  try {
    await act(async () => renderPage());
    await act(async () => {
      triggerReplace();
    });
    expect(mocks.send).not.toHaveBeenCalled();
    mocks.org = originalOrg;
    await act(async () => renderPage());
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ message: question, submit: true }),
    );
  } finally {
    mocks.org = originalOrg;
    await act(async () => root.unmount());
    container.remove();
  }
});

it("report A2-CHART-AUTOSAVE-RACE serializes saves and preserves conflicts", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let finishFirst: (value: Record<string, unknown>) => void = () => {};
  const firstResult = new Promise<Record<string, unknown>>((resolve) => {
    finishFirst = resolve;
  });
  const result = (updatedAt: string) => ({
    project: { id: "project-1", cells: [{ id: "chart", updatedAt }] },
  });
  mocks.mutation.mutateAsync.mockReset().mockResolvedValue({});
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <NotebookPage
              route={{ params: { projectLocator: "project-1" } } as never}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    const save = mocks.props?.onSaveCell;
    expect(save).toBeTypeOf("function");
    if (!save) throw new Error("Notebook save is unavailable");
    mocks.mutation.mutateAsync
      .mockReset()
      .mockReturnValueOnce(firstResult)
      .mockResolvedValueOnce(result("revision-2"))
      .mockResolvedValueOnce(result("revision-3"));
    const chart = { kind: "chart" };
    const first = save("chart", chart, "revision-0");
    const second = save("chart", chart, "revision-0");
    expect(mocks.mutation.mutateAsync).toHaveBeenCalledTimes(1);
    finishFirst(result("revision-1"));
    await Promise.all([first, second]);
    expect(mocks.mutation.mutateAsync.mock.calls[1]?.[0]).toMatchObject({
      expectedUpdatedAt: "revision-1",
    });
    await save("chart", chart, "revision-0");
    expect(mocks.mutation.mutateAsync.mock.calls[2]?.[0]).toMatchObject({
      expectedUpdatedAt: "revision-2",
    });

    const conflict = new Error("Changed elsewhere");
    mocks.mutation.mutateAsync.mockRejectedValueOnce(conflict);
    const failed = save("chart", chart, "revision-3");
    const queued = save("chart", chart, "revision-3");
    const outcomes = await Promise.allSettled([failed, queued]);
    expect(outcomes).toEqual([
      { status: "rejected", reason: conflict },
      { status: "rejected", reason: conflict },
    ]);
    expect(mocks.mutation.mutateAsync).toHaveBeenCalledTimes(4);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    mocks.mutation.mutateAsync.mockReset();
  }
});

it("report 1794947190: uses verified bootstrap while the full workspace shell is pending", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.shellReady = false;
  mocks.send.mockResolvedValue({ delivered: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient();
  const render = async () =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <NotebookPage
              route={{ params: { projectLocator: "project-1" } } as never}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
  try {
    await render();
    expect(mocks.props?.emptyState.onAskDataQuestion).toBeTypeOf("function");
    expect(mocks.props?.canEdit).toBe(true);
    await mocks.props?.emptyState.onAskDataQuestion("Show billing");
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Show billing",
        context: expect.stringContaining("project-1"),
      }),
    );
    mocks.org = "different-org";
    await render();
    expect(mocks.props?.emptyState).toBeUndefined();
    expect(mocks.props?.canEdit).toBe(false);
  } finally {
    mocks.org = "org";
    mocks.shellReady = true;
    await act(async () => root.unmount());
    container.remove();
  }
});

it("keeps review and editing disabled until the active session and workspace match the read", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient();
  const render = async () =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <NotebookPage
              route={{ params: { projectLocator: "project-1" } } as never}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
  mocks.sessionLoading = true;
  await render();
  expect(mocks.props?.canEdit).toBe(false);
  mocks.sessionLoading = false;
  mocks.orgPending = true;
  await render();
  expect(mocks.props?.canEdit).toBe(false);
  mocks.orgPending = false;
  mocks.orgError = true;
  await render();
  expect(mocks.props?.canEdit).toBe(false);
  mocks.orgError = false;
  mocks.session = { email: "another@example.test" };
  await render();
  expect(mocks.props?.canEdit).toBe(false);
  mocks.session = { email: "qa-fleet@builder.io" };
  mocks.org = "different-org";
  await render();
  expect(mocks.props?.canEdit).toBe(false);
  mocks.org = "org";
  await render();
  expect(mocks.props?.canEdit).toBe(true);
  try {
    mocks.canCreate = false;
    await render();
    expect(mocks.props?.canEdit).toBe(true);
    mocks.canCreate = true;
    mocks.projectCanEdit = false;
    await render();
    expect(mocks.props?.canEdit).toBe(false);
  } finally {
    mocks.canCreate = true;
    mocks.projectCanEdit = true;
    await act(async () => root.unmount());
    container.remove();
  }
});

it("hides cached project and results after identity changes even when the refresh fails", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient();
  const render = async () =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <NotebookPage
              route={{ params: { projectLocator: "project-1" } } as never}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
  try {
    await render();
    expect(mocks.props?.project.title).toBe("On Demand Billing Test");
    expect(mocks.props?.outputs.secret).toBeDefined();
    mocks.projectError = true;
    for (const identity of ["session", "org"]) {
      mocks.session = {
        email:
          identity === "session" ? "other@example.test" : "qa-fleet@builder.io",
      };
      mocks.org = identity === "org" ? "other-org" : "org";
      await render();
      expect(mocks.props?.project.title).not.toBe("On Demand Billing Test");
      expect(mocks.props?.outputs).toEqual({});
      expect(mocks.props?.error).toBe("Project read failed");
      expect(mocks.props?.canEdit).toBe(false);
    }
  } finally {
    mocks.session = { email: "qa-fleet@builder.io" };
    mocks.org = "org";
    mocks.projectError = false;
    await act(async () => root.unmount());
    container.remove();
  }
});

it("report A2-SAVE-CACHE-STALE: preserves deletion after an older save response", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient();
  let resolveSave: (value: NonNullable<unknown>) => void = () => {
    throw new Error("save not started");
  };
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <NotebookPage
              route={{ params: { projectLocator: "project-1" } } as never}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    const cacheKey = ["action", "get-project", { projectId: "project-1" }];
    const savedProject = {
      id: "project-1",
      workingVersionId: "v1",
      title: "old",
      cells: [
        { id: "a", updatedAt: "v2" },
        { id: "b", updatedAt: "v1" },
      ],
    };
    const currentProject = {
      id: "project-1",
      workingVersionId: "v1",
      title: "new",
      cells: [{ id: "b", updatedAt: "v2" }],
    };
    mocks.mutation.mutateAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const save = mocks.props?.onSaveCell("a", {}, "v1");
    expect(save).toBeDefined();
    client.setQueryData(cacheKey, {
      ...projectReadMetadata,
      project: currentProject,
    });
    await act(async () => {
      resolveSave({ project: savedProject });
      await save;
    });
    expect(client.getQueryData(cacheKey)).toEqual({
      ...projectReadMetadata,
      project: currentProject,
    });

    const currentWithoutB = {
      ...savedProject,
      cells: [{ id: "a", updatedAt: "v1" }],
    };
    mocks.mutation.mutateAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const saveA = mocks.props?.onSaveCell("a", {}, "v1");
    client.setQueryData(cacheKey, {
      ...projectReadMetadata,
      project: currentWithoutB,
    });
    await act(async () => {
      resolveSave({ project: savedProject });
      await saveA;
    });
    expect(client.getQueryData(cacheKey)).toEqual({
      ...projectReadMetadata,
      project: { ...currentWithoutB, cells: [{ id: "a", updatedAt: "v2" }] },
    });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
  }
});

it("report A2-ADD-CELL-BLOCKED-BY-SHELL shows the acknowledged cell without waiting for a workspace refresh", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient();
  const key = ["action", "get-project", { projectId: "project-1" }];
  const existing = {
    ...projectReadMetadata,
    project: { id: "project-1", workingVersionId: "v1", cells: [] },
    outputs: {
      existing: {
        cellId: "existing",
        status: "complete",
        output: null,
        ranAt: "2026-11-01T00:00:00.000Z",
      },
    } satisfies typeof projectReadMetadata.outputs,
    selectedConnections: [sampleConnection],
  };
  client.setQueryData(key, existing);
  let releaseShell: () => void = () => {};
  const shell = new Promise<void>((resolve) => {
    releaseShell = resolve;
  });
  const invalidate = vi
    .spyOn(client, "invalidateQueries")
    .mockImplementation((filters) =>
      filters?.queryKey?.[1] === "get-workspace-activity" &&
      filters.refetchType !== "none"
        ? shell
        : Promise.resolve(),
    );
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <NotebookPage
              route={{ params: { projectLocator: "project-1" } } as never}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    const cell = {
      id: "new-cell",
      contents: {
        kind: "sql",
        order: "a",
        dataConnectionId: SAMPLE_DATA_SOURCE_ID,
      },
    };
    mocks.mutation.mutateAsync.mockReset().mockResolvedValue({
      createdCellId: cell.id,
      project: { ...existing.project, cells: [cell] },
    });
    let completed: string | undefined;
    const added = mocks.props?.onAddCell("sql").then((id) => {
      completed = id;
    });
    if (!added) throw new Error("Notebook add is unavailable");
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(completed).toBe("new-cell");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    expect(client.getQueryData(key)).toEqual({
      ...existing,
      project: { ...existing.project, cells: [cell] },
    });
    await added;
    let finishAdd: (value: object) => void = () => {};
    const pending = new Promise<object>((resolve) => {
      finishAdd = resolve;
    });
    mocks.mutation.mutateAsync.mockReturnValueOnce(pending);
    const secondAdd = mocks.props?.onAddCell("sql");
    if (!secondAdd) throw new Error("Notebook add is unavailable");
    const concurrentCell = {
      id: "concurrent",
      contents: { ...cell.contents, order: "b" },
    };
    const concurrentProject = {
      ...existing.project,
      workingVersionId: "v2",
      cells: [concurrentCell],
    };
    client.setQueryData(key, { ...existing, project: concurrentProject });
    const secondCell = {
      id: "second",
      contents: { ...cell.contents, order: "c" },
    };
    finishAdd({
      createdCellId: secondCell.id,
      project: { ...concurrentProject, cells: [secondCell] },
    });
    expect(await secondAdd).toBe("second");
    expect(client.getQueryData(key)).toEqual({
      ...existing,
      project: { ...concurrentProject, cells: [concurrentCell, secondCell] },
    });
  } finally {
    releaseShell();
    await act(async () => root.unmount());
    container.remove();
    mocks.mutation.mutateAsync.mockReset();
  }
});

it("preserves an accepted input when a prior save's project read arrives late", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient();
  const key = ["action", "get-project", { projectId: "project-1" }];
  const existing = {
    ...projectReadMetadata,
    project: {
      id: "project-1",
      workingVersionId: "v1",
      cells: [{ id: "numeric" }],
    },
  };
  const cell = { id: "new-text-input", contents: { kind: "input" } };
  const accepted = {
    ...existing,
    project: { ...existing.project, cells: [...existing.project.cells, cell] },
  };
  let finishStaleRead: (project: typeof existing) => void = () => {};
  const stale = new Promise<typeof existing>((resolve) => {
    finishStaleRead = resolve;
  });
  const read = vi
    .fn(() => Promise.resolve(accepted))
    .mockReturnValueOnce(stale);
  client.setQueryData(key, existing);
  const observer = new QueryObserver(client, { queryKey: key, queryFn: read });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <NotebookPage
              route={{ params: { projectLocator: "project-1" } } as never}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    expect(read).toHaveBeenCalledTimes(1);
    mocks.mutation.mutateAsync.mockResolvedValueOnce({
      createdCellId: cell.id,
      project: accepted.project,
    });
    const add = mocks.props?.onAddCell;
    if (!add) throw new Error("Notebook add is unavailable");
    await expect(add("input")).resolves.toBe(cell.id);
    expect(client.getQueryData(key)).toEqual(accepted);
    await act(async () => finishStaleRead(existing));
    expect(client.getQueryData(key)).toEqual(accepted);
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    unsubscribe();
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    mocks.mutation.mutateAsync.mockReset();
    vi.unstubAllGlobals();
  }
});

it("routes editor undo and redo through one durable editing origin and retries a missing receipt", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  document.body.append(host);
  const client = new QueryClient();
  const key = ["action", "get-project", { projectId: "project-1" }];
  const contents: CellContents = {
    kind: "sql",
    id: "sql-1",
    order: "a0",
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    source: "select 1",
    dataConnectionId: SAMPLE_DATA_SOURCE_ID,
    databaseSchema: null,
    resultVariable: "dataframe",
    outputResult: true,
  };
  const cell = { id: contents.id, updatedAt: "r1", contents };
  const duplicate = {
    ...cell,
    id: "copy",
    contents: {
      ...contents,
      id: "copy",
      order: "a1",
      resultVariable: "dataframe_2",
    },
  };
  const stored = {
    ...projectReadMetadata,
    project: { id: "project-1", workingVersionId: "v1", cells: [cell] },
    selectedConnections: [sampleConnection],
  };
  client.setQueryData(key, stored);
  const edit = mocks.mutation.mutateAsync;
  const undo = mocks.undo;
  const receipt = mocks.operationReceipt;
  const head = { versionId: "v1", revision: "1" };
  undo.mockReset().mockImplementation(async (input) => ({
    status: "no_change",
    opId: notebookUndoRequestSchema.parse(input).opId,
    previousHead: head,
    nextHead: head,
    eventSeq: "1",
    committedAt: "2026-11-18T12:00:00.000Z",
  }));
  receipt
    .mockReset()
    .mockResolvedValue({ status: "absent", reason: "not_found" });
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <NotebookPage
              route={{ params: { projectLocator: "project-1" } } as never}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    const props = mocks.props;
    if (!props) throw new Error("Notebook hasn't loaded");
    edit.mockReset().mockResolvedValue({ project: stored.project });
    await props.onDeleteCell(cell.id);
    await props.onMoveCell(cell.id, "down");
    edit.mockResolvedValueOnce({
      createdCellId: duplicate.id,
      project: { ...stored.project, cells: [cell, duplicate] },
    });
    await props.onDuplicateCell(cell.id);
    edit.mockResolvedValueOnce({
      createdCellId: duplicate.id,
      project: { ...stored.project, cells: [cell, duplicate] },
    });
    await props.onAddCell("sql");
    const renamed = { ...contents, resultVariable: "orders" };
    edit.mockResolvedValueOnce({
      project: {
        ...stored.project,
        cells: [{ ...cell, contents: renamed, updatedAt: "r2" }],
      },
    });
    await props.onSaveCell(cell.id, renamed, "r1");

    await props.onUndoCellEdit(false);
    await props.onUndoCellEdit(true);
    const first = notebookUndoRequestSchema.parse(undo.mock.calls[0]?.[0]);
    const second = notebookUndoRequestSchema.parse(undo.mock.calls[1]?.[0]);
    expect(first).toMatchObject({
      projectId: "project-1",
      workingVersionId: "v1",
      direction: "undo",
    });
    expect(second).toEqual({ ...first, direction: "redo", opId: second.opId });
    expect(second.opId).not.toBe(first.opId);
    expect(edit.mock.calls.map(([input]) => input)).toEqual([
      { projectId: "project-1", cellId: cell.id, originId: first.originId },
      {
        projectId: "project-1",
        cellId: cell.id,
        direction: "down",
        originId: first.originId,
      },
      { projectId: "project-1", cellId: cell.id, originId: first.originId },
      { projectId: "project-1", kind: "sql", originId: first.originId },
      {
        projectId: "project-1",
        cellId: cell.id,
        contents: renamed,
        expectedUpdatedAt: "r1",
        originId: first.originId,
      },
    ]);

    const interrupted = new Error("Acknowledgement lost");
    undo.mockRejectedValueOnce(interrupted);
    await expect(props.onUndoCellEdit(false)).rejects.toBe(interrupted);
    const uncertain = notebookUndoRequestSchema.parse(undo.mock.calls[2]?.[0]);
    expect(receipt).toHaveBeenCalledExactlyOnceWith({
      projectId: "project-1",
      opId: uncertain.opId,
    });
    await props.onUndoCellEdit(false);
    expect(undo).toHaveBeenLastCalledWith(uncertain);

    const changedDraft = {
      ...stored,
      project: {
        ...stored.project,
        cells: [
          {
            ...cell,
            updatedAt: "r3",
            contents: { ...renamed, source: "select 42" },
          },
        ],
      },
    };
    client.setQueryData(key, changedDraft);
    const conflict = Object.assign(new Error("Changed elsewhere"), {
      status: 409,
      errorCode: "notebook_conflict",
    });
    undo.mockRejectedValueOnce(conflict);
    await expect(props.onUndoCellEdit(false)).rejects.toBe(conflict);
    expect(client.getQueryData(key)).toEqual(changedDraft);
    expect(edit).toHaveBeenCalledTimes(5);
    expect(receipt).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    edit.mockReset();
    undo.mockReset();
    receipt.mockReset();
    vi.unstubAllGlobals();
  }
});

it.each([
  ["missing", "Connect AI to start chatting"],
  ["unavailable", "Couldn't confirm AI is ready."],
])(
  "reports %s Ask readiness before dispatch and accepts a configured retry",
  async (state, message) => {
    mocks.readiness.mockResolvedValueOnce(state);
    mocks.send.mockClear().mockResolvedValue({ delivered: true });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <AgentNativeI18nProvider
            catalog={i18nCatalog}
            persistPreference={false}
          >
            <QueryClientProvider client={new QueryClient()}>
              <MemoryRouter>
                <NotebookPage
                  route={{ params: { projectLocator: "project-1" } } as never}
                />
              </MemoryRouter>
            </QueryClientProvider>
          </AgentNativeI18nProvider>,
        ),
      );
      const submit = mocks.props?.emptyState.onAskDataQuestion;
      expect(submit).toBeTypeOf("function");
      await expect(submit?.("Show billing")).rejects.toThrow(message);
      expect(mocks.send).not.toHaveBeenCalled();
      await expect(submit?.("Show billing")).resolves.toBeUndefined();
      expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: "Show billing" }),
      );
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  },
);

it("waits for the project agent route before delivering the question", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.send.mockReset().mockResolvedValue({ delivered: true });
  let releaseNavigation: () => void = () => {};
  let beganNavigation: () => void = () => {};
  const navigation = new Promise<void>((resolve) => {
    releaseNavigation = resolve;
  });
  const started = new Promise<void>((resolve) => {
    beganNavigation = resolve;
  });
  const router = createMemoryRouter([
    {
      path: "*",
      loader: async ({ request }) => {
        if (new URL(request.url).searchParams.get("notebookView") === "agent") {
          beganNavigation();
          await navigation;
        }
        return null;
      },
      element: (
        <QueryClientProvider client={new QueryClient()}>
          <NotebookPage
            route={{ params: { projectLocator: "project-1" } } as never}
          />
        </QueryClientProvider>
      ),
    },
  ]);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<RouterProvider router={router} />));
    let submission: Promise<void> | undefined;
    await act(async () => {
      submission = mocks.props?.emptyState.onAskDataQuestion("Show billing");
      await started;
    });
    expect(mocks.send).not.toHaveBeenCalled();
    await act(async () => {
      releaseNavigation();
      await submission;
    });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Show billing",
        chatTarget: "local",
        submit: true,
      }),
    );
  } finally {
    releaseNavigation();
    await act(async () => root.unmount());
    router.dispose();
    container.remove();
  }
});

it("waits for the notebook agent composer to finish restoring before delivering the question", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.send.mockReset().mockResolvedValue({ delivered: true });
  const agentContainer = document.createElement("div");
  agentContainer.className = "ws-agent ws-agent-notebook";
  const composer = document.createElement("div");
  composer.setAttribute("aria-label", "Message agent...");
  composer.setAttribute("aria-disabled", "true");
  agentContainer.append(composer);
  document.body.append(agentContainer);

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={["/project/project-1/latest"]}>
            <NotebookPage
              route={{ params: { projectLocator: "project-1" } } as never}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
    let settled = false;
    const submission = mocks.props?.emptyState
      .onAskDataQuestion("Show billing")
      .then(() => {
        settled = true;
      });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    expect(mocks.send).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    composer.setAttribute("aria-disabled", "false");
    await submission;
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Show billing",
        chatTarget: "local",
        submit: true,
      }),
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
    agentContainer.remove();
  }
});
