import { beforeEach, describe, expect, it, vi } from "vitest";

const forbidden = Object.assign(new Error("Curator access required"), {
  errorCode: "semantic_model_source_admin_required",
  statusCode: 403,
});
const mocks = vi.hoisted(() => ({
  curator: vi.fn(),
  config: vi.fn(),
  token: vi.fn(),
  provider: vi.fn(),
  discover: vi.fn(),
  exact: vi.fn(),
}));
vi.mock("./_semantic-helpers.js", () => ({
  requireSemanticOrg: async () => "org-test",
  requireBigQueryModelCurator: mocks.curator,
}));
vi.mock("../server/lib/org-bigquery-dbt.js", () => ({
  requireDbtUserEmail: () => "member@example.test",
  requireExactDbtRequestContext: mocks.exact,
  readOrganizationDbtConfig: mocks.config,
  readDbtServiceToken: mocks.token,
  sanitizeDbtConfiguration: (value: unknown) => value,
}));
vi.mock("./discover-bigquery-table-schema.js", () => ({
  default: { run: mocks.discover },
}));
vi.mock("../server/lib/warehouse-dbt.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/warehouse-dbt.js")>()),
  readDbtTableMetadataWithToken: mocks.provider,
}));
const { default: action } =
  await import("./get-organization-bigquery-dbt-metadata.js");
const read = () =>
  action.run({ tableReference: "data-project.analytics.orders" }, {} as never);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.exact.mockReturnValue({
    orgId: "org-test",
    userEmail: "member@example.test",
  });
  mocks.curator.mockRejectedValue(forbidden);
});

describe("dbt-disabled table read by a workspace member", () => {
  it.each([
    { state: { status: "absent" }, revision: null },
    {
      state: {
        status: "configured",
        revision: 7,
        config: { hasDbtMetadata: false },
      },
      revision: 7,
    },
  ])(
    "returns no metadata without curator or provider access for $state.status config",
    async ({ state, revision }) => {
      mocks.config.mockResolvedValue(state);
      await expect(read()).resolves.toEqual({
        dbtEnabled: false,
        dbtRevision: revision,
        tableIdentity: null,
        metadata: null,
      });
      expect(mocks.curator).not.toHaveBeenCalled();
      expect(mocks.discover).not.toHaveBeenCalled();
      expect(mocks.token).not.toHaveBeenCalled();
      expect(mocks.provider).not.toHaveBeenCalled();
    },
  );

  it("does not apply the curator restriction to an enabled integration", async () => {
    mocks.config.mockResolvedValue({
      status: "configured",
      revision: 7,
      config: { hasDbtMetadata: true },
    });
    mocks.discover.mockRejectedValue(new Error("stop after the role point"));
    await expect(read()).rejects.toThrow("stop after the role point");
    expect(mocks.curator).not.toHaveBeenCalled();
    expect(mocks.discover).toHaveBeenCalledTimes(1);
  });

  it("propagates an unreadable configuration instead of reporting dbt disabled", async () => {
    const failure = new Error("Configuration lookup unavailable");
    mocks.config.mockRejectedValue(failure);
    await expect(read()).rejects.toBe(failure);
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("still refuses a mismatched workspace before reading configuration", async () => {
    const failure = new Error("Active workspace mismatch");
    mocks.exact.mockImplementation(() => {
      throw failure;
    });
    await expect(read()).rejects.toBe(failure);
    expect(mocks.config).not.toHaveBeenCalled();
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });
});
