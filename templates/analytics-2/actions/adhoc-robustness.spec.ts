// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  stored: undefined as unknown,
  writes: [] as unknown[][],
  runProjectQuery: vi.fn(),
  privateAskNotebookWrite: vi.fn(),
  proposeNotebookToolChange: vi.fn(),
  requireWritableProject: vi.fn(),
  refreshedProjectDocument: vi.fn(),
  addCell: vi.fn(),
  readLegacyNotebook: vi.fn(),
}));

vi.mock(
  "../../../packages/core/dist/settings/user-settings.js",
  async (original) => ({
    ...(await original<object>()),
    getUserSetting: async () => store.stored ?? null,
  }),
);

vi.mock(
  "../../../packages/core/dist/application-state/script-helpers.js",
  async (original) => ({
    ...(await original<object>()),
    resolveCurrentRequestStateTab: async () => ({
      tabId: "tab-1",
      unavailable: false,
    }),
    writeAppStateForCurrentTab: async (...args: unknown[]) => {
      store.writes.push(args);
    },
  }),
);

vi.mock("../server/model/project-query.js", async (original) => ({
  ...(await original<object>()),
  runProjectQuery: store.runProjectQuery,
}));

vi.mock("../server/lib/workspace-access.js", async (original) => ({
  ...(await original<object>()),
  requireCurrentWorkspace: vi.fn().mockResolvedValue({
    ownerEmail: "qa-fleet@builder.io",
    orgId: "org-1",
  }),
}));

vi.mock("../server/model/dataframe-lifecycle.js", async (original) => ({
  ...(await original<object>()),
  sweepDataframeBlobsAfterWrite: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../server/lib/notebook-tool-context.js", async (original) => ({
  ...(await original<object>()),
  privateAskNotebookWrite: store.privateAskNotebookWrite,
}));

vi.mock("../server/lib/notebook-tool-proposal.js", async (original) => ({
  ...(await original<object>()),
  proposeNotebookToolChange: store.proposeNotebookToolChange,
}));

vi.mock("../server/lib/project-action-access.js", async (original) => ({
  ...(await original<object>()),
  requireWritableProject: store.requireWritableProject,
  refreshedProjectDocument: store.refreshedProjectDocument,
  assertGrantedDataConnection: vi.fn().mockResolvedValue(undefined),
  grantedConnectionOrNull: vi.fn().mockResolvedValue(null),
}));

vi.mock("../server/model/cells-store.js", async (original) => ({
  ...(await original<object>()),
  addCell: store.addCell,
}));

vi.mock("../server/model/notebook-operations/legacy.js", async (original) => ({
  ...(await original<object>()),
  readLegacyNotebook: store.readLegacyNotebook,
}));

vi.mock("../server/model/data-connections.js", async (original) => ({
  ...(await original<object>()),
  defaultDataConnectionId: vi.fn().mockResolvedValue("builtin-sample-data"),
}));

import {
  DEFAULT_TOOL_RESULT_CHARS,
  actionCallIntent,
  isActionExposedToExternalAgents,
  preparedCallNeedsApproval,
  type ActionCaller,
  type PreparedActionCall,
} from "@agent-native/core/action";

import { showAgentResource } from "../server/agent-navigation";
import {
  PARTIAL_RESULT_NOTE,
  previewCellOutput,
} from "../server/model/cell-result-preview";
import addProjectCell from "./add-project-cell";
import addProjectToCollection from "./add-project-to-collection";
import archiveProject from "./archive-project";
import createCollection from "./create-collection";
import createProject from "./create-project";
import createThread from "./create-thread";
import deleteCollection from "./delete-collection";
import deleteProject from "./delete-project";
import deleteProjectCell from "./delete-project-cell";
import deleteThread from "./delete-thread";
import duplicateProject from "./duplicate-project";
import favoriteProject from "./favorite-project";
import getProject from "./get-project";
import listCollections from "./list-collections";
import listNotebookThreads from "./list-notebook-threads";
import listProjects from "./list-projects";
import navigate from "./navigate";
import openProject from "./open-project";
import removeProjectFromCollection from "./remove-project-from-collection";
import renameThread from "./rename-thread";
import restoreProject from "./restore-project";
import runProjectCell from "./run-project-cell";
import saveProjectCell from "./save-project-cell";
import searchWorkspace from "./search-workspace";
import trashProject from "./trash-project";
import unarchiveProject from "./unarchive-project";
import updateProject from "./update-project";
import viewScreen from "./view-screen";

