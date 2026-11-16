import { H3, type H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrgContext: vi.fn(),
  storedScope: vi.fn(),
  hasGrant: vi.fn(),
  deleteGrant: vi.fn(),
  keys: vi.fn(),
  resolveCredentials: vi.fn(),
  deleteCredentials: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("./auth.js", async (original) => ({
  ...(await original<typeof import("./auth.js")>()),
  getSession: async () => ({
    email: "member@example.test",
    orgId: "stale-org",
  }),
}));
vi.mock("../org/context.js", async (original) => ({
  ...(await original<typeof import("../org/context.js")>()),
  getOrgContext: mocks.getOrgContext,
}));
vi.mock("./builder-oauth.js", async (original) => ({
  ...(await original<typeof import("./builder-oauth.js")>()),
  getBuilderOAuthStoredScope: mocks.storedScope,
  hasStoredBuilderOAuthGrant: mocks.hasGrant,
  deleteBuilderOAuthSession: mocks.deleteGrant,
}));
vi.mock("./credential-provider.js", async (original) => ({
  ...(await original<typeof import("./credential-provider.js")>()),
  getBuilderKeyConnections: mocks.keys,
  resolveBuilderCredentialsDetailed: mocks.resolveCredentials,
  deleteBuilderCredentials: mocks.deleteCredentials,
}));
vi.mock("../audit/record.js", async (original) => ({
  ...(await original<typeof import("../audit/record.js")>()),
  recordActionAudit: mocks.audit,
}));
vi.mock("../deploy/route-discovery.js", async (original) => ({
  ...(await original<typeof import("../deploy/route-discovery.js")>()),
  getMissingDefaultPlugins: vi.fn(async () => []),
}));

import { createCoreRoutesPlugin } from "./core-routes-plugin.js";
import { sessionResolutionFailure } from "./session-resolution-errors.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "fake-disconnect-scope-test");
  mocks.getOrgContext
    .mockReset()
    .mockResolvedValue({ orgId: "verified-org", role: "admin" });
  mocks.storedScope.mockReset().mockResolvedValue("org");
  mocks.hasGrant.mockReset().mockResolvedValue(true);
  mocks.deleteGrant
    .mockReset()
    .mockResolvedValue({ localDeleted: true, remoteRevoked: true });
  mocks.deleteCredentials.mockReset().mockResolvedValue(undefined);
  mocks.resolveCredentials.mockReset().mockResolvedValue({ source: "user" });
});
afterEach(() => vi.unstubAllEnvs());

async function request(scope?: "org" | "personal") {
  const middleware: Array<
    (event: H3Event, next: () => Promise<unknown>) => unknown
  > = [];
  const plugin = createCoreRoutesPlugin({
    disableHealth: true,
    disableAppState: true,
    disableEmbedRoute: true,
    disablePing: true,
  });
  await plugin({ h3: { "~middleware": middleware } } as Parameters<
    typeof plugin
  >[0]);
  const app = new H3();
  app.use((event: H3Event) => {
    let index = 0;
    const next = async (): Promise<unknown> => {
      const handler = middleware[index++];
      return handler ? handler(event, next) : undefined;
    };
    return next();
  });
  return app.fetch(
    new Request("https://app.example.test/_agent-native/builder/disconnect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Native-CSRF": "1",
      },
      body: JSON.stringify({ scope }),
    }),
  );
}

describe("Builder disconnect verified organization boundary", () => {
  describe.each(["org", "personal", undefined] as const)(
    "scope %s",
    (scope) => {
      it.each(["57014", "42501"])(
        "refuses before all credential work on membership failure %s",
        async (code) => {
          const cause = Object.assign(
            new Error("Fake private membership diagnostics"),
            { code },
          );
          mocks.getOrgContext.mockRejectedValue(
            sessionResolutionFailure(cause),
          );
          const response = await request(scope);
          expect(response.status).toBe(code === "57014" ? 503 : 500);
          expect(response.headers.get("Retry-After")).toBe(
            code === "57014" ? "5" : null,
          );
          expect(await response.text()).not.toContain(cause.message);
          for (const work of [
            mocks.storedScope,
            mocks.hasGrant,
            mocks.deleteGrant,
            mocks.keys,
            mocks.resolveCredentials,
            mocks.deleteCredentials,
            mocks.audit,
          ]) {
            expect(work).not.toHaveBeenCalled();
          }
        },
      );
    },
  );

  it.each(["57014", "42501"])(
    "preserves a later classified lookup failure %s through the outer catch",
    async (code) => {
      const cause = Object.assign(
        new Error("Fake private lookup diagnostics"),
        { code },
      );
      mocks.storedScope.mockRejectedValue(sessionResolutionFailure(cause));
      const response = await request();
      expect(response.status).toBe(code === "57014" ? 503 : 500);
      expect(response.headers.get("Retry-After")).toBe(
        code === "57014" ? "5" : null,
      );
      expect(await response.text()).not.toContain(cause.message);
      expect(mocks.deleteGrant).not.toHaveBeenCalled();
      expect(mocks.deleteCredentials).not.toHaveBeenCalled();
    },
  );

  it("redacts unexpected disconnect failures", async () => {
    mocks.storedScope.mockRejectedValue(
      new Error("Fake private unexpected diagnostics"),
    );
    const response = await request();
    expect(response.status).toBe(500);
    expect(response.headers.get("Retry-After")).toBeNull();
    expect(await response.text()).not.toContain(
      "Fake private unexpected diagnostics",
    );
    expect(mocks.deleteCredentials).not.toHaveBeenCalled();
  });

  it.each(["org", "personal"] as const)(
    "retains healthy %s disconnect",
    async (scope) => {
      if (scope === "personal")
        mocks.getOrgContext.mockResolvedValue({ orgId: null, role: null });
      const response = await request(scope);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, scope });
      expect(mocks.hasGrant).toHaveBeenCalledWith(
        "member@example.test",
        scope === "org" ? "org" : "user",
        scope === "org" ? "verified-org" : null,
      );
      expect(mocks.deleteCredentials).toHaveBeenCalledWith(
        "member@example.test",
        scope === "org" ? { orgId: "verified-org", role: "admin" } : undefined,
      );
    },
  );

  it("retains a verified member's 403 without touching credentials", async () => {
    mocks.getOrgContext.mockResolvedValue({
      orgId: "verified-org",
      role: "member",
    });
    const response = await request("org");
    expect(response.status).toBe(403);
    expect(response.headers.get("Retry-After")).toBeNull();
    expect(mocks.hasGrant).not.toHaveBeenCalled();
    expect(mocks.deleteCredentials).not.toHaveBeenCalled();
  });
});
