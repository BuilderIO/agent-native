// @vitest-environment happy-dom
import {
  CancelledError,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, assert, expect, it, vi } from "vitest";

import type { ProjectEditorProps } from "@/components/notebook/types";
import { resolveRoute } from "@/routes/routing/registry";

import { NotebookPage } from "./NotebookPage";

const mocks = vi.hoisted(() => ({
  editor: null as Pick<
    ProjectEditorProps,
    "outputs" | "execution" | "onLoadResultPage" | "onLoadResultRows"
  > | null,
  call: vi.fn(),
  legacyPage: vi.fn(),
  legacyReads: null as Array<unknown> | null,
  activeRunIds: [] as string[],
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChatAndConfirm: vi.fn(),
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    session: { email: "qa@example.test" },
    isLoading: false,
  }),
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: { orgId: "org" }, isPending: false, isError: false }),
}));
vi.mock("./WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: {
      workspace: { id: "org" },
      user: { email: "qa@example.test" },
      features: { canCreateProject: true },
    },
  }),
}));
vi.mock("@/components/agent", () => ({
  NotebookAgentComposerSuppressed: () => null,
  WorkspaceAgent: () => null,
}));
vi.mock("@/components/notebook", () => ({
  ProjectEditor: (props: ProjectEditorProps) => {
    mocks.editor = props;
    return null;
  },
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "test-tab",
  actionErrorCode: () => null,
  callAction: mocks.call,
  useActionMutation: (name: string) => ({
    mutateAsync:
      name === "run-project-cell" ? mocks.legacyPage : vi.fn(async () => ({})),
  }),
  useActionQuery: (
    name: string,
    params: { projectId?: string },
    options?: {
      enabled?: boolean;
      onRequestStart?: () => unknown;
      onServerResult?: (
        data: unknown,
        metadata: { requestContext: unknown },
      ) => void;
    },
  ) => {
    const legacy = name === "get-project" && mocks.legacyReads !== null;
    return useQuery({
      queryKey: ["action", name, params],
      enabled: options?.enabled ?? true,
      ...(legacy ? { initialData: legacyDocument, staleTime: Infinity } : {}),
      queryFn: async () => {
        if (name === "get-project") {
          const requestContext = options?.onRequestStart?.();
          const data = legacy
            ? await mocks.legacyReads?.shift()
            : {
                ...document,
                project: { ...document.project, id: params.projectId },
              };
          if (!data) throw new CancelledError({ revert: true });
          options?.onServerResult?.(data, { requestContext });
          return data;
        }
        if (name === "get-notebook-execution")
          return {
            ...execution,
            snapshot: {
              ...execution.snapshot,
              ref: { ...execution.snapshot.ref, projectId: params.projectId },
            },
            activeRunIds: mocks.activeRunIds,
            cells: mocks.legacyReads ? {} : execution.cells,
          };
        return { connections: [] };
      },
      retry: false,
    });
  },
}));

const cellId = "cel_query";
const resultId = "result-v1";
const document = {
  project: {
    id: "project-1",
    title: "Project",
    description: "",
    cells: [],
    versions: [],
    workingVersionId: "v1",
    publishedVersionId: null,
  },
  outputs: {},
  queryStates: {},
  selectedConnections: [],
  canEdit: true,
  viewer: { email: "qa@example.test", orgId: "org" },
};
const legacyRequestId = "b998b7db-b3eb-4a25-a9c3-47f8dc021f41";
const legacyDocument = {
  ...document,
  outputs: {
    [cellId]: {
      status: "complete",
      output: {
        type: "table",
        columns: [{ name: "value", type: "string" }],
        rows: [["cached"]],
        rowCount: 1,
        truncated: true,
      },
    },
  },
  queryStates: {
    [cellId]: {
      requestId: legacyRequestId,
      status: "complete",
      busy: false,
      canSeek: true,
      hasNextPage: true,
      totalRows: "2",
    },
  },
};
const execution = {
  status: "found",
  snapshot: {
    namespace: { kind: "draft", namespaceId: "ns" },
    ref: { workspaceId: "org", head: { versionId: "v1", revision: "1" } },
  },
  cells: {
    [cellId]: { stale: false, resultId, attempt: null, finishedAt: null },
  },
  defaultMode: "auto",
  autoRerun: true,
  settingsRevision: "0",
};

function page(number: number, viewPage: number, viewRevision: string) {
  return {
    status: "ready",
    manifest: {
      status: "complete",
      rowCount: "20000",
      fields: [{ name: "row_id", type: "number" }],
    },
    page: number,
    rows: Array.from({ length: 50 }, (_, index) => [
      (number - 1) * 50 + index + 1,
    ]),
    view: { page: viewPage, viewRevision },
  };
}