const AGENT_CALLERS: ActionCaller[] = ["mcp", "tool"];

async function prepare(entry: object, input: unknown) {
  const intent = await actionCallIntent(entry, input);
  if (!intent.valid) throw intent.error;
  return intent as PreparedActionCall;
}

const READS = {
  "view-screen": viewScreen,
  "list-projects": listProjects,
  "get-project": getProject,
  "search-workspace": searchWorkspace,
  "list-collections": listCollections,
  "list-notebook-threads": listNotebookThreads,
};

const WRITES = {
  navigate,
  "open-project": openProject,
  "create-project": createProject,
  "update-project": updateProject,
  "trash-project": trashProject,
  "restore-project": restoreProject,
  "archive-project": archiveProject,
  "unarchive-project": unarchiveProject,
  "favorite-project": favoriteProject,
  "duplicate-project": duplicateProject,
  "delete-project": deleteProject,
  "create-collection": createCollection,
  "add-project-to-collection": addProjectToCollection,
  "remove-project-from-collection": removeProjectFromCollection,
  "delete-collection": deleteCollection,
  "add-project-cell": addProjectCell,
  "save-project-cell": saveProjectCell,
  "delete-project-cell": deleteProjectCell,
  "create-thread": createThread,
  "rename-thread": renameThread,
  "delete-thread": deleteThread,
};

describe("analytics-2 default MCP catalog", () => {
  it.each(Object.entries(READS))(
    "%s is a read-only tool in the external catalog",
    (_name, action) => {
      expect(action.readOnly).toBe(true);
      expect(action.mcpTool).toBe(true);
      expect(isActionExposedToExternalAgents(action)).toBe(true);
    },
  );

  it.each(Object.entries(WRITES))(
    "%s is a write tool in the external catalog",
    (_name, action) => {
      expect(action.mcpTool).toBe(true);
      expect(isActionExposedToExternalAgents(action)).toBe(true);
    },
  );
});

