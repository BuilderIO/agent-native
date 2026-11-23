import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSemanticOrg: vi.fn(async () => "org-1"),
  requireBigQueryModelCurator: vi.fn(async () => undefined),
  requireExact: vi.fn(() => ({
    orgId: "org-1",
    userEmail: "owner@example.com",
  })),
  readOrganizationDbtConfig: vi.fn(),
  readDbtServiceToken: vi.fn(async () => "dbt-token"),
  discoverRun: vi.fn(async () => ({
    projectId: "my-data-project",
    datasetId: "analytics",
    tableName: "orders",
    tableReference: "my-data-project.analytics.orders",
    columns: [],
  })),
  readDbtTableMetadataWithToken: vi.fn(async () => ({
    uniqueId: "model.analytics.orders",
    resourceType: "model",
    name: "orders",
    description: null,
    columns: [],
    lastRefreshed: null,
    freshness: null,
    freshnessCriteria: null,
    tests: [],
    parents: [
      {
        uniqueId: "model.analytics.stg_orders",
        name: "stg_orders",
        resourceType: "model",
      },
    ],
    docsUrl: null,
    runUrl: null,
  })),
}));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  defineAction: (definition: unknown) => definition,
  fail: (message: string, options?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("./_semantic-helpers.js", () => ({
  requireSemanticOrg: mocks.requireSemanticOrg,
  requireBigQueryModelCurator: mocks.requireBigQueryModelCurator,
}));

vi.mock(
  "@agent-native/core/server/request-context",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >()),
    getRequestUserEmail: () => "owner@example.com",
  }),
);

vi.mock("../server/lib/org-bigquery-dbt.js", () => ({
  readOrganizationDbtConfig: mocks.readOrganizationDbtConfig,
  readDbtServiceToken: mocks.readDbtServiceToken,
  requireDbtUserEmail: () => "owner@example.com",
  requireExactDbtRequestContext: mocks.requireExact,
  sanitizeDbtConfiguration: (value: unknown) => value,
}));

vi.mock(
  "../server/lib/warehouse-dbt.js",
  async (importOriginal: () => Promise<Record<string, unknown>>) => {
    // The reviewed provider module's own metadata schema is the output
    // contract, so the mock keeps it real and stubs only the network call.
    const actual = await importOriginal();
    return {
      ...actual,
      readDbtTableMetadataWithToken: mocks.readDbtTableMetadataWithToken,
    };
  },
);

vi.mock("./discover-bigquery-table-schema.js", () => ({
  default: { run: mocks.discoverRun },
}));

const { default: action } =
  await import("./get-organization-bigquery-dbt-metadata.js");

const config = {
  hasDbtMetadata: true,
  dbtVersion: "current" as const,
  dbtAccountId: "12345",
  dbtProjectId: "67890",
  dbtEnvironmentId: "24680",
  dbtCloudHostname: "cloud.getdbt.com",
};

const tableReference = "my-data-project.analytics.orders";