function mount(client = new QueryClient()) {
  const root = createRoot(window.document.createElement("div"));
  const render = (projectId = "project-1") =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <NotebookPage
              route={resolveRoute(`/project/${projectId}/latest`, {
                authenticated: true,
              })}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      ),
    );
  const close = async () => {
    await act(async () => root.unmount());
    client.clear();
  };
  return { render, close };
}

afterEach(() => {
  mocks.editor = null;
  mocks.activeRunIds = [];
  mocks.call.mockReset();
  mocks.legacyPage.mockReset();
  mocks.legacyReads = null;
  vi.unstubAllGlobals();
});

it("seeks a saved warehouse job directly without requesting intervening pages", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.legacyReads = [];
  mocks.legacyPage.mockResolvedValue({
    output: { type: "table", rows: [[19951]] },
  });
  const notebook = mount();
  try {
    await notebook.render();
    const load = mocks.editor?.onLoadResultPage;
    assert(load);
    await expect(load(cellId, 19950, legacyRequestId)).resolves.toEqual([
      [19951],
    ]);
    expect(mocks.legacyPage).toHaveBeenCalledExactlyOnceWith({
      projectId: "project-1",
      cellId,
      requestId: legacyRequestId,
      operation: "page",
      rowOffset: 19950,
    });
    expect(mocks.call).not.toHaveBeenCalled();
  } finally {
    await notebook.close();
  }
});

it.each(["cancelled", "wrong identity", "fresh complete", "fresh next page"])(
  "handles %s project refresh before extending a saved warehouse result",
  async (scenario) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.legacyPage.mockResolvedValue({ status: "complete" });
    const complete = {
      ...legacyDocument,
      outputs: {
        [cellId]: {
          ...legacyDocument.outputs[cellId],
          output: {
            ...legacyDocument.outputs[cellId].output,
            rows: [["first"], ["second"]],
            rowCount: 2,
            truncated: false,
          },
        },
      },
      queryStates: {
        [cellId]: { ...legacyDocument.queryStates[cellId], hasNextPage: false },
      },
    };
    mocks.legacyReads =
      scenario === "cancelled"
        ? []
        : scenario === "wrong identity"
          ? [
              {
                ...legacyDocument,
                viewer: { ...legacyDocument.viewer, orgId: "other" },
              },
            ]
          : scenario === "fresh complete"
            ? [complete]
            : [legacyDocument, complete];
    const notebook = mount();
    try {
      await notebook.render();
      const load = mocks.editor?.onLoadResultRows;
      assert(load);
      await act(async () => {
        if (scenario === "cancelled" || scenario === "wrong identity")
          await expect(load(cellId, 2)).rejects.toThrow();
        else await expect(load(cellId, 2)).resolves.toBe(2);
      });
      expect(mocks.legacyPage).toHaveBeenCalledTimes(
        scenario === "fresh next page" ? 1 : 0,
      );
      if (scenario === "fresh next page")
        expect(mocks.legacyPage).toHaveBeenCalledWith({
          projectId: "project-1",
          cellId,
          requestId: legacyRequestId,
          operation: "next-page",
        });
    } finally {
      await notebook.close();
    }
  },
);

it("rejects a late warehouse result refresh after leaving and reopening the same notebook", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resolveRead: (value: unknown) => void = () => {};
  const held = new Promise((resolve) => {
    resolveRead = resolve;
  });
  mocks.legacyReads = [held];
  const notebook = mount();
  try {
    await notebook.render();
    const load = mocks.editor?.onLoadResultRows;
    assert(load);
    const result = expect(load(cellId, 2)).rejects.toThrow();
    await notebook.render("project-2");
    await notebook.render();
    resolveRead(legacyDocument);
    await result;
    expect(mocks.legacyPage).not.toHaveBeenCalled();
  } finally {
    await notebook.close();
  }
});

it("reads page 400 by immutable result ID and reopens it without submitting a query", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let savedPage = 1;
  let viewRevision = "0";
  mocks.call.mockImplementation(async (action, input) => {
    if (action === "get-notebook-result-page")
      return page(input.page ?? savedPage, savedPage, viewRevision);
    if (action === "set-notebook-result-view") {
      savedPage = input.page;
      viewRevision = "1";
      return { status: "saved", page: savedPage, viewRevision };
    }
    throw new Error(`Unexpected action: ${action}`);
  });
  const first = mount();
  try {
    await first.render();
    await vi.waitFor(() =>
      expect(mocks.editor?.outputs?.[cellId]?.artifactPage).toBe(1),
    );
    const load = mocks.editor?.onLoadResultPage;
    assert(load);
    await act(async () => {
      const rows = await load(cellId, 19950, resultId);
      expect(rows.map((row) => row[0])).toEqual(
        Array.from({ length: 50 }, (_, i) => 19951 + i),
      );
    });
    expect(
      mocks.call.mock.calls.map(([action, input]) => [action, input]),
    ).toEqual([
      ["get-notebook-result-page", { resultId }],
      ["get-notebook-result-page", { resultId, page: 400 }],
      [
        "set-notebook-result-view",
        {
          resultId,
          page: 400,
          requestId: expect.any(String),
          expectedViewRevision: "0",
        },
      ],
    ]);
  } finally {
    await first.close();
  }
  const cold = mount();
  try {
    await cold.render();
    await vi.waitFor(() =>
      expect(mocks.editor?.outputs?.[cellId]?.artifactPage).toBe(400),
    );
    expect(mocks.editor?.outputs?.[cellId]?.output).toMatchObject({
      type: "table",
      rows: page(400, 400, "1").rows,
      totalRows: "20000",
    });
    expect(mocks.call).toHaveBeenCalledTimes(4);
  } finally {
    await cold.close();
  }
});

