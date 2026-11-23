import { callAction } from "@agent-native/core/client/hooks";
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EditorView } from "@uiw/react-codemirror";
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import { i18nCatalog } from "@/i18n";
import type { ProjectDocument } from "@/lib/model/contracts";
import { resolveRoute } from "@/routes/routing/registry";

import "../notebook/NotebookCell";
import { ANALYTICS_CONTROL_IDS as ids } from "../../../shared/analytics-control-ids";
import {
  applyAppPatches,
  emptyAppLayout,
  type AppPatch,
} from "../../../shared/app-layout";
import {
  capabilityDecisionSchema,
  type CapabilityDecision,
  type ControlId,
} from "../../../shared/capabilities";
import type { RunRequest } from "../../../shared/notebook-execution";
import {
  draftHeadSchema,
  revisionSchema,
} from "../../../shared/notebook-snapshot-contract";
import { NotebookPage } from "./NotebookPage";

const emptyDatasetPage = { items: [], endCursor: null, hasNextPage: false };
const legacyRequestId = "00000000-0000-4000-8000-000000000001";

function executionProjection() {
  const project = mocks.project!;
  const cell = project.cells[0];
  const run = [...mocks.runs.values()].at(-1);
  const attempts = run?.attempts ?? [];
  return {
    status: "found",
    snapshot: {
      ref: {
        workspaceId: "org",
        projectId: project.id,
        head: project.draftHead ?? {
          versionId: project.workingVersionId,
          revision: "0",
        },
        eventSeq: "0",
      },
      namespace: { kind: "draft", namespaceId: "notebook-namespace" },
      inputRevision: "0",
      executionFingerprint:
        cell?.contents.kind === "sql" ? cell.contents.source : "empty",
    },
    activeRunIds:
      run && attempts.some(({ state }) => state.status === "running")
        ? [run.runId]
        : [],
    cells: Object.fromEntries(
      attempts.map((attempt) => [
        attempt.attempt.cellId,
        {
          attempt,
          stale: false,
          resultId: null,
          finishedAt: null,
        },
      ]),
    ),
    reactivePending: false,
    defaultMode: "auto",
    autoRerun: true,
    settingsRevision: "0",
  };
}

function runReceipt(request: RunRequest, status: "running" | "cancelled") {
  const cellId =
    "targetCellId" in request ? request.targetCellId : "cell-publish";
  return {
    status: "admitted",
    runId: request.requestId,
    request,
    plan: {
      admittedCellIds: [cellId],
      dependencyResultIds: [],
      rejectedCells: [],
    },
    startedAt: "2026-11-18T00:00:00Z",
    cursor: "1",
    attempts: [
      {
        attempt: {
          attemptId: "attempt-1",
          runId: request.requestId,
          cellId,
          namespaceId: "notebook-namespace",
          outputGeneration: "1",
        },
        state: { status },
      },
    ],
  };
}

function admittedRun(
  request: RunRequest,
  status: "running" | "cancelled" = "running",
) {
  const run = runReceipt(request, status);
  mocks.runs.set(run.runId, run);
  return run;
}

function publishedAppDecision(project: ProjectDocument) {
  return capabilityDecisionSchema.parse({
    controlId: ids.openPublishedApp,
    scope: {
      kind: "release",
      workspaceId: "org",
      projectId: project.id,
      releaseId: "latest",
    },
    ...(project.publishedVersionId === null
      ? { status: "unavailable", reason: "missing_backing" }
      : { status: "allowed", target: { kind: "route", routeId: "app" } }),
  });
}

function notebookCapabilities(
  project: ProjectDocument | null,
  canEdit: boolean,
) {
  if (!project) return [];
  const capabilities: CapabilityDecision[] = [
    publishedAppDecision(project),
    capabilityDecisionSchema.parse({
      controlId: ids.dataBrowse,
      scope: { kind: "workspace", workspaceId: "org" },
      status: "allowed",
      target: { kind: "route", routeId: "data-browser" },
    }),
  ];
  if (canEdit) {
    capabilities.push(
      capabilityDecisionSchema.parse({
        controlId: ids.editProject,
        scope: { kind: "project", workspaceId: "org", projectId: project.id },
        status: "allowed",
        target: { kind: "action", actionName: "update-project" },
      }),
    );
    for (const controlId of [ids.publishProject, ids.forcePublishProject]) {
      capabilities.push(
        capabilityDecisionSchema.parse({
          controlId,
          scope: { kind: "project", workspaceId: "org", projectId: project.id },
          status: "allowed",
          target: { kind: "action", actionName: "publish-project" },
        }),
      );
    }
    for (const cell of project.cells.filter(
      (cell) => cell.contents.kind === "sql",
    ))
      capabilities.push(
        capabilityDecisionSchema.parse({
          controlId: ids.runDraftSql,
          scope: {
            kind: "cell",
            workspaceId: "org",
            projectId: project.id,
            cellId: cell.id,
          },
          status: "allowed",
          target: { kind: "action", actionName: "run-project-cell" },
        }),
      );
  }
  return capabilities.map((capability) =>
    mocks.deniedControls.has(capability.controlId)
      ? capabilityDecisionSchema.parse({
          controlId: capability.controlId,
          scope: capability.scope,
          status: "denied",
          reason: "access_denied",
        })
      : capability,
  );
}

