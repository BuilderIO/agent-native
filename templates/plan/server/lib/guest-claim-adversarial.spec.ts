import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("claim middleware — adversarial scoping", () => {
  const getSessionMock = vi.fn();
  const updateSpy = vi.fn();
  const setSpy = vi.fn();
  const whereSpy = vi.fn();
  const readGuestAuthorEmailMock = vi.fn();
  const clearGuestAuthorCookieMock = vi.fn();

  type Row = { id: string; ownerEmail: string; orgId: string | null };
  let store: Row[] = [];

  function evalPredicate(pred: any, row: Row): boolean {
    if (!pred) return true;
    if (pred.op === "and")
      return pred.args.every((p: any) => evalPredicate(p, row));
    if (pred.op === "eq") {
      const field =
        pred.col === "plans.owner_email"
          ? row.ownerEmail
          : pred.col === "plans.org_id"
            ? row.orgId
            : undefined;
      return field === pred.val;
    }
    if (pred.op === "isNull") {
      const field = pred.col === "plans.org_id" ? row.orgId : undefined;
      return field == null;
    }
    return false;
  }

  let handler: (e: never) => Promise<void>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    store = [];

    vi.doMock("h3", () => ({ defineEventHandler: (fn: unknown) => fn }));
    vi.doMock("drizzle-orm", () => ({
      and: (...args: unknown[]) => ({ op: "and", args }),
      eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
      isNull: (col: unknown) => ({ op: "isNull", col }),
    }));
    vi.doMock("@agent-native/core/server", () => ({
      getSession: getSessionMock,
    }));

    let pendingSet: { ownerEmail: string } | null = null;
    const dbRecorder = {
      update: (table: unknown) => {
        updateSpy(table);
        return {
          set: (vals: { ownerEmail: string }) => {
            setSpy(vals);
            pendingSet = vals;
            return {
              where: (cond: unknown) => {
                whereSpy(cond);
                for (const row of store) {
                  if (evalPredicate(cond, row) && pendingSet) {
                    row.ownerEmail = pendingSet.ownerEmail;
                  }
                }
                return Promise.resolve();
              },
            };
          },
        };
      },
    };
    vi.doMock("../db/index.js", () => ({
      getDb: () => dbRecorder,
      schema: {
        plans: { ownerEmail: "plans.owner_email", orgId: "plans.org_id" },
        planVersions: { ownerEmail: "plan_versions.owner_email" },
      },
    }));
    vi.doMock("../lib/public-plans.js", () => ({
      readGuestAuthorEmail: (event: unknown) => readGuestAuthorEmailMock(event),
      clearGuestAuthorCookie: (event: unknown) =>
        clearGuestAuthorCookieMock(event),
      isGuestAuthorIdentity: (email: unknown) =>
        typeof email === "string" &&
        /^guest-[0-9a-f-]+@agent-native\.guest$/i.test(email),
    }));

    const mod = await import("../middleware/claim-guest-plans.js");
    handler = mod.default as typeof handler;
  });

  afterEach(() => {
    vi.resetModules();
  });

  const EVENT = {} as never;
  const GUEST_A =
    "guest-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa@agent-native.guest";
  const GUEST_B =
    "guest-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb@agent-native.guest";
  const ACCOUNT = "real@user.com";
  const OTHER_ACCOUNT = "victim@user.com";

  it("does NOT touch another guest's plans (no cross-guest leak)", async () => {
    store = [
      { id: "p1", ownerEmail: GUEST_A, orgId: null },
      { id: "p2", ownerEmail: GUEST_B, orgId: null }, // a different guest
      { id: "p3", ownerEmail: OTHER_ACCOUNT, orgId: null }, // someone else's real plan
    ];
    readGuestAuthorEmailMock.mockReturnValue(GUEST_A);
    getSessionMock.mockResolvedValue({ email: ACCOUNT });

    await handler(EVENT);

    expect(store.find((r) => r.id === "p1")?.ownerEmail).toBe(ACCOUNT);
    expect(store.find((r) => r.id === "p2")?.ownerEmail).toBe(GUEST_B);
    expect(store.find((r) => r.id === "p3")?.ownerEmail).toBe(OTHER_ACCOUNT);
  });

  it("never re-keys an org-scoped plan that happens to share the guest owner email (orgId IS NULL guard)", async () => {
    store = [
      { id: "p1", ownerEmail: GUEST_A, orgId: null },
      { id: "p2", ownerEmail: GUEST_A, orgId: "org_123" }, // org-scoped
    ];
    readGuestAuthorEmailMock.mockReturnValue(GUEST_A);
    getSessionMock.mockResolvedValue({ email: ACCOUNT });

    await handler(EVENT);

    expect(store.find((r) => r.id === "p1")?.ownerEmail).toBe(ACCOUNT);
    expect(store.find((r) => r.id === "p2")?.ownerEmail).toBe(GUEST_A);
    expect(store.find((r) => r.id === "p2")?.orgId).toBe("org_123");
  });

  it("is idempotent: a second claim with the now-cleared cookie is a no-op", async () => {
    store = [{ id: "p1", ownerEmail: GUEST_A, orgId: null }];
    readGuestAuthorEmailMock.mockReturnValue(GUEST_A);
    getSessionMock.mockResolvedValue({ email: ACCOUNT });

    await handler(EVENT);
    expect(store[0].ownerEmail).toBe(ACCOUNT);
    expect(clearGuestAuthorCookieMock).toHaveBeenCalledTimes(1);

    readGuestAuthorEmailMock.mockReturnValue(null);
    updateSpy.mockClear();
    await handler(EVENT);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(store[0].ownerEmail).toBe(ACCOUNT);
  });

  it("two guests on two devices signing into the SAME account merges both, no clobber", async () => {
    store = [
      { id: "p1", ownerEmail: GUEST_A, orgId: null },
      { id: "p2", ownerEmail: GUEST_B, orgId: null },
      { id: "p3", ownerEmail: ACCOUNT, orgId: null }, // already owned
    ];

    readGuestAuthorEmailMock.mockReturnValue(GUEST_A);
    getSessionMock.mockResolvedValue({ email: ACCOUNT });
    await handler(EVENT);

    readGuestAuthorEmailMock.mockReturnValue(GUEST_B);
    await handler(EVENT);

    const owners = store.map((r) => r.ownerEmail);
    expect(owners).toEqual([ACCOUNT, ACCOUNT, ACCOUNT]);
  });

  it("a logged-in user replaying ANOTHER guest's id can only ever move rows owned by that id (claim is cookie-scoped, not selective)", async () => {
    store = [
      { id: "p1", ownerEmail: GUEST_B, orgId: null }, // victim guest's plan
      { id: "p2", ownerEmail: OTHER_ACCOUNT, orgId: null }, // real account plan
    ];
    readGuestAuthorEmailMock.mockReturnValue(GUEST_B);
    getSessionMock.mockResolvedValue({ email: ACCOUNT });

    await handler(EVENT);

    expect(store.find((r) => r.id === "p1")?.ownerEmail).toBe(ACCOUNT);
    // ...but a REAL account's plan is NEVER touched, even with a forged cookie.
    expect(store.find((r) => r.id === "p2")?.ownerEmail).toBe(OTHER_ACCOUNT);
  });

  it("does NOT claim when the cookie guest id already equals the session email (already-claimed / self)", async () => {
    store = [{ id: "p1", ownerEmail: GUEST_A, orgId: null }];
    readGuestAuthorEmailMock.mockReturnValue(GUEST_A);
    getSessionMock.mockResolvedValue({ email: GUEST_A });
    await handler(EVENT);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(clearGuestAuthorCookieMock).not.toHaveBeenCalled();
    expect(store[0].ownerEmail).toBe(GUEST_A);
  });

  it("DEFENSIVE GAP: a synthetic public-viewer / local identity as the session email is NOT excluded by the claim guard", async () => {
    const PUBLIC_VIEWER =
      "public-cccccccc-cccc-cccc-cccc-cccccccccccc@agent-native.local";
    store = [{ id: "p1", ownerEmail: GUEST_A, orgId: null }];
    readGuestAuthorEmailMock.mockReturnValue(GUEST_A);
    getSessionMock.mockResolvedValue({ email: PUBLIC_VIEWER });
    await handler(EVENT);
    expect(store[0].ownerEmail).toBe(PUBLIC_VIEWER);
    // If this assertion ever needs flipping to GUEST_A (i.e. "do not claim onto a
    // synthetic identity"), that is the hardening, and the guard in
    // claim-guest-plans.ts should add isAnonymousPublicViewer / local checks.
  });
});

