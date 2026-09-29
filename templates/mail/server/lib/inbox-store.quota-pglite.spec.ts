import { afterEach, describe, expect, it, vi } from "vitest";

describe("Gmail quota timestamps in PGlite", () => {
  afterEach(async () => {
    const { closeDbExec } = await import("@agent-native/core/db");
    await closeDbExec();
    Reflect.deleteProperty(globalThis as object, "__agentNativePgliteClients");
    Reflect.deleteProperty(
      globalThis as object,
      "__agentNativePgliteProcessLocks",
    );
    Reflect.deleteProperty(
      globalThis as object,
      "__agentNativePgliteProcessExitCleanupRegistered",
    );
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reserves and records cooldowns with millisecond timestamps", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory");

    const [{ default: initializeMailDb }, { getDbExec }, quotaStore] =
      await Promise.all([
        import("../plugins/db.js"),
        import("@agent-native/core/db"),
        import("./inbox-store.js"),
      ]);
    await initializeMailDb({});

    const now = Date.now();
    await expect(
      quotaStore.reserveGmailQuota(
        "owner@example.com",
        "account@example.com",
        40,
        "interactive",
        now,
      ),
    ).resolves.toMatchObject({ retryAfterMs: 0 });

    await expect(
      quotaStore.recordGmailQuotaCooldown(
        "owner@example.com",
        "account@example.com",
        1_000,
        now,
      ),
    ).resolves.toBeGreaterThan(0);

    const result = await getDbExec().execute(
      "SELECT created_at, updated_at, quota_cooldown_until FROM mail_gmail_quota_budgets WHERE id = 'account@example.com'",
    );
    const row = result.rows[0] as {
      created_at: number | string;
      updated_at: number | string;
      quota_cooldown_until: number | string;
    };
    expect(Number(row.created_at)).toBe(now);
    expect(Number(row.updated_at)).toBe(now);
    expect(Number(row.quota_cooldown_until)).toBeGreaterThan(now);
  });
});
