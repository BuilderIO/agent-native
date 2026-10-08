import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: {
    app: {} as Record<string, string | undefined>,
    workspace: {} as Record<string, unknown>,
  },
  fingerprint: {
    configured: true,
    source: "DATABASE_URL",
    protocol: "postgresql",
    host: "ep-quiet-sun-a1b2c3.us-east-2.aws.neon.tech",
  } as Record<string, unknown>,
  local: false,
  env: new Map<string, string>(),
  capabilities: [] as Array<{
    id: string;
    service?: string;
    required: boolean;
    suggested?: boolean;
  }>,
}));

vi.mock("../app-config/index.js", () => ({
  getAppConfig: () => mocks.config,
}));

vi.mock("../db/runtime-diagnostics.js", () => ({
  getDatabaseRuntimeFingerprint: () => mocks.fingerprint,
}));

vi.mock("../db/client.js", () => ({
  isLocalDatabase: () => mocks.local,
}));

vi.mock("./credential-provider.js", () => ({
  readDeployCredentialEnv: (key: string) => mocks.env.get(key),
}));

vi.mock("../onboarding/app-profile.js", () => ({
  getOnboardingAppProfile: () => ({
    appId: "clips",
    appName: "Clips",
    capabilities: mocks.capabilities,
  }),
}));

const { databaseProviderForHost, getInfrastructureStatus, parseWorkspaceApps } =
  await import("./infrastructure-status.js");
const { resolveDeployPlatform } = await import("./deploy-environment.js");

const WORKSPACE_APPS = JSON.stringify({
  apps: [
    { id: "dispatch", name: "Dispatch", path: "/dispatch" },
    {
      id: "clips",
      name: "Clips",
      path: "/clips",
      url: "https://clips.example.com",
    },
    { id: "", name: "No id" },
  ],
});

