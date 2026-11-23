import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestContext: { orgId: "org-1", userEmail: "Owner@Example.com" } as
    | { orgId?: string; userEmail?: string; credentialScope?: string }
    | undefined,
  credentialContext: { orgId: "org-1", userEmail: "owner@example.com" } as
    | { orgId?: string; userEmail?: string }
    | undefined,
  userEmail: vi.fn(() => "owner@example.com"),
  getOrgSetting: vi.fn(
    async (
      _orgId: string,
      _key: string,
      _options?: { bypassCache?: boolean },
    ): Promise<Record<string, unknown> | null> => null,
  ),
  mutateOrgSetting: vi.fn(
    async (
      _orgId: string,
      _key: string,
      updater: (
        current: Record<string, unknown> | null,
      ) => Record<string, unknown>,
      _options?: { transaction?: unknown },
    ) => updater(null),
  ),
  writeAppSecret: vi.fn(async () => "secret-id"),
  readAppSecret: vi.fn(
    async () => null as { value: string; last4: string } | null,
  ),
  readAppSecretMeta: vi.fn(
    async () => null as { last4: string; updatedAt: number } | null,
  ),
  execTransaction: vi.fn(
    async <T>(fn: (tx: unknown) => Promise<T>) =>
      fn({ execute: vi.fn(), label: "tx" }) as Promise<T>,
  ),
  withDbExec: vi.fn(async (_exec: unknown, run: () => Promise<unknown>) =>
    run(),
  ),
  transactionSupport: true,
  dbTransaction: vi.fn(),
  dbSupportsTransaction: true,
  scopedExec: { execute: vi.fn(async () => ({ rows: [], rowsAffected: 0 })) },
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string, options?: Record<string, unknown>) => {
    throw Object.assign(new Error(message), options);
  },
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestContext: () => mocks.requestContext,
  getCredentialContext: () => mocks.credentialContext,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.userEmail,
}));

vi.mock("@agent-native/core/secrets", () => ({
  writeAppSecret: mocks.writeAppSecret,
  readAppSecret: mocks.readAppSecret,
  readAppSecretMeta: mocks.readAppSecretMeta,
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: mocks.getOrgSetting,
  mutateOrgSetting: mocks.mutateOrgSetting,
}));

vi.mock("../db/index.js", () => ({
  getDb: () =>
    mocks.dbSupportsTransaction ? { transaction: mocks.dbTransaction } : {},
}));

vi.mock("@agent-native/core/db", () => ({
  // `transactionSupport: false` models an executor whose public contract has
  // no `transaction()`; the production code must refuse before any write.
  getDbExec: () => mocks.scopedExec,
  withDbExec: mocks.withDbExec,
}));

const lib = await import("./org-bigquery-dbt.js");

const currentConfig = {
  hasDbtMetadata: true,
  dbtVersion: "current" as const,
  dbtAccountId: "12345",
  dbtProjectId: "67890",
  dbtEnvironmentId: "24680",
  dbtCloudHostname: "cloud.getdbt.com",
};

