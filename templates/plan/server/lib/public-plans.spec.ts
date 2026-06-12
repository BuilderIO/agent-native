/**
 * Adversarial coverage for the anonymous-owner / public-viewer resolution in
 * public-plans.ts.
 *
 * This is the prime auth-bypass surface for the plan app: a signed-out HTTP
 * caller's effective identity for reading/writing ownable plans is whatever
 * these resolvers return. We try to break the visibility gate and the
 * plan-id-from-request parsing (which decides WHICH plan's visibility is
 * checked) with cross-origin Referer, query-param injection, path traversal,
 * non-public plans, and missing-plan cases.
 *
 * The db is mocked so we can (a) observe the exact id the resolver looks up and
 * (b) control the returned visibility, exercising the real gate logic in
 * public-plans.ts rather than re-implementing it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- controllable request shape (headers + cookies + url) ------------------
const headers = new Map<string, string>();
const cookieStore = new Map<string, string>();
const setCookieSpy = vi.fn();

let requestUrl = "/";

// --- controllable DB --------------------------------------------------------
type PlanRow = { id: string; visibility: string } | undefined;
const dbState = vi.hoisted(() => ({
  // map planId -> visibility, or a function to fully control the result
  byId: new Map<string, string>(),
  lastQueriedId: undefined as string | undefined,
  queryCount: 0,
}));

vi.mock("../db/index.js", () => {
  // Minimal drizzle-ish select().from().where().limit() recorder. The plan
  // resolver calls .where(eq(plans.id, id)).limit(1); we capture the id from
  // the eq() fragment and look it up in dbState.byId.
  return {
    getDb: () => ({
      select: () => ({
        from: () => ({
          where: (cond: { _eqVal?: string }) => ({
            limit: async (): Promise<PlanRow[]> => {
              dbState.queryCount += 1;
              const id = cond?._eqVal;
              dbState.lastQueriedId = id;
              const visibility =
                id !== undefined ? dbState.byId.get(id) : undefined;
              if (visibility === undefined) return [];
              return [{ id, visibility }];
            },
          }),
        }),
      }),
    }),
    schema: {
      plans: { id: "plans.id", visibility: "plans.visibility" },
    },
  };
});

vi.mock("drizzle-orm", () => ({
  // Capture the compared value so the db mock knows which id was requested.
  eq: (_col: unknown, val: unknown) => ({ _eqVal: val }),
}));

const guestAbuseMock = vi.hoisted(() => ({
  tryConsumeGuestMint: vi.fn(async () => true),
}));
vi.mock("./guest-abuse.js", () => ({
  GuestAbuseLimitError: class GuestAbuseLimitError extends Error {
    readonly statusCode = 429;
    constructor(message: string) {
      super(message);
      this.name = "GuestAbuseLimitError";
    }
  },
  tryConsumeGuestMint: guestAbuseMock.tryConsumeGuestMint,
}));

vi.mock("h3", () => ({
  getHeader: (_event: unknown, name: string) => headers.get(name.toLowerCase()),
  getCookie: (_event: unknown, name: string) => cookieStore.get(name),
  setCookie: (
    _event: unknown,
    name: string,
    value: string,
    opts: Record<string, unknown>,
  ) => {
    cookieStore.set(name, value);
    setCookieSpy(name, value, opts);
  },
  deleteCookie: (_event: unknown, name: string) => cookieStore.delete(name),
}));

const { resolvePlanAnonymousOwner, resolvePublicPlanViewerOwner } =
  await import("./public-plans.js");
const { isAnonymousPublicViewer, LOCAL_PLAN_OWNER_EMAIL } =
  await import("./local-identity.js");

// The resolver reads event.node.req.url / event.path; provide both.
function makeEvent() {
  return { node: { req: { url: requestUrl } }, path: requestUrl } as never;
}

const ENV_KEYS = ["NODE_ENV", "AUTH_MODE", "PLAN_LOCAL_MODE"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  headers.clear();
  cookieStore.clear();
  setCookieSpy.mockClear();
  dbState.byId.clear();
  dbState.lastQueriedId = undefined;
  dbState.queryCount = 0;
  requestUrl = "/";
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  // Default to a hosted-style env so the LOCAL fallback does NOT mask the
  // public-viewer gate; individual tests override as needed.
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.NODE_ENV = "production";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const PUBLIC_RE = /^public-[0-9a-f-]{36}@agent-native\.local$/i;

describe("resolvePublicPlanViewerOwner", () => {
  it("mints a public-viewer identity for a public plan referenced by ?id=", async () => {
    dbState.byId.set("plan_pub", "public");
    requestUrl = "/_agent-native/actions/get-visual-plan?id=plan_pub";

    const owner = await resolvePublicPlanViewerOwner(makeEvent());
    expect(owner).not.toBeNull();
    expect(owner).toMatch(PUBLIC_RE);
    expect(isAnonymousPublicViewer(owner)).toBe(true);
    expect(dbState.lastQueriedId).toBe("plan_pub");
    // A fresh viewer cookie was set (httpOnly + Secure auto-detect off on http).
    expect(setCookieSpy).toHaveBeenCalledTimes(1);
    const [name, , opts] = setCookieSpy.mock.calls[0];
    expect(name).toBe("plan_public_viewer");
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });

  it("REFUSES to mint a viewer identity for a PRIVATE plan (no public-link bypass)", async () => {
    dbState.byId.set("plan_priv", "private");
    requestUrl = "/plans/plan_priv";

    const owner = await resolvePublicPlanViewerOwner(makeEvent());
    expect(owner).toBeNull();
    expect(setCookieSpy).not.toHaveBeenCalled();
    // It DID look up the right plan id; the gate is the visibility, not the id.
    expect(dbState.lastQueriedId).toBe("plan_priv");
  });

  it("mints a public-viewer identity for a public recap route", async () => {
    dbState.byId.set("recap_pub", "public");
    requestUrl = "/recaps/recap_pub";

    const owner = await resolvePublicPlanViewerOwner(makeEvent());
    expect(owner).toMatch(PUBLIC_RE);
    expect(dbState.lastQueriedId).toBe("recap_pub");
  });

  it("REFUSES for an unknown / nonexistent plan id", async () => {
    requestUrl = "/plans/plan_does_not_exist";
    const owner = await resolvePublicPlanViewerOwner(makeEvent());
    expect(owner).toBeNull();
    expect(setCookieSpy).not.toHaveBeenCalled();
  });

  it("REFUSES when no plan id can be derived from the request at all", async () => {
    requestUrl = "/some/unrelated/path";
    const owner = await resolvePublicPlanViewerOwner(makeEvent());
    expect(owner).toBeNull();
    // No id => no DB lookup at all.
    expect(dbState.queryCount).toBe(0);
  });

  it("reuses an existing valid viewer cookie without re-minting", async () => {
    dbState.byId.set("plan_pub", "public");
    requestUrl = "/plans/plan_pub";
    const existing = "123e4567-e89b-12d3-a456-426614174000";
    cookieStore.set("plan_public_viewer", existing);

    const owner = await resolvePublicPlanViewerOwner(makeEvent());
    expect(owner).toBe(`public-${existing}@agent-native.local`);
    expect(setCookieSpy).not.toHaveBeenCalled();
  });

  it("re-mints when the stored viewer cookie is not a valid uuid shape", async () => {
    dbState.byId.set("plan_pub", "public");
    requestUrl = "/plans/plan_pub";
    cookieStore.set("plan_public_viewer", "not-a-uuid");

    const owner = await resolvePublicPlanViewerOwner(makeEvent());
    expect(owner).toMatch(PUBLIC_RE);
    expect(setCookieSpy).toHaveBeenCalledTimes(1);
  });

  it("marks the viewer cookie Secure on https (x-forwarded-proto)", async () => {
    dbState.byId.set("plan_pub", "public");
    requestUrl = "/plans/plan_pub";
    headers.set("x-forwarded-proto", "https");

    await resolvePublicPlanViewerOwner(makeEvent());
    expect(setCookieSpy.mock.calls[0][2]).toMatchObject({ secure: true });
  });

  it("does NOT mark the cookie Secure on plain http", async () => {
    dbState.byId.set("plan_pub", "public");
    requestUrl = "/plans/plan_pub";
    headers.set("x-forwarded-proto", "http");

    await resolvePublicPlanViewerOwner(makeEvent());
    expect(setCookieSpy.mock.calls[0][2]).toMatchObject({ secure: false });
  });
});

describe("plan-id derivation (adversarial)", () => {
  it("prefers ?id= over the path id", async () => {
    dbState.byId.set("plan_query", "public");
    dbState.byId.set("plan_path", "public");
    requestUrl = "/plans/plan_path?id=plan_query";

    await resolvePublicPlanViewerOwner(makeEvent());
    expect(dbState.lastQueriedId).toBe("plan_query");
  });

  it("honors ?planId= as an alternate query key", async () => {
    dbState.byId.set("plan_alt", "public");
    requestUrl = "/anything?planId=plan_alt";

    await resolvePublicPlanViewerOwner(makeEvent());
    expect(dbState.lastQueriedId).toBe("plan_alt");
  });

  it("URL-decodes a percent-encoded plan id from the path", async () => {
    dbState.byId.set("plan with space", "public");
    requestUrl = "/plans/plan%20with%20space";

    const owner = await resolvePublicPlanViewerOwner(makeEvent());
    expect(dbState.lastQueriedId).toBe("plan with space");
    expect(owner).toMatch(PUBLIC_RE);
  });

  it("falls back to the Referer path only when it is SAME-ORIGIN", async () => {
    dbState.byId.set("plan_ref", "public");
    // No id in the request URL itself.
    requestUrl = "/_agent-native/actions/get-visual-plan";
    headers.set("host", "plan.example.com");
    headers.set("x-forwarded-proto", "https");
    headers.set("referer", "https://plan.example.com/plans/plan_ref");

    await resolvePublicPlanViewerOwner(makeEvent());
    expect(dbState.lastQueriedId).toBe("plan_ref");
  });

  it("REJECTS a cross-origin Referer (cannot borrow another origin's plan id)", async () => {
    dbState.byId.set("plan_evil", "public");
    requestUrl = "/_agent-native/actions/get-visual-plan";
    headers.set("host", "plan.example.com");
    headers.set("x-forwarded-proto", "https");
    // Attacker's page references a real public plan id, but from evil.com.
    headers.set("referer", "https://evil.com/plans/plan_evil");

    const owner = await resolvePublicPlanViewerOwner(makeEvent());
    expect(owner).toBeNull();
    // The cross-origin referer id must NOT be looked up.
    expect(dbState.lastQueriedId).toBeUndefined();
    expect(dbState.queryCount).toBe(0);
  });

  it("does not crash on a malformed Referer header", async () => {
    requestUrl = "/_agent-native/actions/get-visual-plan";
    headers.set("host", "plan.example.com");
    headers.set("referer", "::::not a url::::");

    const owner = await resolvePublicPlanViewerOwner(makeEvent());
    expect(owner).toBeNull();
  });

  it("does not derive an id from a path that merely contains 'plans' as a prefix segment", async () => {
    // "/plansomething" must not be parsed as plans/<id>; the regex requires a
    // boundary before "plans/".
    requestUrl = "/plansomething/abc";
    const owner = await resolvePublicPlanViewerOwner(makeEvent());
    expect(owner).toBeNull();
    expect(dbState.queryCount).toBe(0);
  });
});

describe("resolvePlanAnonymousOwner (composition: public-viewer THEN local)", () => {
  it("returns the public-viewer identity when the request targets a public plan", async () => {
    dbState.byId.set("plan_pub", "public");
    requestUrl = "/plans/plan_pub";

    const owner = await resolvePlanAnonymousOwner(makeEvent());
    expect(owner).toMatch(PUBLIC_RE);
  });

  it("in HOSTED/production with a non-public target, returns null (no identity)", async () => {
    dbState.byId.set("plan_priv", "private");
    requestUrl = "/plans/plan_priv";
    process.env.NODE_ENV = "production";

    const owner = await resolvePlanAnonymousOwner(makeEvent());
    expect(owner).toBeNull();
  });

  it("in PRODUCTION, never falls back to the LOCAL single-user identity even with no plan in context", async () => {
    requestUrl = "/plans";
    process.env.NODE_ENV = "production";

    const owner = await resolvePlanAnonymousOwner(makeEvent());
    expect(owner).toBeNull();
  });

  it("in PRODUCTION, never falls back to LOCAL even with AUTH_MODE=local (no dev bypass on hosted)", async () => {
    requestUrl = "/plans";
    process.env.NODE_ENV = "production";
    process.env.AUTH_MODE = "local";

    const owner = await resolvePlanAnonymousOwner(makeEvent());
    expect(owner).toBeNull();
  });

  it("in LOCAL dev (no AUTH_MODE), falls back to the local single-user identity when no plan in context", async () => {
    requestUrl = "/plans";
    process.env.NODE_ENV = "development";

    const owner = await resolvePlanAnonymousOwner(makeEvent());
    expect(owner).toBe(LOCAL_PLAN_OWNER_EMAIL);
  });

  it("in LOCAL dev, a public-plan target STILL resolves to the public viewer (read-only), not the local owner", async () => {
    // A public plan loaded with no session in local dev should keep the
    // read-only public-viewer identity rather than being upgraded to the
    // local owner (which would let an anonymous viewer edit it).
    dbState.byId.set("plan_pub", "public");
    requestUrl = "/plans/plan_pub";
    process.env.NODE_ENV = "development";

    const owner = await resolvePlanAnonymousOwner(makeEvent());
    expect(owner).toMatch(PUBLIC_RE);
    expect(owner).not.toBe(LOCAL_PLAN_OWNER_EMAIL);
  });
});
