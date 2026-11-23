// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, type ComponentType, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { assert, beforeAll, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import { resolveRoute } from "@/routes/routing/registry";

import { ANALYTICS_CONTROL_IDS } from "../../../shared/analytics-control-ids";
import { capabilityDecisionSchema } from "../../../shared/capabilities";
import { SAMPLE_DATA_SOURCE_ID } from "../../../shared/sample-data-contract";
import { NotebookPage } from "./NotebookPage";
import { loadNotebookCell } from "./route-critical-code";

beforeAll(() => loadNotebookCell());

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  call: vi.fn(),
  save: vi.fn(),
  add: vi.fn(),
  readProject: null as null | (() => typeof data),
  refetch: vi.fn(),
  agentOpen: false,
}));
vi.mock("@agent-native/core/client/agent-chat", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/agent-chat")
  >()),
  sendToAgentChatAndConfirm: vi.fn(),
}));
vi.mock(
  "@agent-native/core/client/agent-engine-readiness",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/client/agent-engine-readiness")
    >()),
    fetchAgentEngineConfiguredState: async () => "configured",
    getAgentEngineReadiness: () => "configured",
  }),
);
vi.mock(
  "@agent-native/core/client/application-state",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/client/application-state")
    >()),
    compareAndSetClientAppState: vi.fn(async () => {}),
  }),
);
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
      features: { canCreateProject: false },
    },
  }),
}));
vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentChatHome: () => null,
  AgentChatSurface: ({
    composerContextProvider: Context,
  }: {
    composerContextProvider: ComponentType<{
      threadId: string;
      isActive: boolean;
      children: (context: {
        contextItems: { key: string; title: string }[];
      }) => ReactNode;
    }>;
  }) => (
    <aside aria-label="Notebook agent">
      <Context threadId="thread" isActive>
        {({ contextItems }) =>
          contextItems.map(({ key, title }) => <span key={key}>{title}</span>)
        }
      </Context>
    </aside>
  ),
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  getBrowserTabId: () => "test-tab",
  actionErrorCode: () => null,
  actionErrorMessage: () => null,
  callAction: mocks.call,
  writeClientAppState: vi.fn(async () => {}),
  compareAndSetClientAppState: vi.fn(async () => {}),
  useActionMutation: (name: string) => ({
    mutateAsync:
      name === "save-project-cell"
        ? mocks.save
        : name === "add-project-cell"
          ? mocks.add
          : vi.fn(async () => ({})),
  }),
  useActionQuery: (name: string, params: object) => {
    const query = useQuery({
      queryKey: ["action", name, params],
      queryFn: () => mocks.readProject?.() ?? data,
      enabled: name === "get-project" && mocks.readProject !== null,
    });
    if (name === "list-data-statuses")
      return {
        data: { statuses: [], defaultStatusId: null },
        isPending: false,
        isError: false,
      };
    if (name === "list-project-categories")
      return {
        data: { categories: [], assignments: [] },
        isPending: false,
        isError: false,
      };
    if (name === "get-workspace-shell")
      return {
        data: { features: { isManagerOrAbove: false, isAdmin: false } },
        isPending: false,
        isError: false,
      };
    return name === "get-project"
      ? mocks.readProject
        ? query
        : { data, isPending: false, isError: false, refetch: mocks.refetch }
      : name === "get-notebook-execution"
        ? {
            data: projection,
            isPending: false,
            isError: false,
            refetch: mocks.refetch,
          }
        : {
            data: { connections: [], agentOpen: mocks.agentOpen },
            isPending: false,
            isError: false,
          };
  },
}));
const base = {
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
};
const input = {
  id: "input",
  contents: {
    ...base,
    id: "input",
    kind: "input",
    order: "a0",
    name: "Choice",
    inputType: "CHECKBOX",
    defaultValueString: "false",
    options: [],
    optional: false,
  },
};
const sql = {
  id: "sql",
  contents: {
    ...base,
    id: "sql",
    kind: "sql",
    order: "a1",
    source: "select {{ Choice }}",
    dataConnectionId: SAMPLE_DATA_SOURCE_ID,
    databaseSchema: null,
    resultVariable: null,
    outputResult: true,
  },
};
const project = {
  id: "project-1",
  ownerEmail: "qa@example.test",
  title: "Project",
  description: "",
  language: "python",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-09T00:00:00.000Z",
  collectionIds: [],
  cells: [input, sql],
  versions: [],
  workingVersionId: "v1",
  publishedVersionId: null,
};
const data = {
  project,
  outputs: {},
  queryStates: {},
  viewer: { email: "qa@example.test", orgId: "org" },
  canEdit: true,
  capabilities: [
    capabilityDecisionSchema.parse({
      controlId: ANALYTICS_CONTROL_IDS.runDraftSql,
      scope: {
        kind: "cell",
        workspaceId: "org",
        projectId: project.id,
        cellId: sql.id,
      },
      status: "allowed",
      target: { kind: "action", actionName: "run-project-cell" },
    }),
  ],
};

