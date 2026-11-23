import { fail } from "@agent-native/core/action";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../server/lib/project-action-access.js", async () => ({
  cellOutputRecordSchema: (await import("zod")).z.unknown(),
  requireReadableProject: async () => ({
    scope: { ownerEmail: "reader@example.test", orgId: "org" },
    project: { id: "project" },
    canEdit: true,
  }),
}));
vi.mock("../server/model/data-connections.js", () => ({
  readBrowsableDataConnection: state.read,
  canReadConnectionResults: vi.fn(),
}));
vi.mock("../server/model/project-connection-links.js", () => ({
  listProjectConnectionLinks: async () => [],
}));
vi.mock("../server/model/project-grant-access.js", () => ({
  projectAccessLevel: async () => "owner",
}));
vi.mock("../server/model/project-query.js", async () => ({
  getProjectQueryStates: async () => ({}),
  projectQueryStateSchema: (await import("zod")).z.unknown(),
}));
vi.mock("../server/model/project-views.js", () => ({
  recordProjectView: async () => {},
}));
vi.mock("../server/model/projects-store.js", () => ({
  readableProjectVersion: async () => undefined,
  getReadableProjectDocument: async () => ({
    id: "project",
    ownerEmail: "reader@example.test",
    title: "Notebook",
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
    publishedVersionId: null,
    collectionIds: [],
    cells: [
      "good",
      "missing",
      "unavailable",
      "draft",
      "credential-draft",
      "good",
    ].map((source, index) => ({
      id: `cell-${index}`,
      projectId: "project",
      versionId: "working",
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      contents: {
        id: `cell-${index}`,
        order: `a${index + 1}`,
        kind: "sql",
        source: "select 1",
        dataConnectionId: source,
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
    })),
  }),
}));
vi.mock("../server/model/runs-store.js", () => ({
  readProjectOutputs: async () => ({}),
}));
import action from "./get-project.js";

it("report A2-DEFAULT-SOURCE: reads only selected metadata, excludes drafts, and preserves the notebook on failures", async () => {
  state.read.mockImplementation(async (id: string) => {
    if (id === "missing")
      fail("Not found", {
        errorCode: "data_connection_not_found",
        statusCode: 404,
      });
    if (id === "unavailable") throw new Error("unreadable");
    return {
      label: "Warehouse",
      provider: "bigquery",
      config: {
        draft: id === "draft",
        workspaceCredentialDraft: id === "credential-draft",
      },
    };
  });
  const result = await action.run({ projectId: "project" }, {} as never);
  expect(result.project.cells).toHaveLength(6);
  expect(result.selectedConnections).toEqual([
    { id: "good", status: "available", name: "Warehouse", type: "bigquery" },
    { id: "missing", status: "missing" },
    { id: "unavailable", status: "unavailable" },
    { id: "draft", status: "missing" },
    { id: "credential-draft", status: "missing" },
  ]);
  expect(state.read.mock.calls.map(([id]) => id)).toEqual([
    "good",
    "missing",
    "unavailable",
    "draft",
    "credential-draft",
  ]);
});
