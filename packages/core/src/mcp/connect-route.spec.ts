import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- h3 + helper mocks (mirror sibling specs) ---
vi.mock("h3", () => ({
  getMethod: (event: any) => event.method ?? "GET",
  getHeader: (event: any, name: string) =>
    event.headers?.[name.toLowerCase()] ?? event.headers?.[name],
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: vi.fn(async (event: any) => event.body ?? {}),
}));

const getSessionMock = vi.fn();
const getConfiguredLoginHtmlMock = vi.fn(() => null);
// Mirror the real socket-based isLoopbackRequest: dev-open is gated on the
// actual peer, not the (spoofable) Host header. The test events carry no
// socket, so derive loopback from the host they simulate connecting as —
// localhost/127.x ⇒ a loopback peer, anything else ⇒ remote.
const isLoopbackRequestMock = vi.fn((event: any) =>
  /^(localhost|127\.|\[?::1\]?)(:|$)/i.test(String(event?.headers?.host ?? "")),
);
vi.mock("../server/auth.js", () => ({
  getSession: (...a: any[]) => getSessionMock(...a),
  getConfiguredLoginHtml: (...a: any[]) => getConfiguredLoginHtmlMock(...a),
  isLoopbackRequest: (...a: any[]) => isLoopbackRequestMock(...a),
}));

vi.mock("../org/context.js", () => ({
  getOrgDomain: vi.fn(async () => "builder.io"),
}));

// In-memory store mock — exercises mint/revoke + device lifecycle via the
// route, while letting us reach into raw state for assertions.
const tokenRows: any[] = [];
const deviceRows: any[] = [];
vi.mock("./connect-store.js", () => ({
  MCP_CONNECT_SCOPE: "mcp-connect",
  MCP_CONNECT_OAUTH_CLIENT_ID: "agent-native-connect",
  DEFAULT_TOKEN_TTL_DAYS: 365,
  MIN_TOKEN_TTL_DAYS: 1,
  MAX_TOKEN_TTL_DAYS: 365,
  DEVICE_CODE_TTL_MS: 600_000,
  recordMintedToken: vi.fn(async (p: any) => {
    const id = "id-" + tokenRows.length;
    tokenRows.push({ id, ...p, revokedAt: null });
    return id;
  }),
  listTokens: vi.fn(async (email: string) =>
    tokenRows
      .filter((t) => t.ownerEmail === email)
      .map((t) => ({
        id: t.id,
        jti: t.jti,
        ownerEmail: t.ownerEmail,
        orgId: t.orgId ?? null,
        label: t.label ?? null,
        createdAt: 1000,
        lastUsedAt: null,
        revokedAt: t.revokedAt,
      })),
  ),
  revokeToken: vi.fn(async (email: string, id: string) => {
    const t = tokenRows.find(
      (r) => r.id === id && r.ownerEmail === email && r.revokedAt == null,
    );
    if (!t) return false;
    t.revokedAt = Date.now();
    return true;
  }),
  createDeviceCode: vi.fn(async () => {
    const row = {
      deviceCode: "dev-" + deviceRows.length,
      userCode: "ABCD-2345",
      ownerEmail: null,
      orgId: null,
      status: "pending",
      tokenJti: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600_000,
      consumedAt: null,
    };
    deviceRows.push(row);
    return { ...row };
  }),
  getDeviceCode: vi.fn(async (dc: string) => {
    const r = deviceRows.find((d) => d.deviceCode === dc);
    return r ? { ...r } : null;
  }),
  approveDeviceCode: vi.fn(
    async (uc: string, email: string, orgId: string | null) => {
      const r = deviceRows.find((d) => d.userCode === uc);
      if (!r) return "not_found";
      if (r.status !== "pending") return "already";
      r.status = "approved";
      r.ownerEmail = email;
      r.orgId = orgId;
      return { ...r };
    },
  ),
  consumeDeviceCode: vi.fn(async (dc: string, jti: string) => {
    const r = deviceRows.find((d) => d.deviceCode === dc);
    if (!r || r.status !== "approved") return null;
    r.status = "consumed";
    r.tokenJti = jti;
    return { ...r, status: "approved" };
  }),
  claimDeviceCodeForMint: vi.fn(async (dc: string, jti: string) => {
    const r = deviceRows.find((d) => d.deviceCode === dc);
    if (!r || r.status !== "approved") return null;
    r.status = "minting";
    r.tokenJti = jti;
    return { ...r, status: "approved" };
  }),
  finishDeviceCodeMint: vi.fn(async (dc: string, jti: string) => {
    const r = deviceRows.find((d) => d.deviceCode === dc);
    if (!r || r.status !== "minting" || r.tokenJti !== jti) return false;
    r.status = "consumed";
    return true;
  }),
  releaseDeviceCodeMint: vi.fn(async (dc: string, jti: string) => {
    const r = deviceRows.find((d) => d.deviceCode === dc);
    if (!r || r.status !== "minting" || r.tokenJti !== jti) return;
    r.status = "approved";
    r.tokenJti = null;
  }),
  expireDeviceCode: vi.fn(async () => {}),
}));

