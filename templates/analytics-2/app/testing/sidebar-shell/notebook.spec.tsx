import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment happy-dom
import { afterEach, assert, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { ProjectEditor } from "../../components/notebook/ProjectEditor";
import { NotebookPage } from "../../components/workspace/NotebookPage";
import { loadNotebookCell } from "../../components/workspace/route-critical-code";
import type { ProjectDocument } from "../../lib/model/contracts";
import { resolveRoute } from "../../routes/routing/registry";
import {
  init,
  dispose,
  mount as mountShell,
  capture,
  button,
  click,
  key,
  route,
} from "./harness";

async function mount(...[node, path, ready]: Parameters<typeof mountShell>) {
  return mountShell(
    <AgentNativeI18nProvider
      catalog={{ messages: enUS }}
      persistPreference={false}
    >
      {node}
    </AgentNativeI18nProvider>,
    path,
    ready,
  );
}

import notebookStyles from "../../components/notebook/notebook.css?inline";
const query = vi.hoisted(() => ({
  data: {
    versions: [],
    components: [] as {
      id: string;
      name: string;
      sourceProjectId: string;
      cellCount: number;
      updatedAt: string;
    }[],
  },
  isPending: false,
  isError: false,
}));
const user = vi.hoisted(() => ({
  email: undefined as string | undefined,
  labs: false,
  agentPreferences: new Map<string, boolean>(),
}));
vi.mock("../../components/shell/secondary-features", () => ({
  secondaryFeaturesEnabled: () => user.labs,
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    session: user.email ? { email: user.email } : null,
    isLoading: false,
  }),
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({
    data: { orgId: "org" },
    isPending: false,
    isError: false,
  }),
}));
const environmentQuery = {
  ...query,
  data: {
    runtime: "Pyodide",
    runtimeVersion: "314.0.7",
    packages: [
      { name: "micropip", version: "0.11.1" },
      { name: "pandas", version: "2.3.0" },
    ],
  },
};
vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "test-tab",
  actionErrorMessage: () => null,
  writeClientAppState: vi.fn(async () => {}),
  useActionQuery: (action: string) => {
    if (action === "get-project") {
      return user.email
        ? {
            ...projectQuery,
            data: {
              ...projectQuery.data,
              viewer: { email: user.email, orgId: "org" },
            },
          }
        : projectQuery;
    }
    if (action === "list-data-connections") return connectionsQuery;
    if (action === "list-environment-packages") return environmentQuery;
    if (action === "list-data-statuses")
      return { ...query, data: { statuses: [], defaultStatusId: null } };
    if (action === "list-project-categories")
      return { ...query, data: { categories: [], assignments: [] } };
    if (action === "get-workspace-shell")
      return {
        ...query,
        data: { features: { isManagerOrAbove: false, isAdmin: false } },
      };
    if (action === "get-workspace-bootstrap") {
      return {
        ...query,
        data: user.email
          ? { workspace: { id: "org" }, user: { email: user.email } }
          : undefined,
      };
    }
    if (action === "get-editor-preferences" && user.email) {
      return {
        ...query,
        data: {
          lineNumbers: true,
          fullWidthCells: true,
          agentOpen: user.agentPreferences.get(user.email),
        },
      };
    }
    return query;
  },
  useActionMutation: (action: string) => ({
    mutateAsync: async () => ({}),
    mutate: (value: { agentOpen: boolean }) => {
      assert(action === "set-editor-preferences" && user.email);
      user.agentPreferences.set(user.email, value.agentOpen);
    },
  }),
  actionErrorCode: () => undefined,
  useActionQueryCanFetch: () => false,
  callAction: () => {
    throw new Error("Unconfigured action");
  },
}));
const project = {
  id: "project-a",
  ownerEmail: "person@example.test",
  title: "Test project",
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
  cells: [],
  versions: [],
  workingVersionId: "version-a",
  publishedVersionId: null,
} as unknown as ProjectDocument;
const projectQuery = {
  ...query,
  data: {
    project,
    outputs: {},
    queryStates: {},
    canEdit: false,
    capabilities: [],
    selectedConnections: [],
  },
};
const connectionsQuery = { ...query, data: { connections: [] } };
vi.mock("@/components/agent", () => ({
  WorkspaceAgent: () => <div data-domain-agent="" />,
  NotebookAgentComposerSuppressed: () => null,
}));
const noop = async () => {};
const rows = [
  "shell.notebook",
  "sidebar.notebook.tools",
  "sidebar.notebook.find",
  "sidebar.notebook.data-browser",
  "sidebar.notebook.table-of-contents",
  "sidebar.notebook.help",
  "sidebar.notebook.history",
];
afterEach(async () => {
  query.data.components = [];
  user.email = undefined;
  user.labs = false;
  user.agentPreferences.clear();
  await dispose();
});
it.each([false, true])(
  "captures nine notebook tools and nine toggling panels with Labs enabled, agent=%s",
  async (agentOpen) => {
    init();
    user.labs = true;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(
      [
        "action",
        "list-notebook-history",
        { projectId: project.id, filter: "all" },
      ],
      {
        pages: [
          {
            items: [],
            canManageVersions: false,
            nextCursor: null,
            editsTruncated: false,
          },
        ],
        pageParams: [null],
      },
    );
    const onOpen = vi.fn();
    await mount(
      <QueryClientProvider client={client}>
        <ProjectEditor
          project={project}
          connections={[]}
          onRename={noop}
          onSaveCell={noop}
          onAddCell={async () => "test-cell"}
          onDeleteCell={noop}
          onRunCell={noop}
          onSelectConnection={noop}
          agentOpen={agentOpen}
          agentPane={<div data-domain-agent="" />}
          onOpenToolRailItem={onOpen}
        />
      </QueryClientProvider>,
      "/project/project-a/latest",
    );
    capture(`notebook-${agentOpen ? "agent" : "no-agent"}`, rows, {
      agentOpen,
      labs: true,
      project: "empty",
      connections: [],
      versions: [],
    });
    // oracle-change: contract analytics-2#596 makes the existing Components panel reachable.
    expect(document.querySelectorAll(".nb-tool-rail-button")).toHaveLength(9);
    expect(
      [...document.querySelectorAll(".nb-tool-rail-button")].map((item) =>
        item.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Variables",
      "Components",
      "Environment",
      "Files",
      "Find",
      "Data browser",
      "Table of contents",
      "Help & support",
      "History & versions",
    ]);
    const visitedPanels = new Set<string>();
    for (const [label, id] of [
      ["Variables", "variables"],
      ["Environment", "environment"],
      ["Files", "files"],
      ["Find", "find"],
      ["Data browser", "data-browser"],
      ["Table of contents", "toc"],
      ["Help & support", "help"],
      ["History & versions", "history"],
    ] as const) {
      await click(button(label));
      visitedPanels.add(id);
      expect(onOpen).toHaveBeenLastCalledWith(id);
      expect(document.querySelectorAll(".nb-side-panel"), label).toHaveLength(
        1,
      );
      if (id === "variables") {
        expect(
          document.querySelector('.nb-side-panel[aria-label="Variables"]'),
        ).not.toBeNull();
        expect(document.querySelector(".nb-side-panel-note")?.textContent).toBe(
          "No variables yet. Run a SQL or Python cell to create one.",
        );
      }
      if (id === "environment") {
        // The rail button is only a control if selecting it opens the panel the
        // panel component renders; a kind listed in the rail and dropped by the
        // editor's selection guard is the defect this asserts against.
        const panel = document.querySelector(
          '.nb-side-panel[aria-label="Environment"]',
        );
        expect(panel).not.toBeNull();
        expect(
          [...panel!.querySelectorAll(".nb-package-name")].map(
            (name) => name.textContent,
          ),
        ).toEqual(["micropip", "pandas"]);
      }
      capture(`notebook-${agentOpen ? "agent" : "no-agent"}-${id}`, rows, {
        agentOpen,
        activeTool: id,
      });
      await click(button(label));
      expect(document.querySelectorAll(".nb-side-panel")).toHaveLength(0);
    }
    expect(visitedPanels.size).toBe(8);
    onOpen.mockClear();
    await click(button("Components"));
    expect(onOpen.mock.calls).toEqual([["components"]]);
    expect(document.querySelectorAll(".nb-side-panel")).toHaveLength(1);
    expect(
      document.querySelector(".nb-side-panel")?.getAttribute("aria-label"),
    ).toBe("Components");
    expect(document.querySelector(".nb-panel-empty")?.textContent).toBe(
      "No components yet. Select cells in a project and create a component to reuse them here.",
    );
    visitedPanels.add("components");
    expect(visitedPanels.size).toBe(9);
    capture(
      `notebook-${agentOpen ? "agent" : "no-agent"}-components-click`,
      rows,
      {
        agentOpen,
        activeTool: "components",
        reportedTool: "components",
      },
      { reportedItems: onOpen.mock.calls.map(([item]) => item) },
    );
    await click(button("Components"));
    expect(onOpen.mock.calls).toEqual([["components"], ["components"]]);
    expect(document.querySelectorAll(".nb-side-panel")).toHaveLength(0);
    await click(button("Variables"));
    const variablesPanel = document.querySelector(".nb-side-panel");
    expect(variablesPanel?.getAttribute("aria-label")).toBe("Variables");
    await click(button("Components"));
    expect(onOpen).toHaveBeenLastCalledWith("components");
    expect(document.querySelectorAll(".nb-side-panel")).toHaveLength(1);
    expect(document.querySelector(".nb-side-panel")).not.toBe(variablesPanel);
    expect(
      document.querySelector(".nb-side-panel")?.getAttribute("aria-label"),
    ).toBe("Components");
    await click(button("Close Components"));
    expect(document.querySelectorAll(".nb-side-panel")).toHaveLength(0);
    await click(button("Variables"));
    expect(
      document.querySelector(".nb-side-panel")?.getAttribute("aria-label"),
    ).toBe("Variables");
    await click(button("Variables"));
    expect(document.querySelectorAll(".nb-side-panel")).toHaveLength(0);
    client.clear();
  },
);

