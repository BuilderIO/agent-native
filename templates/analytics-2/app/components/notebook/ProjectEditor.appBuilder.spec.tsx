// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { assert, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";
import { cellSchema } from "@/lib/model/contracts";

import { applyAppPatches, emptyAppLayout } from "../../../shared/app-layout";
import { executionSnapshotSchema } from "../../../shared/notebook-execution";
import { revisionSchema } from "../../../shared/notebook-snapshot-contract";
import { ProjectEditor } from "./ProjectEditor";
import { useNotebookRun } from "./useNotebookRun";

const { callAction, readExecution } = vi.hoisted(() => ({
  callAction: vi.fn(),
  readExecution: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorCode: () => null,
  actionErrorMessage: () => null,
  callAction,
  getBrowserTabId: () => "test-tab",
  useActionQuery: (name: string) => ({
    data: name === "get-notebook-execution" ? readExecution() : undefined,
    isPending: false,
    refetch: readExecution,
  }),
  writeClientAppState: vi.fn(async () => {}),
}));

vi.mock("@/lib/desktop-notifications", () => ({
  useDesktopNotificationsEnabled: () => false,
  notifyRunFinished: vi.fn(),
}));

vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({ session: null }),
}));

const projectId = "prj_builder_chart";
const versionId = "ver_builder_chart";
const workspaceId = "ws_builder_chart";
const sourceId = "cel_builder_source";
const chartId = "cel_builder_chart";
const now = "2026-11-01T00:00:00.000Z";
const cellBase = {
  projectId,
  versionId,
  createdAt: now,
  updatedAt: now,
};
const contentsBase = {
  label: null,
  hidden: false,
  gridX: null,
  gridY: null,
  gridWidth: null,
  gridHeight: null,
};
const source = cellSchema.parse({
  ...cellBase,
  id: sourceId,
  contents: {
    ...contentsBase,
    id: sourceId,
    order: "a1",
    kind: "sql",
    label: "Revenue query",
    source: "select 42 as amount, 'North' as region",
    dataConnectionId: null,
    databaseSchema: null,
    resultVariable: "revenue",
    outputResult: true,
  },
});
const chart = cellSchema.parse({
  ...cellBase,
  id: chartId,
  contents: {
    ...contentsBase,
    id: chartId,
    order: "a2",
    kind: "chart",
    label: "Revenue chart",
    dataframe: "revenue",
    chartSpec: {
      mark: "bar",
      xField: "region",
      yField: "amount",
      seriesField: null,
      title: null,
    },
  },
});
const snapshot = executionSnapshotSchema.parse({
  ref: {
    workspaceId,
    projectId,
    head: { versionId, revision: "1" },
    eventSeq: "1",
  },
  namespace: { kind: "draft", namespaceId: "ns_builder_chart" },
  inputRevision: "0",
  executionFingerprint: "builder-chart",
});

function Fixture({
  cells,
  uninitialized = false,
  onAskDataQuestion,
}: {
  cells: (typeof source | typeof chart)[];
  uninitialized?: boolean;
  onAskDataQuestion?: (question: string) => Promise<void> | void;
}) {
  const execution = useNotebookRun({
    projectId,
    workspaceId,
    workingVersionId: versionId,
    identity: projectId,
    enabled: true,
    hasKernelCells: () => false,
  });
  const document = applyAppPatches(
    emptyAppLayout(revisionSchema.parse("0")),
    uninitialized ? [] : [{ type: "initialize" }],
    cells,
  );
  return (
    <ProjectEditor
      view="app"
      project={{
        id: projectId,
        title: "Revenue",
        ownerEmail: "test@workspace.test",
        description: "",
        language: "python",
        favorited: false,
        statusId: null,
        trashedAt: null,
        archivedAt: null,
        lastOpenedAt: null,
        createdAt: now,
        updatedAt: now,
        workingVersionId: versionId,
        publishedVersionId: null,
        cells,
        collectionIds: [],
      }}
      appLayout={{
        document,
        bookmark: null,
        saving: false,
        selectTab: () => {},
        commit: async () => document,
        insert: async () => document,
        pendingWrite: () => undefined,
      }}
      connections={[]}
      onRename={async () => {}}
      onSaveCell={async () => {}}
      onAddCell={async () => "cel_new"}
      onDeleteCell={async () => {}}
      onSelectConnection={async () => {}}
      execution={execution}
      {...(onAskDataQuestion ? { emptyState: { onAskDataQuestion } } : {})}
    />
  );
}

it("runs the chart's producer through notebook admission and reports the action failure in the chart tile", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const read = {
    status: "found",
    snapshot,
    defaultMode: "auto",
    autoRerun: true,
    activeRunIds: [],
  };
  readExecution.mockReturnValue(read);
  callAction.mockImplementation(async (name: string) => {
    if (name === "get-notebook-execution") return read;
    if (name === "start-notebook-run") {
      return { status: "rejected", reason: "unsupported_request" };
    }
    throw new Error(`Unexpected action ${name}`);
  });
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <AgentNativeI18nProvider catalog={{ messages: enUS }}>
            <MemoryRouter>
              <TooltipProvider>
                <Fixture cells={[source, chart]} />
              </TooltipProvider>
            </MemoryRouter>
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      ),
    );
    const tile = container.querySelector('section[aria-label="Revenue chart"]');
    assert(tile);
    const run = tile.querySelector<HTMLButtonElement>(
      'button[aria-label="Run Revenue query"]',
    );
    assert(run);
    expect(run.disabled).toBe(false);
    await act(async () => run.click());
    expect(callAction).toHaveBeenCalledWith(
      "start-notebook-run",
      {
        requestId: expect.any(String),
        snapshot,
        mode: "auto",
        cache: "reuse",
        targetCellId: sourceId,
        staleValues: "allow-compatible",
      },
      { uiOnly: true, keepalive: false },
    );
    expect(tile.querySelector('[role="alert"]')?.textContent).toBe(
      enUS.queryError.title,
    );
    expect(run.disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("shows the App builder type chooser, not the notebook empty state, for an empty project", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  readExecution.mockReturnValue({ status: "unavailable" });
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <AgentNativeI18nProvider catalog={{ messages: enUS }}>
            <MemoryRouter>
              <TooltipProvider>
                <Fixture cells={[]} uninitialized />
              </TooltipProvider>
            </MemoryRouter>
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      ),
    );
    expect(
      container.querySelector('[role="group"][aria-label="APP TYPE"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Generative app");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("sends the Generative app choice to the agent through the project's question handoff", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onAskDataQuestion = vi.fn(async () => {});
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <AgentNativeI18nProvider catalog={{ messages: enUS }}>
            <MemoryRouter>
              <TooltipProvider>
                <Fixture
                  cells={[]}
                  uninitialized
                  onAskDataQuestion={onAskDataQuestion}
                />
              </TooltipProvider>
            </MemoryRouter>
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      ),
    );
    const generate = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Generate with the agent",
    );
    assert(generate);
    await act(async () => generate.click());
    expect(onAskDataQuestion).toHaveBeenCalledWith(
      expect.stringContaining("generative app"),
    );
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
    vi.unstubAllGlobals();
  }
});