describe("get organization dbt table metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSemanticOrg.mockResolvedValue("org-1");
    mocks.requireBigQueryModelCurator.mockResolvedValue(undefined);
    mocks.requireExact.mockReturnValue({
      orgId: "org-1",
      userEmail: "owner@example.com",
    });
    mocks.readOrganizationDbtConfig.mockResolvedValue({
      status: "configured",
      revision: 4,
      config,
    });
    mocks.readDbtServiceToken.mockResolvedValue("dbt-token");
  });

  it("returns metadata with parents for a table BigQuery verified", async () => {
    const result = await action.run({ tableReference }, {} as never);
    expect(result).toMatchObject({
      dbtEnabled: true,
      dbtRevision: 4,
      tableIdentity: {
        projectId: "my-data-project",
        datasetId: "analytics",
        tableId: "orders",
      },
      metadata: {
        resourceType: "model",
        parents: [{ uniqueId: "model.analytics.stg_orders" }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("dbt-token");
    expect(mocks.readDbtTableMetadataWithToken).toHaveBeenCalledWith(
      config,
      "dbt-token",
      {
        projectId: "my-data-project",
        datasetId: "analytics",
        tableId: "orders",
      },
    );
  });

  it("declares a strict output schema that accepts parents and rejects tokens", async () => {
    const result = await action.run({ tableReference }, {} as never);
    expect(action.outputSchema).toBeDefined();
    expect(action.outputSchema.parse(result)).toEqual(result);
    expect(() =>
      action.outputSchema.parse({ ...result, dbtToken: "dbt-token" }),
    ).toThrow();
    expect(() =>
      action.outputSchema.parse({
        ...result,
        tableIdentity: { projectId: "my-data-project" },
      }),
    ).toThrow();
  });

  it("parses the disabled-metadata answer with its nullable identity", async () => {
    mocks.readOrganizationDbtConfig.mockResolvedValue({ status: "absent" });
    const result = await action.run({ tableReference }, {} as never);
    expect(action.outputSchema.parse(result)).toEqual(result);
  });

  it("returns metadata for a 129-column table by paging discovery from column 0", async () => {
    // The discovery action refuses a wide table unless it is asked for an
    // explicit page; the metadata action must ask for page 0, keep the
    // verified identity, and never fall back to a raw table fetch.
    const wideColumns = Array.from({ length: 129 }, (_, index) => ({
      name: `column_${index}`,
      dataType: "STRING",
      nullable: true,
      ordinalPosition: index + 1,
      description: null,
      descriptionTruncated: false,
    }));
    mocks.discoverRun.mockImplementationOnce(
      async (input: { columnOffset?: number }) => {
        if (input.columnOffset === undefined)
          throw Object.assign(
            new Error(
              "This table has more columns than one schema discovery can return. Retry with columnOffset 0 to page through it.",
            ),
            {
              errorCode: "bigquery_schema_column_limit_exceeded",
              statusCode: 409,
            },
          );
        return {
          projectId: "my-data-project",
          datasetId: "analytics",
          tableName: "wide_orders",
          totalColumns: 129,
          columnOffset: input.columnOffset,
          columns: wideColumns,
        };
      },
    );
    const result = await action.run(
      { tableReference: "my-data-project.analytics.wide_orders" },
      {} as never,
    );
    expect(mocks.discoverRun).toHaveBeenCalledWith(
      {
        tableReference: "my-data-project.analytics.wide_orders",
        columnOffset: 0,
      },
      {} as never,
    );
    expect(result).toMatchObject({
      dbtEnabled: true,
      tableIdentity: {
        projectId: "my-data-project",
        datasetId: "analytics",
        tableId: "wide_orders",
      },
    });
    expect(mocks.readDbtTableMetadataWithToken).toHaveBeenCalledWith(
      config,
      "dbt-token",
      {
        projectId: "my-data-project",
        datasetId: "analytics",
        tableId: "wide_orders",
      },
    );
  });

  it("refuses an out-of-org caller before reading any dbt configuration", async () => {
    mocks.requireSemanticOrg.mockRejectedValue(
      Object.assign(new Error("org scope required"), {
        errorCode: "org_scope_required",
        statusCode: 403,
      }),
    );
    await expect(
      action.run({ tableReference }, {} as never),
    ).rejects.toMatchObject({ statusCode: 403 });
    // The audit's condition for #478: scope stays ahead of the nonsecret config read.
    expect(mocks.readOrganizationDbtConfig).not.toHaveBeenCalled();
    expect(mocks.discoverRun).not.toHaveBeenCalled();
    expect(mocks.readDbtServiceToken).not.toHaveBeenCalled();
    expect(mocks.readDbtTableMetadataWithToken).not.toHaveBeenCalled();
  });

  it("does not require the curator role to read enabled dbt metadata", async () => {
    await action.run({ tableReference }, {} as never);
    expect(mocks.requireBigQueryModelCurator).not.toHaveBeenCalled();
    expect(mocks.discoverRun).toHaveBeenCalledTimes(1);
  });

  it("returns metadata:null for a disabled dbt integration without any fetch", async () => {
    mocks.readOrganizationDbtConfig.mockResolvedValue({
      status: "configured",
      revision: 2,
      config: { ...config, hasDbtMetadata: false },
    });
    await expect(action.run({ tableReference }, {} as never)).resolves.toEqual({
      dbtEnabled: false,
      dbtRevision: 2,
      tableIdentity: null,
      metadata: null,
    });
    expect(mocks.discoverRun).not.toHaveBeenCalled();
    expect(mocks.readDbtServiceToken).not.toHaveBeenCalled();
    expect(mocks.readDbtTableMetadataWithToken).not.toHaveBeenCalled();
  });

  it("returns metadata:null when no dbt configuration is stored", async () => {
    mocks.readOrganizationDbtConfig.mockResolvedValue({ status: "absent" });
    await expect(action.run({ tableReference }, {} as never)).resolves.toEqual({
      dbtEnabled: false,
      dbtRevision: null,
      tableIdentity: null,
      metadata: null,
    });
    expect(mocks.readDbtServiceToken).not.toHaveBeenCalled();
    expect(mocks.readDbtTableMetadataWithToken).not.toHaveBeenCalled();
  });

  it("runs BigQuery schema discovery before reading the dbt token", async () => {
    await action.run({ tableReference }, {} as never);
    expect(mocks.discoverRun).toHaveBeenCalledWith(
      { tableReference, columnOffset: 0 },
      {} as never,
    );
    expect(mocks.discoverRun).toHaveBeenCalledBefore(mocks.readDbtServiceToken);
    expect(mocks.readDbtServiceToken).toHaveBeenCalledBefore(
      mocks.readDbtTableMetadataWithToken,
    );
  });

  it("stops when schema discovery denies the caller's table", async () => {
    mocks.discoverRun.mockRejectedValue(
      Object.assign(new Error("project mismatch"), {
        errorCode: "bigquery_table_project_mismatch",
        statusCode: 409,
      }),
    );
    await expect(
      action.run({ tableReference }, {} as never),
    ).rejects.toMatchObject({
      errorCode: "bigquery_table_project_mismatch",
      statusCode: 409,
    });
    expect(mocks.readDbtServiceToken).not.toHaveBeenCalled();
    expect(mocks.readDbtTableMetadataWithToken).not.toHaveBeenCalled();
  });

  it("uses the verified identity, never the caller's unverified string", async () => {
    mocks.discoverRun.mockResolvedValue({
      projectId: "my-data-project",
      datasetId: "analytics",
      tableName: "orders_v2",
      columns: [],
    });
    await action.run({ tableReference }, {} as never);
    expect(mocks.readDbtTableMetadataWithToken).toHaveBeenCalledWith(
      config,
      "dbt-token",
      {
        projectId: "my-data-project",
        datasetId: "analytics",
        tableId: "orders_v2",
      },
    );
  });

  it("fails 409 when the config revision changed while dbt was answering", async () => {
    mocks.readOrganizationDbtConfig
      .mockResolvedValueOnce({ status: "configured", revision: 4, config })
      .mockResolvedValueOnce({
        status: "configured",
        revision: 5,
        config: { ...config, dbtEnvironmentId: "999999" },
      });
    await expect(
      action.run({ tableReference }, {} as never),
    ).rejects.toMatchObject({
      errorCode: "dbt_configuration_stale",
      statusCode: 409,
    });
  });

  it("propagates an absent token as 409 without calling dbt", async () => {
    mocks.readDbtServiceToken.mockRejectedValue(
      Object.assign(new Error("missing token"), {
        errorCode: "dbt_service_token_missing",
        statusCode: 409,
      }),
    );
    await expect(
      action.run({ tableReference }, {} as never),
    ).rejects.toMatchObject({
      errorCode: "dbt_service_token_missing",
      statusCode: 409,
    });
    expect(mocks.readDbtTableMetadataWithToken).not.toHaveBeenCalled();
  });

  it("sanitizes an unexpected provider failure into 503", async () => {
    mocks.readDbtTableMetadataWithToken.mockRejectedValue(
      new Error("socket hang up"),
    );
    const failure = await action
      .run({ tableReference }, {} as never)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      errorCode: "dbt_metadata_unavailable",
      statusCode: 503,
    });
    expect(String((failure as Error).message)).not.toContain("socket hang up");
  });

  it("keeps a typed provider failure as its own status", async () => {
    mocks.readDbtTableMetadataWithToken.mockRejectedValue(
      Object.assign(new Error("access denied"), {
        errorCode: "data_dbt_access_denied",
        statusCode: 403,
      }),
    );
    await expect(
      action.run({ tableReference }, {} as never),
    ).rejects.toMatchObject({
      errorCode: "data_dbt_access_denied",
      statusCode: 403,
    });
  });
});