beforeEach(() => {
  mocks.config.app = { name: "clips" };
  mocks.config.workspace = {};
  mocks.fingerprint = {
    configured: true,
    source: "DATABASE_URL",
    protocol: "postgresql",
    host: "ep-quiet-sun-a1b2c3.us-east-2.aws.neon.tech",
  };
  mocks.local = false;
  mocks.env.clear();
  mocks.capabilities = [
    { id: "llm", service: "model", required: true },
    {
      id: "video-storage",
      service: "storage",
      required: true,
      suggested: false,
    },
    { id: "voice-input", service: "voice", required: false, suggested: true },
    { id: "image-generation", service: "images", required: false },
    {
      id: "embeddings",
      service: "embeddings",
      required: false,
      suggested: true,
    },
    // Only the service id tags a row; an app's own capability never does.
    { id: "media-generation", required: true },
  ];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("databaseProviderForHost", () => {
  it("names the provider from the host", () => {
    expect(databaseProviderForHost("ep-x.us-east-2.aws.neon.tech")).toBe(
      "neon",
    );
    expect(databaseProviderForHost("db.abc.supabase.co")).toBe("supabase");
    expect(databaseProviderForHost("aws-0-us-east-1.pooler.supabase.com")).toBe(
      "supabase",
    );
    expect(databaseProviderForHost("prod.x.us-east-1.rds.amazonaws.com")).toBe(
      "aws-rds",
    );
    expect(databaseProviderForHost("10.0.0.5")).toBe("postgres");
    expect(databaseProviderForHost(undefined)).toBe("postgres");
  });
});

describe("parseWorkspaceApps", () => {
  it("reads each app's name, address, and mount path", () => {
    expect(parseWorkspaceApps(WORKSPACE_APPS)).toEqual([
      { id: "dispatch", name: "Dispatch", url: null, path: "/dispatch" },
      {
        id: "clips",
        name: "Clips",
        url: "https://clips.example.com",
        path: "/clips",
      },
    ]);
  });

  it("accepts a bare array", () => {
    expect(parseWorkspaceApps('[{"id":"mail"}]')).toEqual([
      { id: "mail", name: "mail", url: null, path: "/mail" },
    ]);
  });

  it("throws on a manifest it can't read instead of returning no apps", () => {
    expect(() => parseWorkspaceApps("{not json")).toThrow(
      "Invalid workspace app manifest",
    );
    expect(() => parseWorkspaceApps('{"apps": 3}')).toThrow(
      "Invalid workspace app manifest",
    );
  });
});

describe("getInfrastructureStatus", () => {
  it("reports the database host, never the URL", () => {
    const status = getInfrastructureStatus();
    expect(status.database).toEqual({
      configured: true,
      local: false,
      provider: "neon",
      host: "ep-quiet-sun-a1b2c3.us-east-2.aws.neon.tech",
      sourceKey: "DATABASE_URL",
      appDatabaseKey: "CLIPS_DATABASE_URL",
    });
    expect(JSON.stringify(status)).not.toContain("postgres://");
  });

  it("reports a local PGlite database without a host", () => {
    mocks.local = true;
    mocks.fingerprint = {
      configured: true,
      source: "DATABASE_URL",
      protocol: "pglite",
      database: "./data/app",
    };
    const status = getInfrastructureStatus();
    expect(status.database.provider).toBe("pglite");
    expect(status.database.local).toBe(true);
    expect(status.database.host).toBeNull();
    const databaseUrl = status.variables.find(
      (variable) => variable.key === "DATABASE_URL",
    );
    expect(databaseUrl?.set).toBe(false);
  });

  it("in a workspace, requires A2A_SECRET and lists every app", () => {
    mocks.config.workspace = {
      isWorkspace: true,
      appsJson: WORKSPACE_APPS,
      gatewayUrl: "https://apps.example.com",
    };
    mocks.env.set("A2A_SECRET", "a".repeat(64));
    const status = getInfrastructureStatus();
    expect(status.workspace).toBe(true);
    expect(status.hosting.apps.map((app) => app.id)).toEqual([
      "dispatch",
      "clips",
    ]);
    expect(status.hosting.gatewayUrl).toBe("https://apps.example.com");
    expect(status.variables).toEqual([
      { key: "DATABASE_URL", required: true, set: true },
      { key: "A2A_SECRET", required: true, set: true },
      { key: "BETTER_AUTH_SECRET", required: false, set: false },
      { key: "APP_URL", required: false, set: false },
      { key: "SECRETS_ENCRYPTION_KEY", required: false, set: false },
    ]);
  });

  it("outside a workspace, requires BETTER_AUTH_SECRET and flags a short one", () => {
    mocks.config.app = { name: "clips", url: "https://clips.example.com" };
    mocks.env.set("BETTER_AUTH_SECRET", "too-short");
    mocks.env.set("CLIPS_SECRETS_ENCRYPTION_KEY", "b".repeat(40));
    const status = getInfrastructureStatus();
    expect(status.workspace).toBe(false);
    expect(status.hosting.apps).toEqual([
      {
        id: "clips",
        name: "Clips",
        url: "https://clips.example.com",
        path: null,
      },
    ]);
    const byKey = Object.fromEntries(
      status.variables.map((variable) => [variable.key, variable]),
    );
    expect(byKey.A2A_SECRET).toEqual({
      key: "A2A_SECRET",
      required: false,
      set: false,
    });
    expect(byKey.BETTER_AUTH_SECRET).toEqual({
      key: "BETTER_AUTH_SECRET",
      required: true,
      set: true,
      weak: true,
    });
    expect(byKey.APP_URL?.set).toBe(true);
    expect(byKey.SECRETS_ENCRYPTION_KEY?.set).toBe(true);
  });

  it("tags services from the app profile", () => {
    expect(getInfrastructureStatus().setupTags).toEqual({
      model: "required",
      storage: "required",
      voice: "recommended",
      images: null,
      embeddings: "recommended",
    });
  });
});

describe("resolveDeployPlatform", () => {
  it("reads each host's marker", () => {
    vi.stubEnv("NETLIFY", "true");
    expect(resolveDeployPlatform()).toBe("netlify");
    vi.unstubAllEnvs();
    vi.stubEnv("VERCEL", "1");
    expect(resolveDeployPlatform()).toBe("vercel");
  });

  it("tells a self-run production server from a dev server", () => {
    for (const key of [
      "NETLIFY",
      "NETLIFY_CONTEXT",
      "VERCEL",
      "VERCEL_ENV",
      "CF_PAGES",
      "CF_PAGES_URL",
      "RENDER",
      "RENDER_SERVICE_ID",
      "FLY_APP_NAME",
      "K_SERVICE",
      "AWS_LAMBDA_FUNCTION_NAME",
    ]) {
      vi.stubEnv(key, "");
    }
    vi.stubEnv("NODE_ENV", "production");
    expect(resolveDeployPlatform()).toBe("node");
    vi.stubEnv("NODE_ENV", "development");
    expect(resolveDeployPlatform()).toBe("local");
  });
});
