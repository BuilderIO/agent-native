import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveCredentialDetailedMock = vi.hoisted(() => vi.fn());
const canAuthorizeBuilderMock = vi.hoisted(() => vi.fn());
const getCredentialContextMock = vi.hoisted(() => vi.fn());
const getEmailReadinessMock = vi.hoisted(() => vi.fn());
const listCatalogMock = vi.hoisted(() => vi.fn());
const connectorSourcesMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/credentials", () => ({
  resolveCredentialDetailed: resolveCredentialDetailedMock,
}));
vi.mock("@agent-native/core/server", () => ({
  canAuthorizeBuilderApiRequest: canAuthorizeBuilderMock,
  getCredentialContext: getCredentialContextMock,
  getEmailReadiness: getEmailReadinessMock,
}));
vi.mock("@agent-native/core/workspace-connections", () => ({
  listWorkspaceConnectionProviderCatalogForApp: listCatalogMock,
}));
vi.mock("../connectors/credentials.js", () => ({
  resolveFactoryConnectorSources: connectorSourcesMock,
}));
vi.mock("./provider-api.js", () => ({ FACTORY_APP_ID: "factory" }));

import {
  PROVIDER_VAULT_KEYS,
  readProviderConnections,
} from "./factory-workflow-connections.js";

const identity = { userEmail: "teammate@example.test", orgId: "org-1" };

async function statusOf(provider: string) {
  const [result] = await readProviderConnections([provider], identity);
  return result;
}

/** Vault keys present for this caller, by name. */
function vaultHas(...keys: string[]) {
  resolveCredentialDetailedMock.mockImplementation(async (key: string) =>
    keys.includes(key) ? { value: "secret", scope: "org" } : undefined,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getCredentialContextMock.mockReturnValue({
    userEmail: identity.userEmail,
    orgId: identity.orgId,
  });
  connectorSourcesMock.mockResolvedValue({
    slack: "workspace",
    slackSecondary: undefined,
    github: undefined,
    sentry: "workspace",
  });
  getEmailReadinessMock.mockResolvedValue({
    status: "ready",
    provider: "resend",
  });
  canAuthorizeBuilderMock.mockResolvedValue(true);
  listCatalogMock.mockResolvedValue({ providers: [] });
  vaultHas();
});

