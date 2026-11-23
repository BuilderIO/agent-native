import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSemanticOrg: vi.fn(async () => "org-1"),
  requireBigQueryModelCurator: vi.fn(async () => undefined),
  userEmail: vi.fn(() => "owner@example.com"),
  requireExact: vi.fn(() => ({
    orgId: "org-1",
    userEmail: "owner@example.com",
  })),
  readDbtServiceToken: vi.fn(async () => "saved-token"),
  writeDbtServiceToken: vi.fn(async () => undefined),
  commitDbtConfigRevision: vi.fn(async () => 5),
  validateDbtConfiguration: vi.fn(async () => undefined),
  warehouseRun: vi.fn(async () => ({
    action: "save",
    credentialReadiness: "configured",
    projectId: "my-data-project",
    connectionName: "Warehouse",
    changed: true,
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

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.userEmail,
}));

vi.mock("../server/lib/org-bigquery-dbt.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/org-bigquery-dbt.js")
  >()),
  DBT_SERVICE_TOKEN_KEY: "ANALYTICS_WAREHOUSE_DBT_SERVICE_TOKEN",
  ORGANIZATION_BIGQUERY_DBT_SETTING_KEY:
    "analytics-2.organization-bigquery-dbt",
  readDbtServiceToken: mocks.readDbtServiceToken,
  writeDbtServiceToken: mocks.writeDbtServiceToken,
  commitDbtConfigRevision: mocks.commitDbtConfigRevision,
  requireDbtUserEmail: () => "owner@example.com",
  requireExactDbtRequestContext: mocks.requireExact,
  sanitizeDbtConfiguration: (value: unknown) => value,
  withOrganizationDbtTransaction: async (
    run: (transaction: unknown) => Promise<unknown>,
  ) => run({ transaction: true }),
}));

vi.mock("../server/lib/warehouse-dbt.js", () => ({
  validateDbtConfiguration: mocks.validateDbtConfiguration,
}));

vi.mock("./set-organization-bigquery-connection.js", async (importOriginal) => {
  // The extracted warehouse validator is pure; keeping it real means these
  // cases exercise the actual project/ID, key-shape and project-match rules.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, default: { run: mocks.warehouseRun } };
});

const { default: action } =
  await import("./save-organization-bigquery-dbt-connection.js");

const dbtEnabled = {
  hasDbtMetadata: true,
  dbtVersion: "current" as const,
  dbtAccountId: "12345",
  dbtProjectId: "67890",
  dbtEnvironmentId: "24680",
  dbtCloudHostname: "cloud.getdbt.com",
};

const serviceAccountKey = {
  type: "service_account",
  project_id: "my-data-project",
  client_email: "analytics@my-data-project.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
};
const serviceAccountJson = JSON.stringify(serviceAccountKey);

const args = (overrides: Record<string, unknown> = {}) => ({
  connection: {
    connectionName: "Warehouse",
    connectionDescription: "",
    projectId: "my-data-project",
    serviceAccountJson,
  },
  dbt: dbtEnabled,
  dbtToken: "supplied-token",
  expectedRevision: 4,
  ...overrides,
});