const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  createPreview: vi.fn(),
  cancelPreview: vi.fn(async () => ({ state: "cancelled" })),
  preview: null as object | null,
  previewState: "ready",
  setApp: vi.fn(),
  cancel: vi.fn(async () => ({ status: "cancelling" })),
  legacyRun: vi.fn(async () => {
    mocks.recovery = false;
    return {
      status: "complete",
      output: null,
      hasNextPage: false,
      totalRows: null,
    };
  }),
  run: vi.fn(async (request: RunRequest) => admittedRun(request)),
  cancelRun: vi.fn(async (input: { runId: string; cellId?: string }) => {
    const run = mocks.runs.get(input.runId);
    if (!run) throw new Error("Run unavailable");
    admittedRun(run.request, "cancelled");
    return { status: "cancelled", reason: "cancel_confirmed" };
  }),
  runs: new Map<string, ReturnType<typeof runReceipt>>(),
  canEdit: true,
  deniedControls: new Set<ControlId>(),
  refetchFails: false,
  save: vi.fn(async (_input: { contents: unknown }) => ({
    project: mocks.project!,
  })),
  touch: vi.fn(async () => ({})),
  project: null as ProjectDocument | null,
  recovery: false,
  stale: false,
  active: false,
  resume: false,
  queryStatesOverride: null as Record<string, unknown> | null,
  connectionReadError: false,
  connectionReadPending: false,
  selectedConnections: [] as {
    id: string;
    status: "available";
    name: string;
    type: string;
  }[],
  connections: [] as Array<{
    id: string;
    name: string;
    type: string;
    isDefault: boolean;
    isDraft: boolean;
  }>,
}));
vi.mock("react-router", async (original) => ({
  ...(await original<object>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("./WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: {
      workspace: { id: "org" },
      user: { email: "owner@example.test" },
      features: { canCreateProject: true },
    },
  }),
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    session: { email: "owner@example.test" },
    isLoading: false,
  }),
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: { orgId: "org" }, isPending: false, isError: false }),
}));
vi.mock("@/components/agent", () => ({
  NotebookAgentComposerSuppressed: () => null,
  WorkspaceAgent: () => null,
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const { useQuery } = await import("@tanstack/react-query");
  const { runActionQueryRead, useActionQueryCanFetch } =
    await importOriginal<typeof import("@agent-native/core/client/hooks")>();
  return {
    getBrowserTabId: () => "test-tab",
    actionErrorMessage: () => null,
    writeClientAppState: vi.fn(async () => {}),
    actionErrorCode: (error: { errorCode?: string } | null) => error?.errorCode,
    useActionQueryCanFetch,
    runActionQueryRead,
    callAction: vi.fn(async (name: string, input: unknown) => {
      if (name === "get-notebook-execution") return executionProjection();
      if (name === "list-notebook-history")
        return { items: [], nextCursor: null, canManageVersions: true };
      if (name === "get-notebook-snapshot") {
        const { projectId } = input as { projectId: string };
        if (mocks.project?.id !== projectId)
          throw new Error("Unexpected preview project");
        return {
          status: "accepted",
          snapshot: { head: mocks.project.draftHead },
        };
      }
      if (name === "start-notebook-run") return mocks.run(input as RunRequest);
      if (name === "get-notebook-run") {
        const run = mocks.runs.get((input as { runId: string }).runId);
        if (!run) throw new Error("Run unavailable");
        return {
          status: "found",
          run,
          events: run.attempts.map((receipt) => ({
            event: { type: "attempt", receipt },
          })),
          nextCursor: run.cursor,
          building: [],
        };
      }
      if (name === "cancel-notebook-run")
        return mocks.cancelRun(input as { runId: string; cellId?: string });
      throw new Error(`Unexpected action: ${name}`);
    }),
    useActionMutation: (name: string) => ({
      mutateAsync:
        name === "set-app"
          ? mocks.setApp
          : name === "cancel-project-cell"
            ? mocks.cancel
            : name === "run-project-cell"
              ? mocks.legacyRun
              : name === "publish-project"
                ? mocks.publish
                : name === "create-project-publish-preview"
                  ? mocks.createPreview
                  : name === "cancel-project-publish-preview"
                    ? mocks.cancelPreview
                    : name === "save-project-cell"
                      ? mocks.save
                      : mocks.touch,
    }),
    useActionQuery: (
      name: string,
      params: unknown,
      options?: {
        enabled?: boolean;
        queryKeyScope?: unknown[];
        onRequestStart?: () => unknown;
        onServerResult?: (
          result: unknown,
          metadata: { requestContext: unknown; persistAllowed: boolean },
        ) => void;
      },
    ) => {
      if (name === "get-workspace-shell")
        return {
          data: { features: { isManagerOrAbove: false, isAdmin: false } },
          isPending: false,
          isError: false,
        };
      if (name === "list-project-categories")
        return {
          data: { categories: [], assignments: [] },
          isPending: false,
          isError: false,
        };
      if (name === "list-data-connections" && mocks.connectionReadPending)
        return { data: undefined, isPending: true, isError: false };
      if (name === "list-data-connections" && mocks.connectionReadError)
        return {
          data: undefined,
          isPending: false,
          isError: true,
          error: new Error("Connection list unavailable"),
        };
      if (name === "list-connection-datasets")
        return {
          data: emptyDatasetPage,
          isPending: false,
          isError: false,
        };
      if (name === "get-notebook-execution")
        return useQuery({
          queryKey: ["action", name, params, ...(options?.queryKeyScope ?? [])],
          enabled: options?.enabled ?? true,
          initialData: executionProjection,
          queryFn: executionProjection,
          staleTime: Infinity,
        });
      if (name === "get-project-publish-preview")
        return {
          data: options?.enabled ? mocks.preview : undefined,
          isPending: !options?.enabled,
          isError: false,
          error: null,
        };
      if (name === "get-project")
        return useQuery({
          queryKey: ["action", name, params],
          initialData: {
            project: mocks.project,
            selectedConnections: mocks.selectedConnections,
            canEdit: mocks.canEdit,
            capabilities: notebookCapabilities(mocks.project, mocks.canEdit),
            viewer: { email: "owner@example.test", orgId: "org" },
            outputs:
              mocks.recovery || mocks.stale || mocks.active || mocks.resume
                ? {
                    "cell-publish": {
                      status: "running",
                      output: null,
                      ranAt: "2026-11-01",
                      sourceConnectionId: null,
                      connectionProvenanceRecorded: true,
                    },
                  }
                : {},
            queryStates:
              mocks.active || mocks.resume
                ? {
                    "cell-publish": {
                      status: "running",
                      busy: !mocks.resume,
                      hasNextPage: false,
                      totalRows: null,
                      requestId: legacyRequestId,
                    },
                  }
                : mocks.recovery
                  ? {
                      "cell-publish": {
                        status: "unavailable",
                        busy: false,
                        hasNextPage: false,
                        totalRows: null,
                      },
                    }
                  : {},
          },
          staleTime: Infinity,
          retry: false,
          queryFn: async () => {
            const requestContext = options?.onRequestStart?.();
            if (mocks.refetchFails) throw new Error("Readback unavailable");
            const data = {
              project: mocks.project,
              selectedConnections: mocks.selectedConnections,
              canEdit: mocks.canEdit,
              capabilities: notebookCapabilities(mocks.project, mocks.canEdit),
              viewer: { email: "owner@example.test", orgId: "org" },
              outputs: {},
              queryStates: mocks.queryStatesOverride ?? {},
            };
            options?.onServerResult?.(data, {
              requestContext,
              persistAllowed: false,
            });
            return data;
          },
        });
      return {
        isPending: false,
        isError: false,
        data: { connections: mocks.connections, versions: [] },
      };
    },
  };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.clearAllMocks();
  mocks.canEdit = true;
  mocks.publish.mockReset();
  mocks.setApp.mockReset();
  mocks.previewState = "ready";
  mocks.preview = null;
  mocks.deniedControls.clear();
  mocks.refetchFails = false;
  mocks.recovery = false;
  mocks.stale = false;
  mocks.active = false;
  mocks.resume = false;
  mocks.queryStatesOverride = null;
  mocks.connectionReadError = false;
  mocks.connectionReadPending = false;
  mocks.selectedConnections = [];
  mocks.connections = [];
  mocks.runs.clear();
  mocks.run
    .mockReset()
    .mockImplementation(async (request) => admittedRun(request));
  mocks.save
    .mockReset()
    .mockImplementation(async () => ({ project: mocks.project! }));
});

it("report A2-DEFAULT-SOURCE: shows a persisted source while the catalog is loading", async () => {
  mocks.connectionReadPending = true;
  mocks.selectedConnections = [
    {
      id: "warehouse",
      status: "available",
      name: "Warehouse",
      type: "bigquery",
    },
  ];
  const { container } = await mount(false, true, "warehouse");
  expect(
    container.querySelector('button[aria-label="Data connection: Warehouse"]'),
  ).not.toBeNull();
});

it.each([false, true])(
  "report 1794948257.991429: names the sample source when the connection list is empty or unavailable (error=%s)",
  async (connectionReadError) => {
    mocks.connectionReadError = connectionReadError;
    const { container } = await mount(false, true, "builtin-sample-data");
    const picker = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Data connection: [Demo] Public Data"]',
    );
    expect(picker).not.toBeNull();
    expect(
      container.querySelector(
        'button[aria-label="Data connection: Unknown connection"]',
      ),
    ).toBeNull();
    if (connectionReadError) {
      await act(async () => picker?.click());
      expect(document.body.textContent).toContain(
        "Couldn’t load workspace connections",
      );
    }
  },
);

