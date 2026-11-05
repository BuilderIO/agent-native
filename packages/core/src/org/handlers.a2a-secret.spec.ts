import { AsyncLocalStorage } from "node:async_hooks";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import { runWithRequestContext } from "../server/request-context.js";

const mockExecute = vi.fn();
const mockGetOrgContext = vi.fn();
const mockResolveA2AOrganizationCredentialsByDomain = vi.fn();
const mockGetSession = vi.fn();
const mockPutUserSetting = vi.fn();
const mockGetOrgSetting = vi.fn();
const mockReadBody = vi.fn();
const mockDiscoverAgents = vi.fn();
const mockGetBuiltinAgentsForSeeding = vi.fn(() => [
  { id: "builtin-app", url: "https://builtin.example.test" },
]);
const mockLoadWorkspaceAppsManifest = vi.fn();
const mockSignA2AToken = vi.fn();
const mockSignA2AOrganizationToken = vi.fn();
const mockGetGlobalA2ASecret = vi.fn<() => string | undefined>();
const mockVerifyA2AToken = vi.fn();
const mockCanonicalA2AAudience = vi.fn((url: string) =>
  url.replace(/\/+$/, ""),
);
const mockInvalidateMemberOrgCaches = vi.fn();
const mockSsrfSafeFetch = vi.fn();
const mockFetch = vi.fn();
const mockResolveAppRuntimeUrl = vi.fn(() => "https://remote.example.test");

vi.mock("h3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("h3")>()),
  defineEventHandler: (handler: any) => handler,
  getRouterParam: vi.fn(),
  getRequestURL: (event: any) =>
    event.url ?? new URL("http://example.test/_agent-native/org"),
  getRequestHeader: (event: any, name: string) =>
    event._headers?.[name.toLowerCase()],
  createError: (opts: { statusCode?: number; message?: string }) =>
    Object.assign(new Error(opts.message ?? "Error"), {
      statusCode: opts.statusCode,
    }),
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: (...args: any[]) => mockReadBody(...args),
}));

vi.mock("../server/auth.js", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
}));

vi.mock("../settings/user-settings.js", () => ({
  putUserSetting: (...args: any[]) => mockPutUserSetting(...args),
}));

vi.mock("../settings/org-settings.js", () => ({
  getOrgSetting: (...args: any[]) => mockGetOrgSetting(...args),
  putOrgSetting: vi.fn(),
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mockExecute }),
}));

vi.mock("../server/email.js", () => ({
  sendEmail: vi.fn(),
  isEmailConfigured: () => false,
}));

vi.mock("../server/email-templates.js", () => ({
  renderInviteEmail: vi.fn(),
}));

vi.mock("../server/app-url.js", () => ({
  getAppProductionUrl: () => "https://app.example.test",
  resolveAppRuntimeUrl: () => mockResolveAppRuntimeUrl(),
}));

vi.mock("./context.js", () => ({
  getOrgContext: (...args: any[]) => mockGetOrgContext(...args),
  resolveA2AOrganizationCredentialsByDomain: (...args: any[]) =>
    mockResolveA2AOrganizationCredentialsByDomain(...args),
  createOrganization: vi.fn(),
}));

vi.mock("./request-org-cache.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./request-org-cache.js")>();
  return {
    ...actual,
    invalidateMemberOrgCaches: (...args: any[]) =>
      mockInvalidateMemberOrgCaches(...args),
  };
});

vi.mock("./free-email-providers.js", () => ({
  isFreeEmailProvider: () => false,
}));

vi.mock("../server/agent-discovery.js", () => ({
  discoverAgents: (...args: any[]) => mockDiscoverAgents(...args),
  getBuiltinAgentsForSeeding: () => mockGetBuiltinAgentsForSeeding(),
  loadWorkspaceAppsManifest: (...args: any[]) =>
    mockLoadWorkspaceAppsManifest(...args),
}));

vi.mock("../a2a/client.js", () => ({
  getGlobalA2ASecret: () => mockGetGlobalA2ASecret(),
  signA2AToken: (...args: any[]) => mockSignA2AToken(...args),
  signA2AOrganizationToken: (...args: any[]) =>
    mockSignA2AOrganizationToken(...args),
}));

vi.mock("../a2a/server.js", () => ({
  verifyA2AToken: (...args: any[]) => mockVerifyA2AToken(...args),
}));

vi.mock("../a2a/audience.js", () => ({
  canonicalA2AAudience: (...args: any[]) => mockCanonicalA2AAudience(...args),
}));

vi.mock("../extensions/url-safety.js", () => ({
  ssrfSafeFetch: (...args: any[]) => mockSsrfSafeFetch(...args),
}));

vi.mock("../server/social-sign-in-providers.js", () => ({
  resolveDeploymentSignInMethods: () => ({
    emailPassword: true,
    google: true,
    github: false,
  }),
}));

import {
  getMyOrgHandler,
  receiveA2ASecretHandler,
  revealA2ASecretHandler,
  setA2ASecretHandler,
  setA2AMemberDelegationHandler,
  syncA2ASecretHandler,
} from "./handlers.js";

const ADMIN_CONTEXT = {
  email: "admin@example.test",
  orgId: "org_1",
  orgName: "Example",
  role: "admin",
};