const initialResultId = "result-before-parameter-edit";
const projection = {
  status: "found",
  snapshot: {
    ref: {
      workspaceId: "org",
      projectId: "project-1",
      head: { versionId: "v1", revision: "0" },
      eventSeq: "0",
    },
    namespace: { kind: "draft", namespaceId: "ns" },
    inputRevision: "0",
    executionFingerprint: "signature",
  },
  activeRunIds: [],
  cells: {
    [sql.id]: {
      stale: true,
      resultId: initialResultId,
      attempt: null,
      finishedAt: null,
    },
  },
  reactivePending: false,
  defaultMode: "auto",
  autoRerun: false,
  settingsRevision: "0",
};

it("report A2-PARAMETER-SECOND-RUN lets a project editor without create-project permission dispatch again while refresh is held", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let accepted = projection;
  type FixtureRequest = { requestId: string };
  type FixtureReceipt = Awaited<ReturnType<typeof admit>>;
  const runs = new Map<string, FixtureReceipt>();
  const admit = (request: FixtureRequest) => ({
    status: "admitted",
    runId: request.requestId,
    request,
    plan: {
      admittedCellIds: [sql.id],
      dependencyResultIds: [],
      rejectedCells: [],
    },
    startedAt: "2026-11-18T00:00:00Z",
    attempts: [
      {
        attempt: { cellId: sql.id, attemptId: `attempt-${request.requestId}` },
        state: { status: "queued" },
      },
    ],
    cursor: "0",
  });
  mocks.run.mockReset().mockImplementation(async (request) => {
    const run = admit(request);
    runs.set(run.runId, run);
    return run;
  });
  mocks.call.mockReset().mockImplementation(async (action, input) => {
    if (action === "get-notebook-execution") return accepted;
    if (action === "start-notebook-run") return mocks.run(input);
    if (action === "get-notebook-result-page") {
      await held;
      return { status: "absent" };
    }
    if (action === "get-notebook-run") {
      const run = runs.get(input.runId);
      assert(run);
      return {
        status: "found",
        run,
        events: run.attempts.map(({ attempt }) => ({
          event: {
            type: "attempt",
            receipt: {
              attempt,
              state: { status: "complete", resultIds: ["result"] },
            },
          },
        })),
        nextCursor: "1",
        building: [],
      };
    }
    throw new Error(`Unexpected action: ${action}`);
  });
  mocks.refetch.mockReset().mockResolvedValue({ data });
  mocks.save.mockReset().mockImplementation(async ({ contents }) => {
    accepted = {
      ...projection,
      snapshot: {
        ...projection.snapshot,
        ref: {
          ...projection.snapshot.ref,
          head: { versionId: "v1", revision: "1" },
        },
        inputRevision: "1",
      },
    };
    return {
      project: {
        ...project,
        cells: [{ ...input, contents, updatedAt: "v2" }, sql],
      },
    };
  });
  const client = new QueryClient();
  client.setQueryData(
    ["action", "get-project", { projectId: "project-1" }],
    data,
  );
  vi.spyOn(client, "invalidateQueries").mockImplementation((filters) =>
    filters?.queryKey?.[1] === "get-workspace-activity"
      ? held
      : Promise.resolve(),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <QueryClientProvider client={client}>
            <MemoryRouter>
              <NotebookPage
                route={resolveRoute("/project/project-1/latest", {
                  authenticated: true,
                })}
              />
            </MemoryRouter>
          </QueryClientProvider>
        </AgentNativeI18nProvider>,
      ),
    );
    const editor = container.querySelector<HTMLElement>(
      '[data-notebook-cell="sql"] .cm-content',
    );
    const checkbox = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Choice"]',
    );
    assert(editor);
    assert(checkbox);
    expect(mocks.call).toHaveBeenCalledWith(
      "get-notebook-result-page",
      { resultId: initialResultId },
      expect.objectContaining({ method: "GET" }),
    );
    const run = () =>
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
        }),
      );
    await act(async () => run());
    expect(mocks.run).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(mocks.call).toHaveBeenCalledWith(
        "get-notebook-run",
        expect.objectContaining({ runId: [...runs.keys()][0] }),
        expect.objectContaining({ method: "GET" }),
      ),
    );
    await act(async () => {
      checkbox.click();
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        cellId: "input",
        contents: expect.objectContaining({ defaultValueString: "true" }),
      }),
    );
    await act(async () => run());
    expect(mocks.run).toHaveBeenCalledTimes(2);
    expect(mocks.run.mock.calls[1]?.[0]).toMatchObject({
      mode: "auto",
      targetCellId: sql.id,
      snapshot: { inputRevision: "1", ref: { head: { revision: "1" } } },
    });
    expect(mocks.run.mock.calls[1]?.[0].requestId).not.toBe(
      mocks.run.mock.calls[0]?.[0].requestId,
    );
  } finally {
    release();
    await act(async () => root.unmount());
    container.remove();
    client.clear();
    vi.unstubAllGlobals();
  }
});