it("keeps an unavailable warehouse distinct from the built-in sample", async () => {
  const { container } = await mount(false, true, "warehouse-missing");
  expect(
    container.querySelector(
      'button[aria-label="Data connection: Unknown connection"]',
    ),
  ).not.toBeNull();
});

it("offers connected and sample sources in the notebook Data browser", async () => {
  mocks.canEdit = false;
  mocks.connections = [
    {
      id: "draft",
      name: "Draft warehouse",
      type: "bigquery",
      isDefault: false,
      isDraft: true,
    },
    {
      id: "warehouse",
      name: "Warehouse",
      type: "bigquery",
      isDefault: false,
      isDraft: false,
    },
  ];
  const { container } = await mount();
  const openBrowser = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Data browser"]',
  );
  expect(openBrowser).not.toBeNull();
  await act(async () => openBrowser?.click());
  const source = container.querySelector<HTMLSelectElement>(
    'select[aria-label="Data connection"]',
  );
  expect(source?.value).toBe("warehouse");
  expect(
    Array.from(source?.options ?? [], (option) => option.textContent),
  ).toEqual(["Warehouse", "[Demo] Public Data"]);
});
function committedRelease(project: ProjectDocument, releaseId: string) {
  return {
    releaseId,
    releaseNumber: "1",
    head: project.draftHead,
    manifestId: "manifest-id",
    publishedAt: "2026-11-18T00:00:00Z",
    appHref: `/app/${project.id}/latest`,
    releaseHref: `/app/${project.id}/${releaseId}`,
  };
}

