import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCredentials: vi.fn(),
  listDataConnections: vi.fn(),
  getDataTableDetails: vi.fn(),
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
vi.mock("@agent-native/core/org", () => ({ getOrgContext: vi.fn() }));
vi.mock("@agent-native/core/server", () => ({
  loadActionsFromStaticRegistry: () => ({}),
  createAgentChatPlugin: (options: Record<string, unknown>) => options,
  getCredentialContext: () => ({ userEmail: "member@example.com", orgId: "o" }),
  getRequestContext: () => ({ userEmail: "member@example.com", orgId: "o" }),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => "member@example.com",
}));
vi.mock("../../.generated/actions-registry.js", () => ({ default: {} }));
vi.mock("../../actions/_semantic-helpers.js", () => ({
  requireSemanticOrg: async () => "o",
  requireBigQueryModelCurator: async () => undefined,
}));
vi.mock("../lib/org-bigquery-credentials.js", () => ({
  requireOrganizationBigQueryCredentials: mocks.requireCredentials,
}));
vi.mock("../model/data-connections.js", () => ({
  listDataConnections: mocks.listDataConnections,
}));
vi.mock("../model/data-table-details.js", () => ({
  getDataTableDetails: mocks.getDataTableDetails,
}));

it("after the org-only schema tool is routed away, the saved-connection schema step is available and runs", async () => {
  mocks.requireCredentials.mockRejectedValue(
    Object.assign(
      new Error("Organization BigQuery credentials are not configured."),
      {
        actionContractError: true,
        errorCode: "bigquery_org_credentials_missing",
        statusCode: 409,
      },
    ),
  );
  mocks.listDataConnections.mockResolvedValue([
    { id: "saved-1", type: "bigquery" },
  ]);
  mocks.getDataTableDetails.mockResolvedValue({ connectionId: "saved-1" });

  const { default: discover } =
    await import("../../actions/discover-bigquery-table-schema.js");
  const { default: details } =
    await import("../../actions/get-data-table-details.js");
  const { default: plugin } = await import("./agent-chat.js");
  const { initialToolNames } = plugin as unknown as {
    initialToolNames: string[];
  };

  const routed = await (
    discover as unknown as {
      run: (input: { tableReference: string }) => Promise<unknown>;
    }
  )
    .run({ tableReference: "p.d.t" })
    .catch((error: Error) => error);
  expect(routed).toMatchObject({
    errorCode: "bigquery_org_source_not_configured",
  });

  const named = (routed as Error).message.match(/[a-z]+(?:-[a-z]+)+/g) ?? [];
  for (const tool of [
    "list-data-connections",
    "list-connection-datasets",
    "get-data-table-details",
    "run-project-cell",
  ]) {
    expect(named).toContain(tool);
    expect(initialToolNames).toContain(tool);
  }

  const result = await (
    details as unknown as {
      run: (input: unknown, context: unknown) => Promise<unknown>;
    }
  ).run({ connectionId: "saved-1", tableId: "t" }, { caller: "agent" });
  expect(result).toEqual({ connectionId: "saved-1" });
  expect(mocks.getDataTableDetails).toHaveBeenCalledWith(
    { connectionId: "saved-1", tableId: "t" },
    "agent",
  );
});
