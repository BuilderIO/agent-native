import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("h3", () => ({
  getMethod: (event: any) => event.method ?? "GET",
  getHeader: (event: any, name: string) =>
    event.headers?.[name.toLowerCase()] ?? event.headers?.[name],
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: vi.fn(async (event: any) => event.body ?? {}),
}));

const getSessionMock = vi.fn();
const getConfiguredLoginHtmlMock = vi.fn(
  (): { html: string; status: number } | null => null,
);
const isLoopbackRequestMock = vi.fn((event: any) =>
  /^(localhost|127\.|\[?::1\]?)(:|$)/i.test(String(event?.headers?.host ?? "")),
);
vi.mock("../server/auth.js", () => ({
  getSession: (...a: any[]) => getSessionMock(...a),
  getConfiguredLoginHtml: (...a: any[]) => getConfiguredLoginHtmlMock(...a),
  isLoopbackRequest: (...a: any[]) => isLoopbackRequestMock(...a),
}));

const listOrgMembershipsForEventMock = vi.fn(
  async (): Promise<unknown[] | null> => null,
);
const getOrgContextMock = vi.fn(
  async (): Promise<{ orgId: string | null }> => ({ orgId: null }),
);
vi.mock("../org/context.js", () => ({
  getOrgDomain: vi.fn(async () => "builder.io"),
  getActiveOrgSettingForEvent: vi.fn(async () => null),
  getOrgContext: (...a: any[]) => getOrgContextMock(...a),
  listOrgMembershipsForEvent: (...a: any[]) =>
    listOrgMembershipsForEventMock(...a),
}));

function membership(orgId: string, orgName: string) {
  return {
    orgId,
    orgName,
    allowedDomain: null,
    role: "member",
    identityAuthority: null,
    identityId: null,
  };
}