it.each([false, true])(
  "keeps the eight core notebook tools reachable with Labs off, agent=%s",
  async (agentOpen) => {
    init();
    const client = new QueryClient();
    try {
      await mount(
        <QueryClientProvider client={client}>
          <ProjectEditor
            project={project}
            connections={[]}
            onRename={noop}
            onSaveCell={noop}
            onAddCell={async () => "test-cell"}
            onDeleteCell={noop}
            onRunCell={noop}
            onSelectConnection={noop}
            agentOpen={agentOpen}
            agentPane={<div data-domain-agent="" />}
          />
        </QueryClientProvider>,
        "/project/project-a/latest",
      );
      expect(
        [...document.querySelectorAll(".nb-tool-rail-button")].map((item) =>
          item.getAttribute("aria-label"),
        ),
      ).toEqual([
        "Variables",
        "Environment",
        "Files",
        "Find",
        "Data browser",
        "Table of contents",
        "Help & support",
        "History & versions",
      ]);
      expect(
        document.querySelector('button[aria-label="Components"]'),
      ).toBeNull();
      capture(`notebook-core-${agentOpen ? "agent" : "no-agent"}`, rows, {
        agentOpen,
        labs: false,
      });
      await click(button("Files"));
      expect(
        document.querySelectorAll('.nb-side-panel[aria-label="Files"]'),
      ).toHaveLength(1);
      capture(`notebook-core-${agentOpen ? "agent" : "no-agent"}-files`, rows, {
        agentOpen,
        labs: false,
        activeTool: "files",
      });
      await click(button("Files"));
      expect(document.querySelectorAll(".nb-side-panel")).toHaveLength(0);
    } finally {
      client.clear();
    }
  },
);

