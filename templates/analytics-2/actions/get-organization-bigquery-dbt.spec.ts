import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSemanticOrg: vi.fn(async () => "org-1"),
  requireBigQueryModelCurator: vi.fn(async () => undefined),
  requireExact: vi.fn(() => ({
    orgId: "org-1",
    userEmail: "owner@example.com",
  })),
  readOrganizationDbtConfigView: vi.fn(),
  getDbtServiceTokenState: vi.fn(async () => ({ tokenConfigured: true })),
  readDbtServiceToken: vi.fn(async () => "dbt-token-fixture"),
}));

vi.mock("@agent-native/core/action", () => ({
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
  getRequestUserEmail: () => "owner@example.com",
}));

vi.mock("../server/lib/org-bigquery-dbt.js", () => ({
  readOrganizationDbtConfigView: mocks.readOrganizationDbtConfigView,
  getDbtServiceTokenState: mocks.getDbtServiceTokenState,
  readDbtServiceToken: mocks.readDbtServiceToken,
  requireDbtUserEmail: () => "owner@example.com",
  requireExactDbtRequestContext: mocks.requireExact,
}));

const { default: action } = await import("./get-organization-bigquery-dbt.js");

const config = {
  hasDbtMetadata: true,
  dbtVersion: "current" as const,
  dbtAccountId: "12345",
  dbtProjectId: "67890",
  dbtEnvironmentId: "24680",
  dbtCloudHostname: "cloud.getdbt.com",
};

