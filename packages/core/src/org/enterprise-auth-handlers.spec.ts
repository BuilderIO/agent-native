import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: {
    access: {
      sso: { enabled: true },
      scim: { enabled: true },
    },
  },
  execute: vi.fn(),
  getBetterAuth: vi.fn(),
  getOrgContext: vi.fn(),
  getSession: vi.fn(),
  readBody: vi.fn(),
  registerSSOProvider: vi.fn(),
  listSCIMManagedConnections: vi.fn(),
}));

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getRequestURL: (event: any) =>
    event.url ?? new URL("https://app.example.test/_agent-native/org"),
  getRouterParam: (event: any, key: string) => event.params?.[key],
  createError: ({ statusCode, message }: any) =>
    Object.assign(new Error(message), { statusCode }),
}));

vi.mock("../app-config/index.js", () => ({
  getAppConfig: () => mocks.config,
}));

vi.mock("../db/client.js", () => ({
  getDbExec: () => ({ execute: mocks.execute }),
}));

vi.mock("../server/app-base-path.js", () => ({
  getConfiguredAppBasePath: () => "",
}));

vi.mock("../server/app-url.js", () => ({
  getAppProductionUrl: () => "https://app.example.test",
}));

vi.mock("../server/auth.js", () => ({
  getSession: (...args: any[]) => mocks.getSession(...args),
}));

vi.mock("../server/better-auth-instance.js", () => ({
  getBetterAuth: (...args: any[]) => mocks.getBetterAuth(...args),
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: (...args: any[]) => mocks.readBody(...args),
}));

vi.mock("./context.js", () => ({
  getOrgContext: (...args: any[]) => mocks.getOrgContext(...args),
}));

import {
  createSCIMHandler,
  createSSOProviderHandler,
  getSCIMHandler,
  listSSOProvidersHandler,
} from "./enterprise-auth-handlers.js";

describe("enterprise identity handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.access.sso.enabled = true;
    mocks.config.access.scim.enabled = true;
    mocks.getSession.mockResolvedValue({ email: "owner@example.test" });
    mocks.getOrgContext.mockResolvedValue({
      email: "owner@example.test",
      orgId: "org-1",
      role: "owner",
    });
    mocks.getBetterAuth.mockResolvedValue({
      api: {
        registerSSOProvider: mocks.registerSSOProvider,
        listSCIMManagedConnections: mocks.listSCIMManagedConnections,
      },
    });
    mocks.execute.mockResolvedValue({ rows: [] });
  });

  it("gates SSO and SCIM handlers when the deployment feature is disabled", async () => {
    mocks.config.access.sso.enabled = false;
    await expect(listSSOProvidersHandler({} as any)).rejects.toMatchObject({
      statusCode: 404,
    });

    mocks.config.access.scim.enabled = false;
    await expect(getSCIMHandler({} as any)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("requires an organization owner or admin before reading providers", async () => {
    mocks.getOrgContext.mockResolvedValue({
      email: "member@example.test",
      orgId: "org-1",
      role: "member",
    });
    await expect(listSSOProvidersHandler({} as any)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("registers an SSO provider for the authorized framework organization", async () => {
    mocks.readBody.mockResolvedValue({
      providerId: "okta",
      issuer: "https://id.example.test",
      domain: "example.test",
      type: "oidc",
      oidcConfig: { clientId: "client", clientSecret: "secret" },
    });
    mocks.registerSSOProvider.mockResolvedValue({
      domainVerificationToken: "dns-token",
    });
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ allowed_domain: "example.test" }] })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "provider-row",
            issuer: "https://id.example.test",
            oidc_config: "{}",
            saml_config: null,
            provider_id: "okta",
            organization_id: "org-1",
            domain: "example.test",
            domain_verified: false,
          },
        ],
      });

    await expect(createSSOProviderHandler({} as any)).resolves.toMatchObject({
      provider: {
        providerId: "okta",
        domain: "example.test",
        type: "oidc",
      },
      domainVerificationToken: "dns-token",
      registeredBy: "owner@example.test",
    });
    expect(mocks.registerSSOProvider).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: expect.objectContaining({
        providerId: "okta",
        organizationId: "org-1",
      }),
    });
  });

  it("fails closed when Better Auth returns an unreadable SCIM list", async () => {
    mocks.listSCIMManagedConnections.mockResolvedValue({ invalid: true });
    await expect(getSCIMHandler({} as any)).rejects.toMatchObject({
      statusCode: 502,
    });
  });

  it("returns a one-time SCIM token only to an authorized admin", async () => {
    const createSCIMManagedConnection = vi.fn().mockResolvedValue({
      connection: { id: "connection-1", status: "active" },
      token: "one-time-token",
    });
    mocks.getBetterAuth.mockResolvedValue({
      api: { createSCIMManagedConnection },
    });

    await expect(createSCIMHandler({} as any)).resolves.toMatchObject({
      connection: { connectionId: "connection-1", status: "active" },
      token: "one-time-token",
    });
    expect(createSCIMManagedConnection).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: expect.objectContaining({
        provisioningDomainId: "org-1",
        actorId: "owner@example.test",
      }),
    });
  });
});