describe("cross-app secret handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgContext.mockResolvedValue(ADMIN_CONTEXT);
    mockReadBody.mockResolvedValue({});
  });

  it.each([
    ["reveal", revealA2ASecretHandler],
    ["set", setA2ASecretHandler],
    ["sync", syncA2ASecretHandler],
    ["change member delegation", setA2AMemberDelegationHandler],
  ])("rejects an admin trying to %s it", async (_name, handler) => {
    await expect(handler({} as any)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe("setA2AMemberDelegationHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadBody.mockResolvedValue({ enabled: true });
    mockGetOrgContext.mockResolvedValue({
      email: "owner@example.test",
      orgId: "org_1",
      orgName: "Example",
      role: "owner",
    });
    mockExecute.mockResolvedValue({ rows: [] });
  });

  it("persists the owner's explicit opt-in", async () => {
    await expect(setA2AMemberDelegationHandler({} as any)).resolves.toEqual({
      enabled: true,
    });
    expect(mockExecute).toHaveBeenCalledWith({
      sql: expect.stringContaining("SET a2a_member_delegation_enabled = ?"),
      args: [true, "org_1"],
    });
  });

  it("rejects non-boolean values without writing", async () => {
    mockReadBody.mockResolvedValueOnce({ enabled: "true" });

    await expect(
      setA2AMemberDelegationHandler({} as any),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe("syncA2ASecretHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AGENT_NATIVE_WORKSPACE_APP_ID", "sender");
    mockGetOrgSetting.mockResolvedValue(null);
    mockGetBuiltinAgentsForSeeding.mockReturnValue([
      { id: "builtin-app", url: "https://builtin.example.test" },
    ]);
    mockResolveAppRuntimeUrl.mockReturnValue("https://remote.example.test");
    vi.stubGlobal("fetch", mockFetch);
    mockReadBody.mockResolvedValue({});
    mockGetOrgContext.mockResolvedValue({
      email: "owner@example.test",
      orgId: "org_1",
      orgName: "Example",
      role: "owner",
    });
    mockExecute.mockResolvedValue({
      rows: [{ a2a_secret: "local-secret", allowed_domain: "example.test" }],
    });
    mockDiscoverAgents.mockResolvedValue([
      {
        id: "remote",
        name: "Remote",
        description: "",
        url: "https://remote.example.test",
        color: "#000000",
        source: "workspace",
      },
    ]);
    mockLoadWorkspaceAppsManifest.mockResolvedValue([
      { id: "remote", path: "/" },
      { id: "metadata", path: "/" },
      { id: "workspace-app", path: "/workspace-app" },
      { id: "same-origin-other-path", path: "/registered-app" },
      {
        id: "workspace-app",
        path: "/workspace-app",
        url: "https://workspace.example.test/attacker-controlled-path",
      },
    ]);
    mockSignA2AToken.mockResolvedValue("signed-jwt");
    mockSignA2AOrganizationToken.mockResolvedValue("signed-jwt");
    mockCanonicalA2AAudience.mockImplementation((url) =>
      url.replace(/\/+$/, ""),
    );
    mockSsrfSafeFetch.mockResolvedValue(new Response("ok", { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function setWorkspaceTarget(origin: string) {
    vi.stubEnv("WORKSPACE_GATEWAY_URL", origin);
    vi.stubEnv("AGENT_NATIVE_WORKSPACE_APPS_JSON", "[]");
    resetAppConfigForTests();
    mockResolveAppRuntimeUrl.mockReturnValue(origin);
    mockLoadWorkspaceAppsManifest.mockResolvedValue([
      { id: "sibling", path: "/sibling" },
    ]);
    mockDiscoverAgents.mockResolvedValue([
      {
        id: "sibling",
        name: "Sibling",
        url: `${origin}/sibling`,
        source: "workspace",
      },
    ]);
  }

  it.each([
    "success",
    "standalone-builtin",
    "localhost-success",
    "localhost-redirect",
    "localhost-unconfigured",
    "localhost-other-port",
    "localhost-other-scheme",
    "self-and-sibling",
    "basepath-self-and-sibling",
    "unknown-workspace-identity",
    "wrong-previous-secret",
    "redirect",
    "unconfigured",
    "localhost-configured",
    "abbreviated-ip-configured",
    "builtin",
    "unregistered",
  ] as const)(
    "uses the real SSRF transport for a %s workspace recipient",
    async (mode) => {
      const hasSender = [
        "self-and-sibling",
        "basepath-self-and-sibling",
        "unknown-workspace-identity",
      ].includes(mode);
      const redirects = mode === "redirect" || mode === "localhost-redirect";
      const senderSecret = "fake-new-secret";
      let receiverSecret = "fake-previous-secret";
      const receiving = new AsyncLocalStorage<"sender" | "sibling">();
      const received: Array<{
        url?: string;
        host?: string;
        authorization?: string;
        body: string;
      }> = [];
      const server = createServer(async (request, response) => {
        let body = "";
        for await (const chunk of request) body += chunk;
        received.push({
          url: request.url,
          host: request.headers.host,
          authorization: request.headers.authorization,
          body,
        });
        if (redirects && received.length === 1) {
          response.writeHead(307, { location: "/redirected" });
          response.end();
          return;
        }
        try {
          const result = await receiving.run(
            request.url?.startsWith("/sender/") ? "sender" : "sibling",
            () =>
              receiveA2ASecretHandler({
                _headers: { authorization: request.headers.authorization },
                _audience: `http://${request.headers.host}/${request.url?.startsWith("/sender/") ? "sender" : "sibling"}`,
                _body: JSON.parse(body),
              } as any),
          );
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(result));
        } catch (error) {
          response.writeHead(
            (error as { statusCode?: number }).statusCode ?? 500,
          );
          response.end("receiver rejected request");
        }
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      try {
        const origin = `http://${mode === "localhost-success" || mode === "localhost-redirect" || mode === "localhost-unconfigured" || mode === "localhost-other-port" || mode === "localhost-other-scheme" ? "localhost" : "127.0.0.1"}:${(server.address() as AddressInfo).port}`;
        vi.stubEnv(
          "WORKSPACE_GATEWAY_URL",
          mode === "unconfigured"
            ? "http://127.0.0.1:1"
            : mode === "localhost-other-port"
              ? "http://localhost:1"
              : mode === "localhost-other-scheme"
                ? origin.replace("http:", "https:")
                : mode === "localhost-unconfigured"
                  ? origin.replace("localhost", "127.0.0.1")
                  : mode === "localhost-configured"
                    ? origin.replace("127.0.0.1", "localhost")
                    : mode === "abbreviated-ip-configured"
                      ? origin.replace("127.0.0.1", "127.1")
                      : origin,
        );
        vi.stubEnv("AGENT_NATIVE_WORKSPACE_APPS_JSON", "[]");
        resetAppConfigForTests();
        vi.unstubAllGlobals();
        const { ssrfSafeFetch } = await vi.importActual<
          typeof import("../extensions/url-safety.js")
        >("../extensions/url-safety.js");
        const { signA2AOrganizationToken } =
          await vi.importActual<typeof import("../a2a/client.js")>(
            "../a2a/client.js",
          );
        const { verifyA2AToken } =
          await vi.importActual<typeof import("../a2a/server.js")>(
            "../a2a/server.js",
          );
        mockVerifyA2AToken.mockImplementation((token, event, options) =>
          verifyA2AToken(token, event, {
            ...options,
            expectedAudience: event._audience,
          }),
        );
        mockGetGlobalA2ASecret.mockReturnValue(undefined);
        mockResolveA2AOrganizationCredentialsByDomain.mockImplementation(
          async (domain: string) =>
            domain === "example.test"
              ? {
                  orgId:
                    receiving.getStore() === "sender"
                      ? "sender-org"
                      : "receiver-org",
                  orgDomain: domain,
                  secret:
                    receiving.getStore() === "sender"
                      ? senderSecret
                      : receiverSecret,
                }
              : null,
        );
        mockSsrfSafeFetch.mockImplementation(ssrfSafeFetch);
        mockSignA2AOrganizationToken.mockImplementation(
          signA2AOrganizationToken,
        );
        mockResolveAppRuntimeUrl.mockReturnValue(origin);
        if (
          [
            "success",
            "localhost-success",
            "self-and-sibling",
            "basepath-self-and-sibling",
            "unknown-workspace-identity",
            "wrong-previous-secret",
          ].includes(mode)
        ) {
          vi.stubEnv("APP_URL", `${origin}/sibling`);
        }
        mockReadBody.mockImplementation(
          async (event: { _body?: unknown }) =>
            event._body ?? {
              signSecret:
                mode === "wrong-previous-secret"
                  ? "fake-wrong-secret"
                  : "fake-previous-secret",
            },
        );
        mockExecute.mockImplementation(
          async ({ sql, args }: { sql: string; args: string[] }) => {
            if (sql.includes("SELECT a2a_secret, allowed_domain"))
              return {
                rows: [
                  { a2a_secret: senderSecret, allowed_domain: "example.test" },
                ],
              };
            if (sql.includes("SELECT id, a2a_secret"))
              return {
                rows:
                  receiving.getStore() === "sender"
                    ? [{ id: "sender-org", a2a_secret: senderSecret }]
                    : [{ id: "receiver-org", a2a_secret: receiverSecret }],
              };
            if (sql.includes("UPDATE organizations SET a2a_secret")) {
              if (args[1] !== "receiver-org")
                throw new Error("unexpected receiver organization");
              receiverSecret = args[0];
              return { rows: [] };
            }
            throw new Error("unexpected query");
          },
        );
        mockLoadWorkspaceAppsManifest.mockResolvedValue([
          { id: "sibling", path: "/sibling" },
          ...(hasSender ? [{ id: "sender", path: "/sender" }] : []),
        ]);
        if (hasSender) {
          vi.stubEnv(
            "AGENT_NATIVE_WORKSPACE_APP_ID",
            mode === "self-and-sibling" ? "sender" : undefined,
          );
          vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE_APP_ID", undefined);
          vi.stubEnv("AGENT_NATIVE_APP_ID", "sibling");
          vi.stubEnv(
            "VITE_APP_BASE_PATH",
            mode === "basepath-self-and-sibling" ? "/sender" : undefined,
          );
          vi.stubEnv("APP_BASE_PATH", undefined);
        }
        const recipientBase =
          mode === "standalone-builtin"
            ? "https://builtin.example.test"
            : `${origin}/sibling`;
        if (mode === "standalone-builtin") {
          for (const key of [
            "AGENT_NATIVE_WORKSPACE_APP_ID",
            "VITE_AGENT_NATIVE_WORKSPACE_APP_ID",
            "AGENT_NATIVE_APP_ID",
            "APP_ID",
            "AGENT_APP",
            "npm_package_name",
          ])
            vi.stubEnv(key, undefined);
          mockLoadWorkspaceAppsManifest.mockResolvedValue(null);
          mockSsrfSafeFetch.mockImplementation(
            async (url: string, init: RequestInit) => {
              const authorization = (init.headers as Record<string, string>)
                .Authorization;
              const body = String(init.body);
              received.push({
                url: new URL(url).pathname,
                host: new URL(url).host,
                authorization,
                body,
              });
              const result = await receiving.run("sibling", () =>
                receiveA2ASecretHandler({
                  _headers: { authorization },
                  _body: JSON.parse(body),
                  _audience: recipientBase,
                } as any),
              );
              return new Response(JSON.stringify(result));
            },
          );
        }
        mockGetBuiltinAgentsForSeeding.mockReturnValue([
          { id: "sibling", url: recipientBase },
        ]);
        const agents = [
          {
            id: mode === "unregistered" ? "unregistered" : "sibling",
            name: "Sibling",
            description: "",
            url: recipientBase,
            color: "#000000",
            source:
              mode === "builtin" || mode === "standalone-builtin"
                ? "builtin"
                : "workspace",
          },
        ];
        if (hasSender) {
          vi.stubEnv(
            "AGENT_NATIVE_WORKSPACE_APPS_JSON",
            JSON.stringify([
              { id: "sender", name: "Sender", path: "/sender" },
              { id: "sibling", name: "Sibling", path: "/sibling" },
            ]),
          );
          const discovery = await vi.importActual<
            typeof import("../server/agent-discovery.js")
          >("../server/agent-discovery.js");
          mockDiscoverAgents.mockImplementation(discovery.discoverAgents);
        } else {
          mockDiscoverAgents.mockResolvedValue(agents);
        }

        const event = hasSender
          ? {
              url: new URL(
                `${origin}/sibling/_agent-native/org/a2a-secret/sync`,
              ),
              _headers: { host: new URL(origin).host },
            }
          : {};
        if (mode === "unknown-workspace-identity") {
          await expect(
            syncA2ASecretHandler(event as any),
          ).rejects.toMatchObject({
            statusCode: 503,
            message: expect.stringContaining("workspace"),
          });
          expect(received).toEqual([]);
          expect(receiverSecret).toBe("fake-previous-secret");
          return;
        }
        const result = await syncA2ASecretHandler(event as any);
        if (mode === "self-and-sibling" || mode === "basepath-self-and-sibling")
          expect(mockDiscoverAgents).toHaveBeenCalledWith("sender", {
            workspaceAppsManifest: expect.any(Array),
          });
        if (mode === "unregistered") {
          expect(result).toMatchObject({ total: 0, succeeded: 0, failed: 0 });
          expect(received).toEqual([]);
        } else if (
          mode === "unconfigured" ||
          mode === "localhost-unconfigured" ||
          mode === "localhost-other-port" ||
          mode === "localhost-other-scheme" ||
          mode === "localhost-configured" ||
          mode === "abbreviated-ip-configured" ||
          mode === "builtin"
        ) {
          expect(result).toMatchObject({
            total: 1,
            succeeded: 0,
            failed: 1,
            results: [
              {
                id: "sibling",
                ok: false,
                error: expect.stringContaining("SSRF blocked"),
              },
            ],
          });
          expect(received).toEqual([]);
        } else if (mode === "wrong-previous-secret") {
          expect(result).toMatchObject({
            total: 1,
            succeeded: 0,
            failed: 1,
            results: [{ status: 401 }],
          });
          expect(received).toHaveLength(1);
          expect(receiverSecret).toBe("fake-previous-secret");
        } else {
          if (!redirects) expect(result.results[0].error).toBeUndefined();
          expect(received).toHaveLength(1);
          expect(result).toMatchObject(
            !redirects
              ? { total: 1, succeeded: 1, failed: 0 }
              : {
                  total: 1,
                  succeeded: 0,
                  failed: 1,
                  results: [{ id: "sibling", ok: false, status: 307 }],
                },
          );
          expect(received[0].url).toBe(
            `${mode === "standalone-builtin" ? "" : "/sibling"}/_agent-native/org/a2a-secret/receive`,
          );
          if (mode === "standalone-builtin")
            expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
              `${recipientBase}/_agent-native/org/a2a-secret/receive`,
              expect.anything(),
              expect.objectContaining({ requireDispatcher: true }),
            );
          expect(received[0].host).toBe(new URL(recipientBase).host);
          expect(JSON.parse(received[0].body)).toEqual({
            secret: "fake-new-secret",
            orgDomain: "example.test",
          });
          const token =
            received[0].authorization?.replace(/^Bearer /, "") ?? "";
          const { payload } = await jose.jwtVerify(
            token,
            new TextEncoder().encode("fake-previous-secret"),
            { audience: recipientBase },
          );
          expect(payload.org_domain).toBe("example.test");
          expect(receiverSecret).toBe(
            redirects ? "fake-previous-secret" : senderSecret,
          );
          await expect(
            jose.jwtVerify(token, new TextEncoder().encode("fake-new-secret")),
          ).rejects.toThrow();
        }
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        resetAppConfigForTests();
      }
    },
  );

  it("permits a configured IPv6 loopback literal through the SSRF preflight", async () => {
    const origin = "http://[::1]:43219";
    setWorkspaceTarget(origin);
    const { ssrfSafeFetch } = await vi.importActual<
      typeof import("../extensions/url-safety.js")
    >("../extensions/url-safety.js");
    mockSsrfSafeFetch.mockImplementation(ssrfSafeFetch);
    mockFetch.mockReset().mockResolvedValue(new Response("ok"));

    const result = await syncA2ASecretHandler({} as any);
    expect(result).toMatchObject({ total: 1, succeeded: 1, failed: 0 });
    expect(mockFetch).toHaveBeenCalledWith(
      `${origin}/sibling/_agent-native/org/a2a-secret/receive`,
      expect.objectContaining({
        method: "POST",
        redirect: "manual",
        dispatcher: expect.anything(),
      }),
    );
  });

  it("blocks a configured metadata address without sending a request", async () => {
    setWorkspaceTarget("http://169.254.169.254");
    const { ssrfSafeFetch } = await vi.importActual<
      typeof import("../extensions/url-safety.js")
    >("../extensions/url-safety.js");
    mockSsrfSafeFetch.mockImplementation(ssrfSafeFetch);
    mockFetch
      .mockReset()
      .mockRejectedValue(new Error("unexpected network request"));
    const result = await syncA2ASecretHandler({} as any);
    expect(result).toMatchObject({
      total: 1,
      succeeded: 0,
      failed: 1,
      results: [{ error: expect.stringContaining("SSRF blocked") }],
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["rebind.example.test", "127.0.0.1"],
    ["localhost", "10.0.0.1"],
    ["localhost", "93.184.216.34"],
  ])(
    "blocks configured %s when DNS returns hostile address %s",
    async (hostname, hostileAddress) => {
      let requests = 0;
      const server = createServer((_request, response) => {
        requests++;
        response.end("unexpected");
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const preflightLookup = vi
        .fn()
        .mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
      const connectLookup = vi.fn(
        (
          _hostname: string,
          _options: unknown,
          callback: (
            error: NodeJS.ErrnoException | null,
            addresses: { address: string; family: number }[],
          ) => void,
        ) =>
          callback(
            null,
            hostname === "localhost"
              ? [
                  { address: "127.0.0.1", family: 4 },
                  { address: hostileAddress, family: 4 },
                ]
              : [{ address: hostileAddress, family: 4 }],
          ),
      );
      vi.doMock("node:dns/promises", () => ({ lookup: preflightLookup }));
      vi.doMock("node:dns", () => ({ lookup: connectLookup }));
      vi.resetModules();
      try {
        const origin = `http://${hostname}:${(server.address() as AddressInfo).port}`;
        setWorkspaceTarget(origin);
        vi.unstubAllGlobals();
        const { ssrfSafeFetch } = await vi.importActual<
          typeof import("../extensions/url-safety.js")
        >("../extensions/url-safety.js");
        let transportError: unknown;
        mockSsrfSafeFetch.mockImplementation(
          async (...args: Parameters<typeof ssrfSafeFetch>) => {
            try {
              return await ssrfSafeFetch(...args);
            } catch (error) {
              transportError = error;
              throw error;
            }
          },
        );

        const result = await syncA2ASecretHandler({} as any);
        expect(result).toMatchObject({ total: 1, succeeded: 0, failed: 1 });
        expect(transportError).toMatchObject({
          cause: { code: "EAI_BLOCKED" },
        });
        if (hostname !== "localhost")
          expect(preflightLookup).toHaveBeenCalled();
        expect(connectLookup).toHaveBeenCalled();
        expect(requests).toBe(0);
      } finally {
        vi.doUnmock("node:dns/promises");
        vi.doUnmock("node:dns");
        vi.resetModules();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        resetAppConfigForTests();
      }
    },
  );

  it.each(["localhost", "public"])(
    "fails closed for %s without a dispatcher",
    async (kind) => {
      const preflightLookup = vi
        .fn()
        .mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
      vi.doMock("node:dns/promises", () => ({ lookup: preflightLookup }));
      vi.doMock("node:dns", () => {
        throw new Error("DNS unavailable");
      });
      vi.resetModules();
      try {
        const origin =
          kind === "localhost"
            ? "http://localhost:43219"
            : "https://public.example.test";
        setWorkspaceTarget(origin);
        if (kind === "public") {
          mockGetBuiltinAgentsForSeeding.mockReturnValue([
            { id: "builtin-app", url: origin },
          ]);
          mockDiscoverAgents.mockResolvedValue([
            {
              id: "builtin-app",
              name: "Built-in",
              url: origin,
              source: "builtin",
            },
          ]);
        }
        const { ssrfSafeFetch } = await vi.importActual<
          typeof import("../extensions/url-safety.js")
        >("../extensions/url-safety.js");
        mockSsrfSafeFetch.mockImplementation(ssrfSafeFetch);
        mockFetch
          .mockReset()
          .mockRejectedValue(new Error("unexpected network request"));
        const result = await syncA2ASecretHandler({} as any);
        expect(result).toMatchObject({
          total: 1,
          succeeded: 0,
          failed: 1,
          results: [
            {
              error: expect.stringContaining("dispatcher could not be loaded"),
            },
          ],
        });
        if (kind === "public")
          expect(preflightLookup).toHaveBeenCalledWith("public.example.test", {
            all: true,
            verbatim: true,
          });
        expect(mockFetch).not.toHaveBeenCalled();
      } finally {
        vi.doUnmock("node:dns");
        vi.doUnmock("node:dns/promises");
        vi.resetModules();
        resetAppConfigForTests();
      }
    },
  );

  it("rejects an ambiguous workspace mount without guessing from the app ID", async () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE_APP_ID", undefined);
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE_APP_ID", undefined);
    vi.stubEnv("AGENT_NATIVE_APP_ID", "sibling");
    vi.stubEnv("VITE_APP_BASE_PATH", "/sender");
    resetAppConfigForTests();
    mockResolveAppRuntimeUrl.mockReturnValue("https://workspace.example.test");
    mockLoadWorkspaceAppsManifest.mockResolvedValue([
      { id: "sender", path: "/sender" },
      { id: "duplicate", path: "/sender" },
      { id: "sibling", path: "/sibling" },
    ]);
    mockDiscoverAgents.mockResolvedValue([
      {
        id: "sibling",
        name: "Sibling",
        url: "https://workspace.example.test/sibling",
        source: "workspace",
      },
    ]);
    await expect(syncA2ASecretHandler({} as any)).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringContaining("unique"),
    });
    expect(mockDiscoverAgents).toHaveBeenCalledWith(undefined, {
      workspaceAppsManifest: expect.any(Array),
    });
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });

  it.each([
    "{invalid-json",
    JSON.stringify([
      { id: "sender", path: "/sender" },
      { id: "unreadable-peer" },
    ]),
  ])("rejects an unreadable workspace manifest before sending", async (raw) => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE_APPS_JSON", raw);
    resetAppConfigForTests();
    const discovery = await vi.importActual<
      typeof import("../server/agent-discovery.js")
    >("../server/agent-discovery.js");
    mockLoadWorkspaceAppsManifest.mockImplementation(
      discovery.loadWorkspaceAppsManifest,
    );
    mockDiscoverAgents.mockImplementation(discovery.discoverAgents);
    await expect(syncA2ASecretHandler({} as any)).rejects.toThrow(
      "Invalid workspace apps environment manifest",
    );
    expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
  });

  it("uses one validated workspace manifest even if the source changes during discovery", async () => {
    vi.stubEnv(
      "AGENT_NATIVE_WORKSPACE_APPS_JSON",
      JSON.stringify([
        { id: "sender", path: "/sender" },
        { id: "sibling", path: "/sibling" },
      ]),
    );
    resetAppConfigForTests();
    mockResolveAppRuntimeUrl.mockReturnValue("https://workspace.example.test");
    const discovery = await vi.importActual<
      typeof import("../server/agent-discovery.js")
    >("../server/agent-discovery.js");
    mockLoadWorkspaceAppsManifest.mockImplementation(
      discovery.loadWorkspaceAppsManifest,
    );
    mockDiscoverAgents.mockImplementation(async (selfId, options) => {
      vi.stubEnv("AGENT_NATIVE_WORKSPACE_APPS_JSON", "{unreadable");
      return discovery.discoverAgents(selfId, options);
    });
    await expect(syncA2ASecretHandler({} as any)).resolves.toMatchObject({
      total: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "https://workspace.example.test/sibling/_agent-native/org/a2a-secret/receive",
      expect.anything(),
      expect.anything(),
    );
  });

  it("does not treat a branding slug without package identity as a builtin sender", async () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE_APP_ID", undefined);
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE_APP_ID", undefined);
    vi.stubEnv("npm_package_name", undefined);
    resetAppConfigForTests();
    const { defineAppConfig } = await import("../app-config/index.js");
    defineAppConfig({ app: { slug: "calendar", id: "custom-app" } });
    try {
      mockLoadWorkspaceAppsManifest.mockResolvedValue(null);
      mockGetBuiltinAgentsForSeeding.mockReturnValue([
        { id: "calendar", url: "https://calendar.example.test" },
      ]);
      mockDiscoverAgents.mockImplementation(async (selfId) =>
        selfId === "calendar"
          ? []
          : [
              {
                id: "calendar",
                name: "Calendar",
                url: "https://calendar.example.test",
                source: "builtin",
              },
            ],
      );
      await expect(syncA2ASecretHandler({} as any)).resolves.toMatchObject({
        total: 1,
        succeeded: 1,
        failed: 0,
      });
      expect(mockDiscoverAgents).toHaveBeenCalledWith(undefined, {
        workspaceAppsManifest: null,
      });
    } finally {
      resetAppConfigForTests();
    }
  });

  it("uses proven first-party identity for standalone builtin discovery", async () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE_APP_ID", undefined);
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE_APP_ID", undefined);
    vi.stubEnv("npm_package_name", "calendar");
    resetAppConfigForTests();
    mockLoadWorkspaceAppsManifest.mockResolvedValue(null);
    await syncA2ASecretHandler({} as any);
    expect(mockDiscoverAgents).toHaveBeenCalledWith("calendar", {
      workspaceAppsManifest: null,
    });
  });

  it("posts A2A secrets through the SSRF-safe fetch wrapper", async () => {
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "test-vercel-bypass");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "remote.example.test");
    const result = await syncA2ASecretHandler({} as any);

    expect(result).toMatchObject({
      total: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(mockSignA2AOrganizationToken).toHaveBeenCalledWith(
      "example.test",
      "local-secret",
      undefined,
      {
        preferGlobalSecret: false,
        audience: "https://remote.example.test",
      },
    );
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "https://remote.example.test/_agent-native/org/a2a-secret/receive",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer signed-jwt",
          "x-vercel-protection-bypass": "test-vercel-bypass",
        }),
        body: JSON.stringify({
          secret: "local-secret",
          orgDomain: "example.test",
        }),
      }),
      {
        maxRedirects: 0,
        followRedirects: false,
        requireDispatcher: true,
        allowedPrivateOrigins: [],
      },
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("only sends organization secrets to built-in and same-deployment workspace apps", async () => {
    mockResolveAppRuntimeUrl.mockReturnValue("https://workspace.example.test");
    mockDiscoverAgents.mockResolvedValue([
      {
        id: "workspace-app",
        name: "Workspace App",
        description: "",
        url: "https://workspace.example.test/workspace-app",
        color: "#000000",
        source: "workspace",
      },
      {
        id: "foreign-workspace-app",
        name: "Foreign Workspace App",
        description: "",
        url: "https://customer.example.test/apps/qr",
        color: "#000000",
        source: "workspace",
      },
      {
        id: "builtin-app",
        name: "Built-in App",
        description: "",
        url: "https://builtin.example.test",
        color: "#000000",
        source: "builtin",
      },
      {
        id: "same-origin-other-path",
        name: "Same origin unrelated path",
        description: "",
        url: "https://workspace.example.test/unregistered-path",
        color: "#000000",
        source: "workspace",
      },
      {
        id: "workspace-app",
        name: "Workspace app URL override path",
        description: "",
        url: "https://workspace.example.test/attacker-controlled-path",
        color: "#000000",
        source: "workspace",
      },
      {
        id: "builtin-app",
        name: "Forged Built-in",
        description: "",
        url: "https://attacker.example.test",
        color: "#000000",
        source: "builtin",
      },
      {
        id: "directory-app",
        name: "Directory App",
        description: "",
        url: "https://directory.example.test",
        color: "#000000",
        source: "org-directory",
      },
      {
        id: "remote-app",
        name: "Remote App",
        description: "",
        url: "https://remote.example.test",
        color: "#000000",
        source: "remote-agent",
      },
    ]);

    const result = await syncA2ASecretHandler({} as any);

    expect(result).toMatchObject({ total: 2, succeeded: 2, failed: 0 });
    expect(mockSsrfSafeFetch).toHaveBeenCalledTimes(2);
    expect(mockSsrfSafeFetch.mock.calls.map(([url]) => url).sort()).toEqual([
      "https://builtin.example.test/_agent-native/org/a2a-secret/receive",
      "https://workspace.example.test/workspace-app/_agent-native/org/a2a-secret/receive",
    ]);
  });

  it("skips malformed workspace manifest rows while syncing valid apps", async () => {
    mockResolveAppRuntimeUrl.mockReturnValue("https://workspace.example.test");
    mockLoadWorkspaceAppsManifest.mockResolvedValue([
      { id: "malformed-workspace-app", url: "not a URL", path: "" },
      { id: "workspace-app", path: "/workspace-app" },
    ]);
    mockDiscoverAgents.mockResolvedValue([
      {
        id: "malformed-workspace-app",
        name: "Malformed Workspace App",
        description: "",
        url: "https://workspace.example.test/bad",
        color: "#000000",
        source: "workspace",
      },
      {
        id: "workspace-app",
        name: "Workspace App",
        description: "",
        url: "https://workspace.example.test/workspace-app",
        color: "#000000",
        source: "workspace",
      },
    ]);

    const result = await syncA2ASecretHandler({} as any);

    expect(result).toMatchObject({ total: 1, succeeded: 1, failed: 0 });
    expect(mockSsrfSafeFetch).toHaveBeenCalledTimes(1);
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      "https://workspace.example.test/workspace-app/_agent-native/org/a2a-secret/receive",
      expect.any(Object),
      {
        maxRedirects: 0,
        followRedirects: false,
        requireDispatcher: true,
        allowedPrivateOrigins: [],
      },
    );
  });

  it("reports SSRF blocks as per-agent failures without falling back to bare fetch", async () => {
    mockResolveAppRuntimeUrl.mockReturnValue("http://169.254.169.254");
    mockDiscoverAgents.mockResolvedValue([
      {
        id: "metadata",
        name: "Metadata",
        description: "",
        url: "http://169.254.169.254",
        color: "#000000",
        source: "workspace",
      },
    ]);
    mockSsrfSafeFetch.mockRejectedValueOnce(
      new Error(
        "SSRF blocked: refusing to fetch private/internal address (http://169.254.169.254)",
      ),
    );

    const result = await syncA2ASecretHandler({} as any);

    expect(result).toMatchObject({
      total: 1,
      succeeded: 0,
      failed: 1,
      results: [
        expect.objectContaining({
          id: "metadata",
          ok: false,
          error: expect.stringContaining("SSRF blocked"),
        }),
      ],
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("org A2A secret equal to the deployment A2A_SECRET", () => {
  const OWNER_CONTEXT = { ...ADMIN_CONTEXT, role: "owner" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGlobalA2ASecret.mockReturnValue("deploy-secret");
    mockGetOrgContext.mockResolvedValue(OWNER_CONTEXT);
    mockExecute.mockResolvedValue({
      rows: [{ id: "org_1", a2a_secret: "existing-org-secret" }],
    });
  });

  describe("setA2ASecretHandler", () => {
    it("refuses the deployment secret even with surrounding whitespace", async () => {
      mockReadBody.mockResolvedValue({ secret: "  deploy-secret " });

      await expect(setA2ASecretHandler({} as any)).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining("must differ"),
      });
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("saves a distinct secret", async () => {
      mockReadBody.mockResolvedValue({ secret: "distinct-org-secret" });

      await expect(setA2ASecretHandler({} as any)).resolves.toMatchObject({
        a2aSecret: "distinct-org-secret",
      });
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringContaining("UPDATE organizations"),
          args: ["distinct-org-secret", "org_1"],
        }),
      );
      expect(mockInvalidateMemberOrgCaches).toHaveBeenCalledTimes(1);
    });

    it("saves any secret when no deployment secret is configured", async () => {
      mockGetGlobalA2ASecret.mockReturnValue(undefined);
      mockReadBody.mockResolvedValue({ secret: "deploy-secret" });

      await expect(setA2ASecretHandler({} as any)).resolves.toMatchObject({
        a2aSecret: "deploy-secret",
      });
    });

    it("rotates away from a stored secret equal to the deployment secret", async () => {
      mockExecute.mockResolvedValue({
        rows: [{ id: "org_1", a2a_secret: "deploy-secret" }],
      });
      mockReadBody.mockResolvedValue({ secret: "distinct-org-secret" });

      await expect(setA2ASecretHandler({} as any)).resolves.toEqual({
        a2aSecret: "distinct-org-secret",
        previousSecret: "deploy-secret",
      });
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringContaining("UPDATE organizations"),
          args: ["distinct-org-secret", "org_1"],
        }),
      );
      expect(mockInvalidateMemberOrgCaches).toHaveBeenCalledTimes(1);
    });
  });

  describe("receiveA2ASecretHandler", () => {
    const receive = async (
      pushedSecret: string,
      storedSecret = "existing-org-secret",
      identityAssurance:
        | "organization"
        | "org-member"
        | "user" = "organization",
    ) => {
      mockExecute.mockResolvedValue({
        rows: [{ id: "org_1", a2a_secret: storedSecret }],
      });
      const token = await new jose.SignJWT({ org_domain: "example.test" })
        .setProtectedHeader({ alg: "HS256" })
        .sign(new TextEncoder().encode(storedSecret));
      mockReadBody.mockResolvedValue({
        secret: pushedSecret,
        orgDomain: "example.test",
      });
      mockVerifyA2AToken.mockResolvedValue({
        email:
          identityAssurance === "organization" ? null : "owner@example.test",
        orgId: "org_1",
        orgDomain: "example.test",
        identityAssurance,
      });
      return receiveA2ASecretHandler({
        _headers: { authorization: `Bearer ${token}` },
      } as any);
    };

    it("fails the sync push loudly instead of silently demoting the org", async () => {
      await expect(receive("deploy-secret")).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining("equals this app's A2A_SECRET"),
      });
      expect(mockExecute).not.toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringContaining("UPDATE organizations"),
        }),
      );
    });

    it("does not reveal whether a value matches before the caller is verified", async () => {
      mockVerifyA2AToken.mockResolvedValue({ email: null, orgDomain: null });
      const token = await new jose.SignJWT({ org_domain: "example.test" })
        .setProtectedHeader({ alg: "HS256" })
        .sign(new TextEncoder().encode("wrong-secret"));
      mockReadBody.mockResolvedValue({
        secret: "deploy-secret",
        orgDomain: "example.test",
      });

      await expect(
        receiveA2ASecretHandler({
          _headers: { authorization: `Bearer ${token}` },
        } as any),
      ).rejects.toMatchObject({ statusCode: 401 });
    });

    it("stores a distinct pushed secret", async () => {
      await expect(receive("distinct-org-secret")).resolves.toEqual({
        ok: true,
        orgId: "org_1",
      });
      expect(mockVerifyA2AToken).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        {
          globalSecretOnly: true,
          verificationSecret: "existing-org-secret",
        },
      );
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringContaining("UPDATE organizations"),
          args: ["distinct-org-secret", "org_1"],
        }),
      );
      expect(mockInvalidateMemberOrgCaches).toHaveBeenCalledTimes(1);
    });

    it.each(["org-member", "user"] as const)(
      "does not let %s identity rotate the organization secret",
      async (identityAssurance) => {
        await expect(
          receive(
            "distinct-org-secret",
            "existing-org-secret",
            identityAssurance,
          ),
        ).rejects.toMatchObject({ statusCode: 401 });
        expect(mockExecute).not.toHaveBeenCalledWith(
          expect.objectContaining({
            sql: expect.stringContaining("UPDATE organizations"),
          }),
        );
      },
    );

    it("rotates away from a stored secret equal to the deployment secret", async () => {
      await expect(
        receive("distinct-org-secret", "deploy-secret"),
      ).resolves.toEqual({ ok: true, orgId: "org_1" });
      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          sql: expect.stringContaining("UPDATE organizations"),
          args: ["distinct-org-secret", "org_1"],
        }),
      );
    });

    it("stores the pushed secret when no deployment secret is configured", async () => {
      mockGetGlobalA2ASecret.mockReturnValue(undefined);

      await expect(receive("deploy-secret")).resolves.toMatchObject({
        ok: true,
      });
    });
  });
});