describe("analytics-2 ad hoc requests", () => {
  it.each([
    [
      "Make a project called Q4 revenue",
      createProject,
      { title: "Q4 revenue" },
    ],
    ["Make an untitled project", createProject, {}],
    [
      "Start a project from the sample orders data",
      createProject,
      { title: "Orders", sampleDataset: "orders" },
    ],
    [
      "Make a project and open it for me",
      createProject,
      { title: "Churn", intent: "open" },
    ],
    [
      "Rename project p1",
      updateProject,
      { projectId: "p1", title: "Renamed analysis" },
    ],
    [
      "Describe project p1",
      updateProject,
      { projectId: "p1", description: "Weekly pipeline numbers" },
    ],
    ["Move project p1 to the trash", trashProject, { projectId: "p1" }],
    ["Undo the trash for p1", restoreProject, { projectId: "p1" }],
    ["Archive project p1", archiveProject, { projectId: "p1" }],
    ["Undo the archive of p1", unarchiveProject, { projectId: "p1" }],
    ["Star project p1", favoriteProject, { projectId: "p1", favorited: true }],
    [
      "Unstar project p1",
      favoriteProject,
      { projectId: "p1", favorited: false },
    ],
    ["Copy project p1", duplicateProject, { projectId: "p1" }],
    ["Show my trash", listProjects, { view: "trash" }],
    [
      "Find archived projects about churn",
      listProjects,
      { view: "archive", search: "churn" },
    ],
    [
      "List the projects in collection c1",
      listProjects,
      { collectionId: "c1" },
    ],
    [
      "Search the workspace for revenue edited this week",
      searchWorkspace,
      { text: "revenue", dateRange: "7d" },
    ],
    [
      "Search titles only, archived included",
      searchWorkspace,
      { text: "pipeline", fields: ["title"], includeArchived: true },
    ],
    ["Make a collection called Finance", createCollection, { name: "Finance" }],
    [
      "File p1 under c1",
      addProjectToCollection,
      { projectId: "p1", collectionId: "c1" },
    ],
    [
      "Take p1 out of c1",
      removeProjectFromCollection,
      { projectId: "p1", collectionId: "c1" },
    ],
    [
      "Add a notes cell to p1 after cell k1",
      addProjectCell,
      { projectId: "p1", kind: "markdown", afterCellId: "k1" },
    ],
    [
      "Edit the notes in cell k1",
      saveProjectCell,
      {
        projectId: "p1",
        cellId: "k1",
        contents: {
          kind: "markdown",
          id: "k1",
          order: "a1",
          label: null,
          hidden: false,
          gridX: null,
          gridY: null,
          gridWidth: null,
          gridHeight: null,
          markdown: "Revenue is up",
        },
      },
    ],
    [
      "Delete cell k1 but keep undo",
      deleteProjectCell,
      { projectId: "p1", cellId: "k1" },
    ],
    ["Start a new conversation", createThread, {}],
    [
      "Rename conversation t1",
      renameThread,
      { threadId: "t1", title: "Churn drivers" },
    ],
    ["Delete project p1 for good", deleteProject, { projectId: "p1" }],
    ["Delete collection c1", deleteCollection, { collectionId: "c1" }],
    ["Delete conversation t1", deleteThread, { threadId: "t1" }],
    [
      "Open project p1 on screen",
      navigate,
      { projectId: "p1", intent: "open" },
    ],
    ["Show me my recent projects", navigate, { view: "home", intent: "open" }],
    ["Open the all projects list", navigate, { view: "all" }],
    [
      "Show me my Agent-Native V3 board",
      openProject,
      { name: "Agent-Native V3", intent: "open" },
    ],
    [
      "Open the revenue overview dashboard",
      openProject,
      { name: "revenue overview", intent: "open" },
    ],
    ["Where am I?", viewScreen, {}],
  ] as const)("accepts: %s", async (_request, action, input) => {
    expect((await actionCallIntent(action, input)).valid).toBe(true);
  });

  it.each([
    [
      "a 600 character project title",
      createProject,
      { title: "x".repeat(600) },
    ],
    ["an unknown field on create", createProject, { title: "A", color: "red" }],
    ["a rename without a project", updateProject, { title: "No target" }],
    ["a blank collection name", createCollection, { name: "   " }],
    [
      "filing without a collection",
      addProjectToCollection,
      { projectId: "p1" },
    ],
    [
      "a blank conversation title",
      renameThread,
      { threadId: "t1", title: " " },
    ],
    [
      "a starred flag that is not true or false",
      favoriteProject,
      { projectId: "p1", favorited: "yes" },
    ],
    ["a made-up listing view", listProjects, { view: "everything" }],
    ["a made-up date range", searchWorkspace, { dateRange: "1y" }],
    ["an empty project id on delete", deleteProject, { projectId: "" }],
    ["an intent other than open", createProject, { intent: "close" }],
    ["an unknown navigate field", navigate, { projectId: "p1", tab: "x" }],
  ] as const)(
    "refuses with a typed error: %s",
    async (_request, action, input) => {
      const result = await actionCallIntent(action, input);
      expect(result.valid).toBe(false);
    },
  );

  it("navigate names the opened resource's kind and id errors, not a crash", async () => {
    await expect(navigate.run({})).rejects.toMatchObject({
      errorCode: "invalid_navigation",
    });
  });
});

describe.each(AGENT_CALLERS)(
  "analytics-2 view stays put for caller %s",
  (caller) => {
    const ctx = { userEmail: "qa-fleet@builder.io", orgId: null, caller };

    beforeEach(() => {
      store.writes = [];
    });

    it.each([
      ["project", createProject],
      ["thread", createThread],
      ["collection", createCollection],
    ] as const)("a created %s does not navigate by default", async (kind) => {
      const result = await showAgentResource(ctx as never, kind, "id-1");
      expect(result).toEqual({ navigation: { status: "kept" } });
      expect(store.writes).toEqual([]);
    });

    it("opens the created project when asked with intent open", async () => {
      const result = await showAgentResource(
        ctx as never,
        "project",
        "p-1",
        "open",
      );
      expect(result).toEqual({ navigation: { status: "requested" } });
      expect(store.writes).toHaveLength(1);
    });

    it("reads are read-only, so they never queue navigation", () => {
      for (const action of Object.values(READS)) {
        expect(action.readOnly).toBe(true);
      }
      expect(store.writes).toEqual([]);
    });
  },
);

describe("analytics-2 person's own calls", () => {
  it.each(["frontend", "http", "cli"] as const)(
    "a %s caller is not an agent and gets no navigation field",
    async (caller) => {
      expect(
        await showAgentResource({ caller } as never, "project", "p-1"),
      ).toEqual({});
    },
  );
});

