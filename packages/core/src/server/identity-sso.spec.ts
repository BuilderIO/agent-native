import { createHash } from "node:crypto";

import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const createOAuthSessionMock = vi.fn(async () => ({
  sessionToken: "fresh-session-token",
}));
const signUpEmailMock = vi.fn(async () => ({}));
const googleAuthRequiredMock = vi.fn(async () => false);
const adapterUsers: Array<{
  id: string;
  email: string;
  accounts: Array<{ providerId: string; accountId: string }>;
}> = [];
const linkAccountMock = vi.fn(async (input: any) => {
  const user = adapterUsers.find((candidate) => candidate.id === input.userId);
  if (user) {
    user.accounts.push({
      providerId: input.providerId,
      accountId: input.accountId,
    });
  }
  return {};
});
const findUserByEmailMock = vi.fn(async (email: string) => {
  const user = adapterUsers.find((candidate) => candidate.email === email);
  return user
    ? { user: { id: user.id, email: user.email }, accounts: user.accounts }
    : null;
});

const states = new Map<
  string,
  {
    returnPath: string | null;
    binding: Record<string, string>;
    consumed: boolean;
  }
>();
const seenJtis = new Set<string>();
let stateCounter = 0;

vi.mock("h3", () => ({
  deleteCookie: (event: any, name: string) => {
    delete event.cookies[name];
  },
  getCookie: (event: any, name: string) => event.cookies?.[name],
  getHeader: (event: any, name: string) =>
    event.headers?.[name.toLowerCase()] ?? event.headers?.[name],
  getMethod: (event: any) => event.method ?? "GET",
  setCookie: (event: any, name: string, value: string) => {
    event.cookies ??= {};
    event.cookies[name] = value;
  },
}));

vi.mock("./auth.js", () => ({
  getSession: (...args: any[]) => getSessionMock(...args),
  isExpectedAuthFailure: (error: any) =>
    /already\s+exists|user\s+already/i.test(String(error?.message ?? "")),
  safeReturnPath: (raw: string | null | undefined) => {
    if (!raw) return "/";
    try {
      const url = new URL(raw, "http://safe.invalid");
      return url.origin === "http://safe.invalid"
        ? url.pathname + url.search + url.hash
        : "/";
    } catch {
      return "/";
    }
  },
}));
vi.mock("./app-name.js", () => ({ getAppName: () => "mail" }));
vi.mock("./google-oauth.js", () => ({
  createOAuthSession: (...args: any[]) => createOAuthSessionMock(...args),
  getOrigin: (event: any) =>
    `https://${event.headers?.host ?? "mail.agent-native.com"}`,
}));
vi.mock("../org/auth-policy.js", () => ({
  GOOGLE_AUTH_REQUIRED_MESSAGE: "Google sign-in is required.",
  isGoogleSignInRequiredForEmail: (...args: any[]) =>
    googleAuthRequiredMock(...args),
}));
vi.mock("./better-auth-instance.js", () => ({
  getBetterAuth: async () => ({
    api: { signUpEmail: (...args: any[]) => signUpEmailMock(...args) },
  }),
  getBetterAuthInternalAdapter: async () => ({
    findUserByEmail: (...args: any[]) => findUserByEmailMock(...args),
    linkAccount: (...args: any[]) => linkAccountMock(...args),
  }),
}));
vi.mock("./identity-sso-store.js", () => ({
  SSO_STATE_TTL_MS: 600_000,
  getIdentityHubUrl: () => {
    const raw = process.env.AGENT_NATIVE_IDENTITY_HUB_URL?.trim();
    if (!raw) return undefined;
    try {
      const url = new URL(raw);
      return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "");
    } catch {
      return undefined;
    }
  },
  identitySsoLoginButtonHtml: () =>
    process.env.AGENT_NATIVE_IDENTITY_HUB_URL ? "<a>sso</a>" : "",
  isCanonicalAgentNativeAppRequest: (host: string, protocol: string) =>
    protocol === "https" &&
    ["mail.agent-native.com", "dispatch.agent-native.com"].includes(host),
  isDesktopSsoCanaryUserAgent: (userAgent: string | undefined) =>
    /AgentNativeDesktopSsoCanary\//i.test(userAgent ?? ""),
  isIdentitySsoEnabled: () => !!process.env.AGENT_NATIVE_IDENTITY_HUB_URL,
  isJtiReplayed: vi.fn(async (jti: string | undefined) => {
    if (!jti) return true;
    if (seenJtis.has(jti)) return true;
    seenJtis.add(jti);
    return false;
  }),
  createSsoState: vi.fn(async (input: any) => {
    const state = `state-${String(stateCounter++).padStart(37, "0")}`;
    states.set(state, {
      returnPath: input.returnPath,
      binding: {
        appId: input.appId,
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        authority: input.authority,
        codeChallenge: input.codeChallenge,
      },
      consumed: false,
    });
    return state;
  }),
  consumeSsoState: vi.fn(async (state: string, expected: any) => {
    const row = states.get(state);
    if (!row || row.consumed) return { ok: false, returnPath: null };
    if (
      Object.entries(expected).some(
        ([key, value]) => row.binding[key] !== value,
      )
    ) {
      return { ok: false, returnPath: null };
    }
    row.consumed = true;
    return { ok: true, returnPath: row.returnPath };
  }),
}));

