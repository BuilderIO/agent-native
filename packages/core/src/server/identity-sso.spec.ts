import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- h3 mock (mirror sibling specs) ---
vi.mock("h3", () => ({
  getMethod: (event: any) => event.method ?? "GET",
  getHeader: (event: any, name: string) =>
    event.headers?.[name.toLowerCase()] ?? event.headers?.[name],
}));

// --- auth.js mock: getSession + the two pure helpers we re-use ---
const getSessionMock = vi.fn();
const isExpectedAuthFailureMock = vi.fn((e: any) =>
  /already\s+exists|user\s+already/i.test(String(e?.message ?? "")),
);
vi.mock("./auth.js", () => ({
  getSession: (...a: any[]) => getSessionMock(...a),
  // Real same-origin validator behaviour is exercised by auth.spec.ts; here
  // we just need a faithful-enough stand-in for the redirect target.
  safeReturnPath: (raw: string | null | undefined) => {
    if (!raw) return "/";
    if (/[\x00-\x1f]/.test(raw)) return "/";
    try {
      const u = new URL(raw, "http://safe-base.invalid");
      if (u.origin !== "http://safe-base.invalid") return "/";
      return u.pathname + u.search + u.hash;
    } catch {
      return "/";
    }
  },
  isExpectedAuthFailure: (...a: any[]) => isExpectedAuthFailureMock(...a),
}));

// --- google-oauth.js mock: the literal session-mint path we re-use ---
const createOAuthSessionMock = vi.fn(async () => ({
  sessionToken: "fresh-session-token",
}));
vi.mock("./google-oauth.js", () => ({
  createOAuthSession: (...a: any[]) => createOAuthSessionMock(...a),
  getOrigin: (event: any) =>
    `https://${event.headers?.host ?? "mail.agent-native.com"}`,
}));

vi.mock("./app-name.js", () => ({ getAppName: () => "mail" }));

// --- Better Auth: signUpEmail (new-user path) + internal adapter ---
const signUpEmailMock = vi.fn(async () => ({}));
const adapterUsers: Array<{
  id: string;
  email: string;
  accounts: Array<{ providerId: string; accountId: string }>;
}> = [];
const linkAccountMock = vi.fn(async (a: any) => {
  const u = adapterUsers.find((x) => x.id === a.userId);
  if (u) u.accounts.push({ providerId: a.providerId, accountId: a.accountId });
  return {};
});
const findUserByEmailMock = vi.fn(async (email: string) => {
  const u = adapterUsers.find((x) => x.email === email);
  return u
    ? { user: { id: u.id, email: u.email }, accounts: u.accounts }
    : null;
});
vi.mock("./better-auth-instance.js", () => ({
  getBetterAuth: async () => ({
    api: { signUpEmail: (...a: any[]) => signUpEmailMock(...a) },
  }),
  getBetterAuthInternalAdapter: async () => ({
    findUserByEmail: (...a: any[]) => findUserByEmailMock(...a),
    linkAccount: (...a: any[]) => linkAccountMock(...a),
    createUser: vi.fn(),
  }),
}));

// --- store mock: in-memory CSRF state + jti, real feature switch ---
const stateRows = new Map<
  string,
  { returnPath: string | null; consumed: boolean; expired: boolean }
>();
const jtiSeen = new Set<string>();
let nextState = "state-0";
vi.mock("./identity-sso-store.js", () => ({
  getIdentityHubUrl: () => {
    const raw = process.env.AGENT_NATIVE_IDENTITY_HUB_URL?.trim();
    if (!raw) return undefined;
    try {
      const u = new URL(raw);
      if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
      return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, "");
    } catch {
      return undefined;
    }
  },
  isIdentitySsoEnabled: () => !!process.env.AGENT_NATIVE_IDENTITY_HUB_URL,
  identitySsoLoginButtonHtml: () =>
    process.env.AGENT_NATIVE_IDENTITY_HUB_URL ? "<a>sso</a>" : "",
  createSsoState: vi.fn(async (returnPath: string | null) => {
    const s = nextState;
    nextState = `state-${stateRows.size + 1}`;
    stateRows.set(s, { returnPath, consumed: false, expired: false });
    return s;
  }),
  consumeSsoState: vi.fn(async (state: string) => {
    const row = stateRows.get(state);
    if (!row || row.consumed || row.expired)
      return { ok: false, returnPath: null };
    row.consumed = true;
    return { ok: true, returnPath: row.returnPath };
  }),
  isJtiReplayed: vi.fn(async (jti: string | undefined) => {
    if (!jti) return false;
    if (jtiSeen.has(jti)) return true;
    jtiSeen.add(jti);
    return false;
  }),
}));

