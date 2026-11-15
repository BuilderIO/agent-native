import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, expect, it, vi } from "vitest";

const db = new PGlite();
await db.exec(`CREATE TABLE provider_api_cooldowns (
  quota_key TEXT PRIMARY KEY, provider_id TEXT NOT NULL, scope_key TEXT NOT NULL,
  cooldown_until BIGINT NOT NULL, status BIGINT, reason TEXT, updated_at BIGINT NOT NULL
)`);

vi.mock("../db/client.js", async () => {
  const { storeLedgerResult } =
    await import("../db/store-ledger.test-helpers.js");
  return {
    getDbExec: () => ({
      execute: async (input: string | { sql: string; args?: unknown[] }) => {
        const sql = typeof input === "string" ? input : input.sql;
        const ledger = storeLedgerResult(sql);
        if (ledger) return ledger;
        let index = 0;
        const result = await db.query(
          sql.replace(/\?/g, () => `$${++index}`),
          typeof input === "string" ? [] : (input.args ?? []),
        );
        return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
      },
    }),
  };
});
vi.mock("../db/ddl-guard.js", () => ({
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

const {
  createProviderQuotaIdentity,
  executeWithProviderQuota,
  resetProviderQuotaStateForTests,
} = await import("./quota-governor.js");

beforeEach(async () => {
  await db.exec("DELETE FROM provider_api_cooldowns");
  resetProviderQuotaStateForTests();
  vi.stubEnv("AGENT_NATIVE_PROVIDER_API_PERSIST_COOLDOWNS", "1");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-08T12:00:00Z"));
});
afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await db.close();
});

it.each([
  { existingSeconds: 120, responseSeconds: 1 },
  { existingSeconds: 1, responseSeconds: 120 },
])(
  "preserves the longest concurrent cooldown: $existingSeconds / $responseSeconds",
  async ({ existingSeconds, responseSeconds }) => {
    const identity = createProviderQuotaIdentity({
      appId: "mail",
      providerId: "gmail",
      ctx: { userEmail: "reader@example.test" },
      accountId: "mailbox@example.test",
      credentialSources: [],
    });
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: (value: {
      status: number;
      headers: Record<string, string>;
    }) => void;
    const response = new Promise<{
      status: number;
      headers: Record<string, string>;
    }>((resolve) => {
      finish = resolve;
    });
    const options = {
      request: { identity, method: "GET", target: "provider.example/inbox" },
      execute: async () => {
        started();
        return response;
      },
      inspect: (value: { status: number; headers: Record<string, string> }) =>
        value,
      buildQuotaExhaustedResult: () => ({ status: 429, headers: {} }),
      singleAttempt: true,
      maxWaitMs: 1,
    };
    const run = executeWithProviderQuota(options);
    await pending;
    // Another worker observes a limit while this worker's request is in flight.
    await db.query(
      "INSERT INTO provider_api_cooldowns VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [
        identity.quotaKey,
        "gmail",
        identity.scopeKey,
        Date.now() + existingSeconds * 1000,
        429,
        "other-worker",
        Date.now(),
      ],
    );
    finish({
      status: 429,
      headers: { "retry-after": String(responseSeconds) },
    });
    await run;
    resetProviderQuotaStateForTests();
    vi.setSystemTime(new Date("2026-11-08T12:00:10Z"));
    const execute = vi.fn(async () => ({ status: 200, headers: {} }));
    const result = await executeWithProviderQuota({ ...options, execute });
    expect(result.status).toBe(429);
    expect(execute).not.toHaveBeenCalled();
  },
);