const { handleMcpConnect } = await import("./connect-route.js");

function ev(opts: {
  method?: string;
  path?: string;
  body?: any;
  host?: string;
}): any {
  return {
    method: opts.method ?? "GET",
    body: opts.body,
    headers: { host: opts.host ?? "mail.agent-native.com" },
    node: { req: { url: opts.path ?? "/" } },
    path: opts.path ?? "/",
    url: { pathname: (opts.path ?? "/").split("?")[0] },
  };
}

const SECRET = "test-a2a-secret";

describe("handleMcpConnect", () => {
  beforeEach(() => {
    tokenRows.length = 0;
    deviceRows.length = 0;
    getSessionMock.mockReset();
    getConfiguredLoginHtmlMock.mockReturnValue(null);
    process.env.A2A_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.A2A_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
  });

  describe("connect page", () => {
    it("serves the configured login HTML when unauthenticated", async () => {
      getSessionMock.mockResolvedValue(null);
      getConfiguredLoginHtmlMock.mockReturnValue("<html>login</html>");
      const res = await handleMcpConnect(ev({}), "/");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("<html>login</html>");
    });

    it("renders the connect page for a logged-in user", async () => {
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      const res = await handleMcpConnect(ev({}), "/");
      const body = await res.text();
      expect(res.status).toBe(200);
      expect(body).toContain("Connect an external agent");
      expect(body).toContain("u@example.com");
      expect(body).not.toContain("Allow Claude Code, Codex, or Cowork");
      expect(body).toContain('<details id="connections" class="connections">');
      expect(body).not.toContain("connectionsEl.open = true");
      // The page never embeds a token.
      expect(body).not.toContain("Bearer ey");
      // The new non-dev flow surfaces the remote MCP URL + a per-host picker
      // (Claude / ChatGPT / Cursor / Claude Code / Codex / Other) so users can
      // connect without copying a token. Display the live host MCP URL rather
      // than a hardcoded one.
      expect(body).toContain("https://mail.agent-native.com/_agent-native/mcp");
      expect(body).toContain('data-tab="claude"');
      expect(body).toContain('data-tab="chatgpt"');
      expect(body).toContain('data-tab="claude-code"');
      expect(body).toContain('data-tab="codex"');
      expect(body).toContain("Your MCP URL");
      expect(body).toContain(
        "claude mcp add --transport http agent-native-mail",
      );
      expect(body).toContain(
        "npx @agent-native/core@latest connect https://mail.agent-native.com",
      );
      expect(body).toContain('<details id="assistantSetup" class="hosts">');
      expect(body).not.toContain(
        '<details id="assistantSetup" class="hosts" open>',
      );
    });

    it("shows the device user_code when present and well-formed", async () => {
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      const res = await handleMcpConnect(
        ev({ path: "/?user_code=ABCD-2345" }),
        "/",
      );
      const body = await res.text();
      expect(body).toContain("ABCD-2345");
      expect(body).toContain("Authorize this device");
      expect(body).toContain("Authorizing device...");
      expect(body).toContain('btn.setAttribute("aria-busy", "true")');
      expect(body).not.toContain("Pick your AI assistant");
      expect(body).not.toContain("Your MCP URL");
      expect(body).not.toContain("Advanced options");
    });
  });

  describe("POST /token", () => {
    it("requires a session", async () => {
      getSessionMock.mockResolvedValue(null);
      const res = await handleMcpConnect(ev({ method: "POST" }), "/token");
      expect(res.status).toBe(401);
    });

    it("mints a connect-scoped JWT with jti and records it", async () => {
      getSessionMock.mockResolvedValue({
        email: "u@example.com",
        orgId: "org-1",
      });
      const res = await handleMcpConnect(
        ev({ method: "POST", body: { label: "laptop", ttlDays: 30 } }),
        "/token",
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.mcpUrl).toBe(
        "https://mail.agent-native.com/_agent-native/mcp",
      );
      expect(data.serverName).toBe("agent-native-mail");
      expect(data.mcpServerEntry).toEqual({
        type: "http",
        url: "https://mail.agent-native.com/_agent-native/mcp",
        headers: {
          Authorization: `Bearer ${data.token}`,
        },
      });
      expect(data.cli).toBe(
        "npx @agent-native/core@latest connect https://mail.agent-native.com",
      );

      const { payload } = await jose.jwtVerify(
        data.token,
        new TextEncoder().encode(SECRET),
      );
      expect(payload.sub).toBe("u@example.com");
      expect(payload.scope).toBe("mcp-connect");
      expect(typeof payload.jti).toBe("string");
      expect(payload.org_domain).toBe("builder.io");

      expect(tokenRows).toHaveLength(1);
      expect(tokenRows[0]).toMatchObject({
        ownerEmail: "u@example.com",
        orgId: "org-1",
        label: "laptop",
        jti: payload.jti,
      });
    });

    it("defaults token lifetime to 365 days", async () => {
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      const res = await handleMcpConnect(ev({ method: "POST" }), "/token");
      const { token } = await res.json();
      const { payload } = await jose.jwtVerify(
        token,
        new TextEncoder().encode(SECRET),
      );
      const lifetimeDays =
        ((payload.exp as number) - (payload.iat as number)) / 86400;
      expect(Math.round(lifetimeDays)).toBe(365);
    });

    it("clamps ttlDays into the 1-365 range", async () => {
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      const res = await handleMcpConnect(
        ev({ method: "POST", body: { ttlDays: 9999 } }),
        "/token",
      );
      const { token } = await res.json();
      const { payload } = await jose.jwtVerify(
        token,
        new TextEncoder().encode(SECRET),
      );
      const lifetimeDays =
        ((payload.exp as number) - (payload.iat as number)) / 86400;
      expect(Math.round(lifetimeDays)).toBe(365);
    });

    it("mints a standard MCP OAuth token when no A2A_SECRET is configured", async () => {
      delete process.env.A2A_SECRET;
      process.env.BETTER_AUTH_SECRET = SECRET;
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      const res = await handleMcpConnect(ev({ method: "POST" }), "/token");
      const data = await res.json();
      expect(res.status).toBe(200);
      const { verifyMcpOAuthAccessToken } = await import("./oauth-token.js");
      const verified = await verifyMcpOAuthAccessToken(data.token, data.mcpUrl);
      const decoded = jose.decodeJwt(data.token);
      const lifetimeDays =
        ((decoded.exp as number) - (decoded.iat as number)) / 86400;
      expect(verified).toMatchObject({
        userEmail: "u@example.com",
        clientId: "agent-native-connect",
        scopes: ["mcp:read", "mcp:write", "mcp:apps", "offline_access"],
      });
      expect(data.mcpServerEntry.headers).toMatchObject({
        Authorization: `Bearer ${data.token}`,
      });
      expect(data.mcpServerEntry.headers).not.toHaveProperty(
        "X-Agent-Native-MCP-Full-Catalog",
      );
      expect(Math.round(lifetimeDays)).toBe(365);
      expect(tokenRows[0]).toMatchObject({
        jti: verified?.jti,
        ownerEmail: "u@example.com",
      });
    });

    it("returns a dev-open localhost entry when no A2A_SECRET is configured", async () => {
      delete process.env.A2A_SECRET;
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      const res = await handleMcpConnect(
        ev({ method: "POST", host: "localhost:4321" }),
        "/token",
      );
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.token).toBe("");
      expect(data.mcpServerEntry).toEqual({
        type: "http",
        url: "http://localhost:4321/_agent-native/mcp",
        headers: {
          "X-Agent-Native-Owner-Email": "u@example.com",
        },
      });
    });
  });

  describe("token list + revoke", () => {
    it("lists only the caller's tokens and never the token value", async () => {
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      tokenRows.push(
        { id: "id-0", jti: "j0", ownerEmail: "u@example.com", revokedAt: null },
        { id: "id-1", jti: "j1", ownerEmail: "other@x.com", revokedAt: null },
      );
      const res = await handleMcpConnect(ev({}), "/tokens");
      const data = await res.json();
      expect(data.tokens).toHaveLength(1);
      expect(data.tokens[0]).not.toHaveProperty("jti");
      expect(data.tokens[0]).not.toHaveProperty("token");
      expect(data.tokens[0].id).toBe("id-0");
    });

    it("revoke only succeeds for a token the caller owns", async () => {
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      tokenRows.push({
        id: "id-0",
        jti: "j0",
        ownerEmail: "someoneelse@x.com",
        revokedAt: null,
      });
      const denied = await handleMcpConnect(
        ev({ method: "POST", body: { id: "id-0" } }),
        "/tokens/revoke",
      );
      expect((await denied.json()).ok).toBe(false);
      expect(tokenRows[0].revokedAt).toBeNull();

      tokenRows.push({
        id: "id-1",
        jti: "j1",
        ownerEmail: "u@example.com",
        revokedAt: null,
      });
      const ok = await handleMcpConnect(
        ev({ method: "POST", body: { id: "id-1" } }),
        "/tokens/revoke",
      );
      expect((await ok.json()).ok).toBe(true);
      expect(tokenRows[1].revokedAt).not.toBeNull();
    });

    it("revoke requires a session", async () => {
      getSessionMock.mockResolvedValue(null);
      const res = await handleMcpConnect(
        ev({ method: "POST", body: { id: "x" } }),
        "/tokens/revoke",
      );
      expect(res.status).toBe(401);
    });
  });

  describe("device-code flow", () => {
    it("device/start is unauth and returns the verification URIs", async () => {
      getSessionMock.mockResolvedValue(null);
      const res = await handleMcpConnect(
        ev({ method: "POST" }),
        "/device/start",
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.device_code).toBeTruthy();
      expect(data.user_code).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
      expect(data.verification_uri).toBe(
        "https://mail.agent-native.com/_agent-native/mcp/connect",
      );
      expect(data.verification_uri_complete).toContain(
        "?user_code=" + data.user_code,
      );
      expect(data.interval).toBe(3);
      expect(data.expires_in).toBe(600);
    });

    it("device/start and returned MCP config include APP_BASE_PATH", async () => {
      process.env.APP_BASE_PATH = "/mail";
      try {
        await handleMcpConnect(ev({ method: "POST" }), "/device/start");
        const dc = deviceRows[0].deviceCode;
        getSessionMock.mockResolvedValue({ email: "u@example.com" });
        await handleMcpConnect(
          ev({ method: "POST", body: { user_code: "ABCD-2345" } }),
          "/device/authorize",
        );
        getSessionMock.mockResolvedValue(null);
        const res = await handleMcpConnect(
          ev({ method: "POST", body: { device_code: dc } }),
          "/device/poll",
        );
        const data = await res.json();
        expect(data.mcpUrl).toBe(
          "https://mail.agent-native.com/mail/_agent-native/mcp",
        );
        expect(data.cli).toBe(
          "npx @agent-native/core@latest connect https://mail.agent-native.com/mail",
        );
      } finally {
        delete process.env.APP_BASE_PATH;
      }
    });

    it("device/authorize requires a session and binds the user", async () => {
      // start
      await handleMcpConnect(ev({ method: "POST" }), "/device/start");

      // unauth authorize → 401
      getSessionMock.mockResolvedValue(null);
      const unauth = await handleMcpConnect(
        ev({ method: "POST", body: { user_code: "ABCD-2345" } }),
        "/device/authorize",
      );
      expect(unauth.status).toBe(401);

      // authed authorize → 200 + bound
      getSessionMock.mockResolvedValue({
        email: "u@example.com",
        orgId: "org-7",
      });
      const ok = await handleMcpConnect(
        ev({ method: "POST", body: { user_code: "ABCD-2345" } }),
        "/device/authorize",
      );
      expect(ok.status).toBe(200);
      expect(deviceRows[0].ownerEmail).toBe("u@example.com");
      expect(deviceRows[0].status).toBe("approved");
    });

    it("rejects a malformed user_code", async () => {
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      const res = await handleMcpConnect(
        ev({ method: "POST", body: { user_code: "not a code" } }),
        "/device/authorize",
      );
      expect(res.status).toBe(400);
    });

    it("poll: pending → approved (mints once) → consumed", async () => {
      await handleMcpConnect(ev({ method: "POST" }), "/device/start");
      const dc = deviceRows[0].deviceCode;

      // pending
      getSessionMock.mockResolvedValue(null);
      let res = await handleMcpConnect(
        ev({ method: "POST", body: { device_code: dc } }),
        "/device/poll",
      );
      expect((await res.json()).status).toBe("pending");

      // approve via the browser
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      await handleMcpConnect(
        ev({ method: "POST", body: { user_code: "ABCD-2345" } }),
        "/device/authorize",
      );

      // poll → approved + token (unauth)
      getSessionMock.mockResolvedValue(null);
      res = await handleMcpConnect(
        ev({ method: "POST", body: { device_code: dc } }),
        "/device/poll",
      );
      const data = await res.json();
      expect(data.status).toBe("approved");
      const { payload } = await jose.jwtVerify(
        data.token,
        new TextEncoder().encode(SECRET),
      );
      expect(payload.sub).toBe("u@example.com");
      expect(payload.scope).toBe("mcp-connect");
      const lifetimeDays =
        ((payload.exp as number) - (payload.iat as number)) / 86400;
      expect(Math.round(lifetimeDays)).toBe(365);

      // poll again → consumed (single-use, no second token)
      res = await handleMcpConnect(
        ev({ method: "POST", body: { device_code: dc } }),
        "/device/poll",
      );
      const again = await res.json();
      expect(again.status).toBe("consumed");
      expect(again.token).toBeUndefined();
    });

    it("poll returns a dev-open localhost entry without A2A_SECRET", async () => {
      delete process.env.A2A_SECRET;
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      await handleMcpConnect(
        ev({ method: "POST", host: "localhost:4321" }),
        "/device/start",
      );
      const dc = deviceRows[0].deviceCode;

      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      await handleMcpConnect(
        ev({
          method: "POST",
          host: "localhost:4321",
          body: { user_code: "ABCD-2345" },
        }),
        "/device/authorize",
      );

      getSessionMock.mockResolvedValue(null);
      const res = await handleMcpConnect(
        ev({
          method: "POST",
          host: "localhost:4321",
          body: { device_code: dc },
        }),
        "/device/poll",
      );
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.status).toBe("approved");
      expect(data.token).toBe("");
      expect(data.mcpServerEntry.headers).toEqual({
        "X-Agent-Native-Owner-Email": "u@example.com",
      });
    });

    it("poll mints a standard MCP OAuth token for hosted deploys without A2A_SECRET", async () => {
      delete process.env.A2A_SECRET;
      process.env.BETTER_AUTH_SECRET = SECRET;
      await handleMcpConnect(ev({ method: "POST" }), "/device/start");
      const dc = deviceRows[0].deviceCode;

      getSessionMock.mockResolvedValue({
        email: "u@example.com",
        orgId: "org-7",
      });
      await handleMcpConnect(
        ev({ method: "POST", body: { user_code: "ABCD-2345" } }),
        "/device/authorize",
      );

      getSessionMock.mockResolvedValue(null);
      const res = await handleMcpConnect(
        ev({ method: "POST", body: { device_code: dc } }),
        "/device/poll",
      );
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.status).toBe("approved");

      const { verifyMcpOAuthAccessToken } = await import("./oauth-token.js");
      const verified = await verifyMcpOAuthAccessToken(data.token, data.mcpUrl);
      const decoded = jose.decodeJwt(data.token);
      const lifetimeDays =
        ((decoded.exp as number) - (decoded.iat as number)) / 86400;
      expect(verified).toMatchObject({
        userEmail: "u@example.com",
        orgId: "org-7",
        orgDomain: "builder.io",
        clientId: "agent-native-connect",
        scopes: ["mcp:read", "mcp:write", "mcp:apps", "offline_access"],
      });
      expect(data.mcpServerEntry.headers).toMatchObject({
        Authorization: `Bearer ${data.token}`,
      });
      expect(data.mcpServerEntry.headers).not.toHaveProperty(
        "X-Agent-Native-MCP-Full-Catalog",
      );
      expect(Math.round(lifetimeDays)).toBe(365);
      expect(verified?.jti).toBeTruthy();
      expect(tokenRows[0]).toMatchObject({
        jti: verified?.jti,
        ownerEmail: "u@example.com",
        orgId: "org-7",
        label: "Device connection",
      });
    });

    it("poll returns expired for a past-TTL code", async () => {
      await handleMcpConnect(ev({ method: "POST" }), "/device/start");
      const dc = deviceRows[0].deviceCode;
      deviceRows[0].expiresAt = Date.now() - 1;
      getSessionMock.mockResolvedValue(null);
      const res = await handleMcpConnect(
        ev({ method: "POST", body: { device_code: dc } }),
        "/device/poll",
      );
      expect((await res.json()).status).toBe("expired");
    });
  });
});