const { handleIdentitySso, isIdentitySsoBypassPath, resolveIdentityHubUrl } =
  await import("./identity-sso.js");

const HUB = "https://dispatch.agent-native.com";
const SECRET = "test-a2a-secret";
const CALLBACK =
  "https://mail.agent-native.com/_agent-native/identity/callback";

function event(path: string, options: any = {}): any {
  const staged: string[] = [];
  return {
    method: "GET",
    headers: {
      host: "mail.agent-native.com",
      "x-forwarded-proto": "https",
      "user-agent": "Mozilla/5.0 Chrome/140",
      ...(options.headers ?? {}),
    },
    node: { req: { url: path } },
    path,
    cookies: options.cookies ?? {},
    res: { headers: { getSetCookie: () => staged } },
  };
}

function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function signAssertion(
  claims: Record<string, unknown> = {},
  options: { secret?: string; issuer?: string; audience?: string } = {},
): Promise<string> {
  return new jose.SignJWT({
    scope: "identity",
    email: "alice@example.test",
    sub: "alice@example.test",
    identity_client_id: "mail",
    identity_authority: HUB,
    redirect_uri: CALLBACK,
    jti: "jti-1",
    ...claims,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(options.issuer ?? HUB)
    .setAudience(options.audience ?? CALLBACK)
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(new TextEncoder().encode(options.secret ?? SECRET));
}

async function startLogin(returnPath = "/inbox") {
  const loginEvent = event(
    `/_agent-native/identity/login?return=${returnPath}`,
  );
  const response = await handleIdentitySso(loginEvent, "/login");
  const location = new URL(response.headers.get("Location")!);
  const state = location.searchParams.get("state")!;
  const verifier = Object.values(loginEvent.cookies)[0] as string;
  return { loginEvent, response, location, state, verifier };
}

beforeEach(() => {
  states.clear();
  seenJtis.clear();
  adapterUsers.length = 0;
  stateCounter = 0;
  getSessionMock.mockReset().mockResolvedValue(null);
  createOAuthSessionMock.mockClear();
  signUpEmailMock.mockClear();
  googleAuthRequiredMock.mockReset().mockResolvedValue(false);
  linkAccountMock.mockClear();
  findUserByEmailMock.mockClear();
  process.env.A2A_SECRET = SECRET;
  process.env.AGENT_NATIVE_IDENTITY_HUB_URL = HUB;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ assertion: await signAssertion() }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  delete process.env.A2A_SECRET;
  delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;
  vi.unstubAllGlobals();
});

describe("identity SSO browser contract", () => {
  it("is a true no-op when the hub env is unset", async () => {
    delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;
    const response = await handleIdentitySso(
      event("/_agent-native/identity/login"),
      "/login",
    );
    expect(response.status).toBe(404);
    expect(createOAuthSessionMock).not.toHaveBeenCalled();
  });

  it("allows the packaged Canary to reach canonical apps without per-app env", async () => {
    delete process.env.AGENT_NATIVE_IDENTITY_HUB_URL;
    const request = event("/_agent-native/identity/login?return=/inbox", {
      headers: { "user-agent": "AgentNativeDesktopSsoCanary/1.0" },
    });
    getSessionMock.mockResolvedValue(null);
    const response = await handleIdentitySso(request, "/login");
    expect(resolveIdentityHubUrl(request)).toBe(HUB);
    expect(response.status).toBe(302);
  });

  it("starts an authorization-code + PKCE request without a browser JWT", async () => {
    const { response, location, verifier } = await startLogin();
    expect(response.status).toBe(302);
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("client_id")).toBe("mail");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toBe(
      challengeFor(verifier),
    );
    expect(location.searchParams.has("token")).toBe(false);
    expect(location.searchParams.has("id_token")).toBe(false);
  });

  it("exchanges the code server-to-server, binds state/PKCE, and links the verified email", async () => {
    const { loginEvent, state, verifier } = await startLogin("/welcome");
    const code = "c".repeat(43);
    const callbackEvent = event(
      `/_agent-native/identity/callback?code=${code}&state=${state}`,
      {
        cookies: { ...loginEvent.cookies },
      },
    );
    const response = await handleIdentitySso(callbackEvent, "/callback");
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/welcome");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      `${HUB}/_agent-native/identity/token`,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining(`\"code_verifier\":\"${verifier}\"`),
      }),
    );
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({
      code,
      state,
      app_id: "mail",
      client_id: "mail",
      redirect_uri: CALLBACK,
    });
    expect(createOAuthSessionMock).toHaveBeenCalledWith(
      expect.anything(),
      "alice@example.test",
      expect.objectContaining({ hasProductionSession: false }),
    );
  });

  it("rejects code replay, missing PKCE, bad assertion binding, and legacy token query params", async () => {
    const { loginEvent, state } = await startLogin();
    const code = "d".repeat(43);
    const first = await handleIdentitySso(
      event(`/_agent-native/identity/callback?code=${code}&state=${state}`, {
        cookies: { ...loginEvent.cookies },
      }),
      "/callback",
    );
    expect(first.status).toBe(302);
    const replay = await handleIdentitySso(
      event(`/_agent-native/identity/callback?code=${code}&state=${state}`, {
        cookies: { ...loginEvent.cookies },
      }),
      "/callback",
    );
    expect(replay.status).toBe(400);

    const missingCode = await handleIdentitySso(
      event(`/_agent-native/identity/callback?token=legacy&state=${state}`),
      "/callback",
    );
    expect(missingCode.status).toBe(400);

    const { loginEvent: badLogin, state: badState } = await startLogin();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              assertion: await signAssertion({
                identity_client_id: "calendar",
              }),
            }),
            { status: 200 },
          ),
      ),
    );
    const badAssertion = await handleIdentitySso(
      event(
        `/_agent-native/identity/callback?code=${"e".repeat(43)}&state=${badState}`,
        {
          cookies: { ...badLogin.cookies },
        },
      ),
      "/callback",
    );
    expect(badAssertion.status).toBe(400);
  });

  it("preserves the local Google-required organization policy", async () => {
    googleAuthRequiredMock.mockResolvedValue(true);
    const { loginEvent, state } = await startLogin();
    const response = await handleIdentitySso(
      event(
        `/_agent-native/identity/callback?code=${"h".repeat(43)}&state=${state}`,
        {
          cookies: { ...loginEvent.cookies },
        },
      ),
      "/callback",
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Google sign-in is required.");
    expect(signUpEmailMock).not.toHaveBeenCalled();
    expect(createOAuthSessionMock).not.toHaveBeenCalled();
  });
});

