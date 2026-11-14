import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cooldownRows = new Map<string, Record<string, unknown>>();

vi.mock("../db/client.js", async () => {
  const { storeLedgerResult } =
    await import("../db/store-ledger.test-helpers.js");
  return {
    getDbExec: () => ({
      execute: async (input: string | { sql: string; args?: unknown[] }) => {
        const sql = typeof input === "string" ? input : input.sql;
        const args = typeof input === "string" ? [] : (input.args ?? []);
        const ledger = storeLedgerResult(sql);
        if (ledger) return ledger;

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
  };
});

vi.mock("../db/ddl-guard.js", () => ({
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

const {
  createProviderQuotaIdentity,
  createProviderRequestDedupeKey,
  executeWithProviderQuota,
  ensureCooldownTable,
  resetProviderQuotaStateForTests,
} = await import("./quota-governor.js");
const { ensureTableExists } = await import("../db/ddl-guard.js");
const { getOrCreateRequestDbPool, runWithRequestDbPoolScope } =
  await import("../db/request-pool-context.js");

describe("provider API quota governor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    cooldownRows.clear();
    resetProviderQuotaStateForTests();
    vi.unstubAllEnvs();
    vi.stubEnv("AGENT_NATIVE_PROVIDER_API_PERSIST_COOLDOWNS", "1");
  });

  it.each(["first attempt", "retry"] as const)(
    "prepares each attempt outside the account queue while the %s hook is pending",
    async (pendingAttempt) => {
      vi.useFakeTimers();
      vi.stubEnv("AGENT_NATIVE_PROVIDER_API_PERSIST_COOLDOWNS", "0");
      const identity = createProviderQuotaIdentity({
        appId: "mail",
        providerId: "gmail",
        ctx: { userEmail: "reader@example.test" },
        credentialSources: [],
      });
      const request = {
        identity,
        method: "GET",
        target: "provider.test/thread",
      };
      const success = { status: 200, headers: {} };
      const options = {
        request,
        inspect: (result: { status: number }) => result,
        buildQuotaExhaustedResult: () => ({ status: 429, headers: {} }),
      };
      let release = () => {};
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const blockedCall = pendingAttempt === "retry" ? 2 : 1;
      let prepared = false;
      const beforeAttempt = vi.fn(async () => {
        prepared = false;
        if (beforeAttempt.mock.calls.length === blockedCall) await pending;
        prepared = true;
      });
      const execute = vi.fn(async () => {
        // The queued callback must receive an already prepared attempt.
        expect(prepared).toBe(true);
        prepared = false;
        return execute.mock.calls.length === 1
          ? { status: 429, headers: { "retry-after": "0" } }
          : success;
      });
      const firstOptions = { ...options, beforeAttempt, execute };
      const first = executeWithProviderQuota(firstOptions);
      // Attach immediately so a red assertion cannot become an unhandled rejection.
      const firstOutcome = first.then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await vi.advanceTimersByTimeAsync(0);
      const secondExecute = vi.fn(async () => success);
      const second = executeWithProviderQuota({
        ...options,
        execute: secondExecute,
      });
      await vi.advanceTimersByTimeAsync(0);
      try {
        expect(beforeAttempt).toHaveBeenCalledTimes(blockedCall);
        expect(execute).toHaveBeenCalledTimes(blockedCall - 1);
        expect(secondExecute).toHaveBeenCalledOnce();
        expect(await second).toEqual(success);
      } finally {
        release();
        await vi.runAllTimersAsync();
        await Promise.all([firstOutcome, second]);
      }
      expect(await firstOutcome).toEqual({ value: success });
      expect(beforeAttempt).toHaveBeenCalledTimes(2);
      expect(execute).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["retry", "cooldown"] as const)(
    "releases the account queue during a %s wait so another request can honor its own deadline",
    async (wait) => {
      vi.useFakeTimers();
      vi.stubEnv("AGENT_NATIVE_PROVIDER_API_PERSIST_COOLDOWNS", "0");
      const identity = createProviderQuotaIdentity({
        appId: "calendar",
        providerId: "google-calendar",
        ctx: { userEmail: "reader@example.test" },
        credentialSources: [],
      });
      const request = {
        identity,
        method: "GET",
        target: "provider.test/events",
      };
      const limited = { status: 429, headers: { "retry-after": "1" } };
      const success = { status: 200, headers: {} };
      const options = {
        request,
        inspect: (result: { status: number }) => result,
        buildQuotaExhaustedResult: () => ({ status: 429, headers: {} }),
      };
      if (wait === "cooldown") {
        await executeWithProviderQuota({
          ...options,
          execute: async () => limited,
          singleAttempt: true,
        });
      }
      const retryingExecute = vi.fn(async () => success);
      if (wait === "retry") retryingExecute.mockResolvedValueOnce(limited);
      const retrying = executeWithProviderQuota({
        ...options,
        execute: retryingExecute,
      });
      await vi.advanceTimersByTimeAsync(0);
      const secondExecute = vi.fn(async () => success);
      let secondDone = false;
      const second = executeWithProviderQuota({
        ...options,
        request: { ...request, target: "provider.test/profile" },
        execute: secondExecute,
        maxWaitMs: 1,
      }).then((result) => {
        secondDone = true;
        return result;
      });
      await vi.advanceTimersByTimeAsync(10);
      try {
        expect(secondDone).toBe(true);
        expect(secondExecute).not.toHaveBeenCalled();
        expect(await second).toEqual({ status: 429, headers: {} });
      } finally {
        await vi.runAllTimersAsync();
        await Promise.all([retrying, second]);
      }
      expect(await retrying).toEqual(success);
    },
    2_000,
  );

  it("propagates a typed preparation rejection before entering an occupied queue", async () => {
    vi.stubEnv("AGENT_NATIVE_PROVIDER_API_PERSIST_COOLDOWNS", "0");
    const identity = createProviderQuotaIdentity({
      appId: "mail",
      providerId: "gmail",
      ctx: { userEmail: "reader@example.test" },
      credentialSources: [],
    });
    const success = { status: 200 };
    const options = {
      request: { identity, method: "GET", target: "provider.test/thread" },
      inspect: (result: { status: number }) => result,
      buildQuotaExhaustedResult: vi.fn(() => ({ status: 429 })),
    };
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = () => {};
    const executing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = executeWithProviderQuota({
      ...options,
      execute: async () => {
        started();
        await pending;
        return success;
      },
    });
    await executing;
    const failure = Object.assign(new Error("Budget deadline exceeded"), {
      errorCode: "gmail_provider_unavailable",
      statusCode: 503,
    });
    const execute = vi.fn(async () => success);
    const refusedOptions = {
      ...options,
      beforeAttempt: async () => {
        throw failure;
      },
      execute,
    };
    try {
      await expect(executeWithProviderQuota(refusedOptions)).rejects.toBe(
        failure,
      );
      expect(execute).not.toHaveBeenCalled();
      expect(options.buildQuotaExhaustedResult).not.toHaveBeenCalled();
    } finally {
      release();
      await first;
    }
  });

  it("returns the original single-attempt 429 and persists cooldown even when the environment requests retries", async () => {
    vi.stubEnv("AGENT_NATIVE_PROVIDER_API_MAX_ATTEMPTS", "9");
    const identity = createProviderQuotaIdentity({
      appId: "crm",
      providerId: "gmail",
      ctx: { userEmail: "ada@example.com", orgId: "org-1" },
      credentialSources: [],
    });
    const request = { identity, method: "POST", target: "gmail.example/send" };
    const execute = vi.fn(async () => ({
      status: 429,
      headers: { "retry-after": "120" },
      original: true,
    }));
    const exhausted = (detail: { reason: string }) => ({
      status: 429,
      headers: {},
      original: false,
      reason: detail.reason,
    });
    const first = await executeWithProviderQuota({
      request,
      execute,
      singleAttempt: true,
      maxWaitMs: 1,
      inspect: (result) => result,
      buildQuotaExhaustedResult: exhausted,
    });
    expect(first).toMatchObject({ status: 429, original: true });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(cooldownRows.size).toBe(1);
    const second = await executeWithProviderQuota({
      request,
      execute,
      singleAttempt: true,
      maxWaitMs: 1,
      inspect: (result) => result,
      buildQuotaExhaustedResult: exhausted,
    });
    expect(second).toMatchObject({ original: false, reason: "cooldown" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("separates in-flight request identities by effective byte cap", () => {
    const request = {
      method: "GET",
      url: "https://api.example.test/records",
      headers: { accept: "application/json" },
    };
    const small = createProviderRequestDedupeKey({
      ...request,
      maxBytes: 1_000,
    });
    const large = createProviderRequestDedupeKey({
      ...request,
      maxBytes: 8_000_000,
    });
    const sameCap = createProviderRequestDedupeKey({
      ...request,
      maxBytes: 1_000,
    });
    const noCap = createProviderRequestDedupeKey(request);

    expect(small).toBeDefined();
    expect(sameCap).toBe(small);
    expect(large).not.toBe(small);
    expect(noCap).not.toBe(small);
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

  it("retains the creator request pool until cooldown schema initialization settles", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let continueInitialization!: () => void;
    const initializationGate = new Promise<void>((resolve) => {
      continueInitialization = resolve;
    });
    const pool = { end: vi.fn(async () => {}) };
    vi.mocked(ensureTableExists).mockImplementation(async () => {
      getOrCreateRequestDbPool("quota-cooldown-init", () => pool);
      markStarted();
      await initializationGate;
      getOrCreateRequestDbPool("quota-cooldown-init", () => pool);
    });

    let initialization!: Promise<void>;
    await runWithRequestDbPoolScope(true, undefined, () => {
      initialization = ensureCooldownTable();
    });
    await started;

    expect(pool.end).not.toHaveBeenCalled();

    continueInitialization();
    await expect(initialization).resolves.toBeUndefined();
    expect(pool.end).toHaveBeenCalledOnce();
  });
});
