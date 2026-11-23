import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  curator: vi.fn(),
  exact: vi.fn(),
  credentials: vi.fn(),
  token: vi.fn(),
  validate: vi.fn(),
  commit: vi.fn(),
  writeToken: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("./_semantic-helpers.js", () => ({
  requireSemanticOrg: mocks.member,
  requireBigQueryModelCurator: mocks.curator,
}));
vi.mock("../server/lib/org-bigquery-credentials.js", () => ({
  requireOrganizationBigQueryCredentials: mocks.credentials,
}));
vi.mock("../server/lib/org-bigquery-dbt.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/org-bigquery-dbt.js")
  >()),
  requireDbtUserEmail: () => "admin@example.test",
  requireExactDbtRequestContext: mocks.exact,
  readDbtServiceToken: mocks.token,
  commitDbtConfigRevision: mocks.commit,
  writeDbtServiceToken: mocks.writeToken,
  withOrganizationDbtTransaction: mocks.transaction,
}));
vi.mock("../server/lib/warehouse-dbt.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/warehouse-dbt.js")>()),
  validateDbtConfiguration: mocks.validate,
}));
const { default: action } =
  await import("./save-organization-bigquery-dbt-settings.js");
const config = {
  hasDbtMetadata: true,
  dbtVersion: "current" as const,
  dbtEnvironmentId: "42",
  dbtCloudHostname: "cloud.getdbt.com",
};
const active = { orgId: "org-test", userEmail: "admin@example.test" };
const tx = { fixture: "transaction" };
const run = (input: unknown) =>
  action.run(
    action.schema.parse({ expectedOrgId: active.orgId, ...(input as object) }),
    {
      caller: "frontend",
      userEmail: active.userEmail,
      orgId: active.orgId,
    } as never,
  );
beforeEach(() => {
  vi.resetAllMocks();
  mocks.member.mockResolvedValue(active.orgId);
  mocks.curator.mockResolvedValue(undefined);
  mocks.exact.mockReturnValue(active);
  mocks.credentials.mockResolvedValue(undefined);
  mocks.token.mockResolvedValue("stored-dbt-token");
  mocks.validate.mockResolvedValue(undefined);
  mocks.commit.mockResolvedValue(9);
  mocks.writeToken.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (callback) => callback(tx));
});
describe("edit dbt on the existing organization connection", () => {
  it("requires the workspace identity captured when the edit form was opened", () => {
    expect(
      action.schema.safeParse({ dbt: config, expectedRevision: 8 }).success,
    ).toBe(false);
  });
  it("refuses a form opened in another workspace before checking credentials or writing", async () => {
    await expect(
      run({ dbt: config, expectedRevision: 8, expectedOrgId: "previous-org" }),
    ).rejects.toMatchObject({
      errorCode: "dbt_org_context_mismatch",
      statusCode: 403,
    });
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("refuses a tool caller before any connection, credential or write work", async () => {
    await expect(
      action.run(
        action.schema.parse({
          dbt: config,
          expectedRevision: 8,
          expectedOrgId: active.orgId,
        }),
        {
          caller: "tool",
        } as never,
      ),
    ).rejects.toMatchObject({ errorCode: "ui_only_action", statusCode: 403 });
    expect(mocks.member).not.toHaveBeenCalled();
    expect(mocks.curator).not.toHaveBeenCalled();
    expect(mocks.exact).not.toHaveBeenCalled();
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.writeToken).not.toHaveBeenCalled();
  });
  it("saves without a warehouse payload and preserves the stored dbt token when blank", async () => {
    const result = await run({
      dbt: config,
      expectedRevision: 8,
      dbtToken: "",
    });
    expect(result).toEqual({ changed: true, dbtEnabled: true, dbtRevision: 9 });
    expect(mocks.credentials).toHaveBeenCalledWith(active);
    expect(mocks.validate).toHaveBeenCalledWith(config, "stored-dbt-token");
    expect(mocks.commit).toHaveBeenCalledWith({
      orgId: active.orgId,
      config,
      expectedRevision: 8,
      transaction: tx,
    });
    expect(mocks.writeToken).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("stored-dbt-token");
  });
  it("validates a replacement before committing it in the same transaction", async () => {
    await run({
      dbt: config,
      expectedRevision: 8,
      dbtToken: "replacement-dbt-token",
    });
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.validate).toHaveBeenCalledWith(
      config,
      "replacement-dbt-token",
    );
    expect(mocks.validate).toHaveBeenCalledBefore(mocks.transaction);
    expect(mocks.commit).toHaveBeenCalledBefore(mocks.writeToken);
    expect(mocks.writeToken).toHaveBeenCalledWith({
      orgId: active.orgId,
      token: "replacement-dbt-token",
    });
  });
  it("disables dbt without reading or replacing any token", async () => {
    const disabled = { ...config, hasDbtMetadata: false };
    await expect(run({ dbt: disabled, expectedRevision: 8 })).resolves.toEqual({
      changed: true,
      dbtEnabled: false,
      dbtRevision: 9,
    });
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(mocks.writeToken).not.toHaveBeenCalled();
  });
  it("refuses members before checking the connection or token", async () => {
    const denied = Object.assign(new Error("Admin required"), {
      errorCode: "semantic_model_source_admin_required",
      statusCode: 403,
    });
    mocks.curator.mockRejectedValue(denied);
    await expect(run({ dbt: config, expectedRevision: 8 })).rejects.toBe(
      denied,
    );
    expect(mocks.credentials).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("requires an existing configured warehouse connection before validating dbt", async () => {
    const absent = Object.assign(new Error("Warehouse not configured"), {
      errorCode: "bigquery_org_credentials_missing",
      statusCode: 409,
    });
    mocks.credentials.mockRejectedValue(absent);
    await expect(run({ dbt: config, expectedRevision: 8 })).rejects.toBe(
      absent,
    );
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("does not open a write transaction when dbt validation fails", async () => {
    const failure = Object.assign(new Error("dbt refused"), {
      errorCode: "data_dbt_access_denied",
      statusCode: 403,
    });
    mocks.validate.mockRejectedValue(failure);
    await expect(run({ dbt: config, expectedRevision: 8 })).rejects.toBe(
      failure,
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("refuses a stale revision before replacing the token", async () => {
    const stale = Object.assign(new Error("Stale revision"), {
      errorCode: "dbt_configuration_stale",
      statusCode: 409,
    });
    mocks.commit.mockRejectedValue(stale);
    await expect(
      run({
        dbt: config,
        expectedRevision: 8,
        dbtToken: "replacement-dbt-token",
      }),
    ).rejects.toBe(stale);
    expect(mocks.writeToken).not.toHaveBeenCalled();
  });
  it("keeps its HTTP result and input private and refuses warehouse key fields", () => {
    expect(
      action.schema.safeParse({
        dbt: config,
        expectedRevision: 8,
        serviceAccountJson: "unexpected-key-field",
        expectedOrgId: active.orgId,
      }).success,
    ).toBe(false);
    expect(action.uiOnly).toBe(true);
    expect(action.agentTool).toBe(false);
    expect(action.audit?.recordInputs).toBe(false);
    expect(
      action.outputSchema?.safeParse({
        changed: true,
        dbtRevision: 9,
        dbtEnabled: true,
        dbtToken: "unexpected-token-field",
      }).success,
    ).toBe(false);
  });
});