it("opens and toggles Components on the real notebook page without a rail callback", async () => {
  init();
  user.email = project.ownerEmail;
  user.labs = true;
  query.data.components = [
    {
      id: "component-a",
      name: "Revenue blocks",
      sourceProjectId: project.id,
      cellCount: 3,
      updatedAt: project.updatedAt,
    },
  ];
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const path = "/project/project-a/latest";
  await mount(
    <QueryClientProvider client={client}>
      <NotebookPage route={resolveRoute(path)} />
    </QueryClientProvider>,
    path,
  );
  expect(document.querySelectorAll(".nb-side-panel")).toHaveLength(0);
  await click(button("Components"));
  expect(
    document.querySelectorAll('.nb-side-panel[aria-label="Components"]'),
  ).toHaveLength(1);
  expect(document.querySelector(".nb-component-name")?.textContent).toBe(
    "Revenue blocks",
  );
  expect(document.querySelector(".nb-component-detail")?.textContent).toBe(
    "3 cells",
  );
  await click(button("Components"));
  expect(document.querySelectorAll(".nb-side-panel")).toHaveLength(0);
  await click(button("Components"));
  await click(button("Close Components"));
  expect(document.querySelectorAll(".nb-side-panel")).toHaveLength(0);
  client.clear();
});

it("opens the notebook Agent on demand and restores the signed-in user's choice", async () => {
  init();
  user.email = "first@example.test";
  const path = "/project/project-a/latest";
  const render = (entry = path) => {
    const client = new QueryClient();
    return mount(
      <QueryClientProvider client={client}>
        <NotebookPage route={resolveRoute(path)} />
      </QueryClientProvider>,
      entry,
    );
  };
  const pane = (host: ParentNode) =>
    host.querySelector('aside[aria-label="Agent"] [data-domain-agent]');
  const initial = await render();
  expect(pane(initial.host)).toBeNull();
  expect(user.agentPreferences.size).toBe(0);
  await click(button("Agent", initial.host));
  expect(pane(initial.host)).not.toBeNull();
  expect([...user.agentPreferences]).toEqual([["first@example.test", true]]);

  const reopened = await render();
  expect(pane(reopened.host)).not.toBeNull();
  user.email = "second@example.test";
  expect(pane((await render()).host)).toBeNull();
  user.email = "first@example.test";

  await click(button("Notebook", reopened.host));
  expect(pane(reopened.host)).toBeNull();
  expect(pane((await render()).host)).toBeNull();
  expect(
    pane((await render(`${path}?notebookView=agent#results`)).host),
  ).not.toBeNull();
  expect(pane((await render()).host)).toBeNull();
  expect([...user.agentPreferences]).toEqual([["first@example.test", false]]);
});