describe("get organization dbt configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSemanticOrg.mockResolvedValue("org-1");
    mocks.requireBigQueryModelCurator.mockResolvedValue(undefined);
    mocks.requireExact.mockReturnValue({
      orgId: "org-1",
      userEmail: "owner@example.com",
    });
    mocks.readOrganizationDbtConfigView.mockResolvedValue({
      revision: 7,
      config,
      dbtEnabled: true,
    });
    mocks.getDbtServiceTokenState.mockResolvedValue({ tokenConfigured: true });
    mocks.readDbtServiceToken.mockResolvedValue("dbt-token-fixture");
  });

  it("returns the sanitized configuration, revision and token presence only", async () => {
    const result = await action.run({}, {} as never);
    expect(result).toEqual({
      revision: 7,
      config,
      dbtEnabled: true,
      tokenConfigured: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/token"|manifest|last4/i);
    // Presence is proved by metadata, then the exact slot is actually read and
    // discarded: a corrupt or blank token must not read as configured.
    expect(mocks.getDbtServiceTokenState).toHaveBeenCalledWith("org-1");
    expect(mocks.readDbtServiceToken).toHaveBeenCalledWith("org-1");
    expect(JSON.stringify(result)).not.toContain("dbt-token-fixture");
  });

  it("fails 503 when the stored token cannot be decrypted", async () => {
    mocks.readDbtServiceToken.mockRejectedValue(
      Object.assign(new Error("undecryptable"), {
        errorCode: "dbt_service_token_unavailable",
        statusCode: 503,
      }),
    );
    await expect(action.run({}, {} as never)).rejects.toMatchObject({
      errorCode: "dbt_service_token_unavailable",
      statusCode: 503,
    });
  });

  it("fails 409 when the stored token is blank or absent", async () => {
    mocks.readDbtServiceToken.mockRejectedValue(
      Object.assign(new Error("missing token"), {
        errorCode: "dbt_service_token_missing",
        statusCode: 409,
      }),
    );
    await expect(action.run({}, {} as never)).rejects.toMatchObject({
      errorCode: "dbt_service_token_missing",
      statusCode: 409,
    });
  });

  it("declares a strict output schema that asserts the safe shape", async () => {
    const result = await action.run({}, {} as never);
    expect(action.outputSchema).toBeDefined();
    expect(action.outputSchema.parse(result)).toEqual(result);
    expect(() =>
      action.outputSchema.parse({ ...result, dbtToken: "dbt-token" }),
    ).toThrow();
    expect(() =>
      action.outputSchema.parse({ ...result, tokenLast4: "••••oken" }),
    ).toThrow();
    expect(() =>
      action.outputSchema.parse({
        ...result,
        config: { hasDbtMetadata: true },
      }),
    ).toThrow();
  });

  it("checks scope and role before reading the configuration", async () => {
    mocks.requireBigQueryModelCurator.mockRejectedValue(
      Object.assign(new Error("curator only"), {
        errorCode: "semantic_model_source_admin_required",
        statusCode: 403,
      }),
    );
    await expect(
      action.run({ forEdit: true }, {} as never),
    ).rejects.toMatchObject({
      errorCode: "semantic_model_source_admin_required",
      statusCode: 403,
    });
    expect(mocks.readOrganizationDbtConfigView).not.toHaveBeenCalled();
    expect(mocks.getDbtServiceTokenState).not.toHaveBeenCalled();
  });

  it("report 478: a non-curator member reads dbt on/off and version without connection ids or token state", async () => {
    mocks.requireBigQueryModelCurator.mockRejectedValue(
      Object.assign(new Error("curator only"), {
        errorCode: "semantic_model_source_admin_required",
        statusCode: 403,
      }),
    );
    mocks.readOrganizationDbtConfigView.mockResolvedValue({
      revision: 5,
      dbtEnabled: true,
      config: {
        hasDbtMetadata: true,
        dbtVersion: "current",
        dbtEnvironmentId: "42",
        dbtCloudHostname: "cloud.getdbt.com",
      },
    });
    const result = await action.run({}, {} as never);
    expect(result).toEqual({
      revision: 5,
      dbtEnabled: true,
      tokenConfigured: false,
      config: { hasDbtMetadata: true, dbtVersion: "current" },
    });
    expect(() => action.outputSchema.parse(result)).not.toThrow();
    expect(mocks.getDbtServiceTokenState).not.toHaveBeenCalled();
  });

  it("refuses a mismatched workspace context before any read", async () => {
    mocks.requireExact.mockImplementation(() => {
      throw Object.assign(new Error("wrong workspace"), {
        errorCode: "dbt_org_context_mismatch",
        statusCode: 403,
      });
    });
    await expect(action.run({}, {} as never)).rejects.toMatchObject({
      errorCode: "dbt_org_context_mismatch",
    });
    expect(mocks.readOrganizationDbtConfigView).not.toHaveBeenCalled();
  });

  it("returns an absent configuration without touching the vault", async () => {
    mocks.readOrganizationDbtConfigView.mockResolvedValue({
      revision: null,
      config: null,
      dbtEnabled: false,
    });
    await expect(action.run({}, {} as never)).resolves.toEqual({
      revision: null,
      config: null,
      dbtEnabled: false,
      tokenConfigured: false,
    });
    expect(mocks.getDbtServiceTokenState).not.toHaveBeenCalled();
    expect(mocks.readDbtServiceToken).not.toHaveBeenCalled();
  });

  it("never reads the token when dbt is disabled", async () => {
    mocks.readOrganizationDbtConfigView.mockResolvedValue({
      revision: 3,
      config: { ...config, hasDbtMetadata: false },
      dbtEnabled: false,
    });
    const result = await action.run({}, {} as never);
    expect(result).toMatchObject({ revision: 3, tokenConfigured: false });
    expect(mocks.getDbtServiceTokenState).not.toHaveBeenCalled();
    expect(mocks.readDbtServiceToken).not.toHaveBeenCalled();
  });

  it("reports an unreadable stored configuration as 503", async () => {
    mocks.readOrganizationDbtConfigView.mockRejectedValue(
      Object.assign(new Error("unreadable"), {
        errorCode: "dbt_configuration_unreadable",
        statusCode: 503,
      }),
    );
    await expect(action.run({}, {} as never)).rejects.toMatchObject({
      errorCode: "dbt_configuration_unreadable",
      statusCode: 503,
    });
  });
});