async function mount(
  published = false,
  withCell = false,
  connectionId: string | null = null,
  withAppLayout = false,
) {
  mocks.setApp.mockImplementation(
    async ({ changes: [change] }: { changes: [{ patches: AppPatch[] }] }) => {
      const project = mocks.project;
      if (!project?.draftHead) throw new Error("Missing layout project");
      const nextHead = draftHeadSchema.parse({
        ...project.draftHead,
        revision: String(BigInt(project.draftHead.revision) + 1n),
      });
      const current =
        project.appLayout ?? emptyAppLayout(revisionSchema.parse("0"));
      const appLayout = {
        ...applyAppPatches(current, change.patches, project.cells),
        revision: nextHead.revision,
      };
      mocks.project = { ...project, draftHead: nextHead, appLayout };
      return {
        status: "applied",
        nextHead,
        delta: {
          appLayout,
          cells: [],
          resources: { orderRevision: project.orderRevision },
        },
      };
    },
  );
  mocks.createPreview
    .mockReset()
    .mockImplementation(
      async (input: {
        projectId: string;
        expectedHead: unknown;
        expectedReleaseId: string | null;
      }) => {
        const project = mocks.project;
        if (!project || project.id !== input.projectId)
          throw new Error("Wrong preview project");
        const created = {
          previewId: crypto.randomUUID(),
          projectId: project.id,
          head: input.expectedHead,
          compareReleaseId: input.expectedReleaseId,
          runId: "preview-run",
          state: mocks.previewState,
          cursor: "1",
        };
        mocks.preview = {
          ...created,
          manifestRevision: "1",
          project,
          compared: null,
          diff: project.cells.map(({ id, contents }) => ({
            cellId: id,
            changes: ["added"],
            current: contents,
            previous: null,
          })),
          nextDiffCursor: null,
          outputs: [],
          run: null,
        };
        return created;
      },
    );
  mocks.project = {
    id: "project-publish",
    ownerEmail: "owner@example.test",
    title: "QA notebook",
    description: "",
    language: "python",
    statusId: null,
    favorited: false,
    trashedAt: null,
    archivedAt: null,
    lastOpenedAt: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    workingVersionId: "working",
    publishedVersionId: published ? "published" : null,
    cells: withCell
      ? [
          {
            id: "cell-publish",
            projectId: "project-publish",
            versionId: "working",
            createdAt: "2026-11-01T00:00:00.000Z",
            updatedAt: "2026-11-01T00:00:00.000Z",
            contents: {
              id: "cell-publish",
              order: "a0",
              kind: "sql",
              source: "select 1",
              dataConnectionId: connectionId,
              databaseSchema: null,
              resultVariable: null,
              outputResult: true,
              label: null,
              hidden: false,
              gridX: null,
              gridY: null,
              gridWidth: null,
              gridHeight: null,
            },
          },
        ]
      : [],
    collectionIds: [],
    draftHead: draftHeadSchema.parse({ versionId: "working", revision: "0" }),
    orderRevision: revisionSchema.parse("0"),
    ...(withAppLayout
      ? {
          appLayout: emptyAppLayout(revisionSchema.parse("0")),
        }
      : {}),
  };
  if (withAppLayout) {
    const cell = mocks.project.cells[0];
    if (cell) {
      mocks.project.cells = [
        {
          ...cell,
          contents: {
            id: cell.id,
            kind: "text",
            text: "Regional revenue",
            order: "a1",
            label: null,
            hidden: false,
            gridX: null,
            gridY: null,
            gridWidth: null,
            gridHeight: null,
          },
        },
      ];
    }
  }
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
  });
  const render = async (projectId = "project-publish", suffix = "") => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <AgentNativeI18nProvider
            catalog={i18nCatalog}
            persistPreference={false}
          >
            <TooltipProvider>
              <MemoryRouter>
                <NotebookPage
                  route={resolveRoute(`/project/${projectId}/latest${suffix}`, {
                    authenticated: true,
                  })}
                />
              </MemoryRouter>
            </TooltipProvider>
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      ),
    );
  };
  await render();
  invalidate.mockClear();
  return { container, invalidate, render, client };
}
function button(container: ParentNode, text: string) {
  const found = [...container.querySelectorAll("button")].find(
    (item) =>
      item.textContent?.trim() === text ||
      item.getAttribute("aria-label") === text,
  );
  expect(found, `button ${text}`).toBeDefined();
  return found!;
}
function cellButton(container: ParentNode, label: string) {
  const found = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"], button[aria-label^="${label} ·"]`,
  );
  expect(found, `button ${label}`).not.toBeNull();
  return found!;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}

it("hides notebook run, cell mutation and publish controls for a read-only project", async () => {
  mocks.canEdit = false;
  const { container } = await mount(false, true);
  expect(
    container.querySelector("pre.nb-cell-source.is-readonly")?.textContent,
  ).toContain("select 1");
  expect(container.querySelector('[data-rid="notebook.cell.run"]')).toBeNull();
  const buttons = [...container.querySelectorAll("button")];
  expect(buttons.map((item) => item.textContent?.trim())).not.toContain(
    "Run all",
  );
  expect(buttons.map((item) => item.textContent?.trim())).not.toContain(
    "Publish app",
  );
  expect(
    container.querySelector('[aria-label="More actions for SQL 1"]'),
  ).toBeNull();
});