const { handleIdentitySso } = await import("./identity-sso.js");

const HUB = "https://dispatch.agent-native.com";
const SECRET = "test-a2a-secret";

function ev(opts: { method?: string; path?: string; host?: string }): any {
  const path = opts.path ?? "/";
  return {
    method: opts.method ?? "GET",
    headers: { host: opts.host ?? "mail.agent-native.com" },
    node: { req: { url: path } },
    path,
    url: { pathname: path.split("?")[0] },
  };
}

async function signIdentity(
  claims: Record<string, unknown>,
  opts: { secret?: string; expiresIn?: string; iat?: number } = {},
): Promise<string> {
  const b = new jose.SignJWT({
    aud: "https://mail.agent-native.com/_agent-native/identity/callback",
    redirect_uri:
      "https://mail.agent-native.com/_agent-native/identity/callback",
    ...claims,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(opts.expiresIn ?? "5m");
  if (opts.iat !== undefined) b.setIssuedAt(opts.iat);
  else b.setIssuedAt();
  return b.sign(new TextEncoder().encode(opts.secret ?? SECRET));
}

beforeEach(() => {
  stateRows.clear();
  jtiSeen.clear();
  adapterUsers.length = 0;
  nextState = "state-0";
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue(null);
  signUpEmailMock.mockClear();
  linkAccountMock.mockClear();
  findUserByEmailMock.mockClear();
  createOAuthSessionMock.mockClear();
  process.env.A2A_SECRET = SECRET;
  process.env.AGENT_NATIVE_IDENTITY_HUB_URL = HUB;
});
afterEach(() => {
  delete process.env.A2A_SECRET;
  delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;
});

describe("identity SSO — env-unset is a no-op", () => {
  it("404s every subpath when AGENT_NATIVE_IDENTITY_HUB_URL is unset", async () => {
    delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;
    for (const p of ["/login", "/callback", "/", "/anything"]) {
      const res = await handleIdentitySso(ev({ path: p }), p);
      expect(res.status).toBe(404);
    }
    // No session minted, no Better Auth touched, no state created.
    expect(createOAuthSessionMock).not.toHaveBeenCalled();
    expect(signUpEmailMock).not.toHaveBeenCalled();
    expect(stateRows.size).toBe(0);
  });

  it("the conditional login button is empty when disabled and present when enabled", async () => {
    const mod = await import("./identity-sso-store.js");
    delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;
    expect(mod.identitySsoLoginButtonHtml()).toBe("");
    process.env.AGENT_NATIVE_IDENTITY_HUB_URL = HUB;
    expect(mod.identitySsoLoginButtonHtml()).not.toBe("");
  });
});

describe("identity SSO — /login", () => {
  it("302s to the hub authorize endpoint with app, redirect_uri and state", async () => {
    const res = await handleIdentitySso(
      ev({ path: "/login?return=/inbox" }),
      "/login",
    );
    expect(res.status).toBe(302);
    const loc = res.headers.get("Location")!;
    expect(loc.startsWith(`${HUB}/_agent-native/identity/authorize`)).toBe(
      true,
    );
    const u = new URL(loc);
    expect(u.searchParams.get("app")).toBe("mail");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://mail.agent-native.com/_agent-native/identity/callback",
    );
    expect(u.searchParams.get("state")).toBeTruthy();
    expect(stateRows.size).toBe(1);
  });

  it("skips the round-trip and 302s to the return path when already signed in", async () => {
    getSessionMock.mockResolvedValue({ email: "a@b.com" });
    const res = await handleIdentitySso(
      ev({ path: "/login?return=/inbox" }),
      "/login",
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/inbox");
    expect(stateRows.size).toBe(0);
  });
});

describe("identity SSO — /callback rejects bad tokens", () => {
  async function mintState(returnPath: string | null = null): Promise<string> {
    const store = await import("./identity-sso-store.js");
    return store.createSsoState(returnPath);
  }

  it("rejects a bad signature", async () => {
    const state = await mintState();
    const token = await signIdentity(
      { email: "x@y.com", scope: "identity", jti: "j1" },
      { secret: "WRONG-SECRET" },
    );
    const res = await handleIdentitySso(
      ev({ path: `/callback?token=${token}&state=${state}` }),
      "/callback",
    );
    expect(res.status).toBe(400);
    expect(createOAuthSessionMock).not.toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    const state = await mintState();
    const token = await signIdentity(
      { email: "x@y.com", scope: "identity", jti: "j2" },
      { expiresIn: "-1m" },
    );
    const res = await handleIdentitySso(
      ev({ path: `/callback?token=${token}&state=${state}` }),
      "/callback",
    );
    expect(res.status).toBe(400);
    expect(createOAuthSessionMock).not.toHaveBeenCalled();
  });

  it("rejects the wrong scope (an A2A delegation token)", async () => {
    const state = await mintState();
    const token = await signIdentity({
      email: "x@y.com",
      scope: "mcp-connect",
      jti: "j3",
    });
    const res = await handleIdentitySso(
      ev({ path: `/callback?token=${token}&state=${state}` }),
      "/callback",
    );
    expect(res.status).toBe(400);
    expect(createOAuthSessionMock).not.toHaveBeenCalled();
  });

  it("rejects a token minted for another app callback", async () => {
    const state = await mintState();
    const token = await signIdentity({
      email: "x@y.com",
      scope: "identity",
      jti: "wrong-aud",
      aud: "https://calendar.agent-native.com/_agent-native/identity/callback",
      redirect_uri:
        "https://calendar.agent-native.com/_agent-native/identity/callback",
    });
    const res = await handleIdentitySso(
      ev({ path: `/callback?token=${token}&state=${state}` }),
      "/callback",
    );
    expect(res.status).toBe(400);
    expect(createOAuthSessionMock).not.toHaveBeenCalled();
  });

  it("rejects a legacy identity token without an audience", async () => {
    const state = await mintState();
    const token = await new jose.SignJWT({
      email: "x@y.com",
      scope: "identity",
      jti: "missing-aud",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(SECRET));
    const res = await handleIdentitySso(
      ev({ path: `/callback?token=${token}&state=${state}` }),
      "/callback",
    );
    expect(res.status).toBe(400);
    expect(createOAuthSessionMock).not.toHaveBeenCalled();
  });

  it("rejects a missing/unknown CSRF state", async () => {
    const token = await signIdentity({
      email: "x@y.com",
      scope: "identity",
      jti: "j4",
    });
    const res = await handleIdentitySso(
      ev({ path: `/callback?token=${token}&state=does-not-exist` }),
      "/callback",
    );
    expect(res.status).toBe(400);
    expect(createOAuthSessionMock).not.toHaveBeenCalled();
  });

  it("rejects a replayed (reused) CSRF state", async () => {
    const state = await mintState();
    const t1 = await signIdentity({
      email: "x@y.com",
      scope: "identity",
      jti: "ra",
    });
    const ok = await handleIdentitySso(
      ev({ path: `/callback?token=${t1}&state=${state}` }),
      "/callback",
    );
    expect(ok.status).toBe(302);
    // Same state again → rejected.
    const t2 = await signIdentity({
      email: "x@y.com",
      scope: "identity",
      jti: "rb",
    });
    const res = await handleIdentitySso(
      ev({ path: `/callback?token=${t2}&state=${state}` }),
      "/callback",
    );
    expect(res.status).toBe(400);
  });

  it("rejects a replayed jti even with a fresh valid state", async () => {
    const s1 = await mintState();
    const tok = await signIdentity({
      email: "x@y.com",
      scope: "identity",
      jti: "dup-jti",
    });
    expect(
      (
        await handleIdentitySso(
          ev({ path: `/callback?token=${tok}&state=${s1}` }),
          "/callback",
        )
      ).status,
    ).toBe(302);
    const s2 = await mintState();
    const tok2 = await signIdentity({
      email: "x@y.com",
      scope: "identity",
      jti: "dup-jti",
    });
    const res = await handleIdentitySso(
      ev({ path: `/callback?token=${tok2}&state=${s2}` }),
      "/callback",
    );
    expect(res.status).toBe(400);
  });

  it("never trusts a query-param email — identity comes only from the verified token", async () => {
    const state = await mintState();
    // Token says alice; query says attacker.
    const token = await signIdentity({
      email: "alice@corp.com",
      scope: "identity",
      jti: "qp",
    });
    const res = await handleIdentitySso(
      ev({
        path: `/callback?token=${token}&state=${state}&email=attacker@evil.com`,
      }),
      "/callback",
    );
    expect(res.status).toBe(302);
    // Session minted for the VERIFIED email, not the query param.
    expect(createOAuthSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "alice@corp.com",
      expect.objectContaining({ hasProductionSession: false }),
    );
  });
});

describe("identity SSO — JIT link semantics", () => {
  it("EXISTING email → adds the federated account link, never mutates the user, logs into the SAME user id", async () => {
    adapterUsers.push({
      id: "user-existing-1",
      email: "existing@corp.com",
      accounts: [{ providerId: "credential", accountId: "existing@corp.com" }],
    });
    const store = await import("./identity-sso-store.js");
    const state = await store.createSsoState(null);
    const token = await signIdentity({
      email: "existing@corp.com",
      sub: "hub-sub-123",
      scope: "identity",
      jti: "e1",
      name: "Existing User",
    });
    const res = await handleIdentitySso(
      ev({ path: `/callback?token=${token}&state=${state}` }),
      "/callback",
    );
    expect(res.status).toBe(302);

    // New user path NOT taken — no signup for an existing email.
    expect(signUpEmailMock).not.toHaveBeenCalled();
    // The federated link was added additively via Better Auth's adapter.
    expect(linkAccountMock).toHaveBeenCalledWith({
      userId: "user-existing-1",
      providerId: "agent-native",
      accountId: "hub-sub-123",
    });
    // Original user row untouched: same id, email, and its pre-existing
    // credential account is still present (only an additive row was added).
    const u = adapterUsers.find((x) => x.id === "user-existing-1")!;
    expect(u.email).toBe("existing@corp.com");
    expect(u.accounts).toContainEqual({
      providerId: "credential",
      accountId: "existing@corp.com",
    });
    expect(u.accounts).toContainEqual({
      providerId: "agent-native",
      accountId: "hub-sub-123",
    });
    // Session minted for the SAME user's email via the Google-OAuth path.
    expect(createOAuthSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "existing@corp.com",
      expect.objectContaining({ hasProductionSession: false }),
    );
  });

  it("EXISTING email already linked → no duplicate link, still mints a session", async () => {
    adapterUsers.push({
      id: "u2",
      email: "linked@corp.com",
      accounts: [{ providerId: "agent-native", accountId: "linked@corp.com" }],
    });
    const store = await import("./identity-sso-store.js");
    const state = await store.createSsoState(null);
    const token = await signIdentity({
      email: "linked@corp.com",
      scope: "identity",
      jti: "l1",
    });
    const res = await handleIdentitySso(
      ev({ path: `/callback?token=${token}&state=${state}` }),
      "/callback",
    );
    expect(res.status).toBe(302);
    expect(linkAccountMock).not.toHaveBeenCalled();
    expect(createOAuthSessionMock).toHaveBeenCalled();
  });

  it("NEW email → creates the user via the app's own signUpEmail path, then sessions", async () => {
    // findUserByEmail starts empty; after signUpEmail the test adapter
    // 'creates' the row so the post-create lookup resolves.
    signUpEmailMock.mockImplementation(async (opts: any) => {
      adapterUsers.push({
        id: "new-user-9",
        email: opts.body.email,
        accounts: [{ providerId: "credential", accountId: opts.body.email }],
      });
      return {};
    });
    const store = await import("./identity-sso-store.js");
    const state = await store.createSsoState("/welcome");
    const token = await signIdentity({
      email: "brand-new@corp.com",
      scope: "identity",
      jti: "n1",
      name: "Brand New",
    });
    const res = await handleIdentitySso(
      ev({ path: `/callback?token=${token}&state=${state}` }),
      "/callback",
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/welcome");
    // Created via the SAME Better Auth signup API the app already uses.
    expect(signUpEmailMock).toHaveBeenCalledWith({
      body: expect.objectContaining({
        email: "brand-new@corp.com",
        name: "Brand New",
      }),
    });
    expect(createOAuthSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "brand-new@corp.com",
      expect.objectContaining({ hasProductionSession: false }),
    );
  });
});