describe("guest-abuse — adversarial counting & windows", () => {
  const dbState = {
    ownedCount: 0,
    globalCount: 0,
    mintCount: 0,
    throwOnExecute: false,
    calls: [] as Array<{ sql: string; args: unknown[] }>,
  };

  const execute = vi.fn(async (input: { sql: string; args: unknown[] }) => {
    dbState.calls.push({ sql: input.sql, args: input.args });
    if (dbState.throwOnExecute) throw new Error("simulated db failure");
    const sql = input.sql;
    if (/FROM plan_guest_mints/i.test(sql) && /COUNT/i.test(sql)) {
      return { rows: [{ n: dbState.mintCount }] };
    }
    if (/owner_email = \$1/i.test(sql))
      return { rows: [{ n: dbState.ownedCount }] };
    if (/owner_email LIKE \$1/i.test(sql))
      return { rows: [{ n: dbState.globalCount }] };
    return { rows: [] };
  });

  let assertGuestCreateWithinLimits: (e: string) => Promise<void>;
  let tryConsumeGuestMint: (e: unknown) => Promise<boolean>;
  let GuestAbuseLimitError: any;

  let headers: Record<string, string | undefined> = {};

  const ENV_KEYS = [
    "PLAN_GUEST_ABUSE_DISABLED",
    "PLAN_GUEST_MAX_PLANS",
    "PLAN_GUEST_MINT_LIMIT",
    "PLAN_GUEST_MINT_WINDOW_MS",
    "PLAN_GUEST_GLOBAL_CREATE_LIMIT",
    "PLAN_GUEST_GLOBAL_WINDOW_MS",
  ] as const;

  beforeEach(async () => {
    vi.resetModules();
    dbState.ownedCount = 0;
    dbState.globalCount = 0;
    dbState.mintCount = 0;
    dbState.throwOnExecute = false;
    dbState.calls = [];
    execute.mockClear();
    headers = {};
    for (const k of ENV_KEYS) delete process.env[k];

    vi.doMock("@agent-native/core/db", () => ({
      getDbExec: () => ({ execute }),
    }));
    vi.doMock("h3", () => ({
      getHeader: (_e: unknown, name: string) => headers[name.toLowerCase()],
      getRequestIP: () => undefined,
    }));
    const mod = await import("./guest-abuse.js");
    assertGuestCreateWithinLimits = mod.assertGuestCreateWithinLimits;
    tryConsumeGuestMint = mod.tryConsumeGuestMint;
    GuestAbuseLimitError = mod.GuestAbuseLimitError;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    vi.resetModules();
  });

  const GUEST = "guest-11111111-1111-1111-1111-111111111111@agent-native.guest";

  it("blocks EXACTLY at the cap (>= maxPlans), not just above it", async () => {
    process.env.PLAN_GUEST_MAX_PLANS = "3";
    dbState.ownedCount = 3;
    await expect(assertGuestCreateWithinLimits(GUEST)).rejects.toBeInstanceOf(
      GuestAbuseLimitError,
    );
  });

  it("allows at cap-minus-one (boundary below the cap)", async () => {
    process.env.PLAN_GUEST_MAX_PLANS = "3";
    dbState.ownedCount = 2;
    await expect(assertGuestCreateWithinLimits(GUEST)).resolves.toBeUndefined();
  });

  it("a blank/zero env value falls back to the default cap (cannot be disabled via empty string)", async () => {
    process.env.PLAN_GUEST_MAX_PLANS = "";
    dbState.ownedCount = 24;
    await expect(assertGuestCreateWithinLimits(GUEST)).resolves.toBeUndefined();
    dbState.ownedCount = 25;
    await expect(assertGuestCreateWithinLimits(GUEST)).rejects.toBeInstanceOf(
      GuestAbuseLimitError,
    );
  });

  it("a non-integer env value (e.g. '5.5' or 'abc') falls back to the default, never an absurd cap", async () => {
    process.env.PLAN_GUEST_MAX_PLANS = "abc";
    dbState.ownedCount = 24;
    await expect(assertGuestCreateWithinLimits(GUEST)).resolves.toBeUndefined();
    dbState.ownedCount = 25;
    await expect(assertGuestCreateWithinLimits(GUEST)).rejects.toBeInstanceOf(
      GuestAbuseLimitError,
    );
  });

  it("the per-guest cap query is scoped to the exact owner email (no LIKE / no wildcard injection)", async () => {
    process.env.PLAN_GUEST_MAX_PLANS = "100";
    const injected =
      "guest-22222222-2222-2222-2222-222222222222@agent-native.guest";
    await assertGuestCreateWithinLimits(injected);
    const capCall = dbState.calls.find((c) => /owner_email = \$1/i.test(c.sql));
    expect(capCall?.args[0]).toBe(injected);
    expect(capCall?.sql).not.toContain(injected);
  });

  it("the per-IP mint limiter blocks exactly at the limit even when overridden tiny", async () => {
    process.env.PLAN_GUEST_MINT_LIMIT = "1";
    dbState.mintCount = 1;
    await expect(tryConsumeGuestMint({} as never)).resolves.toBe(false);
    const insert = dbState.calls.find((c) =>
      /INSERT INTO plan_guest_mints/i.test(c.sql),
    );
    expect(insert).toBeUndefined();
  });

  it("an over-large env limit is clamped to the documented max, not honored verbatim", async () => {
    process.env.PLAN_GUEST_MAX_PLANS = "999999999999999";
    dbState.ownedCount = 1_000_000;
    await expect(assertGuestCreateWithinLimits(GUEST)).rejects.toBeInstanceOf(
      GuestAbuseLimitError,
    );
  });

  it("a negative env limit is clamped to the documented min (>=1), never 0 or negative", async () => {
    process.env.PLAN_GUEST_MAX_PLANS = "-5";
    dbState.ownedCount = 1;
    await expect(assertGuestCreateWithinLimits(GUEST)).rejects.toBeInstanceOf(
      GuestAbuseLimitError,
    );
  });

  it("does NOT count the guest's own cap against a different guest's plans (global LIKE is separate from the per-guest exact count)", async () => {
    process.env.PLAN_GUEST_MAX_PLANS = "100";
    process.env.PLAN_GUEST_GLOBAL_CREATE_LIMIT = "1000";
    dbState.ownedCount = 1;
    dbState.globalCount = 1;
    await assertGuestCreateWithinLimits(GUEST);
    const exact = dbState.calls.find((c) => /owner_email = \$1/i.test(c.sql));
    const like = dbState.calls.find((c) => /owner_email LIKE \$1/i.test(c.sql));
    expect(exact?.args[0]).toBe(GUEST);
    expect(like?.args[0]).toBe("guest-%@agent-native.guest");
  });
});
