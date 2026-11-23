import { describe, expect, it, vi } from "vitest";

import type { CellContents } from "../../app/lib/model/contracts.js";
import { SAMPLE_DATA_SOURCE_ID } from "../../shared/sample-data-contract.js";

const mocks = vi.hoisted(() => ({
  readDataConnection: vi.fn(async () => {
    throw Object.assign(new Error("Data connection not found."), {
      errorCode: "data_connection_not_found",
      statusCode: 404,
    });
  }),
}));

vi.mock("@agent-native/core/action", () => ({
  fail: (message: string, options?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));
vi.mock("@agent-native/core/db/schema", () => ({ and: vi.fn(), eq: vi.fn() }));
vi.mock("../db/index.js", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("../model/data-connections.js", () => ({
  readDataConnection: mocks.readDataConnection,
  connectionContext: () => ({
    userEmail: "owner@example.test",
    orgId: "org-1",
  }),
}));
vi.mock("../model/database.js", () => ({
  ensureAnalyticsDatabase: vi.fn(async () => undefined),
}));
vi.mock("../model/project-grant-access.js", () => ({
  canEditProject: vi.fn(),
  canManageProject: vi.fn(),
  projectAccessLevel: vi.fn(),
}));
vi.mock("../model/project-access.js", () => ({
  getAuthorizedProjectRow: vi.fn(),
  getReadableProjectRow: vi.fn(),
}));
vi.mock("../model/projects-store.js", () => ({ getProjectDocument: vi.fn() }));
vi.mock("./workspace-access.js", () => ({
  requireCurrentWorkspace: vi.fn(),
  workspaceAccess: {},
}));
vi.mock("../lib/org-bigquery-credentials.js", () => ({
  getOrganizationBigQueryCredentialReadiness: async () => "missing",
  requireOrganizationBigQueryProjectId: async () => "query-project",
}));

const { assertGrantedMetricConnection } =
  await import("./project-action-access.js");

function metricCell(dataConnectionId: string | null): CellContents {
  return {
    id: "cell-1",
    kind: "dbt-metric",
    order: "i",
    label: null,
    hidden: false,
    gridX: null,
    gridY: null,
    gridWidth: null,
    gridHeight: null,
    dataConnectionId,
    metrics: [],
    selectedTimegrain: null,
    selectedDimensions: [],
    useRichDisplay: true,
  };
}

describe("a dbt-metric cell's data connection", () => {
  it("refuses a new connection id that is not a workspace connection", async () => {
    await expect(
      assertGrantedMetricConnection(
        metricCell("conn_missing"),
        metricCell(null),
      ),
    ).rejects.toMatchObject({ errorCode: "data_connection_not_found" });
  });

  it("refuses an unknown connection on a cell created or pasted without a stored copy", async () => {
    await expect(
      assertGrantedMetricConnection(metricCell("conn_missing")),
    ).rejects.toMatchObject({ errorCode: "data_connection_not_found" });
  });

  it("accepts the bundled sample source and a cleared choice", async () => {
    await expect(
      assertGrantedMetricConnection(metricCell(SAMPLE_DATA_SOURCE_ID)),
    ).resolves.toBeUndefined();
    await expect(
      assertGrantedMetricConnection(metricCell(null), metricCell("gone")),
    ).resolves.toBeUndefined();
  });

  it("leaves an unchanged connection alone so a cell can still be edited after it is removed", async () => {
    mocks.readDataConnection.mockClear();
    await expect(
      assertGrantedMetricConnection(metricCell("gone"), metricCell("gone")),
    ).resolves.toBeUndefined();
    expect(mocks.readDataConnection).not.toHaveBeenCalled();
  });
});
