import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppSecret: vi.fn(),
  resolveCredential: vi.fn(),
  resolveWorkspaceConnectionCredentialForApp: vi.fn(),
  resolveOrgIdForEmail: vi.fn(),
  select: vi.fn(),
  isLocalDatabase: vi.fn(),
}));

vi.mock("@agent-native/core/credentials", () => ({
  resolveCredential: mocks.resolveCredential,
}));
vi.mock("@agent-native/core/org", () => ({
  orgMembers: { email: "email", orgId: "org_id" },
  resolveOrgIdForEmail: mocks.resolveOrgIdForEmail,
}));
vi.mock("@agent-native/core/secrets", () => ({
  readAppSecret: mocks.readAppSecret,
}));
vi.mock("@agent-native/core/workspace-connections", () => ({
  resolveWorkspaceConnectionCredentialForApp:
    mocks.resolveWorkspaceConnectionCredentialForApp,
}));
vi.mock("@agent-native/core/db", () => ({
  isLocalDatabase: mocks.isLocalDatabase,
}));
vi.mock("../db/index.js", () => ({
  getDb: () => ({ select: mocks.select }),
}));

import { resolveConnectorSecret } from "./credentials.js";

const HOSTED_RUNTIME_ENV_KEYS = [
  "NETLIFY",
  "NETLIFY_LOCAL",
  "SITE_ID",
  "VERCEL",
  "CF_PAGES",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_EXECUTION_ENV",
  "FUNCTIONS_WORKER_RUNTIME",
  "K_SERVICE",
  "RENDER",
  "FLY_APP_NAME",
  "AGENT_NATIVE_WORKSPACE",
  "VITE_AGENT_NATIVE_WORKSPACE",
  "AGENT_NATIVE_WORKSPACE_APPS_JSON",
  "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
  "FUSION_ENVIRONMENT",
  "FUSION_ENV_ORIGIN",
  "VITE_FUSION_ENV_ORIGIN",
] as const;

function stubCleanLocalRuntimeEnv() {
  for (const key of HOSTED_RUNTIME_ENV_KEYS) {
    vi.stubEnv(key, "");
  }
}

describe("resolveConnectorSecret", () => {
  const userEmail = "owner@example.com";

  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    stubCleanLocalRuntimeEnv();
    mocks.readAppSecret.mockResolvedValue(null);
    mocks.resolveCredential.mockResolvedValue(undefined);
    mocks.resolveWorkspaceConnectionCredentialForApp.mockResolvedValue({
      available: false,
      value: undefined,
    });
    mocks.resolveOrgIdForEmail.mockResolvedValue("active-org");
    mocks.isLocalDatabase.mockReturnValue(false);
    mocks.select.mockReturnValue({
      from: () => ({
        where: async () => [{ orgId: "active-org" }],
      }),
    });
  });

  it("prefers the designated Dispatch vault over a deployment fallback", async () => {
    vi.stubEnv("AGENT_VAULT_ORG_ID", "dispatch-org");
    vi.stubEnv("FACTORY_TEST_CONNECTOR_KEY", "deployment-value");
    mocks.readAppSecret.mockImplementation(async ({ scope, scopeId }) =>
      scope === "workspace" && scopeId === "dispatch-org"
        ? { value: "dispatch-value" }
        : null,
    );

    await expect(
      resolveConnectorSecret("FACTORY_TEST_CONNECTOR_KEY", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBe("dispatch-value");
  });

  it("uses the deployment fallback only when shared scopes miss", async () => {
    vi.stubEnv("FACTORY_TEST_CONNECTOR_KEY", " deployment-value ");

    await expect(
      resolveConnectorSecret("FACTORY_TEST_CONNECTOR_KEY", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBe("deployment-value");
  });

  it("prefers an app-granted provider connection for known source keys", async () => {
    mocks.isLocalDatabase.mockReturnValue(true);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-local-token");
    mocks.resolveWorkspaceConnectionCredentialForApp.mockResolvedValue({
      available: true,
      value: "connected-slack-token",
    });

    await expect(
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBe("connected-slack-token");
    expect(
      mocks.resolveWorkspaceConnectionCredentialForApp,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: "factory",
        provider: "slack",
        key: "SLACK_BOT_TOKEN",
        userEmail,
        orgId: "active-org",
      }),
    );
    expect(mocks.readAppSecret).not.toHaveBeenCalled();
  });

  it("does not use deployment env fallbacks for standard provider keys", async () => {
    vi.stubEnv("SENTRY_AUTH_TOKEN", "deployment-sentry-token");

    await expect(
      resolveConnectorSecret("SENTRY_AUTH_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBeUndefined();
  });

  it("reads provider keys from env on a local sqlite database", async () => {
    mocks.isLocalDatabase.mockReturnValue(true);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SLACK_BOT_TOKEN", " xoxb-local-token ");

    await expect(
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBe("xoxb-local-token");
  });

  it("does not use provider env on production even with a file database", async () => {
    mocks.isLocalDatabase.mockReturnValue(true);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-production-file-db");

    await expect(
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not use provider env on Netlify even with a file database", async () => {
    mocks.isLocalDatabase.mockReturnValue(true);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-netlify-file-db");

    await expect(
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not use provider env on hosted workspace even with a file database", async () => {
    mocks.isLocalDatabase.mockReturnValue(true);
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-hosted-file-db");

    await expect(
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not use provider env on Fly even with a file database", async () => {
    mocks.isLocalDatabase.mockReturnValue(true);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FLY_APP_NAME", "factory-prod");
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-fly-file-db");

    await expect(
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not use provider env on Netlify SITE_ID even with a file database", async () => {
    mocks.isLocalDatabase.mockReturnValue(true);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SITE_ID", "00000000-0000-0000-0000-000000000000");
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-netlify-runtime-file-db");

    await expect(
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBeUndefined();
  });

  it("reads provider keys from env under netlify dev with SITE_ID", async () => {
    mocks.isLocalDatabase.mockReturnValue(true);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SITE_ID", "00000000-0000-0000-0000-000000000000");
    vi.stubEnv("NETLIFY_LOCAL", "true");
    vi.stubEnv("SLACK_BOT_TOKEN", " xoxb-netlify-dev-token ");

    await expect(
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBe("xoxb-netlify-dev-token");
  });
});