describe("readProviderConnections", () => {
  it("never calls Factory's own operations a missing connection", async () => {
    expect(await statusOf("factory")).toEqual({
      provider: "factory",
      status: "connected",
      connectWith: null,
    });
  });

  it("reads Slack, GitHub and Sentry from the connectors Factory already resolves, once", async () => {
    const result = await readProviderConnections(
      ["slack", "github", "sentry"],
      identity,
    );

    expect(result.map(({ provider, status }) => [provider, status])).toEqual([
      ["github", "not connected"],
      ["sentry", "connected"],
      ["slack", "connected"],
    ]);
    expect(connectorSourcesMock).toHaveBeenCalledTimes(1);
    expect(connectorSourcesMock).toHaveBeenCalledWith(identity.userEmail, {
      orgId: identity.orgId,
    });
    expect(result[0]).toMatchObject({ connectWith: "workspace-connection" });
  });

  it("says when a provider is connected only through the local .env, which provider-api-request cannot use", async () => {
    connectorSourcesMock.mockResolvedValue({
      slack: "local-env",
      slackSecondary: undefined,
      github: "workspace",
      sentry: undefined,
    });

    const result = await readProviderConnections(
      ["slack", "github", "sentry"],
      identity,
    );

    const byProvider = Object.fromEntries(
      result.map((entry) => [entry.provider, entry]),
    );
    expect(byProvider.slack).toMatchObject({
      status: "connected",
      detail: expect.stringMatching(/local \.env only.*provider-api-request/),
    });
    expect(byProvider.github).toEqual({
      provider: "github",
      status: "connected",
      connectWith: "workspace-connection",
    });
    expect(byProvider.sentry).toMatchObject({ status: "not connected" });
  });

  it("calls an unreadable vault unknown, never not connected", async () => {
    connectorSourcesMock.mockRejectedValue(
      new Error("Couldn't reach the secret vault (transient)."),
    );

    const result = await readProviderConnections(["slack", "github"], identity);

    expect(result).toEqual([
      expect.objectContaining({
        provider: "github",
        status: "unknown",
        detail: expect.stringContaining("secret vault"),
      }),
      expect.objectContaining({ provider: "slack", status: "unknown" }),
    ]);
  });

  it("reads email from its readiness, and keeps unavailable apart from not configured", async () => {
    expect(await statusOf("email")).toMatchObject({ status: "connected" });

    getEmailReadinessMock.mockResolvedValue({
      status: "not-configured",
      provider: "dev",
    });
    expect(await statusOf("email")).toMatchObject({
      status: "not connected",
      detail: "Email is not configured.",
    });

    getEmailReadinessMock.mockResolvedValue({
      status: "unavailable",
      provider: "unknown",
    });
    expect(await statusOf("email")).toMatchObject({ status: "unknown" });
  });

  it("asks for the Builder scope the start call needs", async () => {
    expect(await statusOf("builder")).toMatchObject({ status: "connected" });
    expect(canAuthorizeBuilderMock).toHaveBeenCalledWith("builder:agents:run");

    canAuthorizeBuilderMock.mockResolvedValue(false);
    expect(await statusOf("builder")).toMatchObject({
      status: "not connected",
      detail: expect.stringContaining("builder:agents:run"),
    });

    canAuthorizeBuilderMock.mockRejectedValue(new Error("store offline"));
    expect(await statusOf("builder")).toMatchObject({
      status: "unknown",
      detail: "store offline",
    });
  });

  it("counts a ready workspace connection granted to Factory", async () => {
    listCatalogMock.mockResolvedValue({
      providers: [{ id: "hubspot", readiness: { status: "ready" } }],
    });

    expect(await statusOf("hubspot")).toEqual({
      provider: "hubspot",
      status: "connected",
      connectWith: "workspace-connection",
    });
    expect(listCatalogMock).toHaveBeenCalledWith({
      appId: "factory",
      provider: "hubspot",
      includeConnections: "granted",
    });
  });

  it("falls back to the vault key when there is no connection", async () => {
    vaultHas("NOTION_API_KEY");
    expect(await statusOf("notion")).toMatchObject({ status: "connected" });
  });

  it("needs every key a way of signing in names", async () => {
    vaultHas("JIRA_USER_EMAIL", "JIRA_API_TOKEN");
    expect(await statusOf("jira")).toMatchObject({ status: "not connected" });

    vaultHas("JIRA_BASE_URL", "JIRA_USER_EMAIL", "JIRA_API_TOKEN");
    expect(await statusOf("jira")).toMatchObject({ status: "connected" });
  });

  it("points vault-only providers at the vault", async () => {
    expect(await statusOf("stripe")).toEqual({
      provider: "stripe",
      status: "not connected",
      connectWith: "vault",
      detail: "Add its key to the vault.",
    });
    expect(listCatalogMock).not.toHaveBeenCalled();

    vaultHas("STRIPE_SECRET_KEY");
    expect(await statusOf("stripe")).toMatchObject({ status: "connected" });
  });

  it("is unknown when the check failed and nothing else says connected", async () => {
    listCatalogMock.mockRejectedValue(
      new Error("Workspace connections require an authenticated user."),
    );

    expect(await statusOf("hubspot")).toMatchObject({
      status: "unknown",
      detail: "Workspace connections require an authenticated user.",
    });
  });

  it("is connected when the vault says so even though the connection check failed", async () => {
    listCatalogMock.mockRejectedValue(new Error("offline"));
    vaultHas("HUBSPOT_PRIVATE_APP_TOKEN");

    expect(await statusOf("hubspot")).toMatchObject({ status: "connected" });
  });

  it("is unknown outside an authenticated request", async () => {
    getCredentialContextMock.mockReturnValue(null);

    expect(await statusOf("gong")).toMatchObject({
      status: "unknown",
      detail: expect.stringContaining("authenticated request"),
    });
  });

  it("answers each provider once and in a stable order", async () => {
    const result = await readProviderConnections(
      ["stripe", "factory", "stripe", "email"],
      identity,
    );
    expect(result.map((entry) => entry.provider)).toEqual([
      "email",
      "factory",
      "stripe",
    ]);
  });
});

describe("the vault key table", () => {
  it("names only keys the provider API catalog declares for that provider", async () => {
    const { getProviderApiConfig } = await vi.importActual<
      typeof import("@agent-native/core/provider-api")
    >("@agent-native/core/provider-api");

    for (const [provider, ways] of Object.entries(PROVIDER_VAULT_KEYS)) {
      const declared = getProviderApiConfig(provider).credentialKeys;
      for (const key of ways.flat()) {
        expect(declared, `${provider} declares ${key}`).toContain(key);
      }
    }
  });
});