it("uses scoped capability decisions for notebook controls and the direct builder URL", async () => {
  for (const id of [
    ids.runDraftSql,
    ids.openPublishedApp,
    ids.dataBrowse,
    ids.editProject,
  ])
    mocks.deniedControls.add(id);
  const { container, render } = await mount(true, true);
  expect(container.querySelector('[data-rid="notebook.cell.run"]')).toBeNull();
  expect(
    container.querySelector('a[href="/app/project-publish/latest"]'),
  ).toBeNull();
  expect(
    container.querySelector('button[aria-label="Data browser"]'),
  ).toBeNull();
  expect(
    [...container.querySelectorAll("button")].some(
      (item) => item.textContent === "Run all",
    ),
  ).toBe(false);
  await render("project-publish", "/app");
  expect(container.querySelector("[data-project-not-found]")).not.toBeNull();
});

it.each([true, false])(
  "links to the live app on first render when published is %s",
  async (published) => {
    const { container } = await mount(published);
    const link = [...container.querySelectorAll("header a")].find(
      (anchor) => anchor.textContent === "View app",
    );
    expect(link?.getAttribute("href")).toBe(
      published ? "/app/project-publish/latest" : undefined,
    );
  },
);

it.each([false, true])(
  "opens version history from the split Publish menu and links only to a live release (published=%s)",
  async (published) => {
    vi.mocked(callAction).mockClear();
    const { container } = await mount(published);
    await act(async () => {
      button(container, "Publish actions").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });

    const menuItems = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ];
    const live = menuItems.find(
      (item) => item.textContent.trim() === "View published app",
    );
    expect(live != null).toBe(published);
    expect(live?.getAttribute("href")).toBe(
      published ? "/app/project-publish/latest" : undefined,
    );
    const history = menuItems.find(
      (item) => item.textContent.trim() === "Version history",
    );
    expect(history).toBeDefined();
    expect(
      vi
        .mocked(callAction)
        .mock.calls.some(([name]) => name === "list-notebook-history"),
    ).toBe(false);
    if (history) await click(history);
    expect(
      container.querySelector('aside[aria-label="History & versions"]'),
    ).not.toBeNull();
    expect(callAction).toHaveBeenCalledWith(
      "list-notebook-history",
      { projectId: "project-publish", filter: "all" },
      expect.objectContaining({ method: "GET" }),
    );
    expect(mocks.createPreview).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
  },
);

it("publishes through the real notebook header, waits, refreshes and reflects the published state", async () => {
  let finish!: (value: unknown) => void;
  mocks.publish.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { container, invalidate, render } = await mount();
  await click(button(container, "Publish app"));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog).not.toBeNull();
  expect(mocks.publish).not.toHaveBeenCalled();
  const details = dialog.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(details, "Updated totals");
    details.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(button(dialog, "Publish app"));
  expect(mocks.publish).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      projectId: "project-publish",
      previewId: expect.any(String),
      expectedManifestRevision: "1",
      expectedReleaseId: null,
      mode: "ready",
      description: "Updated totals",
    }),
  );
  expect(button(dialog, "Publish app").disabled).toBe(true);
  expect(button(dialog, "Publish app").getAttribute("aria-busy")).toBe("true");
  expect(button(dialog, "Publish actions").disabled).toBe(true);
  await click(button(dialog, "Publish app"));
  expect(mocks.publish).toHaveBeenCalledTimes(1);
  await act(async () => {
    mocks.refetchFails = true;
    finish(committedRelease(mocks.project!, "published-1"));
  });
  await render();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(button(container, "Publish changes").disabled).toBe(true);
  const liveApp = container.querySelector(
    'a[href="/app/project-publish/latest"]',
  );
  expect(liveApp?.textContent).toContain("View app");
  expect(liveApp?.getAttribute("aria-label")).toBe("Go to live published app");
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ["action", "get-project"],
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ["action", "get-workspace-activity"],
  });
});

it.each(
  [
    {
      accepted: true,
      fromNotebook: false,
      name: "shows the acknowledged layout in App preview when opened during a layout save",
    },
    {
      accepted: false,
      fromNotebook: false,
      name: "rejects App preview when the held layout save conflicts",
    },
    {
      accepted: true,
      fromNotebook: true,
      name: "initializes the default layout before previewing a publish from the notebook",
    },
  ].map(
    ({ accepted, fromNotebook, name }) =>
      [name, accepted, fromNotebook] as const,
  ),
)("%s", async (_name, accepted, fromNotebook) => {
  const { container, render } = await mount(false, true, null, true);
  const initial = mocks.project?.appLayout;
  expect(initial).toBeDefined();
  if (!initial || !mocks.project) throw new Error("Missing project fixture");

  let acknowledge: (receipt: unknown) => void = () => {
    throw new Error("Layout write did not start");
  };
  let reject: (reason: Error) => void = acknowledge;
  mocks.setApp.mockImplementationOnce(
    () =>
      new Promise((resolve, rejectRequest) => {
        acknowledge = resolve;
        reject = rejectRequest;
      }),
  );
  expect(mocks.setApp).not.toHaveBeenCalled();
  if (!fromNotebook) await render("project-publish", "/app");
  expect(mocks.setApp).toHaveBeenCalledTimes(fromNotebook ? 0 : 1);
  await click(button(container, "Publish app"));
  expect(mocks.setApp).toHaveBeenCalledWith(
    expect.objectContaining({
      changes: [
        {
          type: "set-app",
          expectedLayoutRevision: "0",
          patches: [{ type: "initialize", includeExecutionOutputs: true }],
        },
      ],
    }),
  );
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  if (!dialog) throw new Error("Missing publish dialog");
  expect(button(dialog, "Running").disabled).toBe(true);
  expect(dialog.textContent).toContain("Preparing preview");
  expect(mocks.createPreview).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();

  if (!accepted) {
    await act(async () =>
      reject(
        Object.assign(new Error("Stale layout"), {
          errorCode: "notebook_conflict",
        }),
      ),
    );
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(
      "Stale layout",
    );
    expect(button(dialog, "Publish app").disabled).toBe(true);
    expect(mocks.publish).not.toHaveBeenCalled();
    return;
  }

  const layout = applyAppPatches(
    initial,
    [{ type: "initialize", includeExecutionOutputs: true }],
    mocks.project.cells,
  );
  mocks.project = {
    ...mocks.project,
    draftHead: draftHeadSchema.parse({ versionId: "working", revision: "1" }),
    appLayout: { ...layout, revision: revisionSchema.parse("1") },
  };
  await act(async () =>
    acknowledge({
      status: "applied",
      nextHead: { versionId: "working", revision: "1" },
      delta: {
        appLayout: { ...layout, revision: "1" },
        cells: [],
        resources: { orderRevision: "0" },
      },
    }),
  );
  expect(mocks.createPreview).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      expectedHead: { versionId: "working", revision: "1" },
    }),
  );
  const placed = dialog.querySelector("[data-app-element]");
  expect(placed?.getAttribute("data-app-interval")).toBe("0:120");
  expect(placed?.getAttribute("data-app-display")).toBe("output");
  expect(placed?.textContent).toContain("Regional revenue");
  expect(button(dialog, "Publish app").disabled).toBe(false);
  const builderOutput = container.querySelector("section[data-display=output]");
  expect(builderOutput?.textContent.includes("Regional revenue") ?? false).toBe(
    !fromNotebook,
  );
});

