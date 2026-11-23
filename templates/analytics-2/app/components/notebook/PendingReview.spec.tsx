// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Link, MemoryRouter } from "react-router";
import { assert, beforeAll, expect, it, vi } from "vitest";

import { WorkspaceAgent } from "@/components/agent";
import { agentScope } from "@/components/agent/scope";
import { i18nCatalog } from "@/i18n";
import type {
  Cell,
  CellContents,
  ProjectDocument,
} from "@/lib/model/contracts";

import { draftHeadSchema } from "../../../shared/notebook-snapshot-contract";
import { loadNotebookCell } from "../workspace/route-critical-code";
import { CellOutputView } from "./CellOutputView";
import { PendingChangeCard, NotebookReviewContext } from "./PendingChangeCard";
import { ProjectEditor } from "./ProjectEditor";
import { useNotebookAgentReview } from "./useNotebookAgentReview";

beforeAll(() => loadNotebookCell());

const projectId = "project-review";
const orgId = "workspace-review";
const threadId = "thread-first";
const at = "2026-11-01T00:00:00.000Z";
const head = draftHeadSchema.parse({
  versionId: "version-review",
  revision: "7",
});
const baseline = {
  id: "cell-baseline",
  projectId,
  versionId: head.versionId,
  createdAt: at,
  updatedAt: at,
  contents: {
    id: "cell-baseline",
    kind: "sql",
    order: "a1",
    source: "SELECT 42",
    label: "Baseline query",
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    dataConnectionId: null,
    databaseSchema: null,
    resultVariable: null,
    outputResult: true,
  },
} satisfies Cell;
const project: ProjectDocument = {
  id: projectId,
  title: "Review notebook",
  description: "",
  language: "python",
  ownerEmail: "editor@example.test",
  statusId: null,
  favorited: false,
  trashedAt: null,
  archivedAt: null,
  lastOpenedAt: null,
  createdAt: at,
  updatedAt: at,
  collectionIds: [],
  cells: [baseline],
  workingVersionId: head.versionId,
  publishedVersionId: null,
};
const resources = {
  orderRevision: "0",
  metadataRevision: "0",
  inputRevision: "0",
  layoutRevision: "0",
};
const before = { ...baseline, revision: "7", labelRevision: "1" };

function delta(id: string, contents: CellContents) {
  return {
    cells: [{ ...before, id, contents: { ...contents, id } }],
    tombstones: [],
    resources,
  };
}

const proposal = {
  id: "proposal-first",
  cellId: baseline.id,
  kind: "edit",
  before: { cells: [before], tombstones: [], resources },
  after: {
    cells: [
      { ...before, contents: { ...before.contents, source: "SELECT 13042" } },
    ],
    tombstones: [],
    resources,
  },
  dependsOn: [],
  runId: null,
  resultIds: [],
};

function Fixture({ repair, card }: { repair?: boolean; card?: boolean }) {
  const state = useNotebookAgentReview({
    projectId,
    identity: orgId,
    head,
    editable: true,
    agentOpen: !!repair,
    refreshAccepted: async () => {},
  });
  return (
    <>
      <Link to="?threadId=thread-second">Switch thread</Link>
      <Link to="?">Leave thread</Link>
      {repair ? (
        <>
          <CellOutputView
            output={{
              type: "error",
              message: "Unrecognized name: missing",
              detail: null,
            }}
            queryError
            onFixWithAgent={() => void state.fix(baseline.id, "failed-attempt")}
          />
          <WorkspaceAgent
            mode="notebook"
            orgId={orgId}
            projectId={projectId}
            threadId={state.threadId}
            notebook={state.notebook}
          />
        </>
      ) : (
        <ProjectEditor
          project={project}
          agentOpen={false}
          connections={[]}
          onRename={async () => {}}
          onSaveCell={async () => {}}
          onAddCell={async () => "new-cell"}
          onDeleteCell={async () => {}}
          onSelectConnection={async () => {}}
          review={state.notebook.review}
        />
      )}
      {card && (
        <NotebookReviewContext.Provider value={state.notebook.review}>
          <PendingChangeCard
            context={{
              toolName: "save-project-cell",
              args: {},
              resultJson: { proposalIds: [proposal.id], threadId },
              isRunning: false,
            }}
          />
        </NotebookReviewContext.Provider>
      )}
    </>
  );
}