describe("additive JIT linking", () => {
  it("keeps an existing local user and adds only the inert provider link", async () => {
    adapterUsers.push({
      id: "existing-1",
      email: "alice@example.test",
      accounts: [{ providerId: "credential", accountId: "alice@example.test" }],
    });
    const { loginEvent, state } = await startLogin();
    const response = await handleIdentitySso(
      event(
        `/_agent-native/identity/callback?code=${"f".repeat(43)}&state=${state}`,
        {
          cookies: { ...loginEvent.cookies },
        },
      ),
      "/callback",
    );
    expect(response.status).toBe(302);
    expect(signUpEmailMock).not.toHaveBeenCalled();
    expect(linkAccountMock).toHaveBeenCalledWith({
      userId: "existing-1",
      providerId: "agent-native",
      accountId: "alice@example.test",
    });
  });

  it("creates a new user with a random unusable credential", async () => {
    signUpEmailMock.mockImplementation(async ({ body }: any) => {
      adapterUsers.push({
        id: "new-1",
        email: body.email,
        accounts: [{ providerId: "credential", accountId: body.email }],
      });
      return {};
    });
    const { loginEvent, state } = await startLogin();
    const response = await handleIdentitySso(
      event(
        `/_agent-native/identity/callback?code=${"g".repeat(43)}&state=${state}`,
        {
          cookies: { ...loginEvent.cookies },
        },
      ),
      "/callback",
    );
    expect(response.status).toBe(302);
    const password = signUpEmailMock.mock.calls[0][0].body.password;
    expect(password).toMatch(/^an-sso_[A-Za-z0-9_-]{43}$/);
    expect(password).not.toContain(SECRET);
  });
});

describe("route boundaries", () => {
  it("does not bypass auth for the Desktop completion page", () => {
    expect(
      isIdentitySsoBypassPath("/_agent-native/identity/desktop-complete"),
    ).toBe(false);
  });
});