describe("getMyOrgHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgSetting.mockResolvedValue(null);
    mockGetOrgContext.mockResolvedValue({
      email: "owner@example.test",
      orgId: "org_1",
      orgName: "Example",
      role: "owner",
    });
    mockExecute.mockImplementation(async ({ sql }: { sql: string }) =>
      sql.includes("a2a_secret")
        ? {
            rows: [
              {
                allowed_domain: "example.test",
                a2a_secret: "example-stored-secret",
              },
            ],
          }
        : { rows: [] },
    );
  });

  it("reports that a secret exists without serializing its value", async () => {
    const result = (await getMyOrgHandler({} as any)) as Record<
      string,
      unknown
    >;

    expect(result.a2aSecretSet).toBe(true);
    expect(Object.keys(result)).not.toContain("a2aSecret");
    expect(JSON.stringify(result)).not.toContain("example-stored-secret");
  });

  it("omits the indicator entirely for plain members", async () => {
    mockGetOrgContext.mockResolvedValue({
      email: "member@example.test",
      orgId: "org_1",
      orgName: "Example",
      role: "member",
    });

    const result = (await getMyOrgHandler({} as any)) as Record<
      string,
      unknown
    >;

    expect(result.a2aSecretSet).toBeUndefined();
    expect(result.signInMethods).toBeUndefined();
  });

  it("gives an admin the sign-in methods but not the secret indicator", async () => {
    mockGetOrgContext.mockResolvedValue(ADMIN_CONTEXT);

    const result = (await getMyOrgHandler({} as any)) as Record<
      string,
      unknown
    >;

    expect(result.a2aSecretSet).toBeUndefined();
    expect(result.signInMethods).toEqual({
      emailPassword: true,
      google: true,
      github: false,
    });
  });

  it("fails instead of reporting org visibility when the default cannot be read", async () => {
    mockGetOrgSetting.mockRejectedValueOnce(
      new Error("settings database unavailable"),
    );

    await expect(getMyOrgHandler({} as any)).rejects.toThrow(
      "settings database unavailable",
    );
  });

  it("limits delegated org details to the asserted org and caps the returned role", async () => {
    mockExecute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes("a2a_secret")) {
        return {
          rows: [
            {
              allowed_domain: "example.test",
              a2a_secret: "example-stored-secret",
              a2a_member_delegation_enabled: true,
            },
          ],
        };
      }
      if (sql.includes("FROM org_members m") && sql.includes("icon_json")) {
        return {
          rows: [
            {
              orgId: "org_1",
              role: "owner",
              orgName: "Example",
            },
            {
              orgId: "org_2",
              role: "owner",
              orgName: "Other",
            },
          ],
        };
      }
      if (sql.includes("FROM org_invitations i")) {
        return {
          rows: [{ id: "invite-1", orgId: "org_1", orgName: "Example" }],
        };
      }
      return { rows: [] };
    });

    const result = (await runWithRequestContext(
      {
        a2aIdentityAssurance: "org-member",
        userEmail: "owner@example.test",
        orgId: "org_1",
      },
      () => getMyOrgHandler({} as any),
    )) as Record<string, any>;

    expect(result.orgId).toBe("org_1");
    expect(result.role).toBe("member");
    expect(result.orgs).toEqual([
      expect.objectContaining({ orgId: "org_1", role: "member" }),
    ]);
    expect(result.pendingInvitations).toEqual([
      expect.objectContaining({ id: "invite-1", orgId: "org_1" }),
    ]);
    expect(result.signInMethods).toBeUndefined();
    expect(result.a2aSecretSet).toBeUndefined();
    expect(result.a2aMemberDelegationEnabled).toBeUndefined();

    const membershipQuery = mockExecute.mock.calls.find(
      ([query]) =>
        query.sql.includes("FROM org_members m") &&
        query.sql.includes("icon_json"),
    )?.[0];
    expect(membershipQuery?.args).toEqual(["owner@example.test", "org_1"]);
    const invitationQuery = mockExecute.mock.calls.find(([query]) =>
      query.sql.includes("FROM org_invitations i"),
    )?.[0];
    expect(invitationQuery?.args).toEqual(["owner@example.test", "org_1"]);
  });

  it("does not expose a stale session org for a different delegated identity scope", async () => {
    mockGetOrgContext.mockResolvedValue({
      email: "owner@example.test",
      orgId: "org_other",
      orgName: "Other",
      role: "owner",
    });

    const result = (await runWithRequestContext(
      {
        a2aIdentityAssurance: "org-member",
        userEmail: "owner@example.test",
        orgId: "org_1",
      },
      () => getMyOrgHandler({} as any),
    )) as Record<string, any>;

    expect(result.orgId).toBeNull();
    expect(result.orgName).toBeNull();
    expect(result.role).toBeNull();
    expect(result.orgs).toEqual([]);
    expect(result.a2aSecretSet).toBeUndefined();
    expect(result.a2aMemberDelegationEnabled).toBeUndefined();
    expect(
      mockExecute.mock.calls.some(([query]) =>
        query.sql.includes("a2a_secret"),
      ),
    ).toBe(false);
    expect(mockGetOrgSetting).not.toHaveBeenCalled();
  });
});

describe("revealA2ASecretHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgContext.mockResolvedValue({
      email: "owner@example.test",
      orgId: "org_1",
      orgName: "Example",
      role: "owner",
    });
    mockExecute.mockResolvedValue({
      rows: [{ a2a_secret: "example-stored-secret" }],
    });
  });

  it("returns the secret for an owner that explicitly asks for it", async () => {
    const result = (await revealA2ASecretHandler({} as any)) as {
      a2aSecret: string | null;
    };

    expect(result.a2aSecret).toBe("example-stored-secret");
  });

  it("rejects members who are not owners or admins", async () => {
    mockGetOrgContext.mockResolvedValue({
      email: "member@example.test",
      orgId: "org_1",
      orgName: "Example",
      role: "member",
    });

    await expect(revealA2ASecretHandler({} as any)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
