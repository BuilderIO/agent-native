import { afterEach, describe, expect, it, vi } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import {
  getMissingAuthSecretKey,
  getMissingDeploySettings,
} from "./deploy-settings.js";

// Cleared explicitly so ambient deploy markers, deploy contexts, and secrets
// in the shell or a leaked stub cannot decide the answer.
function stubUnconfiguredDeploy() {
  for (const key of [
    "APP_NAME",
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "NETLIFY_DATABASE_URL",
    "NETLIFY_DATABASE_URL_UNPOOLED",
    "NETLIFY_FUNCTION_NAME",
    "NETLIFY_LOCAL",
    "AWS_LAMBDA_FUNCTION_NAME",
    "LAMBDA_TASK_ROOT",
    "AWS_EXECUTION_ENV",
    "VERCEL_FUNCTION_ID",
    "VERCEL_REGION",
    "VERCEL_ENV",
    "CONTEXT",
    "NETLIFY_CONTEXT",
    "BRANCH",
    "SENTRY_ENVIRONMENT",
    "AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT",
    "AGENT_NATIVE_BUILD_PRODUCTION_SERVER",
    "AGENT_NATIVE_WORKSPACE",
    "VITE_AGENT_NATIVE_WORKSPACE",
    "BETTER_AUTH_SECRET",
    "A2A_SECRET",
  ]) {
    vi.stubEnv(key, "");
  }
  // resolveDeployEnvironment() treats an unset NODE_ENV with no deploy
  // context as production, the way a bare `node .output/server/index.mjs` is.
  vi.stubEnv("NODE_ENV", "");
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});

describe("getMissingDeploySettings", () => {
  it("names BETTER_AUTH_SECRET for a deployed standalone app without one", () => {
    stubUnconfiguredDeploy();

    expect(getMissingDeploySettings()).toMatchObject({
      authSecretKey: "BETTER_AUTH_SECRET",
      a2aSecretMissing: false,
    });
  });

  it("names no secret under local development", () => {
    stubUnconfiguredDeploy();
    vi.stubEnv("NODE_ENV", "development");

    expect(getMissingDeploySettings()).toEqual({
      databaseSource: null,
      authSecretKey: null,
      a2aSecretMissing: false,
    });
  });

  it("asks a deployed workspace for A2A_SECRET, which also derives the auth secret", () => {
    stubUnconfiguredDeploy();
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");

    expect(getMissingDeploySettings()).toMatchObject({
      authSecretKey: "A2A_SECRET",
      a2aSecretMissing: true,
    });
  });

  it("does not ask a workspace for BETTER_AUTH_SECRET once A2A_SECRET is set", () => {
    stubUnconfiguredDeploy();
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("A2A_SECRET", "workspace-root-secret");

    expect(getMissingDeploySettings()).toMatchObject({
      authSecretKey: null,
      a2aSecretMissing: false,
    });
  });

  it("still asks a workspace for A2A_SECRET when only BETTER_AUTH_SECRET is set", () => {
    stubUnconfiguredDeploy();
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("BETTER_AUTH_SECRET", "explicit-secret");

    expect(getMissingDeploySettings()).toMatchObject({
      authSecretKey: null,
      a2aSecretMissing: true,
    });
  });

  it("names nothing for a test runner, even with a host marker leaked into the worker", () => {
    stubUnconfiguredDeploy();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NETLIFY_FUNCTION_NAME", "leaked-from-another-spec");

    expect(getMissingDeploySettings()).toEqual({
      databaseSource: null,
      authSecretKey: null,
      a2aSecretMissing: false,
    });
  });

  it("reports the database the refusal rejects", () => {
    stubUnconfiguredDeploy();
    vi.stubEnv("NETLIFY_FUNCTION_NAME", "server");

    expect(getMissingDeploySettings().databaseSource).toBe("default");
  });
});

// resolveAuthSecret() and the banner must share one decision: the banner
// shows a missing auth secret exactly when Better Auth refuses to start.
describe("getMissingAuthSecretKey agrees with resolveAuthSecret()", () => {
  it.each([
    ["a standalone deploy without a secret", {}],
    ["a standalone deploy with a secret", { BETTER_AUTH_SECRET: "explicit" }],
    ["a workspace deploy without A2A_SECRET", { AGENT_NATIVE_WORKSPACE: "1" }],
    [
      "a workspace deploy with A2A_SECRET",
      { AGENT_NATIVE_WORKSPACE: "1", A2A_SECRET: "workspace-root-secret" },
    ],
    [
      "a preview deploy without a secret",
      { AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT: "preview" },
    ],
  ])("for %s", async (_case, env: Record<string, string>) => {
    stubUnconfiguredDeploy();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const { getAuthSecret } = await import("./better-auth-instance.js");

    let refused = false;
    try {
      getAuthSecret();
    } catch {
      refused = true;
    }

    expect(getMissingAuthSecretKey() !== null).toBe(refused);
  });
});