it("links to the live published app from the publish dialog when a version is live", async () => {
  const { container } = await mount(true, true);
  await editSource(container, "select 42");
  await click(button(container, "Publish changes"));
  const dialog = document.querySelector('[role="dialog"]')!;
  const live = dialog.querySelector('a[href="/app/project-publish/latest"]');
  expect(live?.textContent).toContain("View published app");
});

it("offers no live app link in the publish dialog before the first publish", async () => {
  const { container } = await mount(false, true);
  await click(button(container, "Publish app"));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector('a[href$="/latest"]')).toBeNull();
});

it("keeps version details on failure, allows retry, and supports cancelling without a write", async () => {
  mocks.publish
    .mockRejectedValueOnce(new Error("That project is not in this workspace."))
    .mockImplementationOnce(async () =>
      committedRelease(mocks.project!, "published-retry"),
    );
  const { container } = await mount(true);
  await click(button(container, "Publish changes"));
  await click(button(document.querySelector('[role="dialog"]')!, "Close"));
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(mocks.cancelPreview).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      createRequestId: expect.any(String),
      projectId: "project-publish",
    }),
  );
  await click(button(container, "Publish changes"));
  const dialog = document.querySelector('[role="dialog"]')!;
  const details = dialog.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(details, "Retry version");
    details.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(button(dialog, "Publish app"));
  expect(details.value).toBe("Retry version");
  expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(
    "That project is not in this workspace.",
  );
  expect(button(dialog, "Publish app").disabled).toBe(false);
  expect(container.querySelector('[role="status"]')).toBeNull();
  await click(button(dialog, "Publish app"));
  expect(mocks.publish).toHaveBeenCalledTimes(2);
  expect(mocks.publish).toHaveBeenLastCalledWith(
    expect.objectContaining({
      projectId: "project-publish",
      description: "Retry version",
    }),
  );
  expect(mocks.publish.mock.calls[1]?.[0].requestId).toBe(
    mocks.publish.mock.calls[0]?.[0].requestId,
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("cancels by create intent before the preview acknowledgement returns", async () => {
  const { container } = await mount();
  let finish: (value: unknown) => void = () => {
    throw new Error("Preview create did not start");
  };
  mocks.createPreview.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await click(button(container, "Publish app"));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(button(dialog, "Running").disabled).toBe(true);
  const request = mocks.createPreview.mock.calls[0]?.[0];
  await click(button(dialog, "Close"));
  expect(mocks.cancelPreview).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      projectId: request.projectId,
      createRequestId: request.requestId,
    }),
  );
  await act(async () => finish({ previewId: "late-preview" }));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.publish).not.toHaveBeenCalled();
});

it.each(["running", "failed"] as const)(
  "shows the %s preview's explicit publish control and Notebook diff",
  async (state) => {
    const { container } = await mount(false, true);
    mocks.previewState = state;
    mocks.publish.mockImplementation(async () =>
      committedRelease(mocks.project!, "published-override"),
    );
    await click(button(container, "Publish app"));
    const dialog = document.querySelector('[role="dialog"]')!;
    await act(async () =>
      button(dialog, "Notebook diff").dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      ),
    );
    expect(dialog.textContent).toContain("Added");
    await act(async () =>
      button(dialog, "Config").dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      ),
    );
    expect(dialog.textContent).toContain("cellType: SQL");
    if (state === "failed") {
      expect(dialog.textContent).toContain("Project errors");
      await click(button(dialog, "Publish with errors"));
    } else {
      expect(button(dialog, "Running").disabled).toBe(true);
      await act(async () => {
        button(dialog, "Publish actions").dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        );
      });
      const force = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((item) => item.textContent === "Force publish");
      expect(force).toBeDefined();
      if (force) await click(force);
    }
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        mode: state === "failed" ? "accept-errors" : "force",
      }),
    );
  },
);