describe("organization dbt store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestContext = { orgId: "org-1", userEmail: " Owner@Example.com " };
    mocks.credentialContext = {
      orgId: "org-1",
      userEmail: "owner@example.com",
    };
    mocks.userEmail.mockReturnValue("Owner@Example.com");
    mocks.getOrgSetting.mockResolvedValue(null);
    mocks.readAppSecret.mockResolvedValue(null);
    mocks.readAppSecretMeta.mockResolvedValue(null);
    mocks.writeAppSecret.mockResolvedValue("secret-id");
    mocks.transactionSupport = true;
    mocks.dbSupportsTransaction = true;
    mocks.dbTransaction.mockImplementation(async (callback: () => unknown) =>
      callback(),
    );
  });

  it("keeps the locked vault slot and setting key", () => {
    expect(lib.DBT_SERVICE_TOKEN_KEY).toBe(
      "ANALYTICS_WAREHOUSE_DBT_SERVICE_TOKEN",
    );
    expect(lib.ORGANIZATION_BIGQUERY_DBT_SETTING_KEY).toBe(
      "analytics-2.organization-bigquery-dbt",
    );
  });

  describe("requireExactDbtRequestContext", () => {
    it("accepts the same normalized email and organization", () => {
      expect(
        lib.requireExactDbtRequestContext({
          orgId: "org-1",
          userEmail: "owner@example.com",
        }),
      ).toEqual({ orgId: "org-1", userEmail: "owner@example.com" });
    });

    it("rejects a different organization before any store read", async () => {
      mocks.credentialContext = {
        orgId: "org-2",
        userEmail: "owner@example.com",
      };
      expect(() =>
        lib.requireExactDbtRequestContext({
          orgId: "org-1",
          userEmail: "owner@example.com",
        }),
      ).toThrowError(
        expect.objectContaining({
          errorCode: "dbt_org_context_mismatch",
          statusCode: 403,
        }),
      );
      expect(mocks.getOrgSetting).not.toHaveBeenCalled();
      expect(mocks.readAppSecretMeta).not.toHaveBeenCalled();
    });

    it("rejects a mismatched email", () => {
      mocks.requestContext = { orgId: "org-1", userEmail: "other@example.com" };
      expect(() =>
        lib.requireExactDbtRequestContext({
          orgId: "org-1",
          userEmail: "owner@example.com",
        }),
      ).toThrowError(
        expect.objectContaining({ errorCode: "dbt_org_context_mismatch" }),
      );
    });

    it("rejects an empty request context", () => {
      mocks.requestContext = undefined;
      expect(() =>
        lib.requireExactDbtRequestContext({
          orgId: "org-1",
          userEmail: "owner@example.com",
        }),
      ).toThrowError(
        expect.objectContaining({
          errorCode: "dbt_workspace_required",
          statusCode: 403,
        }),
      );
    });
  });

  describe("readOrganizationDbtConfig", () => {
    it("reports absent when the org has no dbt setting", async () => {
      await expect(lib.readOrganizationDbtConfig("org-1")).resolves.toEqual({
        status: "absent",
      });
    });

    it("reads a configured revision and the exact nonsecret config", async () => {
      mocks.getOrgSetting.mockResolvedValue({
        revision: 3,
        config: currentConfig,
      });
      const state = await lib.readOrganizationDbtConfig("org-1");
      expect(state).toEqual({
        status: "configured",
        revision: 3,
        config: currentConfig,
      });
      expect(mocks.getOrgSetting).toHaveBeenCalledWith(
        "org-1",
        "analytics-2.organization-bigquery-dbt",
        { bypassCache: true },
      );
    });

    it("bypasses the per-request settings cache so an external save is visible", async () => {
      // A save from Settings writes in another request. Serving this read from
      // the request snapshot would keep answering the old revision and make a
      // later staleness comparison illusory.
      const cached = { revision: 4, config: currentConfig };
      mocks.getOrgSetting.mockImplementation(
        async (
          _orgId: string,
          _key: string,
          options?: { bypassCache?: boolean },
        ) =>
          options?.bypassCache
            ? { revision: 5, config: currentConfig }
            : cached,
      );
      await expect(lib.readOrganizationDbtConfig("org-1")).resolves.toEqual({
        status: "configured",
        revision: 5,
        config: currentConfig,
      });
    });

    it("fails loudly when the stored setting is not a revision+config record", async () => {
      mocks.getOrgSetting.mockResolvedValue({ config: currentConfig });
      await expect(
        lib.readOrganizationDbtConfig("org-1"),
      ).rejects.toMatchObject({
        errorCode: "dbt_configuration_unreadable",
        statusCode: 503,
      });
    });

    it("rejects a stored config that carries a token", async () => {
      mocks.getOrgSetting.mockResolvedValue({
        revision: 1,
        config: { ...currentConfig, dbtToken: "dbt_abc" },
      });
      await expect(
        lib.readOrganizationDbtConfig("org-1"),
      ).rejects.toMatchObject({
        errorCode: "dbt_configuration_unreadable",
        statusCode: 503,
      });
    });

    it("rejects an unknown dbt version", async () => {
      mocks.getOrgSetting.mockResolvedValue({
        revision: 1,
        config: { ...currentConfig, dbtVersion: "future" },
      });
      await expect(
        lib.readOrganizationDbtConfig("org-1"),
      ).rejects.toMatchObject({
        errorCode: "dbt_configuration_unreadable",
      });
    });

    it("surfaces a store lookup failure as 503, not as absent", async () => {
      mocks.getOrgSetting.mockRejectedValue(new Error("db down"));
      await expect(
        lib.readOrganizationDbtConfig("org-1"),
      ).rejects.toMatchObject({
        errorCode: "dbt_configuration_store_unavailable",
        statusCode: 503,
      });
    });
  });

  describe("dbt service token slot", () => {
    it("reads only the exact org-scoped slot", async () => {
      mocks.readAppSecret.mockResolvedValue({
        value: "dbt_token",
        last4: "oken",
      });
      await expect(lib.readDbtServiceToken("org-1")).resolves.toBe("dbt_token");
      expect(mocks.readAppSecret).toHaveBeenCalledWith({
        key: "ANALYTICS_WAREHOUSE_DBT_SERVICE_TOKEN",
        scope: "org",
        scopeId: "org-1",
      });
    });

    it("treats an absent token as 409 and never falls back", async () => {
      mocks.readAppSecret.mockResolvedValue(null);
      await expect(lib.readDbtServiceToken("org-1")).rejects.toMatchObject({
        errorCode: "dbt_service_token_missing",
        statusCode: 409,
      });
      expect(mocks.readAppSecret).toHaveBeenCalledTimes(1);
    });

    it("treats a blank stored token as 409", async () => {
      mocks.readAppSecret.mockResolvedValue({ value: "   ", last4: "" });
      await expect(lib.readDbtServiceToken("org-1")).rejects.toMatchObject({
        errorCode: "dbt_service_token_missing",
        statusCode: 409,
      });
    });

    it("treats a vault read error as 503", async () => {
      mocks.readAppSecret.mockRejectedValue(new Error("vault down"));
      await expect(lib.readDbtServiceToken("org-1")).rejects.toMatchObject({
        errorCode: "dbt_service_token_unavailable",
        statusCode: 503,
      });
    });

    it("reports token presence from metadata without returning the value", async () => {
      mocks.readAppSecretMeta.mockResolvedValue({
        last4: "••••oken",
        updatedAt: 1,
      });
      const state = await lib.getDbtServiceTokenState("org-1");
      expect(state).toEqual({ tokenConfigured: true });
      expect(mocks.readAppSecretMeta).toHaveBeenCalledWith({
        key: "ANALYTICS_WAREHOUSE_DBT_SERVICE_TOKEN",
        scope: "org",
        scopeId: "org-1",
      });
      expect(JSON.stringify(state)).not.toContain("••••oken");
    });

    it("reports an absent slot as not configured", async () => {
      mocks.readAppSecretMeta.mockResolvedValue(null);
      await expect(lib.getDbtServiceTokenState("org-1")).resolves.toEqual({
        tokenConfigured: false,
      });
    });

    it("reports an unreadable slot as 503 rather than missing", async () => {
      mocks.readAppSecretMeta.mockRejectedValue(new Error("vault down"));
      await expect(lib.getDbtServiceTokenState("org-1")).rejects.toMatchObject({
        errorCode: "dbt_service_token_unavailable",
        statusCode: 503,
      });
    });

    it("writes the exact org-scoped slot for this organization only", async () => {
      await lib.writeDbtServiceToken({ orgId: "org-1", token: "dbt_token" });
      expect(mocks.writeAppSecret).toHaveBeenCalledWith({
        key: "ANALYTICS_WAREHOUSE_DBT_SERVICE_TOKEN",
        scope: "org",
        scopeId: "org-1",
        value: "dbt_token",
      });
    });

    it("refuses a blank token before writing", async () => {
      await expect(
        lib.writeDbtServiceToken({ orgId: "org-1", token: "  " }),
      ).rejects.toMatchObject({ statusCode: 422 });
      expect(mocks.writeAppSecret).not.toHaveBeenCalled();
    });

    it("maps a vault write error to 503 without echoing the token", async () => {
      mocks.writeAppSecret.mockRejectedValue(new Error("vault down"));
      const failure = await lib
        .writeDbtServiceToken({ orgId: "org-1", token: "dbt_token" })
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({
        errorCode: "dbt_service_token_unavailable",
        statusCode: 503,
      });
      expect(String((failure as Error).message)).not.toContain("dbt_token");
    });
  });

  describe("revision commit", () => {
    it("compares expectedRevision and increments inside the caller transaction", async () => {
      const tx = { execute: vi.fn() };
      mocks.mutateOrgSetting.mockImplementation(
        async (_orgId, _key, updater, options) => {
          expect(options?.transaction).toBe(tx);
          return updater({ revision: 2, config: currentConfig }) as Record<
            string,
            unknown
          >;
        },
      );
      const revision = await lib.commitDbtConfigRevision({
        orgId: "org-1",
        config: currentConfig,
        expectedRevision: 2,
        transaction: tx as never,
      });
      expect(revision).toBe(3);
      expect(mocks.mutateOrgSetting).toHaveBeenCalledWith(
        "org-1",
        "analytics-2.organization-bigquery-dbt",
        expect.any(Function),
        { transaction: tx },
      );
      // The option object is a plain structural value: no cast and no
      // suppressed type, and the same runtime object the public helper takes.
      expect(mocks.mutateOrgSetting.mock.calls[0]![3]).toEqual({
        transaction: tx,
      });
    });

    it("rejects a stale expectedRevision with 409 before any write", async () => {
      const tx = { execute: vi.fn() };
      mocks.mutateOrgSetting.mockImplementation(
        async (_orgId, _key, updater) =>
          updater({ revision: 5, config: currentConfig }) as Record<
            string,
            unknown
          >,
      );
      await expect(
        lib.commitDbtConfigRevision({
          orgId: "org-1",
          config: currentConfig,
          expectedRevision: 4,
          transaction: tx as never,
        }),
      ).rejects.toMatchObject({
        errorCode: "dbt_configuration_stale",
        statusCode: 409,
      });
      expect(mocks.writeAppSecret).not.toHaveBeenCalled();
    });

    it("refuses to overwrite an unreadable stored record", async () => {
      const tx = { execute: vi.fn() };
      mocks.mutateOrgSetting.mockImplementation(async (_orgId, _key, updater) =>
        updater({ revision: "many" } as unknown as Record<string, unknown>),
      );
      await expect(
        lib.commitDbtConfigRevision({
          orgId: "org-1",
          config: currentConfig,
          expectedRevision: 0,
          transaction: tx as never,
        }),
      ).rejects.toMatchObject({ errorCode: "dbt_configuration_unreadable" });
    });
  });

  describe("transaction wrapper", () => {
    it("refuses to run when the app database has no transaction support", async () => {
      mocks.dbSupportsTransaction = false;
      await expect(
        lib.withOrganizationDbtTransaction(async () => "never"),
      ).rejects.toMatchObject({
        errorCode: "dbt_transaction_unavailable",
        statusCode: 503,
      });
      expect(mocks.execTransaction).not.toHaveBeenCalled();
      expect(mocks.mutateOrgSetting).not.toHaveBeenCalled();
      expect(mocks.writeAppSecret).not.toHaveBeenCalled();
    });

    it("opens the transaction on the public app Drizzle handle", async () => {
      // getDbExec().transaction() holds the pool without installing the
      // Drizzle transaction scope, so a nested getDb() read self-deadlocks on a
      // single-connection pool. getDb().transaction() installs both scopes.
      const seen: unknown[] = [];
      const result = await lib.withOrganizationDbtTransaction(async (tx) => {
        seen.push(tx);
        return "ok";
      });
      expect(result).toBe("ok");
      expect(mocks.dbTransaction).toHaveBeenCalledTimes(1);
      expect(mocks.execTransaction).not.toHaveBeenCalled();
      expect(seen).toEqual([mocks.scopedExec]);
      expect(mocks.withDbExec).not.toHaveBeenCalled();
    });
  });
});