it("lets a shared project editor run one cell from its Run mode menu", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  data.canEdit = false;
  mocks.save.mockClear();
  mocks.run.mockReset().mockImplementation(async (request) => ({
    status: "admitted",
    runId: request.requestId,
    request,
    plan: {
      admittedCellIds: [sql.id],
      rejectedCells: [],
      dependencyResultIds: [],
    },
    startedAt: "2026-11-18T00:00:00Z",
    attempts: [],
    cursor: "0",
  }));
  mocks.call.mockReset().mockImplementation(async (name, params) => {
    if (name === "start-notebook-run") return mocks.run(params);
    if (name === "get-notebook-execution") return projection;
    return { status: "absent" };
  });
  mocks.refetch.mockResolvedValue({ data });
  const client = new QueryClient();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <QueryClientProvider client={client}>
            <MemoryRouter>
              <NotebookPage
                route={resolveRoute("/project/project-1/latest", {
                  authenticated: true,
                })}
              />
            </MemoryRouter>
          </QueryClientProvider>
        </AgentNativeI18nProvider>,
      ),
    );
    const menu = host.querySelector<HTMLButtonElement>(
      '[data-notebook-cell="sql"] button[aria-label="Run mode"]',
    );
    assert(menu);
    await act(async () => {
      menu.focus();
      menu.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    const mode = document.querySelector<HTMLElement>(
      '[role="menuitem"][aria-label="Cell only"]',
    );
    assert(mode);
    await act(async () => mode.click());
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        mode: "cell-only",
        targetCellId: sql.id,
      }),
    );
    expect(
      host.querySelector('[data-notebook-cell="sql"] [contenteditable="true"]'),
    ).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    data.canEdit = true;
    vi.unstubAllGlobals();
  }
});