it("offers Request review as a visible button in the publish dialog and copies a review link", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  const { container } = await mount(false, true);
  await click(button(container, "Publish app"));
  const dialog = document.querySelector('[role="dialog"]')!;
  await click(button(dialog, "Request review"));
  expect(writeText).toHaveBeenCalledOnce();
  expect(mocks.publish).not.toHaveBeenCalled();
});

async function editSource(container: HTMLElement, value: string) {
  const input = container.querySelector<HTMLElement>(".cm-content");
  expect(input).not.toBeNull();
  if (!input) throw new Error("SQL editor missing");
  const editor = EditorView.findFromDOM(input);
  if (!editor) throw new Error("SQL editor view missing");
  await act(async () => {
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
    });
  });
}

it.each([false, true])(
  "saves the latest cell before publishing, with an existing autosave=%s",
  async (alreadySaving) => {
    let finishSave!: () => void;
    mocks.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = () => resolve({ project: mocks.project! });
        }),
    );
    mocks.publish.mockImplementation(async () =>
      committedRelease(mocks.project!, "published-saved"),
    );
    const { container } = await mount(false, true);
    await editSource(container, "select 42");
    if (alreadySaving) {
      await act(async () => {
        await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
      });
    }
    await click(button(container, "Publish app"));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.createPreview).not.toHaveBeenCalled();
    expect(button(dialog, "Running").disabled).toBe(true);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        projectId: "project-publish",
        cellId: "cell-publish",
        contents: expect.objectContaining({ source: "select 42" }),
      }),
    );
    await act(async () => {
      finishSave();
    });
    expect(mocks.createPreview).toHaveBeenCalledTimes(1);
    await click(button(dialog, "Publish app"));
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        projectId: "project-publish",
        mode: "ready",
      }),
    );
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  },
);

it("keeps the dialog and draft on save failure and retries the save before publishing", async () => {
  const { container } = await mount(false, true);
  mocks.save
    .mockRejectedValueOnce(new Error("Save unavailable"))
    .mockImplementation(async () => ({ project: mocks.project! }));
  mocks.publish.mockImplementation(async () =>
    committedRelease(mocks.project!, "published-retried"),
  );
  await editSource(container, "select 99");
  await click(button(container, "Publish app"));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(dialog.querySelector('[role="alert"]')?.textContent).toBe(
    "Save unavailable",
  );
  expect(container.querySelector<HTMLElement>(".cm-content")?.textContent).toBe(
    "select 99",
  );
  await click(button(dialog, "Restart and run all"));
  await click(
    button(document.querySelector('[role="dialog"]')!, "Publish app"),
  );
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(mocks.publish).toHaveBeenCalledTimes(1);
});

it("keeps an old project completion from closing another project's dialog or showing its success", async () => {
  let finish!: (value: unknown) => void;
  mocks.publish.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { container, render, client } = await mount();
  const first = mocks.project!;
  await click(button(container, "Publish app"));
  await click(
    button(document.querySelector('[role="dialog"]')!, "Publish app"),
  );
  mocks.project = { ...first, id: "project-next" };
  await render("project-next");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click(button(container, "Publish app"));
  const nextDialog = document.querySelector('[role="dialog"]');
  mocks.refetchFails = true;
  await act(async () => {
    finish(committedRelease(first, "published-first"));
  });
  expect(document.querySelector('[role="dialog"]')).toBe(nextDialog);
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(button(container, "Publish app")).toBeDefined();
  expect(
    client.getQueryData([
      "action",
      "get-project",
      { projectId: "project-publish" },
    ]),
  ).toMatchObject({ project: { publishedVersionId: "published-first" } });
  expect(
    client.getQueryData([
      "action",
      "get-project",
      { projectId: "project-next" },
    ]),
  ).toMatchObject({ project: { publishedVersionId: null } });
});