function mount(
  status: "pending" | "undone",
  ui: React.ReactNode,
  proposals: Array<
    Omit<typeof proposal, "before" | "after"> & {
      before: ReturnType<typeof delta> | null;
      after: ReturnType<typeof delta> | null;
    }
  > = [proposal],
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const repair = vi.fn();
  const runs = vi.fn();
  const requests = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      );
      const path = url.pathname;
      if (path.endsWith("/application-state") && init?.method === "POST") {
        const { writes } = JSON.parse(String(init.body)) as {
          writes: { value?: unknown }[];
        };
        return Response.json({
          results: writes.map(({ value }) => ({
            ok: true,
            value: value ?? null,
          })),
        });
      }
      if (path.includes("/application-state/") && init?.method === "PATCH")
        return Response.json({ changed: true });
      if (path.endsWith("/actions/list-data-statuses"))
        return Response.json({ statuses: [], defaultStatusId: null });
      if (path.endsWith("/actions/list-project-categories"))
        return Response.json({ categories: [], assignments: [] });
      if (path.endsWith("/actions/get-workspace-shell"))
        return Response.json({
          features: { isManagerOrAbove: false, isAdmin: false },
        });
      if (path.endsWith("/actions/get-notebook-pending-changes")) {
        const matching = url.searchParams.get("threadId") === threadId;
        return Response.json({
          bindingId: matching ? "bind-first" : "bind-second",
          acceptedHead: head,
          overlayRevision: "1",
          cursor: "1",
          reviewedSetDigest: "0".repeat(64),
          changes: matching
            ? proposals.map((change) => ({ ...change, status }))
            : [],
          hasMore: false,
          reset: false,
        });
      }
      if (path.endsWith("/actions/list-notebook-threads"))
        return Response.json({
          threads: [{ id: threadId, title: "Review thread" }],
        });
      if (path.endsWith("/actions/get-notebook-repair-context")) {
        repair(Object.fromEntries(url.searchParams));
        return Response.json({
          cellId: baseline.id,
          cellLabel: "Baseline query",
          prompt:
            "Verify, fix, and give a concise explanation about the following error in @Baseline query\n\nUnrecognized name: missing",
        });
      }
      if (path.endsWith("/auth/session")) {
        return Response.json({
          email: project.ownerEmail,
          userId: "editor",
          orgId,
        });
      }
      if (path.endsWith("/threads")) return Response.json({ threads: [] });
      if (path.endsWith("/threads/" + threadId))
        return Response.json({
          id: threadId,
          scope: agentScope(orgId),
          threadData: JSON.stringify({
            messages: [
              {
                message: {
                  id: "old-message",
                  role: "user",
                  content: [{ type: "text", text: "Review this notebook" }],
                },
              },
            ],
          }),
        });
      if (init?.method === "POST" && /runs|messages|chat/.test(path))
        runs(path);
      if (path.endsWith("/actions/get-agentkit-capabilities"))
        return Response.json({
          sources: { figma: { available: false } },
          integrations: [],
        });
      return Response.json({ active: false, models: [], engines: [] });
    },
  );
  vi.stubGlobal("fetch", requests);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  return {
    host,
    repair,
    runs,
    render: () =>
      act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <AgentNativeI18nProvider
              catalog={i18nCatalog}
              persistPreference={false}
            >
              <MemoryRouter
                initialEntries={[
                  `/project/${projectId}?notebookThread=${threadId}`,
                ]}
              >
                {ui}
              </MemoryRouter>
            </AgentNativeI18nProvider>
          </QueryClientProvider>,
        ),
      ),
    dispose: async () => {
      await act(async () => root.unmount());
      client.clear();
      host.remove();
      localStorage.clear();
      vi.unstubAllGlobals();
    },
  };
}

it("shows the bound thread's SQL diff and restores accepted source on thread switch", async () => {
  const page = mount("pending", <Fixture />);
  try {
    await page.render();
    await vi.waitFor(() =>
      expect(
        page.host.querySelector("[data-notebook-proposal]")?.textContent,
      ).toContain("SELECT 13042"),
    );
    expect(page.host.textContent).toContain("1/1 pending");
    expect(page.host.textContent).toContain("SELECT 42");
    const review = page.host.querySelector<HTMLButtonElement>(
      'button[aria-label="View pending changes"]',
    );
    const proposalHeading = page.host.querySelector(
      "[data-notebook-proposal-heading]",
    );
    assert(review && proposalHeading);
    expect(review.getAttribute("aria-keyshortcuts")).toBe("Alt+K");
    await act(async () => review.click());
    expect(document.activeElement).toBe(proposalHeading);
    await act(async () => review.focus());
    await act(async () => {
      review.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "KeyK",
          altKey: true,
          bubbles: true,
        }),
      );
    });
    expect(document.activeElement).toBe(proposalHeading);
    const other = [...page.host.querySelectorAll("a")].find(
      (link) => link.textContent === "Switch thread",
    );
    assert(other);
    await act(async () => other.click());
    expect(page.host.textContent).not.toContain("SELECT 13042");
    await vi.waitFor(() =>
      expect(page.host.textContent).toContain("No pending changes."),
    );
    expect(page.host.textContent).not.toContain("SELECT 13042");
    expect(page.host.textContent).toContain("SELECT 42");
    const leave = [...page.host.querySelectorAll("a")].find(
      (link) => link.textContent === "Leave thread",
    );
    assert(leave);
    await act(async () => leave.click());
    expect(page.host.textContent).not.toContain("No pending changes.");
    expect(page.host.textContent).toContain("SELECT 42");
  } finally {
    await page.dispose();
  }
});