it("takes readers Home from a project at phone width", async () => {
  init({ width: 390 });
  const client = new QueryClient();
  const path = "/project/project-a/latest";
  try {
    const { host } = await mount(
      <QueryClientProvider client={client}>
        <NotebookPage route={resolveRoute(path)} />
      </QueryClientProvider>,
      path,
    );
    const home = host.querySelector<HTMLAnchorElement>(
      '.nb-header a[href="/home"][aria-label="Home"]',
    );
    assert(home);
    await click(home);
    expect(route).toBe("/home");
  } finally {
    client.clear();
  }
});

it.each([390, 1280])(
  "hides the cell rail until hover or selection on desktop and keeps it reachable on phones at %ipx",
  async (width) => {
    init({ width });
    const { happyDOM } = window as unknown as {
      happyDOM: { setViewport(viewport: { width: number }): void };
    };
    happyDOM.setViewport({ width });
    const style = document.createElement("style");
    style.textContent = notebookStyles;
    document.head.append(style);
    const runAt = "2026-01-01T10:00:00.000Z";
    vi.setSystemTime(new Date(runAt));
    const cell = {
      id: "sql",
      projectId: project.id,
      versionId: project.workingVersionId,
      createdAt: runAt,
      updatedAt: runAt,
      contents: {
        id: "sql",
        order: "a",
        kind: "sql",
        label: null,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
        source: "select 1",
        dataConnectionId: "warehouse",
        databaseSchema: null,
        resultVariable: null,
        outputResult: true,
      },
    } satisfies ProjectDocument["cells"][number];
    const python: ProjectDocument["cells"][number] = {
      ...cell,
      id: "python",
      contents: {
        ...cell.contents,
        id: "python",
        order: "b",
        kind: "code",
        language: "python",
        source: "print(1)",
      },
    };
    const client = new QueryClient();
    const runCell = vi.fn(noop);
    await loadNotebookCell();
    try {
      const { host } = await mount(
        <AgentNativeI18nProvider
          catalog={{ messages: enUS }}
          persistPreference={false}
        >
          <QueryClientProvider client={client}>
            <ProjectEditor
              project={{ ...project, cells: [cell, python] }}
              connections={[{ id: "warehouse", name: "Snowflake warehouse" }]}
              outputs={{
                [cell.id]: { ranAt: runAt },
                [python.id]: { ranAt: runAt },
              }}
              onRename={noop}
              onSaveCell={noop}
              onAddCell={async () => cell.id}
              onDeleteCell={noop}
              onRunCell={runCell}
              onSelectConnection={noop}
              agentOpen={false}
            />
          </QueryClientProvider>
        </AgentNativeI18nProvider>,
        "/project/project-a/latest",
      );
      const article = host.querySelector("[data-notebook-cell=sql]");
      const pythonArticle = host.querySelector("[data-notebook-cell=python]");
      assert(article && pythonArticle);
      expect(article.classList.contains("is-selected")).toBe(false);
      expect(pythonArticle.classList.contains("is-selected")).toBe(false);
      const sqlRun = button("Run SQL 1", article);
      const pythonRun = button("Run Code 2", pythonArticle);
      const phone = width <= 700;
      for (const run of [sqlRun, pythonRun]) {
        expect(
          run.checkVisibility({
            opacityProperty: true,
            visibilityProperty: true,
          }),
        ).toBe(phone);
        expect(getComputedStyle(run).pointerEvents).not.toBe("none");
        expect(run.disabled).toBe(false);
      }
      const legend = article.querySelector(".nb-cell-legend");
      const frame = article.querySelector(".nb-cell-frame");
      const rail = article.querySelector(".nb-cell-actions");
      const meta = frame?.querySelector(".nb-cell-meta");
      const time = meta?.querySelector("time");
      assert(legend && frame && rail && meta && time);
      expect(legend.textContent).toBe("SQL 1");
      expect(getComputedStyle(legend).position).toBe("absolute");
      expect(getComputedStyle(meta).justifyContent).toBe("flex-end");
      expect(time.textContent).toBe("Just now");
      expect(time.dateTime).toBe(runAt);
      expect(button("Data connection: Snowflake warehouse", meta)).toBeTruthy();
      expect(sqlRun.closest(".nb-cell-run-split")?.parentElement).toBe(rail);
      expect(pythonRun.closest(".nb-cell-run-split")?.parentElement).toBe(
        pythonArticle.querySelector(".nb-cell-actions"),
      );
      expect(
        button("Collapse", article).closest(".nb-cell-gutter")?.parentElement,
      ).toBe(article);
      expect(rail.parentElement).toBe(article);
      expect(getComputedStyle(rail).flexDirection).toBe(
        phone ? "row" : "column",
      );
      for (const action of ["Run mode", "More actions for SQL 1"]) {
        const trigger = button(action, rail);
        expect(trigger.checkVisibility({ visibilityProperty: true })).toBe(
          true,
        );
        expect(trigger.closest('[aria-hidden="true"], [inert]')).toBeNull();
        expect(getComputedStyle(trigger).pointerEvents).not.toBe("none");
        expect(trigger.tabIndex).toBe(0);
        expect(trigger.disabled).toBe(false);
      }
      await click(sqlRun);
      await click(pythonRun);
      expect(runCell.mock.calls).toEqual([[cell.id], [python.id]]);
      await key(button("Run mode", rail), "Enter");
      const menu = document.querySelector('[role="menu"]');
      assert(menu);
      const stats = [
        ...menu.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ].find((item) => item.textContent === "View more");
      assert(stats);
      await click(stats);
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        "RUN STATS",
      );
    } finally {
      style.remove();
      happyDOM.setViewport({ width: 1280 });
      client.clear();
    }
  },
);
