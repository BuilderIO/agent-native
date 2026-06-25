import { beforeEach, describe, expect, it, vi } from "vitest";

const cooldownRows = new Map<string, Record<string, unknown>>();

vi.mock("../db/client.js", () => ({
  intType: () => "INTEGER",
  isPostgres: () => false,
  getDbExec: () => ({
    execute: async (input: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof input === "string" ? input : input.sql;
      const args = typeof input === "string" ? [] : (input.args ?? []);

      if (/CREATE TABLE|CREATE INDEX/i.test(sql)) {
        return { rows: [], rowsAffected: 0 };
      }

      if (/SELECT provider_id, scope_key, cooldown_until/i.test(sql)) {
        const quotaKey = String(args[0]);
        const row = cooldownRows.get(quotaKey);
        return { rows: row ? [row] : [], rowsAffected: 0 };
      }

      if (/DELETE FROM provider_api_cooldowns/i.test(sql)) {
        cooldownRows.delete(String(args[0]));
        return { rows: [], rowsAffected: 1 };
      }

      if (/INSERT INTO provider_api_cooldowns/i.test(sql)) {
        const [
          quotaKey,
          providerId,
          scopeKey,
          cooldownUntil,
          status,
          reason,
          updatedAt,
        ] = args;
        cooldownRows.set(String(quotaKey), {
          quota_key: quotaKey,
          provider_id: providerId,
          scope_key: scopeKey,
          cooldown_until: cooldownUntil,
          status,
          reason,
          updated_at: updatedAt,
        });
        return { rows: [], rowsAffected: 1 };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },
  }),
}));

const {
  createProviderQuotaIdentity,
  executeWithProviderQuota,
  resetProviderQuotaStateForTests,
} = await import("./quota-governor.js");

describe("provider API quota governor", () => {
  beforeEach(() => {
    cooldownRows.clear();
    resetProviderQuotaStateForTests();
    vi.unstubAllEnvs();
    vi.stubEnv("AGENT_NATIVE_PROVIDER_API_PERSIST_COOLDOWNS", "1");
  });

  it("persists long Retry-After cooldowns and reuses them after memory reset", async () => {
    const identity = createProviderQuotaIdentity({
      appId: "analytics",
      providerId: "hubspot",
      ctx: { userEmail: "ada@example.com", orgId: "org-1" },
      credentialSources: [
        {
          provider: "hubspot",
          key: "HUBSPOT_PRIVATE_APP_TOKEN",
          source: "workspace_connection",
          connectionId: "conn-1",
        },
      ],
    });
    const request = {
      identity,
      method: "GET",
      target: "api.hubapi.com/crm/v3/objects/deals",
    };
    const exhausted = (reason: string, retryAfterMs: number) => ({
      status: 429,
      headers: {},
      exhausted: true,
      reason,
      retryAfterMs,
    });

    const first = await executeWithProviderQuota({
      request,
      maxWaitMs: 1,
      execute: async () => ({
        status: 429,
        headers: { "retry-after": "120" },
      }),
      inspect: (result) => result,
      buildQuotaExhaustedResult: (detail) =>
        exhausted(detail.reason, detail.retryAfterMs),
    });

    expect(first).toMatchObject({
      exhausted: true,
      reason: "retry_after",
    });
    expect(cooldownRows.size).toBe(1);

    resetProviderQuotaStateForTests();
    const execute = vi.fn(async () => ({ status: 200, headers: {} }));
    const second = await executeWithProviderQuota({
      request,
      maxWaitMs: 1,
      execute,
      inspect: (result) => result,
      buildQuotaExhaustedResult: (detail) =>
        exhausted(detail.reason, detail.retryAfterMs),
    });

    expect(execute).not.toHaveBeenCalled();
    expect(second).toMatchObject({
      exhausted: true,
      reason: "cooldown",
    });
  });
});
