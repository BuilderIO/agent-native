import { checkActionProperties } from "@agent-native/core/action-properties";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  configured: true,
  authorize: vi.fn(),
  metadata: vi.fn(),
  readConnection: vi.fn(),
  readBrowsable: vi.fn(),
}));
vi.mock("../server/model/data-table-details.js", () => ({
  getDataTableDetails: state.authorize,
}));
vi.mock("../server/model/data-connections.js", () => ({
  readDataConnection: state.readConnection,
  readBrowsableDataConnection: state.readBrowsable,
}));
vi.mock("../server/model/data-dbt.js", async (original) => ({
  ...(await original<typeof import("../server/model/data-dbt.js")>()),
  readDbtTableMetadata: state.metadata,
}));
import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../shared/bigquery-source-contract.js";
import action from "./get-data-dbt-metadata.js";
const input = {
  connectionId: "qa-connection",
  tableId: "table:qa-project:analytics:customers",
};
beforeEach(() => {
  vi.clearAllMocks();
  state.readConnection.mockResolvedValue({
    id: "qa-connection",
    config: { hasDbtMetadata: true },
    credentialRefs: [],
  });
  state.readBrowsable.mockImplementation((id: string) =>
    state.readConnection(id),
  );
  state.authorize.mockResolvedValue({
    table: {
      projectId: "qa-project",
      datasetId: "analytics",
      tableId: "customers",
    },
  });
  state.metadata.mockResolvedValue(null);
});
describe("dbt browser action boundary", () => {
  it.each(["builtin-sample-data", ORGANIZATION_BIGQUERY_SOURCE_ID])(
    "report A2-DBT-BROWSABLE-CONNECTION: resolves browsable source %s",
    async (connectionId) => {
      state.readConnection.mockRejectedValue(new Error("connection not found"));
      state.readBrowsable.mockResolvedValue({
        id: connectionId,
        config: { hasDbtMetadata: false },
        credentialRefs: [],
      });
      await expect(
        action.run({ ...input, connectionId }, { caller: "frontend" } as never),
      ).resolves.toEqual({ ...input, connectionId, metadata: null });
      expect(state.metadata).not.toHaveBeenCalled();
    },
  );
  it("does not contact either provider when dbt is not enabled", async () => {
    state.readConnection.mockResolvedValue({
      id: "qa-connection",
      config: { hasDbtMetadata: false },
      credentialRefs: [],
    });
    expect(await action.run(input, { caller: "frontend" } as never)).toEqual({
      ...input,
      metadata: null,
    });
    expect(state.authorize).not.toHaveBeenCalled();
    expect(state.metadata).not.toHaveBeenCalled();
  });
  it("refuses table access before requesting dbt metadata", async () => {
    state.authorize.mockRejectedValue(
      new Error("This table is excluded for AI."),
    );
    await expect(
      action.run(input, { caller: "agent" } as never),
    ).rejects.toThrow("excluded for AI");
    expect(state.metadata).not.toHaveBeenCalled();
  });
  it("refuses metadata from an integration disabled while the remote call was running", async () => {
    state.readConnection
      .mockResolvedValueOnce({
        id: "qa-connection",
        config: { hasDbtMetadata: true, dbtCredentialKey: "FIRST_KEY" },
        credentialRefs: [{ key: "FIRST_KEY" }],
      })
      .mockResolvedValue({
        id: "qa-connection",
        config: { hasDbtMetadata: false, dbtCredentialKey: "FIRST_KEY" },
        credentialRefs: [{ key: "FIRST_KEY" }],
      });
    await expect(
      action.run(input, { caller: "frontend" } as never),
    ).rejects.toThrow("dbt configuration changed");
  });
  it("refuses metadata from a rotated dbt credential", async () => {
    state.readConnection
      .mockResolvedValueOnce({
        id: "qa-connection",
        config: { hasDbtMetadata: true, dbtCredentialKey: "FIRST_KEY" },
        credentialRefs: [{ key: "FIRST_KEY" }],
      })
      .mockResolvedValue({
        id: "qa-connection",
        config: { hasDbtMetadata: true, dbtCredentialKey: "SECOND_KEY" },
        credentialRefs: [{ key: "SECOND_KEY" }],
      });
    await expect(
      action.run(input, { caller: "frontend" } as never),
    ).rejects.toThrow("dbt configuration changed");
  });
  it("rechecks access after the remote metadata request before publishing output", async () => {
    state.authorize
      .mockResolvedValueOnce({
        table: {
          projectId: "qa-project",
          datasetId: "analytics",
          tableId: "customers",
        },
      })
      .mockRejectedValueOnce(new Error("The data resource policy changed."));
    await expect(
      action.run(input, { caller: "agent" } as never),
    ).rejects.toThrow("policy changed");
    expect(state.metadata).toHaveBeenCalledOnce();
  });
  it("keeps read-only action output valid on generated inputs", async () => {
    await checkActionProperties(action, {
      runs: 15,
      context: { caller: "frontend" },
    });
  });
  it("does not publish upstream resource identities authorized only by the selected table", async () => {
    state.metadata.mockResolvedValue({
      uniqueId: "model.qa.customers",
      resourceType: "model",
      name: "customers",
      description: null,
      columns: [],
      lastRefreshed: null,
      freshness: null,
      tests: [],
      docsUrl: null,
      runUrl: "https://cloud.getdbt.com/deploy/7/projects/11/runs/70",
      parents: [
        {
          uniqueId: "source.restricted.secret",
          name: "restricted-upstream-name",
          resourceType: "Source",
        },
      ],
    });
    const result = await action.run(input, { caller: "agent" } as never);
    expect(result.metadata?.runUrl).toBe(
      "https://cloud.getdbt.com/deploy/7/projects/11/runs/70",
    );
    expect(result.metadata).not.toHaveProperty("parents");
    expect(JSON.stringify(result)).not.toContain("restricted-upstream-name");
    expect(JSON.stringify(result)).not.toContain("source.restricted.secret");
  });
});
