import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireProjectId: vi.fn(),
  listDataConnections: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  fail: (message: string, options?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), {
      actionContractError: true,
      ...options,
    });
  },
}));

vi.mock(
  "@agent-native/core/server/request-context",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >()),
    getRequestUserEmail: () => "member@example.com",
  }),
);

vi.mock("../../actions/_semantic-helpers.js", () => ({
  requireSemanticOrg: async () => "org-1",
}));

vi.mock("./org-bigquery-credentials.js", () => ({
  requireOrganizationBigQueryProjectId: mocks.requireProjectId,
  withOrganizationBigQueryRequestContext: (_: unknown, run: () => unknown) =>
    run(),
}));

vi.mock("../model/data-connections.js", () => ({
  listDataConnections: mocks.listDataConnections,
}));

const { runOrganizationWarehouseQueryInternal } =
  await import("./organization-warehouse-query.js");

describe("organization warehouse query without an organization source", () => {
  beforeEach(() => {
    mocks.requireProjectId.mockReset();
    mocks.listDataConnections.mockReset();
    mocks.requireProjectId.mockRejectedValue(
      Object.assign(
        new Error("Organization BigQuery credentials are not configured."),
        {
          actionContractError: true,
          errorCode: "bigquery_org_credentials_missing",
          statusCode: 409,
        },
      ),
    );
  });

  it("QA24: routes a member with a granted connection to the connection catalog", async () => {
    mocks.listDataConnections.mockResolvedValue([
      { id: "conn-1", name: "Sales warehouse", type: "bigquery" },
    ]);

    await expect(
      runOrganizationWarehouseQueryInternal({
        operation: "start",
        connectionId: "__analytics_2_org_source__",
        sql: "SELECT 1",
      } as never),
    ).rejects.toMatchObject({
      errorCode: "bigquery_org_source_not_configured",
      details: { grantedConnectionIds: ["conn-1"] },
    });
  });

  it("keeps the credential error without a granted connection", async () => {
    mocks.listDataConnections.mockResolvedValue([]);

    await expect(
      runOrganizationWarehouseQueryInternal({
        operation: "start",
        connectionId: "__analytics_2_org_source__",
        sql: "SELECT 1",
      } as never),
    ).rejects.toMatchObject({ errorCode: "bigquery_org_credentials_missing" });
  });
});