it("keeps publication locked when navigating away and back before completion", async () => {
  let finish!: (value: unknown) => void;
  mocks.publish.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { container, render } = await mount();
  const first = mocks.project!;
  await click(button(container, "Publish app"));
  await click(
    button(document.querySelector('[role="dialog"]')!, "Publish app"),
  );
  mocks.project = { ...first, id: "project-next" };
  await render("project-next");
  mocks.project = first;
  await render();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(button(container, "Publish app").disabled).toBe(true);
  expect(button(container, "Publish app").getAttribute("aria-busy")).toBe(
    "true",
  );
  expect(mocks.publish).toHaveBeenCalledTimes(1);
  mocks.refetchFails = true;
  await act(async () => {
    finish(committedRelease(first, "published-return"));
  });
  expect(button(container, "Publish changes").disabled).toBe(true);
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it("uses the just-saved SQL snapshot when running immediately after an edit", async () => {
  mocks.save.mockImplementationOnce(async ({ contents }) => {
    const project = mocks.project!;
    const cell = project.cells[0]!;
    mocks.project = {
      ...project,
      draftHead: draftHeadSchema.parse({ versionId: "working", revision: "1" }),
      cells: [{ ...cell, contents: contents as typeof cell.contents }],
    };
    return { project: mocks.project };
  });
  const { container } = await mount(false, true, "warehouse");
  await editSource(container, "select 42");
  await click(cellButton(container, "Run SQL 1"));
  await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
  expect(mocks.run).toHaveBeenCalledWith(
    expect.objectContaining({
      targetCellId: "cell-publish",
      snapshot: expect.objectContaining({
        executionFingerprint: "select 42",
        ref: expect.objectContaining({
          head: { versionId: "working", revision: "1" },
        }),
      }),
    }),
  );
  const requestId = mocks.run.mock.calls[0]?.[0].requestId;
  await click(cellButton(container, "Stop SQL 1"));
  expect(mocks.cancelRun).toHaveBeenCalledExactlyOnceWith({
    runId: requestId,
    cellId: "cell-publish",
  });
  expect(mocks.legacyRun).not.toHaveBeenCalled();
  expect(mocks.cancel).not.toHaveBeenCalled();
});

it("report A2-STALE-RUN-PUBLICATION: shows an actionable recovery notice for an unavailable legacy cell run", async () => {
  mocks.recovery = true;
  const { container } = await mount(false, true);
  const alert = container.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("SQL 1");
  expect(alert?.textContent).toMatch(/run each cell again/i);
  const run = cellButton(container, "Run SQL 1");
  expect(run.disabled).toBe(false);
  await click(run);
  await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
  expect(mocks.legacyRun).not.toHaveBeenCalled();
  await vi.waitFor(() =>
    expect(container.querySelector('[role="alert"]')).toBeNull(),
  );
});

it("report A2-STALE-RUN-PUBLICATION: a stale running output after editing permits rerun", async () => {
  mocks.stale = true;
  const { container } = await mount(false, true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "SQL 1",
  );
  const run = cellButton(container, "Run SQL 1");
  expect(run.disabled).toBe(false);
  await click(run);
  await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
  expect(mocks.legacyRun).not.toHaveBeenCalled();
});

it("report A2-STALE-RUN-PUBLICATION: a current legacy warehouse run can still be stopped", async () => {
  mocks.active = true;
  const { container } = await mount(false, true, "warehouse");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('button[aria-label="Run SQL 1"]')).toBeNull();
  const stop = cellButton(container, "Stop SQL 1");
  expect(stop.disabled).toBe(false);
  await click(stop);
  expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith({
    projectId: "project-publish",
    cellId: "cell-publish",
    requestId: legacyRequestId,
  });
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.cancelRun).not.toHaveBeenCalled();
});

it("polls an unfinished saved warehouse job without admitting a new run", async () => {
  mocks.resume = true;
  mocks.queryStatesOverride = {
    "cell-publish": {
      status: "running",
      busy: false,
      hasNextPage: false,
      totalRows: null,
      requestId: legacyRequestId,
    },
  };
  await mount(false, true, "warehouse");
  await vi.waitFor(
    () =>
      expect(mocks.legacyRun).toHaveBeenCalledExactlyOnceWith({
        projectId: "project-publish",
        cellId: "cell-publish",
        requestId: legacyRequestId,
        operation: "poll",
      }),
    { timeout: 3000 },
  );
  expect(mocks.run).not.toHaveBeenCalled();
});

it.each([null, "builtin-sample-data", "warehouse"])(
  "offers Stop only after the server admits the new run on %s",
  async (connectionId) => {
    let finish: (run: ReturnType<typeof admittedRun>) => void = () => {
      throw new Error("Run was not started");
    };
    mocks.run.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { container } = await mount(false, true, connectionId);
    await click(cellButton(container, "Run SQL 1"));
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    expect(
      container.querySelector('button[aria-label="Stop SQL 1"]'),
    ).toBeNull();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.cancelRun).not.toHaveBeenCalled();
    const request = mocks.run.mock.calls[0]?.[0];
    if (!request) throw new Error("Run was not started");
    await act(async () => finish(admittedRun(request)));
    await click(cellButton(container, "Stop SQL 1"));
    expect(mocks.cancelRun).toHaveBeenCalledExactlyOnceWith({
      runId: request.requestId,
      cellId: "cell-publish",
    });
    expect(mocks.cancel).not.toHaveBeenCalled();
  },
);

it.each([
  { initial: null, changed: "warehouse" },
  { initial: "warehouse", changed: "builtin-sample-data" },
])(
  "keeps the run ID pinned when selection changes from $initial to $changed",
  async ({ initial, changed }) => {
    const { container, client } = await mount(false, true, initial);
    await click(cellButton(container, "Run SQL 1"));
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    const requestId = mocks.run.mock.calls[0]?.[0].requestId;
    const key = ["action", "get-project", { projectId: "project-publish" }];
    await act(async () => {
      const data = client.getQueryData<{
        project: ProjectDocument;
        outputs: object;
        queryStates: object;
      }>(key);
      if (!data) throw new Error("Project query missing");
      const cell = data.project.cells[0];
      if (!cell || cell.contents.kind !== "sql")
        throw new Error("SQL cell missing");
      mocks.project = {
        ...data.project,
        cells: [
          {
            ...cell,
            contents: { ...cell.contents, dataConnectionId: changed },
          },
        ],
      };
      client.setQueryData(key, {
        ...data,
        project: mocks.project,
        queryStates: {
          "cell-publish": {
            status: "running",
            busy: true,
            hasNextPage: false,
            totalRows: null,
            requestId: legacyRequestId,
          },
        },
      });
    });
    await click(cellButton(container, "Stop SQL 1"));
    expect(mocks.cancelRun).toHaveBeenCalledExactlyOnceWith({
      runId: requestId,
      cellId: "cell-publish",
    });
    expect(mocks.cancel).not.toHaveBeenCalled();
  },
);

it.each([false, true])(
  "keeps stale legacy warehouse state from stopping a demo cell (busy=%s)",
  async (busy) => {
    mocks.active = busy;
    mocks.resume = !busy;
    const { container } = await mount(false, true, "builtin-sample-data");
    expect(
      container.querySelector('button[aria-label="Stop SQL 1"]'),
    ).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "SQL 1",
    );
    expect(mocks.legacyRun).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  },
);