const tokenRows: any[] = [];
const deviceRows: any[] = [];
let issuanceFailure: "not-member" | "unavailable" | null = null;
let issuanceRole = "member";
const issuanceTransaction = {
  execute: vi.fn(async ({ sql }: { sql: string }) => {
    if (issuanceFailure === "unavailable")
      throw new Error("test membership query unavailable");
    // No email change has retired an address in these tests.
    if (sql.includes("to_regclass"))
      return { rows: [{ present: false }], rowsAffected: 0 };
    return {
      rows:
        issuanceFailure === "not-member" && sql.includes("org_members")
          ? []
          : [{ id: "member-1", role: issuanceRole }],
      rowsAffected: 0,
    };
  }),
};
vi.mock("../db/client.js", () => ({
  getDbExec: () => ({
    transaction: async (
      run: (tx: typeof issuanceTransaction) => Promise<unknown>,
    ) => {
      const previousTokens = structuredClone(tokenRows);
      const previousDevices = structuredClone(deviceRows);
      try {
        return await run(issuanceTransaction);
      } catch (err) {
        tokenRows.splice(0, tokenRows.length, ...previousTokens);
        deviceRows.splice(0, deviceRows.length, ...previousDevices);
        throw err;
      }
    },
  }),
}));
vi.mock("./credential-membership.js", () => ({
  checkCredentialOrgMembership: vi.fn(async () => "member"),
}));
vi.mock("./credential-issuance.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./credential-issuance.js")>();
  return {
    ...original,
    withMcpCredentialIssuance: vi.fn(original.withMcpCredentialIssuance),
  };
});
vi.mock("./connect-store.js", () => ({
  ensureConnectTables: vi.fn(async () => {}),
  MCP_CONNECT_SCOPE: "mcp-connect",
  MCP_CONNECT_OAUTH_CLIENT_ID: "agent-native-connect",
  DEFAULT_TOKEN_TTL_DAYS: 365,
  MIN_TOKEN_TTL_DAYS: 1,
  MAX_TOKEN_TTL_DAYS: 365,
  MAX_SERVICE_TOKEN_TTL_DAYS: 3650,
  normalizeServiceName: (name: string) => name.trim().toLowerCase(),
  serviceIdentityEmail: (name: string, orgId: string) =>
    `svc-${name}@service.${orgId}`,
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
  createDeviceCode: vi.fn(async (catalogScope: "full" | null = null) => {
    const row = {
      deviceCode: "dev-" + deviceRows.length,
      userCode: "ABCD-2345",
      ownerEmail: null,
      orgId: null,
      status: "pending",
      tokenJti: null,
      catalogScope,
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
  getDeviceCodeByUserCode: vi.fn(async (uc: string) => {
    const r = deviceRows.find((d) => d.userCode === uc);
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

const { withMcpCredentialIssuance } = await import("./credential-issuance.js");
const withMcpCredentialIssuanceMock = vi.mocked(withMcpCredentialIssuance);
const { handleMcpConnect, mintOrgServiceToken } =
  await import("./connect-route.js");
const { defineAppConfig, resetAppConfigForTests } =
  await import("../app-config/index.js");

function ev(opts: {
  method?: string;
  path?: string;
  body?: any;
  host?: string;
  acceptLanguage?: string;
}): any {
  return {
    method: opts.method ?? "GET",
    body: opts.body,
    headers: {
      host: opts.host ?? "mail.agent-native.com",
      ...(opts.acceptLanguage
        ? { "accept-language": opts.acceptLanguage }
        : {}),
    },
    node: { req: { url: opts.path ?? "/" } },
    path: opts.path ?? "/",
    url: { pathname: (opts.path ?? "/").split("?")[0] },
  };
}

const SECRET = "test-a2a-secret";

// Vitest runs with NODE_ENV=test, which resolves to the local environment and
// its suffixed server name; most cases here describe production.
beforeEach(() => {
  vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "production");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("handleMcpConnect", () => {
  beforeEach(() => {
    issuanceTransaction.execute.mockClear();
    issuanceFailure = null;
    issuanceRole = "member";
    withMcpCredentialIssuanceMock.mockClear();
    tokenRows.length = 0;
    deviceRows.length = 0;
    getSessionMock.mockReset();
    listOrgMembershipsForEventMock.mockReset();
    listOrgMembershipsForEventMock.mockResolvedValue(null);
    getOrgContextMock.mockReset();
    getOrgContextMock.mockResolvedValue({ orgId: null });
    getConfiguredLoginHtmlMock.mockReturnValue(null);
    process.env.A2A_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.A2A_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
  });

  it.each(["mint", "approve", "poll"] as const)(
    "returns retryable unavailable when Connect table preflight fails for %s",
    async (operation) => {
      getSessionMock.mockResolvedValue({
        email: "u@example.com",
        orgId: "org-1",
      });
      if (operation !== "mint") {
        await handleMcpConnect(ev({ method: "POST" }), "/device/start");
      }
      if (operation === "poll") {
        await handleMcpConnect(
          ev({ method: "POST", body: { user_code: "ABCD-2345" } }),
          "/device/authorize",
        );
      }
      const previousDevices = structuredClone(deviceRows);
      const { ensureConnectTables } = await import("./connect-store.js");
      vi.mocked(ensureConnectTables).mockRejectedValueOnce(
        new Error("test preflight database unavailable"),
      );
      withMcpCredentialIssuanceMock.mockClear();
      const response = await handleMcpConnect(
        ev({
          method: "POST",
          body:
            operation === "poll"
              ? { device_code: deviceRows[0].deviceCode }
              : { user_code: "ABCD-2345" },
        }),
        operation === "mint"
          ? "/token"
          : operation === "approve"
            ? "/device/authorize"
            : "/device/poll",
      );
      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("5");
      expect(await response.json()).toEqual({
        error: "Organization membership could not be verified. Retry shortly.",
      });
      expect(withMcpCredentialIssuanceMock).not.toHaveBeenCalled();
      expect(tokenRows).toHaveLength(0);
      expect(deviceRows).toEqual(previousDevices);
    },
  );

  describe("connect page", () => {
    it("serves the configured login HTML when unauthenticated", async () => {
      getSessionMock.mockResolvedValue(null);
      getConfiguredLoginHtmlMock.mockReturnValue({
        html: "<html>login</html>",
        status: 200,
      });
      const res = await handleMcpConnect(ev({}), "/");
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("<html>login</html>");
    });

    it("passes through the setup page's 503 while sign-in cannot work", async () => {
      getSessionMock.mockResolvedValue(null);
      getConfiguredLoginHtmlMock.mockReturnValue({
        html: "<html>setup</html>",
        status: 503,
      });
      const res = await handleMcpConnect(ev({}), "/");
      expect(res.status).toBe(503);
      expect(await res.text()).toBe("<html>setup</html>");
    });

    it("renders the connect page for a logged-in user", async () => {
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      const res = await handleMcpConnect(ev({}), "/");
      const body = await res.text();
      expect(res.status).toBe(200);
      expect(body).not.toContain("Connect an external agent");
      expect(body).not.toContain(">Agent-Native<");
      expect(body).not.toContain("app-pill");
      expect(body).not.toContain('connectionsStateEl.textContent = "None"');
      expect(body).toContain(
        'connectionsStateEl.textContent = activeCount ? String(activeCount) : "";',
      );
      expect(body).toContain("u@example.com");
      expect(body).not.toContain("Allow Claude Code, Codex, or Cowork");
      expect(body).toContain('<details id="connections" class="connections">');
      expect(body).toContain(
        '<details id="staticTokenMint" class="connections static-token-mint">',
      );
      expect(body).toContain('class="flow-terminal"');
      expect(body).not.toContain("&lt;/&gt;");
      expect(body).not.toContain("connectionsEl.open = true");
      // The page never embeds a token.
      expect(body).not.toContain("Bearer ey");
      expect(body).toContain("https://mail.agent-native.com/mcp");
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

    it("emits inline scripts that parse", async () => {
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      const res = await handleMcpConnect(ev({}), "/");
      const body = await res.text();
      const scripts = [...body.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      expect(scripts.length).toBeGreaterThan(0);
      for (const [, code] of scripts) {
        expect(() => new Function(code)).not.toThrow();
      }
    });

    it("renders the service-principal governance view, hidden until the org has principals", async () => {
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      const res = await handleMcpConnect(ev({}), "/");
      const body = await res.text();
      expect(body).toContain(
        '<details id="principals" class="connections hidden">',
      );
      expect(body).toContain("Service principals");
      expect(body).toContain('"/_agent-native/actions"');
      expect(body).toContain('ACTIONS + "/list-org-service-tokens"');
      expect(body).toContain('"set-service-principal-lifecycle"');
      expect(body).toContain("data.canManage");
      expect(body).toContain("No owner or action grant is set.");
      // Only missing-org/auth responses hide the view; a route 404 is shown.
      expect(body).toContain(
        "res.status === 400 || res.status === 401 || res.status === 403",
      );
      expect(body).not.toContain("res.status === 404");
      expect(body).toContain("if (!USER_CODE) loadPrincipals();");

      const localized = await (
        await handleMcpConnect(ev({ acceptLanguage: "es-ES" }), "/")
      ).text();
      expect(localized).toContain("Principales de servicio");
    });

    it("uses the configured public framework prefix for service-principal actions", async () => {
      const previousPrefix =
        process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX;
      process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX =
        "/_platform";
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      try {
        const res = await handleMcpConnect(ev({}), "/");
        const body = await res.text();
        expect(body).toContain('var ACTIONS = "/_platform/actions";');
        expect(body).not.toContain('var ACTIONS = "/_agent-native/actions";');
      } finally {
        if (previousPrefix === undefined) {
          delete process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX;
        } else {
          process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX =
            previousPrefix;
        }
      }
    });

    it("localizes the shared guide copy from the request language", async () => {
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      const res = await handleMcpConnect(ev({ acceptLanguage: "es-ES" }), "/");
      const body = await res.text();
      expect(body).toContain("Abre Customize → Connectors en Claude.");
      expect(body).not.toContain("Open Customize → Connectors in Claude.");
      expect(body).toContain("Tu URL de MCP");
      expect(body).toContain("Conexiones existentes");
      expect(body).not.toContain("Existing connections");
      expect(body).not.toContain("Signed in as");
      expect(body).toContain('id="mcp-guide-tab-claude"');
      expect(body).toContain('aria-labelledby="mcp-guide-tab-claude"');
    });

    it("uses a validated locale from the Settings connect link", async () => {
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      const res = await handleMcpConnect(
        ev({ path: "/?locale=es-ES", acceptLanguage: "en-US" }),
        "/",
      );
      const body = await res.text();
      expect(body).toContain("Abre Customize → Connectors en Claude.");
      expect(body).not.toContain("Open Customize → Connectors in Claude.");
      expect(body).toContain('<html lang="es-ES" dir="ltr">');
    });

    it("selects the guide requested by the integrations handoff", async () => {
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      const res = await handleMcpConnect(ev({ path: "/?guide=xAI" }), "/");
      const body = await res.text();

      expect(body).toContain(
        'id="mcp-guide-tab-grok" data-tab="grok" aria-controls="mcp-guide-panel-grok" aria-selected="true"',
      );
      expect(body).toContain(
        'class="tab-panel is-active" role="tabpanel" id="mcp-guide-panel-grok"',
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
      expect(body).toContain("Authorize device");
      expect(body).not.toContain("From your terminal");
      expect(body).not.toContain("Connect an external agent");
      expect(body).not.toContain(">None<");
      expect(body).toContain("Authorizing device...");
      expect(body).toContain(
        'showMsg(COPY.finishingConnection, "ok", COPY.deviceAuthorized)',
      );
      expect(body).toContain(
        'showMsg(COPY.connectedDescription, "ok", COPY.connected)',
      );
      expect(body).toContain(
        "if (response.status === 404) return COPY.unknownDeviceCode;",
      );
      expect(body).toContain(
        "if (response.status === 410) return COPY.expiredDeviceCode;",
      );
      expect(body).toContain(
        "if (response.status === 409) return COPY.alreadyUsedDeviceCode;",
      );
      expect(body).toContain(".msg-title");
      expect(body).toContain(".msg-copy");
      expect(body).toContain('btn.setAttribute("aria-busy", "true")');
      expect(body).not.toContain("Pick your AI assistant");
      expect(body).not.toContain('<details id="staticTokenMint"');
      expect(body).not.toContain('class="connections-title">Authorize device');
      expect(body).toContain('class="flow-terminal"');
      expect(body).not.toContain("&lt;/&gt;");
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
      expect(data.mcpUrl).toBe("https://mail.agent-native.com/mcp");
      expect(data.serverName).toBe("agent-native-mail");
      expect(data.mcpServerEntry).toEqual({
        type: "http",
        url: "https://mail.agent-native.com/mcp",
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

    it.each(["not-member", "unavailable"] as const)(
      "refuses a stale personal mint when the issuance boundary returns %s",
      async (reason) => {
        getSessionMock.mockResolvedValue({
          email: "u@example.com",
          orgId: "org-1",
        });
        issuanceFailure = reason;
        const response = await handleMcpConnect(
          ev({ method: "POST" }),
          "/token",
        );
        expect(response.status).toBe(reason === "not-member" ? 403 : 503);
        expect(tokenRows).toHaveLength(0);
        expect(withMcpCredentialIssuanceMock).toHaveBeenCalledWith(
          {
            email: "u@example.com",
            orgId: "org-1",
            requestOrigin: "https://mail.agent-native.com",
          },
          expect.any(Function),
        );
      },
    );

    it("returns retryable unavailable without exposing a token when recording a personal mint fails", async () => {
      getSessionMock.mockResolvedValue({
        email: "u@example.com",
        orgId: "org-1",
      });
      const { recordMintedToken } = await import("./connect-store.js");
      vi.mocked(recordMintedToken).mockRejectedValueOnce(
        new Error(
          "Unexpected affected row count for MCP connect token insert.",
        ),
      );
      const response = await handleMcpConnect(ev({ method: "POST" }), "/token");
      expect(response.status).toBe(503);
      expect(response.headers.get("Retry-After")).toBe("5");
      expect(await response.json()).not.toHaveProperty("token");
      expect(tokenRows).toHaveLength(0);
    });

    it("records a personal mint through the issuance transaction", async () => {
      getSessionMock.mockResolvedValue({
        email: "u@example.com",
        orgId: "org-1",
      });
      const response = await handleMcpConnect(ev({ method: "POST" }), "/token");
      expect(response.status).toBe(200);
      const { recordMintedToken } = await import("./connect-store.js");
      expect(recordMintedToken).toHaveBeenLastCalledWith(
        expect.objectContaining({ orgId: "org-1" }),
        issuanceTransaction,
      );
    });

    it("binds a new token to the default org of an account without one", async () => {
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      getOrgContextMock.mockResolvedValueOnce({ orgId: "org-new" });
      listOrgMembershipsForEventMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([membership("org-new", "U's workspace")]);

      const res = await handleMcpConnect(
        ev({ method: "POST", body: {} }),
        "/token",
      );

      expect(res.status).toBe(200);
      expect(tokenRows[0].orgId).toBe("org-new");
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

    it("mints revocable org service tokens with a 10-year lifetime", async () => {
      issuanceRole = "admin";
      const minted = await mintOrgServiceToken({
        serviceName: "pr-recap",
        orgId: "org-1",
        createdBy: "admin@example.com",
        ttlDays: 3650,
        appUrl: "https://plan.example.com",
      });
      const { payload } = await jose.jwtVerify(
        minted.token,
        new TextEncoder().encode(SECRET),
      );

      expect(minted.ttlDays).toBe(3650);
      expect(payload.jti).toBe(minted.jti);
      expect((payload.exp as number) - (payload.iat as number)).toBe(
        3650 * 86_400,
      );
      expect(tokenRows[0]).toMatchObject({
        jti: minted.jti,
        kind: "service",
        ownerEmail: "svc-pr-recap@service.org-1",
      });
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
        url: "http://localhost:4321/mcp",
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
        "https://mail.agent-native.com/mcp/connect",
      );
      expect(data.verification_uri_complete).toContain(
        "?user_code=" + data.user_code,
      );
      expect(data.interval).toBe(3);
      expect(data.expires_in).toBe(600);
    });

    it("persists requested full catalog scope and rejects non-boolean values", async () => {
      const res = await handleMcpConnect(
        ev({ method: "POST", body: { fullCatalog: true } }),
        "/device/start",
      );
      expect(res.status).toBe(200);
      expect(deviceRows[0].catalogScope).toBe("full");

      const invalid = await handleMcpConnect(
        ev({ method: "POST", body: { fullCatalog: "true" } }),
        "/device/start",
      );
      expect(invalid.status).toBe(400);
      expect(deviceRows).toHaveLength(1);
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
        expect(data.mcpUrl).toBe("https://mail.agent-native.com/mail/mcp");
        expect(data.cli).toBe(
          "npx @agent-native/core@latest connect https://mail.agent-native.com/mail",
        );
      } finally {
        delete process.env.APP_BASE_PATH;
      }
    });

    it("device/authorize requires a session and binds the user", async () => {
      await handleMcpConnect(ev({ method: "POST" }), "/device/start");

      getSessionMock.mockResolvedValue(null);
      const unauth = await handleMcpConnect(
        ev({ method: "POST", body: { user_code: "ABCD-2345" } }),
        "/device/authorize",
      );
      expect(unauth.status).toBe(401);

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

    it("lets a member of several orgs choose the org bound to the device", async () => {
      await handleMcpConnect(ev({ method: "POST" }), "/device/start");
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      listOrgMembershipsForEventMock.mockResolvedValue([
        membership("org-1", "Acme"),
        membership("org-2", "Globex"),
      ]);

      const page = await (
        await handleMcpConnect(ev({ path: "/?user_code=ABCD-2345" }), "/")
      ).text();
      expect(page).toContain('<select id="organizationId">');
      expect(page).toContain('<option value="org-1" selected>Acme');

      const ok = await handleMcpConnect(
        ev({
          method: "POST",
          body: { user_code: "ABCD-2345", org_id: "org-2" },
        }),
        "/device/authorize",
      );
      expect(ok.status).toBe(200);
      expect(deviceRows[0].orgId).toBe("org-2");
    });

    it("omits the org picker for a member of exactly one org", async () => {
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      listOrgMembershipsForEventMock.mockResolvedValue([
        membership("org-1", "Acme"),
      ]);

      const page = await (
        await handleMcpConnect(ev({ path: "/?user_code=ABCD-2345" }), "/")
      ).text();
      expect(page).not.toContain('id="organizationId"');
    });

    it("ignores a non-string or empty org_id and falls back to the default", async () => {
      await handleMcpConnect(ev({ method: "POST" }), "/device/start");
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      listOrgMembershipsForEventMock.mockResolvedValue([
        membership("org-1", "Acme"),
      ]);

      const res = await handleMcpConnect(
        ev({
          method: "POST",
          body: { user_code: "ABCD-2345", org_id: "" },
        }),
        "/device/authorize",
      );
      expect(res.status).toBe(200);
      expect(deviceRows[0].orgId).toBe("org-1");
    });

    it("refuses to bind a device to an org the user does not belong to", async () => {
      await handleMcpConnect(ev({ method: "POST" }), "/device/start");
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      listOrgMembershipsForEventMock.mockResolvedValue([
        membership("org-1", "Acme"),
      ]);

      const res = await handleMcpConnect(
        ev({
          method: "POST",
          body: { user_code: "ABCD-2345", org_id: "org-9" },
        }),
        "/device/authorize",
      );
      expect(res.status).toBe(403);
      expect(deviceRows[0].status).toBe("pending");
    });

    it("refuses a client-supplied org_id when the account has no orgs to check it against", async () => {
      await handleMcpConnect(ev({ method: "POST" }), "/device/start");
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      listOrgMembershipsForEventMock.mockResolvedValue([]);
      getOrgContextMock.mockResolvedValueOnce({ orgId: null });

      const res = await handleMcpConnect(
        ev({
          method: "POST",
          body: { user_code: "ABCD-2345", org_id: "someone-elses-org" },
        }),
        "/device/authorize",
      );
      expect(res.status).toBe(403);
      expect(deviceRows[0].status).toBe("pending");
      expect(deviceRows[0].orgId).not.toBe("someone-elses-org");
    });

    it("gives an account without an org its default one before binding", async () => {
      await handleMcpConnect(ev({ method: "POST" }), "/device/start");
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      getOrgContextMock.mockResolvedValueOnce({ orgId: "org-new" });
      listOrgMembershipsForEventMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([membership("org-new", "U's workspace")]);

      const ok = await handleMcpConnect(
        ev({ method: "POST", body: { user_code: "ABCD-2345" } }),
        "/device/authorize",
      );
      expect(ok.status).toBe(200);
      expect(deviceRows[0].orgId).toBe("org-new");
    });

    it("rejects a malformed user_code", async () => {
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      const res = await handleMcpConnect(
        ev({ method: "POST", body: { user_code: "not a code" } }),
        "/device/authorize",
      );
      expect(res.status).toBe(400);
    });

    it.each(["not-member", "unavailable"] as const)(
      "refuses stale device approval when issuance returns %s",
      async (reason) => {
        await handleMcpConnect(ev({ method: "POST" }), "/device/start");
        getSessionMock.mockResolvedValue({
          email: "u@example.com",
          orgId: "org-1",
        });
        issuanceFailure = reason;
        const response = await handleMcpConnect(
          ev({ method: "POST", body: { user_code: "ABCD-2345" } }),
          "/device/authorize",
        );
        expect(response.status).toBe(reason === "not-member" ? 403 : 503);
        expect(deviceRows[0].status).toBe("pending");
        expect(deviceRows[0].ownerEmail).toBeNull();
      },
    );

    it.each(["not-member", "unavailable"] as const)(
      "refuses polling a previously approved device when issuance returns %s",
      async (reason) => {
        await handleMcpConnect(ev({ method: "POST" }), "/device/start");
        getSessionMock.mockResolvedValue({
          email: "u@example.com",
          orgId: "org-1",
        });
        await handleMcpConnect(
          ev({ method: "POST", body: { user_code: "ABCD-2345" } }),
          "/device/authorize",
        );
        issuanceFailure = reason;
        const response = await handleMcpConnect(
          ev({
            method: "POST",
            body: { device_code: deviceRows[0].deviceCode },
          }),
          "/device/poll",
        );
        expect(response.status).toBe(reason === "not-member" ? 403 : 503);
        expect(tokenRows).toHaveLength(0);
        expect(deviceRows[0].status).toBe("approved");
      },
    );

    it("rechecks device status after the membership lock even when the poll preloaded an approved row", async () => {
      await handleMcpConnect(ev({ method: "POST" }), "/device/start");
      getSessionMock.mockResolvedValue({
        email: "u@example.com",
        orgId: "org-1",
      });
      await handleMcpConnect(
        ev({ method: "POST", body: { user_code: "ABCD-2345" } }),
        "/device/authorize",
      );
      issuanceTransaction.execute.mockImplementationOnce(async () => {
        deviceRows[0].status = "expired";
        return { rows: [{ id: "member-1" }], rowsAffected: 0 };
      });
      const response = await handleMcpConnect(
        ev({ method: "POST", body: { device_code: deviceRows[0].deviceCode } }),
        "/device/poll",
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "expired" });
      expect(tokenRows).toHaveLength(0);
    });

    it("uses one issuance transaction for device approval and claim, record, finish", async () => {
      await handleMcpConnect(ev({ method: "POST" }), "/device/start");
      getSessionMock.mockResolvedValue({
        email: "u@example.com",
        orgId: "org-1",
      });
      await handleMcpConnect(
        ev({ method: "POST", body: { user_code: "ABCD-2345" } }),
        "/device/authorize",
      );
      const dc = deviceRows[0].deviceCode;
      const response = await handleMcpConnect(
        ev({ method: "POST", body: { device_code: dc } }),
        "/device/poll",
      );
      expect(response.status).toBe(200);
      const {
        approveDeviceCode,
        claimDeviceCodeForMint,
        recordMintedToken,
        finishDeviceCodeMint,
      } = await import("./connect-store.js");
      expect(approveDeviceCode).toHaveBeenLastCalledWith(
        "ABCD-2345",
        "u@example.com",
        "org-1",
        issuanceTransaction,
      );
      expect(claimDeviceCodeForMint).toHaveBeenLastCalledWith(
        dc,
        expect.any(String),
        issuanceTransaction,
      );
      expect(recordMintedToken).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ownerEmail: "u@example.com",
          orgId: "org-1",
        }),
        issuanceTransaction,
      );
      expect(finishDeviceCodeMint).toHaveBeenLastCalledWith(
        dc,
        tokenRows[0].jti,
        issuanceTransaction,
      );
    });

    it("rolls back the device claim when recording fails and allows a retry", async () => {
      await handleMcpConnect(ev({ method: "POST" }), "/device/start");
      getSessionMock.mockResolvedValue({
        email: "u@example.com",
        orgId: "org-1",
      });
      await handleMcpConnect(
        ev({ method: "POST", body: { user_code: "ABCD-2345" } }),
        "/device/authorize",
      );
      const dc = deviceRows[0].deviceCode;
      const { recordMintedToken } = await import("./connect-store.js");
      vi.mocked(recordMintedToken).mockRejectedValueOnce(
        new Error("test write failure"),
      );
      const response = await handleMcpConnect(
        ev({ method: "POST", body: { device_code: dc } }),
        "/device/poll",
      );
      expect(response.status).toBe(503);
      expect(deviceRows[0]).toMatchObject({
        status: "approved",
        tokenJti: null,
      });
      expect(tokenRows).toHaveLength(0);
      const retried = await handleMcpConnect(
        ev({ method: "POST", body: { device_code: dc } }),
        "/device/poll",
      );
      expect(retried.status).toBe(200);
      expect((await retried.json()).status).toBe("approved");
      expect(tokenRows).toHaveLength(1);
    });

    it("rolls back the token record when finishing the device fails", async () => {
      await handleMcpConnect(ev({ method: "POST" }), "/device/start");
      getSessionMock.mockResolvedValue({
        email: "u@example.com",
        orgId: "org-1",
      });
      await handleMcpConnect(
        ev({ method: "POST", body: { user_code: "ABCD-2345" } }),
        "/device/authorize",
      );
      const { finishDeviceCodeMint } = await import("./connect-store.js");
      vi.mocked(finishDeviceCodeMint).mockResolvedValueOnce(false);
      const response = await handleMcpConnect(
        ev({ method: "POST", body: { device_code: deviceRows[0].deviceCode } }),
        "/device/poll",
      );
      expect(response.status).toBe(503);
      expect(tokenRows).toHaveLength(0);
      expect(deviceRows[0]).toMatchObject({
        status: "approved",
        tokenJti: null,
      });
    });

    it("poll: pending → approved (mints once) → consumed", async () => {
      await handleMcpConnect(ev({ method: "POST" }), "/device/start");
      const dc = deviceRows[0].deviceCode;

      getSessionMock.mockResolvedValue(null);
      let res = await handleMcpConnect(
        ev({ method: "POST", body: { device_code: dc } }),
        "/device/poll",
      );
      expect((await res.json()).status).toBe("pending");

      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      await handleMcpConnect(
        ev({ method: "POST", body: { user_code: "ABCD-2345" } }),
        "/device/authorize",
      );

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

      res = await handleMcpConnect(
        ev({ method: "POST", body: { device_code: dc } }),
        "/device/poll",
      );
      const again = await res.json();
      expect(again.status).toBe("consumed");
      expect(again.token).toBeUndefined();
    });

    it("shows full catalog scope before approval and signs it into the token", async () => {
      await handleMcpConnect(
        ev({ method: "POST", body: { fullCatalog: true } }),
        "/device/start",
      );
      const dc = deviceRows[0].deviceCode;
      getSessionMock.mockResolvedValue({ email: "u@example.com" });

      const page = await handleMcpConnect(
        ev({ path: "/?user_code=ABCD-2345" }),
        "/",
      );
      expect(await page.text()).toContain(
        "This device is requesting access to the full action catalog.",
      );

      await handleMcpConnect(
        ev({ method: "POST", body: { user_code: "ABCD-2345" } }),
        "/device/authorize",
      );
      getSessionMock.mockResolvedValue(null);
      const response = await handleMcpConnect(
        ev({ method: "POST", body: { device_code: dc } }),
        "/device/poll",
      );
      const data = await response.json();
      const { payload } = await jose.jwtVerify(
        data.token,
        new TextEncoder().encode(SECRET),
      );
      expect(payload.catalog_scope).toBe("full");
    });

    it("preserves full catalog scope in a dev-open localhost entry", async () => {
      delete process.env.A2A_SECRET;
      delete process.env.ACCESS_TOKEN;
      delete process.env.ACCESS_TOKENS;
      await handleMcpConnect(
        ev({
          method: "POST",
          host: "localhost:4321",
          body: { fullCatalog: true },
        }),
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
        "X-Agent-Native-MCP-Full-Catalog": "1",
      });
    });

    it("poll mints a standard MCP OAuth token for hosted deploys without A2A_SECRET", async () => {
      delete process.env.A2A_SECRET;
      process.env.BETTER_AUTH_SECRET = SECRET;
      await handleMcpConnect(
        ev({ method: "POST", body: { fullCatalog: true } }),
        "/device/start",
      );
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
        catalogScope: "full",
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

describe("server name on a multi-label host", () => {
  beforeEach(() => {
    getSessionMock.mockResolvedValue({
      email: "u@example.com",
      orgId: "org-1",
    });
  });
  afterEach(() => resetAppConfigForTests());

  async function serverNameFor(host: string): Promise<string> {
    const res = await handleMcpConnect(ev({ host }), "/identity");
    expect(res.status).toBe(200);
    return (await res.json()).serverName;
  }

  it("uses declared app identity instead of the leading hostname label", async () => {
    defineAppConfig({ app: { id: "mail" } });
    expect(await serverNameFor("beta.mail.agent-native.com")).toBe(
      "agent-native-mail",
    );
  });

  it("distinguishes two beta apps that share a leading label", async () => {
    defineAppConfig({ app: { id: "mail" } });
    const mail = await serverNameFor("beta.mail.agent-native.com");
    resetAppConfigForTests();
    defineAppConfig({ app: { id: "calendar" } });
    const calendar = await serverNameFor("beta.calendar.agent-native.com");
    expect(mail).not.toBe(calendar);
  });

  it("still falls back to the hostname when nothing declares an identity", async () => {
    expect(await serverNameFor("mail.agent-native.com")).toBe(
      "agent-native-mail",
    );
  });
});

describe("explicit server name", () => {
  beforeEach(() => {
    getSessionMock.mockResolvedValue({
      email: "u@example.com",
      orgId: "org-1",
    });
  });
  afterEach(() => resetAppConfigForTests());

  it("wins over the derived name, prefix included", async () => {
    defineAppConfig({ app: { id: "plan" } });
    const res = await handleMcpConnect(
      ev({ host: "plan.agent-native.com" }),
      "/identity",
      { serverName: "plan" },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).serverName).toBe("plan");
  });

  it("is refused rather than published when it is not a plain name", async () => {
    await expect(
      handleMcpConnect(ev({ host: "plan.agent-native.com" }), "/identity", {
        serverName: "plan; echo hi",
      }),
    ).rejects.toThrow(/not a plain name/);
  });

  it("is refused before a token is minted that no response would return", async () => {
    const { recordMintedToken } = await import("./connect-store.js");
    vi.mocked(recordMintedToken).mockClear();
    await expect(
      handleMcpConnect(
        ev({ method: "POST", host: "plan.agent-native.com" }),
        "/token",
        { serverName: "plan; echo hi" },
      ),
    ).rejects.toThrow(/not a plain name/);
    expect(recordMintedToken).not.toHaveBeenCalled();
  });
});

describe("connect identity", () => {
  beforeEach(() => {
    getSessionMock.mockResolvedValue(null);
    getConfiguredLoginHtmlMock.mockReturnValue(null);
  });
  afterEach(() => resetAppConfigForTests());

  async function identityFor(
    host: string,
    options: Parameters<typeof handleMcpConnect>[2] = {},
  ) {
    const res = await handleMcpConnect(ev({ host }), "/identity", options);
    expect(res.status).toBe(200);
    return res.json();
  }

  it("answers without a session and keeps production names unsuffixed", async () => {
    defineAppConfig({ app: { id: "content" } });
    expect(await identityFor("content.agent-native.com")).toEqual({
      serverName: "agent-native-content",
      appName: "content",
      appUrl: "https://content.agent-native.com",
      mcpUrl: "https://content.agent-native.com/mcp",
      environment: "production",
      oauth: true,
    });
  });

  it("fits a long hostname-derived name instead of failing", async () => {
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "preview");
    const label = `deploy-preview-6800--${"x".repeat(42)}`;
    const { serverName } = await identityFor(`${label}.netlify.app`);
    expect(serverName).toMatch(
      /^agent-native-deploy-preview-6800--x+-preview$/,
    );
    expect(serverName.length).toBeLessThanOrEqual(64);
  });

  it.each([
    ["beta", "beta.content.agent-native.com", "agent-native-content-beta"],
    [
      "preview",
      "preview.content.agent-native.com",
      "agent-native-content-preview",
    ],
    ["local", "localhost:8080", "agent-native-content-local"],
  ])(
    "gives the %s environment its own name",
    async (environment, host, serverName) => {
      vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", environment);
      defineAppConfig({ app: { id: "content" } });
      const identity = await identityFor(host);
      expect(identity.serverName).toBe(serverName);
      expect(identity.environment).toBe(environment);
    },
  );

  it("suffixes a declared server name outside production", async () => {
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "beta");
    expect(
      (await identityFor("beta.plan.agent-native.com", { serverName: "plan" }))
        .serverName,
    ).toBe("plan-beta");
  });

  it("targets the workspace base path", async () => {
    vi.stubEnv("APP_BASE_PATH", "/content");
    defineAppConfig({ app: { id: "content" } });
    const identity = await identityFor("workspace.example.com");
    expect(identity.appUrl).toBe("https://workspace.example.com/content");
    expect(identity.mcpUrl).toBe("https://workspace.example.com/content/mcp");
    expect(identity.serverName).toBe("agent-native-content");
  });

  it("advertises the base path the MCP server is mounted on when both variables are set", async () => {
    vi.stubEnv("VITE_APP_BASE_PATH", "/content");
    vi.stubEnv("APP_BASE_PATH", "/legacy");
    const identity = await identityFor("workspace.example.com");
    expect(identity.appUrl).toBe("https://workspace.example.com/content");
    expect(identity.mcpUrl).toBe("https://workspace.example.com/content/mcp");
  });

  it("matches the name the token payload writes", async () => {
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "beta");
    process.env.A2A_SECRET = SECRET;
    try {
      defineAppConfig({ app: { id: "mail" } });
      const identity = await identityFor("beta.mail.agent-native.com");
      getSessionMock.mockResolvedValue({ email: "u@example.com" });
      const res = await handleMcpConnect(
        ev({
          method: "POST",
          host: "beta.mail.agent-native.com",
          body: { label: "laptop", ttlDays: 30 },
        }),
        "/token",
      );
      const payload = await res.json();
      expect(payload.serverName).toBe(identity.serverName);
      expect(payload.mcpUrl).toBe(identity.mcpUrl);
    } finally {
      delete process.env.A2A_SECRET;
    }
  });

  it("rejects writes", async () => {
    const res = await handleMcpConnect(ev({ method: "POST" }), "/identity");
    expect(res.status).toBe(405);
  });

  it("renders install links that carry only the name and URL", async () => {
    vi.stubEnv("AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT", "beta");
    defineAppConfig({ app: { id: "mail" } });
    getSessionMock.mockResolvedValue({ email: "u@example.com" });
    const res = await handleMcpConnect(
      ev({ host: "beta.mail.agent-native.com" }),
      "/",
    );
    const body = await res.text();
    const hrefs = [...body.matchAll(/href="([^"]+)"/g)]
      .map(([, href]) => href.replace(/&amp;/g, "&"))
      .filter(
        (href) =>
          href.startsWith("https://cursor.com/install-mcp") ||
          href.startsWith("vscode:") ||
          href.startsWith("vscode-insiders:"),
      );
    expect(hrefs).toHaveLength(3);
    for (const href of hrefs) {
      const payload = href.startsWith("https://cursor.com/")
        ? {
            name: new URL(href).searchParams.get("name"),
            ...JSON.parse(atob(new URL(href).searchParams.get("config")!)),
          }
        : JSON.parse(decodeURIComponent(href.slice(href.indexOf("?") + 1)));
      const { type, ...rest } = payload;
      expect(rest).toEqual({
        name: "agent-native-mail-beta",
        url: "https://beta.mail.agent-native.com/mcp",
      });
      expect(type === undefined || type === "http").toBe(true);
    }
    expect(body).toContain(
      'href="https://cursor.com/install-mcp?name=agent-native-mail-beta',
    );
  });
});
