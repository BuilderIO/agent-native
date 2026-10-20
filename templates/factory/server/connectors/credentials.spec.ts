import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppSecret: vi.fn(),
  resolveCredential: vi.fn(),
  resolveWorkspaceConnectionCredentialForApp: vi.fn(),
  resolveOrgIdForEmail: vi.fn(),
  select: vi.fn(),
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
vi.mock("../db/index.js", () => ({
  getDb: () => ({ select: mocks.select }),
}));

import {
  createRunObserver,
  withRunObserver,
} from "../lib/workflow-run-observer.js";
import { sanitizeDetails } from "../tripwire/redact.js";
import { createCapturingTripwireSink } from "../tripwire/testing.js";
import type { TripwireInput, TripwireSink } from "../tripwire/types.js";
import {
  VaultUnavailableError,
  hasConnectorSecret,
  resolveConnectorSecret,
  resolveFactoryConnectorReadiness,
} from "./credentials.js";

const HOSTED_RUNTIME_ENV_KEYS = [
  "NETLIFY",
  "NETLIFY_LOCAL",
  "NETLIFY_DEV",
  "CONTEXT",
  "SITE_ID",
  "VERCEL",
  "CF_PAGES",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_EXECUTION_ENV",
  "FUNCTIONS_WORKER_RUNTIME",
  "K_SERVICE",
  "RENDER",
  "FLY_APP_NAME",
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_SERVICE_ID",
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
    delete process.env[key];
    vi.stubEnv(key, "");
  }
  for (const key of [
    "SLACK_BOT_TOKEN",
    "SLACK_BOT_TOKEN_2",
    "GITHUB_TOKEN",
    "GITHUB_APP_ID",
    "GITHUB_APP_INSTALLATION_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "SENTRY_AUTH_TOKEN",
    "SENTRY_SERVER_TOKEN",
  ]) {
    delete process.env[key];
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

  it("does not use provider env on production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-production-token");

    await expect(
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not use provider env on Netlify", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-netlify-token");

    await expect(
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not use provider env on hosted workspace", async () => {
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-hosted-token");

    await expect(
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not use provider env on Fly", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FLY_APP_NAME", "factory-prod");
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-fly-token");

    await expect(
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not use provider env on Netlify SITE_ID", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SITE_ID", "00000000-0000-0000-0000-000000000000");
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-netlify-runtime-token");

    await expect(
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBeUndefined();
  });

  it("reads provider keys from env under netlify dev with SITE_ID", async () => {
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

  it("reads provider keys from env when Netlify CLI sets NETLIFY_DEV", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SITE_ID", "00000000-0000-0000-0000-000000000000");
    vi.stubEnv("NETLIFY_DEV", "true");
    vi.stubEnv("SLACK_BOT_TOKEN", " xoxb-netlify-cli-token ");

    await expect(
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBe("xoxb-netlify-cli-token");
  });

  it("reads provider keys from env when Netlify CONTEXT is dev", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SITE_ID", "00000000-0000-0000-0000-000000000000");
    vi.stubEnv("CONTEXT", "dev");
    vi.stubEnv("SLACK_BOT_TOKEN", " xoxb-netlify-context-dev-token ");

    await expect(
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBe("xoxb-netlify-context-dev-token");
  });

  it("does not use provider env on Railway", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "railway-env-1");
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-railway-token");

    await expect(
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not use a sibling org vault token for the requested org", async () => {
    mocks.select.mockReturnValue({
      from: () => ({
        where: async () => [{ orgId: "active-org" }, { orgId: "other-org" }],
      }),
    });
    mocks.readAppSecret.mockImplementation(async ({ key, scope, scopeId }) =>
      key === "SLACK_BOT_TOKEN" && scope === "org" && scopeId === "other-org"
        ? { value: "xoxb-other-org" }
        : null,
    );

    await expect(
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBeUndefined();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("does not use provider env when NODE_ENV is unset in local development", async () => {
    vi.stubEnv("NODE_ENV", "");
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-unset-node-env");

    await expect(
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("resolveFactoryConnectorReadiness", () => {
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
    mocks.select.mockReturnValue({
      from: () => ({
        where: async () => [{ orgId: "active-org" }],
      }),
    });
  });

  it("does not record workspace usage when resolving readiness", async () => {
    mocks.resolveWorkspaceConnectionCredentialForApp.mockResolvedValue({
      available: true,
      value: "xoxb-connected",
    });

    await resolveFactoryConnectorReadiness(userEmail, { orgId: "active-org" });
    expect(
      mocks.resolveWorkspaceConnectionCredentialForApp,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        recordUsage: false,
      }),
    );
  });

  it("treats a granted workspace connection as ready", async () => {
    mocks.resolveWorkspaceConnectionCredentialForApp.mockImplementation(
      async ({ provider, key }) =>
        provider === "slack" && key === "SLACK_BOT_TOKEN"
          ? { available: true, value: "xoxb-connected" }
          : { available: false, value: undefined },
    );

    await expect(
      resolveFactoryConnectorReadiness(userEmail, { orgId: "active-org" }),
    ).resolves.toEqual({
      slack: true,
      slackSecondary: false,
      github: false,
      sentry: false,
    });
  });

  it("treats a complete GitHub App configuration as ready", async () => {
    const appKeys = new Set([
      "GITHUB_APP_ID",
      "GITHUB_APP_INSTALLATION_ID",
      "GITHUB_APP_PRIVATE_KEY",
    ]);
    mocks.readAppSecret.mockImplementation(async ({ key, scope, scopeId }) =>
      appKeys.has(key) && scope === "org" && scopeId === "active-org"
        ? { value: "configured" }
        : null,
    );

    await expect(
      resolveFactoryConnectorReadiness(userEmail, { orgId: "active-org" }),
    ).resolves.toMatchObject({ github: true });
  });

  it("does not treat a partial GitHub App configuration as ready", async () => {
    mocks.readAppSecret.mockImplementation(async ({ key, scope, scopeId }) =>
      key === "GITHUB_APP_ID" && scope === "org" && scopeId === "active-org"
        ? { value: "configured" }
        : null,
    );

    await expect(
      resolveFactoryConnectorReadiness(userEmail, { orgId: "active-org" }),
    ).resolves.toMatchObject({ github: false });
  });

  it("falls back to the org vault when no workspace connection exists", async () => {
    mocks.readAppSecret.mockImplementation(async ({ key, scope, scopeId }) =>
      key === "SLACK_BOT_TOKEN" && scope === "org" && scopeId === "active-org"
        ? { value: "xoxb-vault" }
        : null,
    );

    await expect(
      hasConnectorSecret("SLACK_BOT_TOKEN", userEmail, { orgId: "active-org" }),
    ).resolves.toBe(true);
    await expect(
      resolveFactoryConnectorReadiness(userEmail, { orgId: "active-org" }),
    ).resolves.toEqual({
      slack: true,
      slackSecondary: false,
      github: false,
      sentry: false,
    });
  });

  it("does not treat a primary Slack token as secondary readiness", async () => {
    mocks.readAppSecret.mockImplementation(async ({ key, scope, scopeId }) =>
      key === "SLACK_BOT_TOKEN" && scope === "org" && scopeId === "active-org"
        ? { value: "xoxb-vault" }
        : null,
    );

    await expect(
      resolveFactoryConnectorReadiness(userEmail, { orgId: "active-org" }),
    ).resolves.toEqual({
      slack: true,
      slackSecondary: false,
      github: false,
      sentry: false,
    });
  });

  it("does not treat hosted deployment env as ready", async () => {
    vi.stubEnv("SITE_ID", "netlify-site");
    vi.stubEnv("SLACK_BOT_TOKEN", "xoxb-hosted-token");
    vi.stubEnv("GITHUB_TOKEN", "ghp-hosted-token");

    await expect(
      resolveFactoryConnectorReadiness(userEmail, { orgId: "active-org" }),
    ).resolves.toEqual({
      slack: false,
      slackSecondary: false,
      github: false,
      sentry: false,
    });
  });

  it("does not coerce a vault outage into disconnected", async () => {
    mocks.readAppSecret.mockRejectedValue(new Error("vault timeout"));

    await expect(
      hasConnectorSecret("SLACK_BOT_TOKEN", userEmail, { orgId: "active-org" }),
    ).rejects.toBeInstanceOf(VaultUnavailableError);
  });
});

describe("credential_source_used tripwire", () => {
  const userEmail = "owner@example.com";
  const SLACK_SECRET = "xoxb-FAKE-0000-aaaaaaaaaaaa";
  const GITHUB_SECRET = "ghp_FAKE0000aaaaaaaaaaaa";

  // A note lands only inside a run's observer, so a call made with no run open
  // is the same call with no sink at all.
  function inRun<T>(sink: TripwireSink, work: () => Promise<T>): Promise<T> {
    return withRunObserver(createRunObserver(sink), work);
  }

  function stored(event: TripwireInput) {
    return { ...event, details: sanitizeDetails(event.details).fields };
  }

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
    mocks.select.mockReturnValue({
      from: () => ({
        where: async () => [{ orgId: "active-org" }],
      }),
    });
  });

  it("records a workspace-connection use, and never the value", async () => {
    mocks.resolveWorkspaceConnectionCredentialForApp.mockResolvedValue({
      available: true,
      value: SLACK_SECRET,
    });
    const { sink, events } = createCapturingTripwireSink();

    const observed = await inRun(sink, () =>
      resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      }),
    );
    const unobserved = await resolveConnectorSecret(
      "SLACK_BOT_TOKEN",
      userEmail,
      { orgId: "active-org" },
    );

    expect(unobserved).toBe(observed);
    expect(observed).toBe(SLACK_SECRET);
    expect(JSON.stringify(events[0])).not.toContain(SLACK_SECRET);
  });

  it.each([
    ["the organization the run is for", "active-org"],
    ["the designated vault organization", "designated-vault-org"],
  ])(
    "records a vault use found in %s and never an id or the stored value",
    async (_where, foundIn) => {
      vi.stubEnv("AGENT_VAULT_ORG_ID", "designated-vault-org");
      mocks.readAppSecret.mockImplementation(async ({ key, scope, scopeId }) =>
        key === "SLACK_BOT_TOKEN" && scope === "org" && scopeId === foundIn
          ? { value: SLACK_SECRET }
          : null,
      );
      const { sink, events } = createCapturingTripwireSink();

      await expect(
        inRun(sink, () =>
          resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
            orgId: "active-org",
          }),
        ),
      ).resolves.toBe(SLACK_SECRET);

      const text = JSON.stringify(stored(events[0]));
      expect(text).not.toContain(SLACK_SECRET);
      expect(text).not.toContain("designated-vault-org");
      expect(text).not.toContain("active-org");
    },
  );

  it("records an env use only in local development, and never the value", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SLACK_BOT_TOKEN", SLACK_SECRET);
    const { sink, events } = createCapturingTripwireSink();

    await expect(
      inRun(sink, () =>
        resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
          orgId: "active-org",
        }),
      ),
    ).resolves.toBe(SLACK_SECRET);

    expect(JSON.stringify(stored(events[0]))).not.toContain(SLACK_SECRET);
  });

  it("records one event per provider in a run, and a second provider its own", async () => {
    mocks.resolveWorkspaceConnectionCredentialForApp.mockImplementation(
      async ({ provider }) => ({
        available: true,
        value: provider === "slack" ? SLACK_SECRET : GITHUB_SECRET,
      }),
    );
    const { sink, events } = createCapturingTripwireSink();

    await inRun(sink, async () => {
      await resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      });
      await resolveConnectorSecret("SLACK_BOT_TOKEN", userEmail, {
        orgId: "active-org",
      });
      await resolveConnectorSecret("GITHUB_TOKEN", userEmail, {
        orgId: "active-org",
      });
    });

    expect(events).toHaveLength(2);
    expect(events.map((event) => stored(event).details)).toMatchObject([
      { provider: "slack", source: "workspace-connection" },
      { provider: "github", source: "workspace-connection" },
    ]);
    expect(JSON.stringify(events.map(stored))).not.toContain(SLACK_SECRET);
    expect(JSON.stringify(events.map(stored))).not.toContain(GITHUB_SECRET);
  });

  it("a readiness check", async () => {
    mocks.resolveWorkspaceConnectionCredentialForApp.mockResolvedValue({
      available: true,
      value: SLACK_SECRET,
    });
    const { sink } = createCapturingTripwireSink();

    await expect(
      inRun(sink, () =>
        resolveFactoryConnectorReadiness(userEmail, { orgId: "active-org" }),
      ),
    ).resolves.toMatchObject({ slack: true });
  });
});