it("restores an undone chat reference as struck text after remount", async () => {
  const page = mount("undone", <Fixture card />);
  try {
    await page.render();
    await vi.waitFor(() =>
      expect(page.host.querySelector("del")?.textContent).toBe(
        "Baseline query",
      ),
    );
    expect(page.host.textContent).toContain("Undone");
    expect(page.host.querySelector("[data-notebook-proposal]")).toBeNull();
  } finally {
    await page.dispose();
  }
});

it("reviews chart field changes, rendered markdown and human-readable input settings", async () => {
  const { source: _source, ...base } = baseline.contents;
  const chartSpec = {
    mark: "line",
    xField: "date-id",
    yField: "net-id",
    xTimeUnit: "month",
    yAggregation: "sum",
    seriesField: null,
    title: "Revenue",
    fieldLabels: {
      "date-id": "order_date",
      "net-id": "net_total",
      "gross-id": "gross_total",
    },
  } as const;
  const chart = {
    ...base,
    kind: "chart",
    dataframe: "orders",
    chartSpec,
  } as const;
  const page = mount("pending", <Fixture />, [
    {
      ...proposal,
      id: "chart-review",
      cellId: "chart",
      kind: "edit",
      before: delta("chart", chart),
      after: delta("chart", {
        ...chart,
        chartSpec: { ...chartSpec, yField: "gross-id" },
      }),
    },
    {
      ...proposal,
      id: "text-review",
      cellId: "text",
      kind: "edit",
      before: delta("text", { ...base, kind: "text", text: "## Old note" }),
      after: delta("text", {
        ...base,
        kind: "text",
        text: "## Findings\n\n**Gross** revenue",
      }),
    },
    {
      ...proposal,
      id: "input-review",
      cellId: "input",
      kind: "insert",
      before: null,
      after: delta("input", {
        ...base,
        kind: "input",
        name: "sales_region",
        label: "Sales region",
        inputType: "DROPDOWN",
        defaultValueString: "EMEA",
      }),
    },
  ]);
  try {
    await page.render();
    await vi.waitFor(() => {
      const chart = page.host.querySelector(
        '[data-notebook-proposal="chart-review"]',
      );
      expect(chart?.querySelector("del")?.textContent).toBe("Sum of net_total");
      expect(chart?.querySelector("ins")?.textContent).toBe(
        "Sum of gross_total",
      );
      expect(chart?.textContent).toContain("Month of order_date");
      expect(chart?.textContent).toContain("Line");
      expect(chart?.textContent).toContain("Revenue");
      expect(chart?.querySelector("pre")).toBeNull();
      const text = page.host.querySelector(
        '[data-notebook-proposal="text-review"]',
      );
      expect(
        Array.from(
          text?.querySelectorAll('[role="heading"]') ?? [],
          (heading) => heading.textContent,
        ),
      ).toEqual(["Old note", "Findings"]);
      expect(text?.querySelector("strong")?.textContent).toBe("Gross");
      const input = page.host.querySelector(
        '[data-notebook-proposal="input-review"]',
      );
      expect(
        Array.from(
          input?.querySelectorAll("dd") ?? [],
          (value) => value.textContent,
        ),
      ).toEqual(["Sales region", "Dropdown", "EMEA"]);
    });
  } finally {
    await page.dispose();
  }
});

it("prefills the shared composer with the scoped error and waits for Send", async () => {
  const page = mount("undone", <Fixture repair />);
  try {
    await page.render();
    await vi.waitFor(() =>
      expect(page.host.textContent).toContain("Review this notebook"),
    );
    const fix = [...page.host.querySelectorAll("button")].find(
      (button) => button.textContent === "Fix with agent",
    );
    assert(fix);
    await act(async () => fix.click());
    await vi.waitFor(() =>
      expect(page.host.querySelector(".ProseMirror")?.textContent).toContain(
        "Unrecognized name: missing",
      ),
    );
    expect(page.repair).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId,
        projectId,
        cellId: baseline.id,
        attemptId: "failed-attempt",
      }),
    );
    expect(page.runs).not.toHaveBeenCalled();
  } finally {
    await page.dispose();
  }
});
