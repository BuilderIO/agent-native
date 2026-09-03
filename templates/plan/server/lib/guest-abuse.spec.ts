import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Control the mocked DB client per test. `execute` inspects the SQL to decide
// which COUNT to return, captures every call, and can be forced to throw to
// exercise the fail-open paths.
const dbState = {
  mintCount: 0,
  ownedCount: 0,
  globalCount: 0,
  throwOnExecute: false,
  calls: [] as Array<{ sql: string; args: unknown[] }>,
};

function resetDbState() {
  dbState.mintCount = 0;
  dbState.ownedCount = 0;
  dbState.globalCount = 0;
  dbState.throwOnExecute = false;
  dbState.calls = [];
}

const execute = vi.fn(async (input: { sql: string; args: unknown[] }) => {
  dbState.calls.push({ sql: input.sql, args: input.args });
  if (dbState.throwOnExecute) throw new Error("simulated db failure");
  const sql = input.sql;
  if (/FROM plan_guest_mints/i.test(sql) && /COUNT/i.test(sql)) {
    return { rows: [{ n: dbState.mintCount }] };
  }
  if (/owner_email = \?/i.test(sql)) {
    return { rows: [{ n: dbState.ownedCount }] };
  }
  if (/owner_email LIKE \?/i.test(sql)) {
    return { rows: [{ n: dbState.globalCount }] };
  }
  // INSERT / DELETE / anything else.
  return { rows: [] };
});

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({ execute }),
}));

// h3 header/IP access is driven by mutable test fixtures.
let headers: Record<string, string | undefined> = {};
let peerIp: string | undefined;
let requestIpThrows = false;

vi.mock("h3", () => ({
  getHeader: (_event: unknown, name: string) => headers[name.toLowerCase()],
  getRequestIP: () => {
    if (requestIpThrows) throw new Error("no socket");
    return peerIp;
  },
}));

const {
  assertGuestCreateWithinLimits,
  getClientIpFromEvent,
  GuestAbuseLimitError,
  tryConsumeGuestMint,
} = await import("./guest-abuse.js");

const GUEST = "guest-11111111-1111-1111-1111-111111111111@agent-native.guest";
const REAL_USER = "alice@example.com";
const LOCAL_OWNER = "local@agent-native.local";
const PUBLIC_VIEWER =
  "public-22222222-2222-2222-2222-222222222222@agent-native.local";
const fakeEvent = {} as Parameters<typeof getClientIpFromEvent>[0];

const GUEST_ENV_KEYS = [
  "PLAN_GUEST_ABUSE_DISABLED",
  "PLAN_GUEST_MAX_PLANS",
  "PLAN_GUEST_MINT_LIMIT",
  "PLAN_GUEST_MINT_WINDOW_MS",
  "PLAN_GUEST_GLOBAL_CREATE_LIMIT",
  "PLAN_GUEST_GLOBAL_WINDOW_MS",
] as const;

beforeEach(() => {
  resetDbState();
  execute.mockClear();
  headers = {};
  peerIp = undefined;
  requestIpThrows = false;
  for (const key of GUEST_ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of GUEST_ENV_KEYS) delete process.env[key];
});

describe("getClientIpFromEvent", () => {
  it("prefers the trusted platform edge header and trims it", () => {
    headers["x-nf-client-connection-ip"] = "  203.0.113.7 ";
    headers["x-forwarded-for"] = "10.0.0.1";
    peerIp = "127.0.0.1";
    expect(getClientIpFromEvent(fakeEvent)).toBe("203.0.113.7");
  });

  it("falls through trusted headers in priority order", () => {
    headers["cf-connecting-ip"] = "198.51.100.9";
    expect(getClientIpFromEvent(fakeEvent)).toBe("198.51.100.9");
    headers = { "x-real-ip": "198.51.100.10" };
    expect(getClientIpFromEvent(fakeEvent)).toBe("198.51.100.10");
  });

  it("uses the left-most X-Forwarded-For entry when no trusted header is set", () => {
    headers["x-forwarded-for"] = "203.0.113.5, 70.41.3.18, 150.172.238.178";
    expect(getClientIpFromEvent(fakeEvent)).toBe("203.0.113.5");
  });

  it("falls back to the socket peer, then undefined", () => {
    peerIp = "192.0.2.44";
    expect(getClientIpFromEvent(fakeEvent)).toBe("192.0.2.44");
    peerIp = undefined;
    requestIpThrows = true;
    expect(getClientIpFromEvent(fakeEvent)).toBeUndefined();
  });
});