it("keeps focus and exact input debounce boundaries with the notebook agent open during menu exit", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let saved = data;
  mocks.agentOpen = true;
  mocks.readProject = () => saved;
  mocks.call
    .mockReset()
    .mockImplementation(async (name) =>
      name === "get-notebook-execution" ? projection : { status: "absent" },
    );
  mocks.add.mockReset().mockImplementation(async ({ inputType }) => {
    const id = `cell-${inputType}`;
    const created = {
      id,
      projectId: project.id,
      versionId: project.workingVersionId,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      contents: {
        ...input.contents,
        id,
        order: inputType === "NUMERIC_INPUT" ? "a2" : "a3",
        name: inputType === "NUMERIC_INPUT" ? "number_input" : "text_input",
        defaultValueString: inputType === "NUMERIC_INPUT" ? "0" : "",
        inputType,
      },
    };
    saved = {
      ...saved,
      project: { ...saved.project, cells: [...saved.project.cells, created] },
    };
    return { createdCellId: id, project: saved.project };
  });
  mocks.save.mockReset().mockImplementation(async ({ cellId, contents }) => {
    saved = {
      ...saved,
      project: {
        ...saved.project,
        cells: saved.project.cells.map((cell) =>
          cell.id === cellId ? { ...cell, updatedAt: "saved", contents } : cell,
        ),
      },
    };
    return { project: saved.project };
  });
  const client = new QueryClient();
  client.setQueryData(
    ["action", "get-project", { projectId: project.id }],
    data,
  );
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <QueryClientProvider client={client}>
            <MemoryRouter>
              <NotebookPage
                route={resolveRoute("/project/project-1/latest", {
                  authenticated: true,
                })}
              />
            </MemoryRouter>
          </QueryClientProvider>
        </AgentNativeI18nProvider>,
      ),
    );
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    assert(setValue);
    for (const [label, type, initial, value, delay] of [
      ["Number input", "number", "0", "7", 250],
      ["Text input", "text", "", "regional data", 2000],
    ] as const) {
      const before = host.querySelectorAll("[data-notebook-cell]").length;
      const trigger = [...host.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Inputs",
      );
      assert(trigger);
      await act(async () =>
        trigger.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            pointerType: "mouse",
          }),
        ),
      );
      const option = [
        ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ].find((item) => item.textContent?.trim() === label);
      assert(option);
      const menu = option.closest<HTMLElement>('[role="menu"]');
      assert(menu);
      menu.style.animationName = "exit";
      await act(async () => option.click());
      await act(async () => vi.advanceTimersByTimeAsync(0));
      const cells = [...host.querySelectorAll("[data-notebook-cell]")];
      expect(cells).toHaveLength(before + 1);
      const field = cells
        .at(-1)
        ?.querySelector<HTMLInputElement>(
          `input[type="${type}"][aria-label^="Value for "]`,
        );
      assert(field);
      expect(field.value).toBe(initial);
      const commits = mocks.save.mock.calls.length;
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      await act(async () => {
        field.select();
        field.focus();
        setValue.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(
        host.querySelector('[aria-label="Notebook agent"]')?.textContent,
      ).toContain(`${type}_input, accepted revision`);
      expect(menu.dataset.state).toBe("closed");
      await act(async () =>
        option.dispatchEvent(
          new PointerEvent("pointerout", {
            bubbles: true,
            pointerType: "mouse",
            relatedTarget: field,
          }),
        ),
      );
      await act(async () => vi.advanceTimersByTimeAsync(delay - 1));
      expect(document.activeElement).toBe(field);
      await act(async () => {
        const animationEnd = new Event("animationend", { bubbles: true });
        Object.defineProperty(animationEnd, "animationName", { value: "exit" });
        menu.dispatchEvent(animationEnd);
      });
      expect(mocks.save).toHaveBeenCalledTimes(commits);
      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(mocks.save).toHaveBeenCalledTimes(commits + 1);
      expect(saved.project.cells.at(-1)?.contents).toMatchObject({
        defaultValueString: value,
      });
    }
  } finally {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    mocks.readProject = null;
    mocks.agentOpen = false;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
