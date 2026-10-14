import { afterEach, describe, expect, it, vi } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import { markServerRuntimeStarted } from "../db/server-runtime.js";
import {
  getMissingAuthSecretKey,
  getMissingDeploySettings,
  getSignInBlockingSettingKeys,
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
    "AWS_SAM_LOCAL",
    "VERCEL_FUNCTION_ID",
    "VERCEL_REGION",
    "VERCEL_ENV",
    "VERCEL",
    "NETLIFY",
    "CF_PAGES",
    "RENDER",
    "FLY_APP_NAME",
    "K_SERVICE",
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

// A started production server build: `node .output/server/index.mjs`, which
// runs without NODE_ENV.
function stubProductionServer() {
  vi.stubEnv("AGENT_NATIVE_BUILD_PRODUCTION_SERVER", "true");
  markServerRuntimeStarted();
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetAppConfigForTests();
  delete (globalThis as Record<string, unknown>)
    .__AGENT_NATIVE_SERVER_RUNTIME__;
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
    stubProductionServer();
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
    stubProductionServer();
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("BETTER_AUTH_SECRET", "explicit-secret");

    expect(getMissingDeploySettings()).toMatchObject({
      authSecretKey: null,
      a2aSecretMissing: true,
    });
  });

  // A marker proves a real deploy; NODE_ENV=test must not make it local.
  it.each([
    ["a Lambda function", { AWS_LAMBDA_FUNCTION_NAME: "server" }],
    ["a Netlify function", { NETLIFY_FUNCTION_NAME: "server" }],
  ])(
    "asks %s for its auth secret with NODE_ENV test",
    (_case, env: Record<string, string>) => {
      stubUnconfiguredDeploy();
      vi.stubEnv("NODE_ENV", "test");
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);

      expect(getMissingDeploySettings()).toMatchObject({
        authSecretKey: "BETTER_AUTH_SECRET",
        a2aSecretMissing: false,
      });
    },
  );

  it("asks a production server build for its auth secret with NODE_ENV test", () => {
    stubUnconfiguredDeploy();
    stubProductionServer();
    vi.stubEnv("NODE_ENV", "test");

    expect(getMissingDeploySettings().authSecretKey).toBe("BETTER_AUTH_SECRET");
  });

  it("asks a workspace Lambda for A2A_SECRET with NODE_ENV test", () => {
    stubUnconfiguredDeploy();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "server");
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");

    expect(getMissingDeploySettings()).toMatchObject({
      authSecretKey: "A2A_SECRET",
      a2aSecretMissing: true,
    });
  });

  it("names nothing under netlify dev, which sets the function marker", () => {
    stubUnconfiguredDeploy();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NETLIFY_FUNCTION_NAME", "server");
    vi.stubEnv("NETLIFY_LOCAL", "true");
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");

    expect(getMissingDeploySettings()).toEqual({
      databaseSource: null,
      authSecretKey: null,
      a2aSecretMissing: false,
    });
  });

  it("asks a workspace Netlify function for A2A_SECRET with NODE_ENV unset", () => {
    stubUnconfiguredDeploy();
    vi.stubEnv("NETLIFY_FUNCTION_NAME", "server");
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("BETTER_AUTH_SECRET", "explicit-secret");

    expect(getMissingDeploySettings().a2aSecretMissing).toBe(true);
  });

  it("names no database or A2A_SECRET under netlify serve of the production build", () => {
    stubUnconfiguredDeploy();
    stubProductionServer();
    vi.stubEnv("NETLIFY_LOCAL", "true");
    vi.stubEnv("NETLIFY_FUNCTION_NAME", "server");
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("BETTER_AUTH_SECRET", "explicit-secret");

    expect(getMissingDeploySettings()).toEqual({
      databaseSource: null,
      authSecretKey: null,
      a2aSecretMissing: false,
    });
  });

  it("names nothing under sam local, which sets the Lambda marker", () => {
    stubUnconfiguredDeploy();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AWS_SAM_LOCAL", "true");
    vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "server");
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");

    expect(getMissingDeploySettings()).toEqual({
      databaseSource: null,
      authSecretKey: null,
      a2aSecretMissing: false,
    });
  });

  it.each([
    ["unset", ""],
    ["test", "test"],
  ])(
    "reports the database the refusal rejects with NODE_ENV %s",
    (_label, nodeEnv) => {
      stubUnconfiguredDeploy();
      vi.stubEnv("NODE_ENV", nodeEnv);
      vi.stubEnv("NETLIFY_FUNCTION_NAME", "server");

      expect(getMissingDeploySettings().databaseSource).toBe("default");
    },
  );
});

describe("getSignInBlockingSettingKeys", () => {
  const POSTGRES_URL = "postgres://app:placeholder@db.example.com/app";

  it("names the database and auth secret for a bare standalone server", () => {
    stubUnconfiguredDeploy();
    stubProductionServer();

    expect(getSignInBlockingSettingKeys()).toEqual([
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
    ]);
  });

  it("asks a bare workspace server for A2A_SECRET alone, not both secrets", () => {
    stubUnconfiguredDeploy();
    stubProductionServer();
    vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");

    expect(getSignInBlockingSettingKeys()).toEqual([
      "DATABASE_URL",
      "A2A_SECRET",
    ]);
  });

  it("names the app-prefixed key that resolved to local PGlite", () => {
    stubUnconfiguredDeploy();
    stubProductionServer();
    vi.stubEnv("APP_NAME", "chat");
    vi.stubEnv("CHAT_DATABASE_URL", "pglite:./data/pglite");
    vi.stubEnv("DATABASE_URL", POSTGRES_URL);
    vi.stubEnv("BETTER_AUTH_SECRET", "explicit-secret");

    expect(getSignInBlockingSettingKeys()).toEqual(["CHAT_DATABASE_URL"]);
  });

  it.each([
    ["only BETTER_AUTH_SECRET", { BETTER_AUTH_SECRET: "explicit-secret" }],
    ["only A2A_SECRET", { A2A_SECRET: "workspace-root-secret" }],
  ])(
    "lets a workspace with a database and %s sign in",
    (_case, env: Record<string, string>) => {
      stubUnconfiguredDeploy();
      stubProductionServer();
      vi.stubEnv("AGENT_NATIVE_WORKSPACE", "1");
      vi.stubEnv("DATABASE_URL", POSTGRES_URL);
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);

      expect(getSignInBlockingSettingKeys()).toEqual([]);
    },
  );

  it("names nothing under local development", () => {
    stubUnconfiguredDeploy();
    vi.stubEnv("NODE_ENV", "development");

    expect(getSignInBlockingSettingKeys()).toEqual([]);
  });
});

// resolveAuthSecret() and the setup page must share one decision: the page
// names a missing auth secret exactly when Better Auth refuses to start.
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
    [
      "a Lambda function with NODE_ENV test",
      { NODE_ENV: "test", AWS_LAMBDA_FUNCTION_NAME: "server" },
    ],
    [
      "netlify dev with NODE_ENV development",
      {
        NODE_ENV: "development",
        NETLIFY_FUNCTION_NAME: "server",
        NETLIFY_LOCAL: "true",
      },
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