it("rejects a late artifact read after leaving and reopening the same notebook", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resolveRead: (value: unknown) => void = () => {};
  const held = new Promise((resolve) => {
    resolveRead = resolve;
  });
  mocks.call.mockImplementation(async (action, input) => {
    if (action !== "get-notebook-result-page")
      throw new Error(`Unexpected action: ${action}`);
    return input.page ? held : page(1, 1, "0");
  });
  const notebook = mount();
  try {
    await notebook.render();
    await vi.waitFor(() =>
      expect(mocks.editor?.outputs?.[cellId]?.artifactPage).toBe(1),
    );
    const load = mocks.editor?.onLoadResultPage;
    assert(load);
    const result = expect(load(cellId, 19950, resultId)).rejects.toThrow();
    await notebook.render("project-2");
    await notebook.render();
    resolveRead(page(400, 1, "0"));
    await result;
    expect(
      mocks.call.mock.calls.some(
        ([action]) => action === "set-notebook-result-view",
      ),
    ).toBe(false);
  } finally {
    await notebook.close();
  }
});

it("reattaches to an active server plan, observes per-cell progress, and stops it without resubmitting", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const runId = "run-held";
  mocks.activeRunIds = [runId];
  const attempt = {
    attemptId: "att_one",
    runId,
    namespaceId: "ns",
    cellId,
    outputGeneration: "1",
  };
  let cancelled = false;
  mocks.call.mockImplementation(async (action, input) => {
    if (action === "get-notebook-result-page") return page(1, 1, "0");
    if (action === "cancel-notebook-run") {
      cancelled = true;
      return { status: "cancelled", reason: "cancel_confirmed" };
    }
    if (action !== "get-notebook-run")
      throw new Error(`Unexpected action: ${action}`);
    const event = (sequence: string, status: string) => ({
      runId,
      sequence,
      event: { type: "attempt", receipt: { attempt, state: { status } } },
    });
    return {
      status: "found",
      run: {
        status: "admitted",
        runId,
        request: { mode: "run-all" },
        cursor: "1",
        startedAt: "2026-11-18T00:00:00Z",
        plan: {
          admittedCellIds: [cellId],
          dependencyResultIds: [],
          rejectedCells: [],
        },
        attempts: [{ attempt, state: { status: "queued" } }],
      },
      events: [
        ...(input.after === "0" ? [event("2", "running")] : []),
        ...(cancelled ? [event("3", "cancelled")] : []),
      ],
      nextCursor: cancelled ? "3" : "2",
      building: [],
    };
  });
  const notebook = mount();
  try {
    await notebook.render();
    await vi.waitFor(() =>
      expect(mocks.editor?.execution?.run?.attempts[0]?.state.status).toBe(
        "running",
      ),
    );
    expect(mocks.editor?.execution?.run?.runId).toBe(runId);
    expect(mocks.editor?.execution?.runningIds.has(cellId)).toBe(true);
    expect(mocks.call).toHaveBeenCalledWith(
      "get-notebook-run",
      { runId, after: "0", first: 100 },
      expect.objectContaining({ method: "GET" }),
    );
    const stop = mocks.editor?.execution?.cancel;
    assert(stop);
    await act(async () => stop());
    await vi.waitFor(() =>
      expect(mocks.editor?.execution?.run?.attempts[0]?.state.status).toBe(
        "cancelled",
      ),
    );
    expect(mocks.editor?.execution?.runningIds.has(cellId)).toBe(false);
    expect(mocks.call).toHaveBeenCalledWith(
      "cancel-notebook-run",
      { runId },
      expect.objectContaining({ uiOnly: true }),
    );
    expect(
      mocks.call.mock.calls.every(([action]) =>
        [
          "get-notebook-run",
          "get-notebook-result-page",
          "cancel-notebook-run",
        ].includes(action),
      ),
    ).toBe(true);
  } finally {
    await notebook.close();
  }
});