describe.each(AGENT_CALLERS)(
  "analytics-2 no-approvals gate for caller %s",
  (caller) => {
    beforeEach(() => {
      store.stored = undefined;
    });

    const ctxFor = (actionName: string) => ({
      userEmail: "qa-fleet@builder.io",
      orgId: null,
      caller,
      actionName,
    });

    it.each([
      ["create-project", createProject, { title: "A" }],
      ["update-project", updateProject, { projectId: "p1", title: "B" }],
      ["trash-project", trashProject, { projectId: "p1" }],
      ["restore-project", restoreProject, { projectId: "p1" }],
      ["archive-project", archiveProject, { projectId: "p1" }],
      ["unarchive-project", unarchiveProject, { projectId: "p1" }],
      [
        "favorite-project",
        favoriteProject,
        { projectId: "p1", favorited: true },
      ],
      [
        "delete-project-cell",
        deleteProjectCell,
        { projectId: "p1", cellId: "k1" },
      ],
      [
        "remove-project-from-collection",
        removeProjectFromCollection,
        { projectId: "p1", collectionId: "c1" },
      ],
    ] as const)(
      "%s is reversible and never requires approval, even when no-approvals is off",
      async (actionName, action, input) => {
        const prepared = await prepare(action, input);
        for (const stored of [
          undefined,
          { enabled: true },
          { enabled: false },
        ]) {
          store.stored = stored;
          expect(
            await preparedCallNeedsApproval(
              action,
              prepared,
              ctxFor(actionName),
            ),
          ).toBe(false);
        }
      },
    );

    it.each([
      ["delete-project", deleteProject, { projectId: "p1" }],
      ["delete-collection", deleteCollection, { collectionId: "c1" }],
      ["delete-thread", deleteThread, { threadId: "t1" }],
    ] as const)(
      "%s runs when no-approvals is on (or default) and asks when it is off",
      async (actionName, action, input) => {
        const prepared = await prepare(action, input);
        expect(
          await preparedCallNeedsApproval(action, prepared, ctxFor(actionName)),
        ).toBe(false);
        store.stored = { enabled: true };
        expect(
          await preparedCallNeedsApproval(action, prepared, ctxFor(actionName)),
        ).toBe(false);
        store.stored = { enabled: false };
        expect(
          await preparedCallNeedsApproval(action, prepared, ctxFor(actionName)),
        ).toBe(true);
      },
    );
  },
);

describe("report QA-1794950716.099249", () => {
  it.each([
    ["run-project-cell", runProjectCell, { projectId: "p1", cellId: "c1" }],
    [
      "add-project-cell",
      addProjectCell,
      { projectId: "p1", kind: "sql", source: "SELECT 1" },
    ],
  ] as const)(
    "%s never requires approval and marks destructiveHint false",
    async (actionName, action, input) => {
      expect(action.mcpAnnotations?.destructiveHint).toBe(false);
      const prepared = await prepare(action, input);
      for (const caller of AGENT_CALLERS) {
        for (const stored of [
          undefined,
          { enabled: true },
          { enabled: false },
        ]) {
          store.stored = stored;
          expect(
            await preparedCallNeedsApproval(action, prepared, {
              userEmail: "qa-fleet@builder.io",
              orgId: null,
              caller,
              actionName,
            }),
          ).toBe(false);
        }
      }
    },
  );
});

describe("report QA-1794950687.488649", () => {
  beforeEach(() => {
    store.runProjectQuery.mockReset();
  });

  it("flags final-offset page reads in run-project-cell as partial with the real total and stays under 50k chars", async () => {
    const pageRows = Array.from({ length: 50 }, (_, index) => [
      19950 + index,
      "x".repeat(400),
    ]);
    store.runProjectQuery.mockResolvedValueOnce({
      status: "complete",
      output: {
        type: "table",
        columns: [
          { name: "id", type: "number" },
          { name: "payload", type: "string" },
        ],
        rows: pageRows,
        rowCount: 50,
        truncated: false,
      },
      hasNextPage: false,
      totalRows: "20000",
    });

    const result = await runProjectCell.run(
      {
        projectId: "p1",
        cellId: "c1",
        operation: "page",
        requestId: "11111111-1111-4111-8111-111111111111",
        rowOffset: 19950,
      },
      { caller: "tool" },
    );

    expect(result.preview).toMatchObject({
      offset: 19950,
      nextOffset: null,
      returnedRows: 50,
      totalRows: "20000",
      partial: true,
      partialNote: PARTIAL_RESULT_NOTE,
    });
    expect(result.output?.type === "table" && result.output.truncated).toBe(
      true,
    );
    expect(JSON.stringify(result).length).toBeLessThan(
      DEFAULT_TOOL_RESULT_CHARS,
    );
  });

  it("marks previewCellOutput partial when totalRows exceeds returned rows even if truncated is false", () => {
    const result = previewCellOutput({
      type: "table",
      columns: [{ name: "n", type: "number" }],
      rows: [[1], [2], [3]],
      rowCount: 3,
      truncated: false,
      totalRows: "100",
    });

    expect(result.preview).toMatchObject({
      returnedRows: 3,
      totalRows: "100",
      partial: true,
      partialNote: PARTIAL_RESULT_NOTE,
    });
    expect(result.output?.type === "table" && result.output.truncated).toBe(
      true,
    );
  });
});