describe("save organization BigQuery and dbt connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSemanticOrg.mockResolvedValue("org-1");
    mocks.requireBigQueryModelCurator.mockResolvedValue(undefined);
    mocks.userEmail.mockReturnValue("owner@example.com");
    mocks.requireExact.mockReturnValue({
      orgId: "org-1",
      userEmail: "owner@example.com",
    });
    mocks.readDbtServiceToken.mockResolvedValue("saved-token");
    mocks.commitDbtConfigRevision.mockResolvedValue(5);
    mocks.validateDbtConfiguration.mockResolvedValue(undefined);
    mocks.warehouseRun.mockResolvedValue({
      action: "save",
      credentialReadiness: "configured",
      projectId: "my-data-project",
      connectionName: "Warehouse",
      changed: true,
    });
  });

  it("is private to the UI and never records its inputs", () => {
    expect(action).toMatchObject({
      uiOnly: true,
      agentTool: false,
      mcpTool: false,
      toolCallable: false,
      persistInChatHistory: false,
      persistInBrowser: false,
      audit: { recordInputs: false },
    });
  });

  it("saves the connection, bumps the dbt revision and stores the token", async () => {
    const result = await action.run(args(), {} as never);
    expect(result).toEqual({
      action: "save",
      credentialReadiness: "configured",
      projectId: "my-data-project",
      connectionName: "Warehouse",
      changed: true,
      dbtRevision: 5,
    });
    expect(JSON.stringify(result)).not.toContain("supplied-token");
  });

  it("declares a strict output schema that accepts the safe result", async () => {
    const result = await action.run(args(), {} as never);
    expect(action.outputSchema).toBeDefined();
    expect(action.outputSchema.parse(result)).toEqual(result);
  });

  it("rejects an output that carries the dbt token or an unknown field", () => {
    const safe = {
      action: "save",
      credentialReadiness: "configured",
      projectId: "my-data-project",
      connectionName: "Warehouse",
      changed: true,
      dbtRevision: 5,
    };
    expect(() =>
      action.outputSchema.parse({ ...safe, dbtToken: "supplied-token" }),
    ).toThrow();
    expect(() =>
      action.outputSchema.parse({ ...safe, serviceAccountJson: "{}" }),
    ).toThrow();
    expect(() =>
      action.outputSchema.parse({
        ...safe,
        credentialReadiness: "unavailable",
      }),
    ).toThrow();
    expect(action.outputSchema.parse(safe)).toEqual(safe);
  });

  it("refuses a caller whose organization or role check fails before any write", async () => {
    mocks.requireExact.mockImplementation(() => {
      throw Object.assign(new Error("wrong workspace"), {
        errorCode: "dbt_org_context_mismatch",
        statusCode: 403,
      });
    });
    await expect(action.run(args(), {} as never)).rejects.toMatchObject({
      errorCode: "dbt_org_context_mismatch",
      statusCode: 403,
    });
    expect(mocks.readDbtServiceToken).not.toHaveBeenCalled();
    expect(mocks.commitDbtConfigRevision).not.toHaveBeenCalled();
    expect(mocks.warehouseRun).not.toHaveBeenCalled();
    expect(mocks.writeDbtServiceToken).not.toHaveBeenCalled();
  });

  it("refuses a non-curator before any vault or store write", async () => {
    mocks.requireBigQueryModelCurator.mockRejectedValue(
      Object.assign(new Error("curator only"), {
        errorCode: "semantic_model_source_admin_required",
        statusCode: 403,
      }),
    );
    await expect(action.run(args(), {} as never)).rejects.toMatchObject({
      errorCode: "semantic_model_source_admin_required",
      statusCode: 403,
    });
    expect(mocks.readDbtServiceToken).not.toHaveBeenCalled();
    expect(mocks.validateDbtConfiguration).not.toHaveBeenCalled();
    expect(mocks.commitDbtConfigRevision).not.toHaveBeenCalled();
    expect(mocks.warehouseRun).not.toHaveBeenCalled();
    expect(mocks.writeDbtServiceToken).not.toHaveBeenCalled();
  });

  it("validates the dbt configuration and token before any write", async () => {
    mocks.validateDbtConfiguration.mockRejectedValue(
      Object.assign(new Error("bad environment"), {
        errorCode: "data_dbt_configuration_invalid",
        statusCode: 422,
      }),
    );
    await expect(action.run(args(), {} as never)).rejects.toMatchObject({
      errorCode: "data_dbt_configuration_invalid",
      statusCode: 422,
    });
    expect(mocks.commitDbtConfigRevision).not.toHaveBeenCalled();
    expect(mocks.warehouseRun).not.toHaveBeenCalled();
    expect(mocks.writeDbtServiceToken).not.toHaveBeenCalled();
    expect(mocks.validateDbtConfiguration).toHaveBeenCalledWith(
      dbtEnabled,
      "supplied-token",
    );
  });

  it("reuses the saved token when this save supplies none", async () => {
    await action.run(args({ dbtToken: undefined }), {} as never);
    expect(mocks.validateDbtConfiguration).toHaveBeenCalledWith(
      dbtEnabled,
      "saved-token",
    );
    // The slot is untouched: a save without a token keeps the stored one.
    expect(mocks.writeDbtServiceToken).not.toHaveBeenCalled();
    expect(mocks.commitDbtConfigRevision).toHaveBeenCalledBefore(
      mocks.warehouseRun,
    );
  });

  it("fails a save that needs a token when the slot is empty", async () => {
    mocks.readDbtServiceToken.mockRejectedValue(
      Object.assign(new Error("missing token"), {
        errorCode: "dbt_service_token_missing",
        statusCode: 409,
      }),
    );
    await expect(
      action.run(args({ dbtToken: undefined }), {} as never),
    ).rejects.toMatchObject({
      errorCode: "dbt_service_token_missing",
      statusCode: 409,
    });
    expect(mocks.validateDbtConfiguration).not.toHaveBeenCalled();
    expect(mocks.commitDbtConfigRevision).not.toHaveBeenCalled();
    expect(mocks.warehouseRun).not.toHaveBeenCalled();
  });

  it("never reads the token when the dbt configuration is disabled", async () => {
    await action.run(
      args({
        dbt: { ...dbtEnabled, hasDbtMetadata: false },
        dbtToken: undefined,
      }),
      {} as never,
    );
    expect(mocks.readDbtServiceToken).not.toHaveBeenCalled();
    expect(mocks.validateDbtConfiguration).not.toHaveBeenCalled();
    expect(mocks.writeDbtServiceToken).not.toHaveBeenCalled();
    expect(mocks.commitDbtConfigRevision).toHaveBeenCalled();
  });

  it("writes in order: revision compare-and-swap, connection, then token", async () => {
    await action.run(args(), {} as never);
    expect(mocks.commitDbtConfigRevision).toHaveBeenCalledBefore(
      mocks.warehouseRun,
    );
    expect(mocks.warehouseRun).toHaveBeenCalledBefore(
      mocks.writeDbtServiceToken,
    );
    expect(mocks.commitDbtConfigRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        expectedRevision: 4,
        transaction: { transaction: true },
      }),
    );
    expect(mocks.writeDbtServiceToken).toHaveBeenCalledWith({
      orgId: "org-1",
      token: "supplied-token",
    });
  });

  it("refuses an invalid warehouse project before any dbt token or provider call", async () => {
    const badArgs = args();
    badArgs.connection.projectId = "Bad_Project";
    await expect(action.run(badArgs, {} as never)).rejects.toMatchObject({
      errorCode: "bigquery_project_id_invalid",
      statusCode: 422,
    });
    expect(mocks.readDbtServiceToken).not.toHaveBeenCalled();
    expect(mocks.validateDbtConfiguration).not.toHaveBeenCalled();
    expect(mocks.commitDbtConfigRevision).not.toHaveBeenCalled();
    expect(mocks.warehouseRun).not.toHaveBeenCalled();
    expect(mocks.writeDbtServiceToken).not.toHaveBeenCalled();
  });

  it("refuses a malformed service account key before any dbt access", async () => {
    const badArgs = args();
    badArgs.connection.serviceAccountJson = "{not json";
    await expect(action.run(badArgs, {} as never)).rejects.toMatchObject({
      errorCode: "bigquery_service_account_invalid_json",
      statusCode: 422,
    });
    expect(mocks.readDbtServiceToken).not.toHaveBeenCalled();
    expect(mocks.validateDbtConfiguration).not.toHaveBeenCalled();
    expect(mocks.commitDbtConfigRevision).not.toHaveBeenCalled();
    expect(mocks.warehouseRun).not.toHaveBeenCalled();
  });

  it("accepts a key from another project, since the key project is not the data project", async () => {
    const crossProject = args();
    crossProject.connection.serviceAccountJson = JSON.stringify({
      type: "service_account",
      project_id: "another-project",
      client_email: "analytics@another-project.iam.gserviceaccount.com",
      private_key:
        "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
    });
    await expect(
      action.run(crossProject, {} as never),
    ).resolves.not.toMatchObject({
      errorCode: "bigquery_service_account_project_mismatch",
    });
  });

  it("passes the normalized warehouse values to the original action", async () => {
    const spaced = args({
      connection: {
        connectionName: "  Warehouse  ",
        connectionDescription: "  Primary warehouse  ",
        projectId: "  my-data-project  ",
        serviceAccountJson: JSON.stringify({
          type: "service_account",
          project_id: "my-data-project",
          client_email: "analytics@my-data-project.iam.gserviceaccount.com",
          private_key:
            "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
          extra_field: "kept-verbatim",
        }),
      },
    });
    await action.run(action.schema.parse(spaced), {} as never);
    const [saved] = mocks.warehouseRun.mock.calls[0]! as [
      Record<string, unknown>,
    ];
    expect(saved.projectId).toBe("my-data-project");
    expect(saved.connectionName).toBe("Warehouse");
    expect(saved.connectionDescription).toBe("Primary warehouse");
    const key = JSON.parse(String(saved.serviceAccountJson));
    expect(key.project_id).toBe("my-data-project");
    // The key file's own fields survive the normalization verbatim.
    expect(key.extra_field).toBe("kept-verbatim");
  });

  it("passes the caller's action context through unchanged", async () => {
    // The validated request context is an AsyncLocalStorage fact, not a value
    // this action rebuilds. The warehouse action receives the very object the
    // dispatcher handed over.
    const ctx = {
      caller: "frontend",
      userEmail: "owner@example.com",
      orgId: "org-1",
      credentialScope: "org",
    } as never;
    await action.run(args(), ctx);
    expect(mocks.warehouseRun).toHaveBeenCalledTimes(1);
    expect(mocks.warehouseRun.mock.calls[0]![1]).toBe(ctx);
    expect(mocks.warehouseRun.mock.calls[0]![1]).toMatchObject({
      userEmail: "owner@example.com",
      orgId: "org-1",
    });
  });

  it("passes the exact organization context to the warehouse save", async () => {
    // A synthetic caller context stands in for the dispatcher's own object;
    // the action must hand that very object on, not rebuild one.
    const ctx = {
      caller: "frontend",
      userEmail: "owner@example.com",
      orgId: "org-1",
      credentialScope: "org",
    } as never;
    await action.run(args(), ctx);
    expect(mocks.warehouseRun).toHaveBeenCalledWith(
      {
        action: "save",
        projectId: "my-data-project",
        serviceAccountJson,
        connectionName: "Warehouse",
        connectionDescription: "",
      },
      expect.objectContaining({
        userEmail: "owner@example.com",
        orgId: "org-1",
        credentialScope: "org",
      }),
    );
    expect(mocks.warehouseRun.mock.calls[0]![1]).toBe(ctx);
  });

  it("propagates a stale revision as 409 before the connection is written", async () => {
    mocks.commitDbtConfigRevision.mockRejectedValue(
      Object.assign(new Error("stale"), {
        errorCode: "dbt_configuration_stale",
        statusCode: 409,
      }),
    );
    await expect(action.run(args(), {} as never)).rejects.toMatchObject({
      errorCode: "dbt_configuration_stale",
      statusCode: 409,
    });
    expect(mocks.warehouseRun).not.toHaveBeenCalled();
    expect(mocks.writeDbtServiceToken).not.toHaveBeenCalled();
  });

  it("propagates a warehouse save failure instead of claiming a save", async () => {
    mocks.warehouseRun.mockRejectedValue(
      Object.assign(new Error("credentials not persisted"), {
        errorCode: "bigquery_credentials_not_persisted",
        statusCode: 503,
      }),
    );
    await expect(action.run(args(), {} as never)).rejects.toMatchObject({
      errorCode: "bigquery_credentials_not_persisted",
      statusCode: 503,
    });
    // The token write is after the connection: a failed connection save never
    // reaches it. Whether the committed revision survives is decided by the
    // real transaction, not by this mock.
    expect(mocks.writeDbtServiceToken).not.toHaveBeenCalled();
  });

  it("sanitizes an unexpected failure into one 503 without the cause", async () => {
    mocks.warehouseRun.mockRejectedValue(new Error("relation app_secrets"));
    const failure = await action
      .run(args(), {} as never)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      errorCode: "dbt_connection_save_failed",
      statusCode: 503,
    });
    expect(String((failure as Error).message)).not.toContain("app_secrets");
  });

  it("propagates a vault write failure rather than reporting success", async () => {
    mocks.writeDbtServiceToken.mockRejectedValue(
      Object.assign(new Error("vault down"), {
        errorCode: "dbt_service_token_unavailable",
        statusCode: 503,
      }),
    );
    await expect(action.run(args(), {} as never)).rejects.toMatchObject({
      errorCode: "dbt_service_token_unavailable",
      statusCode: 503,
    });
  });
});
