import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  curator: vi.fn(),
  view: vi.fn(),
  meta: vi.fn(),
  token: vi.fn(),
}));
vi.mock("./_semantic-helpers.js", () => ({
  requireSemanticOrg: async () => "org-test",
  requireBigQueryModelCurator: mocks.curator,
}));
vi.mock("../server/lib/org-bigquery-dbt.js", () => ({
  requireDbtUserEmail: () => "admin@example.test",
  requireExactDbtRequestContext: (value: unknown) => value,
  readOrganizationDbtConfigView: mocks.view,
  getDbtServiceTokenState: mocks.meta,
  readDbtServiceToken: mocks.token,
}));
const { default: action } = await import("./get-organization-bigquery-dbt.js");
beforeEach(() => {
  vi.resetAllMocks();
  mocks.curator.mockResolvedValue(undefined);
  mocks.view.mockResolvedValue({
    revision: 3,
    config: { hasDbtMetadata: false, dbtVersion: "current" },
    dbtEnabled: false,
  });
  mocks.meta.mockResolvedValue({ tokenConfigured: true });
});
it("reports token presence for an edit while dbt is off without decrypting it", async () => {
  const result = await action.run(
    action.schema.parse({ forEdit: true }),
    {} as never,
  );
  expect(result.tokenConfigured).toBe(true);
  expect(result.editOrgId).toBe("org-test");
  expect(mocks.meta).toHaveBeenCalledWith("org-test");
  expect(mocks.token).not.toHaveBeenCalled();
});
it("retains the default disabled read without touching token metadata", async () => {
  expect(
    (await action.run(action.schema.parse({}), {} as never)).tokenConfigured,
  ).toBe(false);
  expect(mocks.meta).not.toHaveBeenCalled();
  expect(mocks.token).not.toHaveBeenCalled();
});
it("propagates an edit metadata lookup failure rather than claiming no token exists", async () => {
  const failure = Object.assign(new Error("Metadata unavailable"), {
    errorCode: "dbt_service_token_unavailable",
    statusCode: 503,
  });
  mocks.meta.mockRejectedValue(failure);
  await expect(
    action.run(action.schema.parse({ forEdit: true }), {} as never),
  ).rejects.toBe(failure);
  expect(mocks.token).not.toHaveBeenCalled();
});
it("refuses non-curators before reading settings or token metadata", async () => {
  const failure = Object.assign(new Error("Curator required"), {
    statusCode: 403,
  });
  mocks.curator.mockRejectedValue(failure);
  await expect(
    action.run(action.schema.parse({ forEdit: true }), {} as never),
  ).rejects.toBe(failure);
  expect(mocks.view).not.toHaveBeenCalled();
  expect(mocks.meta).not.toHaveBeenCalled();
  expect(mocks.token).not.toHaveBeenCalled();
});
