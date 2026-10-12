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
  }, 15_000);

  it("leaves room for the first backfill page after the initial inbox slice", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory");

    const [{ default: initializeMailDb }, quotaStore] = await Promise.all([
      import("../plugins/db.js"),
      import("./inbox-store.js"),
    ]);
    await initializeMailDb({});

    const now = Date.now();
    for (const units of [1, 10, 2_000, 10, 960]) {
      await expect(
        quotaStore.reserveGmailQuota(
          "owner@example.com",
          "account@example.com",
          units,
          "interactive",
          now,
        ),
      ).resolves.toMatchObject({ retryAfterMs: 0 });
    }

    for (const [units, lane] of [
      [2, "incremental"],
      [10, "backfill"],
      [1_960, "backfill"],
    ] as const) {
      await expect(
        quotaStore.reserveGmailQuota(
          "owner@example.com",
          "account@example.com",
          units,
          lane,
          now,
        ),
      ).resolves.toMatchObject({ retryAfterMs: 0 });
    }
  }, 15_000);

  it("stores token accounts by hash, resolves them until expiry, and prunes dead rows", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory");

    const [{ default: initializeMailDb }, quotaStore] = await Promise.all([
      import("../plugins/db.js"),
      import("./inbox-store.js"),
    ]);
    await initializeMailDb({});

    const now = Date.now();
    const live = {
      ownerEmail: "Owner@Example.com",
      accountEmail: "A@Example.com",
      expiresAt: now + 60_000,
    };
    await quotaStore.saveGmailTokenAccount("hash-live", live, now);
    await quotaStore.saveGmailTokenAccount(
      "hash-dead",
      { ...live, expiresAt: now + 1_000 },
      now,
    );

    await expect(
      quotaStore.readGmailTokenAccount("hash-live", now),
    ).resolves.toEqual({
      ownerEmail: "owner@example.com",
      accountEmail: "a@example.com",
      expiresAt: now + 60_000,
    });
    await expect(
      quotaStore.readGmailTokenAccount("hash-unknown", now),
    ).resolves.toBeUndefined();
    // Expired rows stop resolving, and the next write prunes them.
    await expect(
      quotaStore.readGmailTokenAccount("hash-dead", now + 2_000),
    ).resolves.toBeUndefined();
    await quotaStore.saveGmailTokenAccount("hash-new", live, now + 2_000);
    const { getDbExec } = await import("@agent-native/core/db");
    const rows = await getDbExec().execute(
      "SELECT token_hash FROM mail_gmail_token_accounts ORDER BY token_hash",
    );
    expect(
      rows.rows.map((row) => (row as { token_hash: string }).token_hash),
    ).toEqual(["hash-live", "hash-new"]);
  }, 15_000);

  it("reads active cooldowns by account or by owner, and not expired ones", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory");

    const [{ default: initializeMailDb }, quotaStore] = await Promise.all([
      import("../plugins/db.js"),
      import("./inbox-store.js"),
    ]);
    await initializeMailDb({});

    const now = Date.now();
    const until = await quotaStore.recordGmailQuotaCooldown(
      "owner@example.com",
      "cooling@example.com",
      30_000,
      now,
    );
    await quotaStore.reserveGmailQuota(
      "owner@example.com",
      "healthy@example.com",
      10,
      "interactive",
      now,
    );

    const byAccount = await quotaStore.readGmailQuotaCooldowns(
      { accountEmails: ["Cooling@Example.com", "healthy@example.com"] },
      now,
    );
    expect([...byAccount.keys()]).toEqual(["cooling@example.com"]);
    expect(byAccount.get("cooling@example.com")).toBe(now + until);
    const byOwner = await quotaStore.readGmailQuotaCooldowns(
      { ownerEmail: "OWNER@example.com" },
      now,
    );
    expect([...byOwner.keys()]).toEqual(["cooling@example.com"]);
    await expect(
      quotaStore.readGmailQuotaCooldowns(
        { ownerEmail: "other@example.com" },
        now,
      ),
    ).resolves.toEqual(new Map());
    // The window passed.
    await expect(
      quotaStore.readGmailQuotaCooldowns(
        { ownerEmail: "owner@example.com" },
        now + until + 1,
      ),
    ).resolves.toEqual(new Map());
  }, 15_000);

  it("clears needs_reauth and error sync state on reconnect, leaving healthy rows alone", async () => {
    vi.stubEnv("DATABASE_URL", "pglite:memory");

    const [{ default: initializeMailDb }, store] = await Promise.all([
      import("../plugins/db.js"),
      import("./inbox-store.js"),
    ]);
    await initializeMailDb({});

    for (const [account, status] of [
      ["dead@example.com", "needs_reauth"],
      ["broken@example.com", "error"],
      ["fine@example.com", "idle"],
    ] as const) {
      await store.ensureSyncAccountRow("owner@example.com", account);
      await store.patchSyncAccount("owner@example.com", account, {
        status,
        lastError: status === "idle" ? null : "Google API error (401): nope",
      });
    }

    await store.clearSyncAccountReauth("owner@example.com", "dead@example.com");
    await store.clearSyncAccountReauth(
      "owner@example.com",
      "broken@example.com",
    );
    await store.clearSyncAccountReauth("owner@example.com", "fine@example.com");
    // Another owner's row with the same account is untouched.
    await store.ensureSyncAccountRow("someone@example.com", "dead@example.com");
    await store.patchSyncAccount("someone@example.com", "dead@example.com", {
      status: "needs_reauth",
    });
    await store.clearSyncAccountReauth("owner@example.com", "dead@example.com");

    const rows = await store.readSyncAccounts("owner@example.com");
    expect(
      rows
        .map(({ accountEmail, status, lastError }) => [
          accountEmail,
          status,
          lastError,
        ])
        .sort(),
    ).toEqual([
      ["broken@example.com", "idle", null],
      ["dead@example.com", "idle", null],
      ["fine@example.com", "idle", null],
    ]);
    const other = await store.readSyncAccounts("someone@example.com");
    expect(other[0]?.status).toBe("needs_reauth");
  }, 15_000);
});
