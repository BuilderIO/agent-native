// oracle-change: migrate the removed provider/connectionId contract to the strict id schema and its current scoped role/storage boundary.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: { orgId: "org-1", userEmail: "owner@example.test" },
  credentialScope: "org",
  credentialOrg: "org-1",
  credentialState: "configured",
  manager: true,
  saved: null as Record<string, unknown> | null,
  put: vi.fn(),
  resolve: vi.fn(),
  catalog: vi.fn(),
  readRole: vi.fn(),
}));

vi.mock(import("@agent-native/core/server"), async (importOriginal) => ({
  ...(await importOriginal()),
  getRequestContext: () => mocks.context,
  readOrgMemberRole: mocks.readRole,
  runWithRequestContext: (_context: unknown, run: () => unknown) => run(),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: () => mocks.context.userEmail,
}));
vi.mock("@agent-native/core/credentials", () => ({
  resolveCredentialDetailed: mocks.resolve,
}));
vi.mock("@agent-native/core/workspace-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/workspace-connections")
  >()),
  listWorkspaceConnectionProviderCatalogForApp: mocks.catalog,
  resolveWorkspaceConnectionForApp: vi.fn(),
}));
vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: async () => mocks.saved,
  putOrgSetting: mocks.put,
  deleteOrgSetting: async () => {
    mocks.saved = null;
  },
}));
vi.mock("../server/lib/provider-api.js", () => ({
  ANALYTICS_2_APP_ID: "analytics-2",
}));

import { ORGANIZATION_BIGQUERY_SOURCE_ID } from "../shared/bigquery-source-contract.js";
const { default: action } = await import("./set-default-data-connection.js");
const input = { id: ORGANIZATION_BIGQUERY_SOURCE_ID };

describe("organization warehouse workspace default", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context = { orgId: "org-1", userEmail: "owner@example.test" };
    mocks.credentialScope = "org";
    mocks.credentialOrg = "org-1";
    mocks.credentialState = "configured";
    mocks.manager = true;
    mocks.saved = null;
    mocks.catalog.mockResolvedValue({ providers: [] });
    mocks.readRole.mockImplementation(async (org: string, email: string) =>
      org === "org-1" && email === "owner@example.test"
        ? mocks.manager
          ? "owner"
          : "member"
        : null,
    );
    mocks.resolve.mockImplementation(async (key: string, context: unknown) => {
      if (mocks.credentialState === "unavailable")
        throw new Error("Storage unavailable");
      if (
        mocks.credentialState === "missing" ||
        (mocks.credentialState === "partial" && key !== "BIGQUERY_PROJECT_ID")
      )
        return null;
      expect(context).toEqual({
        userEmail: "owner@example.test",
        orgId: "org-1",
        credentialScope: "org",
      });
      return {
        scope: mocks.credentialScope,
        scopeId: mocks.credentialOrg,
        value:
          key === "BIGQUERY_PROJECT_ID"
            ? "qa-project"
            : "flagged-source-credential",
      };
    });
    mocks.put.mockImplementation(
      async (_org: string, _key: string, value: Record<string, unknown>) => {
        mocks.saved = value;
      },
    );
  });

  it("saves, reads back and clears one exact-organization default without a catalog grant", async () => {
    expect(await action.run(input, {} as never)).toEqual(input);
    expect(mocks.readRole).toHaveBeenCalledWith("org-1", "owner@example.test");
    expect(mocks.put).toHaveBeenCalledWith(
      "org-1",
      "analytics.data.default-connection",
      input,
    );
    expect(mocks.saved).toEqual(input);
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.saved)).not.toContain(
      "flagged-source-credential",
    );
    expect(await action.run({ id: null }, {} as never)).toEqual({ id: null });
    expect(mocks.saved).toEqual({ id: null });
  });

  it.each(["missing", "partial", "unavailable"])(
    "refuses %s credentials before writing",
    async (state) => {
      mocks.credentialState = state;
      await expect(action.run(input, {} as never)).rejects.toMatchObject({
        statusCode: state === "unavailable" ? 503 : 409,
        ...(state === "unavailable"
          ? {
              errorCode: "bigquery_credentials_unavailable",
              message: expect.not.stringContaining("Storage unavailable"),
            }
          : {}),
      });
      expect(mocks.put).not.toHaveBeenCalled();
      expect(mocks.catalog).not.toHaveBeenCalled();
    },
  );

  it.each(["user", "foreign-org"])(
    "refuses %s credential fallback",
    async (scope) => {
      if (scope === "user") mocks.credentialScope = "user";
      else mocks.credentialOrg = "org-2";
      await expect(action.run(input, {} as never)).rejects.toMatchObject({
        statusCode: 409,
      });
      expect(mocks.put).not.toHaveBeenCalled();
    },
  );

  it("refuses an active organization mismatch before reading credentials", async () => {
    mocks.context = { ...mocks.context, orgId: "org-2" };
    await expect(action.run(input, {} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("refuses members before credential access", async () => {
    mocks.manager = false;
    await expect(action.run(input, {} as never)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it("rejects the reserved source paired with another provider", async () => {
    expect(
      action.schema.safeParse({ ...input, provider: "other" }).success,
    ).toBe(false);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });
});