describe("report QA-1794950510.186719", () => {
  const emptyProject = {
    id: "p1",
    ownerEmail: "qa-fleet@builder.io",
    title: "Project",
    description: "",
    language: "python" as const,
    statusId: null,
    favorited: false,
    trashedAt: null,
    archivedAt: null,
    lastOpenedAt: null,
    createdAt: "2026-11-21T00:00:00.000Z",
    updatedAt: "2026-11-21T00:00:00.000Z",
    workingVersionId: "ver-1",
    publishedVersionId: null,
    cells: [],
    collectionIds: [],
  };

  beforeEach(() => {
    store.privateAskNotebookWrite.mockReset();
    store.proposeNotebookToolChange.mockReset();
    store.requireWritableProject.mockReset();
    store.refreshedProjectDocument.mockReset();
    store.addCell.mockReset();
    store.readLegacyNotebook.mockReset();
  });

  it("distinguishes staged pending_review proposals from saved cells in add-project-cell", async () => {
    store.privateAskNotebookWrite.mockResolvedValueOnce(null);
    store.proposeNotebookToolChange.mockResolvedValueOnce({
      threadId: "t1",
      proposalIds: ["prop-1"],
      newCellId: "cel_proposed",
      project: emptyProject,
    });

    const proposed = await addProjectCell.run(
      { projectId: "p1", kind: "sql", source: "SELECT 1" },
      {
        caller: "tool",
        threadId: "t1",
        runId: "run-1",
        turnId: "turn-1",
        toolCallId: "call-1",
        userEmail: "qa-fleet@builder.io",
        orgId: "org-1",
        appId: "analytics-2",
      },
    );

    expect(proposed.cellStatus).toBe("pending_review");
    expect(proposed.proposalIds).toEqual(["prop-1"]);
    expect(proposed.project.cells).toEqual([]);

    const savedCell = {
      id: "cel_saved",
      projectId: "p1",
      versionId: "ver-1",
      createdAt: "2026-11-21T00:00:00.000Z",
      updatedAt: "2026-11-21T00:00:00.000Z",
      contents: {
        id: "cel_saved",
        order: "a1",
        kind: "sql" as const,
        label: null,
        hidden: false,
        gridX: null,
        gridY: null,
        gridWidth: null,
        gridHeight: null,
        source: "SELECT 1",
        dataConnectionId: null,
        databaseSchema: null,
        resultVariable: "dataframe",
        outputResult: true,
      },
    };
    store.requireWritableProject.mockResolvedValueOnce({
      scope: { ownerEmail: "qa-fleet@builder.io", orgId: "org-1" },
      project: {
        id: "p1",
        workingVersionId: "ver-1",
        notebookLastSqlSource: null,
      },
    });
    store.readLegacyNotebook.mockResolvedValueOnce({
      project: {
        id: "p1",
        workingVersionId: "ver-1",
        notebookLastSqlSource: null,
      },
      cells: [],
    });
    store.addCell.mockResolvedValueOnce(savedCell);
    store.refreshedProjectDocument.mockResolvedValueOnce({
      ...emptyProject,
      cells: [savedCell],
    });

    const saved = await addProjectCell.run(
      { projectId: "p1", kind: "sql", source: "SELECT 1" },
      { caller: "frontend" },
    );

    expect(saved.cellStatus).toBe("saved");
    expect(saved.createdCellId).toBe("cel_saved");
  });
});
