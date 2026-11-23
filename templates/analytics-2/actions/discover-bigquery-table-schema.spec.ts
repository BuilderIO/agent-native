import { beforeEach, describe, expect, it, vi } from "vitest";

import { builtinSampleConnection } from "../server/model/data-connection-dto.js";

const CREDENTIAL_SETUP_GAP =
  /\b(?:api[ -]?keys?|access tokens?|credentials?|secrets?)\b[^.]{0,60}\bnot (?:configured|set|connected|available)\b/i;

const mocks = vi.hoisted(() => ({
  requireCredentials: vi.fn(),
  listDataConnections: vi.fn(),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (definition: unknown) => definition,
  fail: (message: string, options?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), {
      actionContractError: true,
      ...options,
    });
  },
}));

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const context = {
    userEmail: "member@example.com",
    orgId: "org-1",
  };
  return {
    ...(await importOriginal<typeof import("@agent-native/core/server")>()),
    getCredentialContext: () => context,
    getRequestContext: () => context,
  };
});

vi.mock(
  "@agent-native/core/server/request-context",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >()),
    getRequestUserEmail: () => "member@example.com",
  }),
);

vi.mock("./_semantic-helpers.js", () => ({
  requireSemanticOrg: async () => "org-1",
  requireBigQueryModelCurator: async () => undefined,
}));

vi.mock("../server/lib/org-bigquery-credentials.js", () => ({
  requireOrganizationBigQueryCredentials: mocks.requireCredentials,
}));

vi.mock("../server/model/data-connections.js", () => ({
  listDataConnections: mocks.listDataConnections,
}));

const { default: action } = await import("./discover-bigquery-table-schema.js");

const missingOrganizationSource = () =>
  Object.assign(
    new Error("Organization BigQuery credentials are not configured."),
    {
      actionContractError: true,
      errorCode: "bigquery_org_credentials_missing",
      statusCode: 409,
    },
  );

const run = (reference = "proj-1.sales.orders") =>
  (
    action as unknown as {
      run: (input: { tableReference: string }) => Promise<unknown>;
    }
  ).run({ tableReference: reference });

describe("discover-bigquery-table-schema without an organization source", () => {
  beforeEach(() => {
    mocks.requireCredentials.mockReset();
    mocks.listDataConnections.mockReset();
    mocks.requireCredentials.mockRejectedValue(missingOrganizationSource());
  });

  it("QA24: a member with a granted connection is routed to its catalog instead of a setup stop", async () => {
    mocks.listDataConnections.mockResolvedValue([
      { id: "conn-1", name: "Sales warehouse", type: "bigquery" },
      builtinSampleConnection(),
    ]);

    const error = await run().then(
      () => null,
      (caught: unknown) => caught as Error & { errorCode?: string },
    );

    expect(error).not.toBeNull();
    expect(error?.errorCode).toBe("bigquery_org_source_not_configured");
    expect(error?.message).toContain("list-connection-datasets");
    expect(error?.message).toContain("get-data-table-details");
    expect(error?.message).not.toMatch(CREDENTIAL_SETUP_GAP);
    expect(mocks.listDataConnections).toHaveBeenCalledWith({ forAgent: true });
  });

  it("keeps the credential error when the member has no granted connection", async () => {
    mocks.listDataConnections.mockResolvedValue([builtinSampleConnection()]);

    await expect(run()).rejects.toMatchObject({
      actionContractError: true,
      errorCode: "bigquery_org_credentials_missing",
      statusCode: 409,
    });
  });

  it("does not mask the credential error when the connection list is unreadable", async () => {
    mocks.listDataConnections.mockRejectedValue(new Error("catalog down"));

    await expect(run()).rejects.toMatchObject({
      errorCode: "bigquery_org_credentials_missing",
    });
  });

  it("never reroutes a partial organization credential", async () => {
    mocks.requireCredentials.mockRejectedValue(
      Object.assign(
        new Error("Organization BigQuery credentials are incomplete."),
        {
          actionContractError: true,
          errorCode: "bigquery_org_credentials_incomplete",
          statusCode: 409,
        },
      ),
    );
    mocks.listDataConnections.mockResolvedValue([
      { id: "conn-1", name: "Sales warehouse", type: "bigquery" },
    ]);

    await expect(run()).rejects.toMatchObject({
      errorCode: "bigquery_org_credentials_incomplete",
    });
    expect(mocks.listDataConnections).not.toHaveBeenCalled();
  });

  it("states in its description that it reads the organization source only", () => {
    const { description } = action as unknown as { description: string };
    expect(description).toMatch(/organization source/i);
    expect(description).toContain("list-connection-datasets");
  });
});