describe("assertGuestCreateWithinLimits — identity gating (byte-identical for non-guests)", () => {
  it("is a no-op for an authenticated real user and never touches the DB", async () => {
    dbState.ownedCount = 9999;
    dbState.globalCount = 9999;
    await expect(
      assertGuestCreateWithinLimits(REAL_USER),
    ).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it("is a no-op for the local single-user identity", async () => {
    dbState.ownedCount = 9999;
    await assertGuestCreateWithinLimits(LOCAL_OWNER);
    expect(execute).not.toHaveBeenCalled();
  });

  it("is a no-op for an anonymous public viewer (not a guest author)", async () => {
    dbState.ownedCount = 9999;
    await assertGuestCreateWithinLimits(PUBLIC_VIEWER);
    expect(execute).not.toHaveBeenCalled();
  });

  it("is a no-op when the master kill-switch is set, even for a guest", async () => {
    process.env.PLAN_GUEST_ABUSE_DISABLED = "1";
    dbState.ownedCount = 9999;
    await assertGuestCreateWithinLimits(GUEST);
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("assertGuestCreateWithinLimits — per-guest cap", () => {
  it("throws 429 once the guest owns the maximum number of plans", async () => {
    process.env.PLAN_GUEST_MAX_PLANS = "5";
    dbState.ownedCount = 5;
    await expect(assertGuestCreateWithinLimits(GUEST)).rejects.toBeInstanceOf(
      GuestAbuseLimitError,
    );
    await assertGuestCreateWithinLimits(GUEST).catch((err) => {
      expect((err as { statusCode?: number }).statusCode).toBe(429);
    });
  });

  it("allows creation while the guest is under the cap and global limit", async () => {
    process.env.PLAN_GUEST_MAX_PLANS = "5";
    dbState.ownedCount = 4;
    dbState.globalCount = 0;
    await expect(assertGuestCreateWithinLimits(GUEST)).resolves.toBeUndefined();
  });
});

describe("assertGuestCreateWithinLimits — global throttle backstop", () => {
  it("throws once the global guest-create window is saturated", async () => {
    process.env.PLAN_GUEST_MAX_PLANS = "100";
    process.env.PLAN_GUEST_GLOBAL_CREATE_LIMIT = "10";
    dbState.ownedCount = 0; // under per-guest cap
    dbState.globalCount = 10; // at global limit
    await expect(assertGuestCreateWithinLimits(GUEST)).rejects.toBeInstanceOf(
      GuestAbuseLimitError,
    );
  });

  it("scopes the global count to guest-owned rows via a guest-domain LIKE", async () => {
    process.env.PLAN_GUEST_GLOBAL_CREATE_LIMIT = "1000";
    await assertGuestCreateWithinLimits(GUEST);
    const likeCall = dbState.calls.find((c) =>
      /owner_email LIKE \?/i.test(c.sql),
    );
    expect(likeCall?.args[0]).toBe("guest-%@agent-native.guest");
  });
});

describe("assertGuestCreateWithinLimits — fail open", () => {
  it("does not throw when the DB errors (availability over enforcement)", async () => {
    dbState.throwOnExecute = true;
    await expect(assertGuestCreateWithinLimits(GUEST)).resolves.toBeUndefined();
  });
});

describe("tryConsumeGuestMint", () => {
  it("allows and records a mint when under the per-IP budget", async () => {
    process.env.PLAN_GUEST_MINT_LIMIT = "3";
    dbState.mintCount = 2;
    peerIp = "203.0.113.99";
    await expect(tryConsumeGuestMint(fakeEvent)).resolves.toBe(true);
    const insert = dbState.calls.find((c) =>
      /INSERT INTO plan_guest_mints/i.test(c.sql),
    );
    expect(insert).toBeTruthy();
  });

  it("hashes the client IP (never stores the raw address)", async () => {
    peerIp = "203.0.113.99";
    await tryConsumeGuestMint(fakeEvent);
    const countCall = dbState.calls.find((c) =>
      /FROM plan_guest_mints/i.test(c.sql),
    );
    const ipHash = countCall?.args[0] as string;
    expect(ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ipHash).not.toContain("203.0.113.99");
  });

  it("blocks (returns false) and does not insert once the per-IP budget is exhausted", async () => {
    process.env.PLAN_GUEST_MINT_LIMIT = "3";
    dbState.mintCount = 3;
    peerIp = "203.0.113.99";
    await expect(tryConsumeGuestMint(fakeEvent)).resolves.toBe(false);
    const insert = dbState.calls.find((c) =>
      /INSERT INTO plan_guest_mints/i.test(c.sql),
    );
    expect(insert).toBeUndefined();
  });

  it("buckets different IPs under different hashes", async () => {
    peerIp = "203.0.113.1";
    await tryConsumeGuestMint(fakeEvent);
    const firstHash = dbState.calls.find((c) =>
      /FROM plan_guest_mints/i.test(c.sql),
    )?.args[0];
    resetDbState();
    peerIp = "203.0.113.2";
    await tryConsumeGuestMint(fakeEvent);
    const secondHash = dbState.calls.find((c) =>
      /FROM plan_guest_mints/i.test(c.sql),
    )?.args[0];
    expect(firstHash).not.toBe(secondHash);
  });

  it("fails open (allows the mint) when the DB errors", async () => {
    dbState.throwOnExecute = true;
    peerIp = "203.0.113.99";
    await expect(tryConsumeGuestMint(fakeEvent)).resolves.toBe(true);
  });

  it("skips the DB entirely when abuse mitigation is disabled", async () => {
    process.env.PLAN_GUEST_ABUSE_DISABLED = "true";
    await expect(tryConsumeGuestMint(fakeEvent)).resolves.toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });
});
