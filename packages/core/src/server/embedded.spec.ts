import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  awaitBootstrap: vi.fn(),
  createAuthPlugin: vi.fn(),
  createCoreRoutesPlugin: vi.fn(),
  markDefaultPluginProvided: vi.fn(),
  trackPluginInit: vi.fn(),
}));

vi.mock("./auth-plugin.js", () => ({
  createAuthPlugin: mocks.createAuthPlugin,
}));

vi.mock("./core-routes-plugin.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./core-routes-plugin.js")>();
  return {
    ...actual,
    createCoreRoutesPlugin: mocks.createCoreRoutesPlugin,
  };
});

vi.mock("./framework-request-handler.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./framework-request-handler.js")>();
  return {
    ...actual,
    awaitBootstrap: mocks.awaitBootstrap,
    markDefaultPluginProvided: mocks.markDefaultPluginProvided,
    trackPluginInit: mocks.trackPluginInit,
  };
});

import {
  configureAgentNativeEmbeddedEnvironment,
  createAgentNativeEmbeddedAuthOptions,
  mountAgentNativeEmbedded,
  normalizeAgentNativeEmbeddedSession,
} from "./embedded.js";

const ORIGINAL_ENV = {
  APP_NAME: process.env.APP_NAME,
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("embedded Agent-Native helpers", () => {
  afterEach(() => {
    vi.clearAllMocks();
    restoreEnv();
  });

  it("mounts auth and core liveness before host bootstrap", async () => {
    const events: string[] = [];
    mocks.createAuthPlugin.mockImplementation(() => () => events.push("auth"));
    mocks.createCoreRoutesPlugin.mockImplementation(
      () => () => events.push("core-routes"),
    );
    mocks.awaitBootstrap.mockImplementation(() => {
      events.push("bootstrap");
    });

    await mountAgentNativeEmbedded(
      {},
      {
        auth: async () => null,
        resources: false,
        sentry: false,
        org: false,
        coreRoutes: {},
        onboarding: false,
        integrations: false,
        terminal: false,
        agentChat: false,
      },
    );

    expect(events).toEqual(["auth", "core-routes", "bootstrap"]);
  });

  it("does not await default auth before mounting embedded liveness", async () => {
    const events: string[] = [];
    let releaseAuth!: () => void;
    mocks.createAuthPlugin.mockImplementation(
      () => () =>
        new Promise<void>((resolve) => {
          releaseAuth = resolve;
        }),
    );
    mocks.createCoreRoutesPlugin.mockImplementation(
      () => () => events.push("core-routes"),
    );
    mocks.awaitBootstrap.mockImplementation(() => {
      events.push("bootstrap");
    });

    const mounting = mountAgentNativeEmbedded(
      {},
      {
        resources: false,
        sentry: false,
        org: false,
        coreRoutes: {},
        onboarding: false,
        integrations: false,
        terminal: false,
        agentChat: false,
      },
    );

    await expect(
      Promise.race([
        mounting.then(() => true),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), 100),
        ),
      ]),
    ).resolves.toBe(true);
    expect(events).toEqual(["core-routes", "bootstrap"]);

    releaseAuth();
    await mounting;
  });

  it("normalizes host-auth sessions into framework auth sessions", () => {
    expect(
      normalizeAgentNativeEmbeddedSession({
        email: "ada@example.com",
        userId: "user-1",
        name: "Ada",
        organizationId: "org-1",
        role: "admin",
      }),
    ).toEqual({
      email: "ada@example.com",
      userId: "user-1",
      token: undefined,
      name: "Ada",
      orgId: "org-1",
      orgRole: "admin",
    });
  });

  it("uses userId as the owner key when the host has no email", () => {
    expect(
      normalizeAgentNativeEmbeddedSession({
        email: "",
        userId: "builder-user-1",
        orgId: "org-1",
      }),
    ).toMatchObject({
      email: "builder-user-1",
      userId: "builder-user-1",
      orgId: "org-1",
    });
  });

  it("builds host-auth options that disable standalone Google OAuth", async () => {
    const auth = createAgentNativeEmbeddedAuthOptions(async () => ({
      email: "grace@example.com",
      organizationId: "org-2",
    }));

    await expect(auth?.getSession?.({} as never)).resolves.toMatchObject({
      email: "grace@example.com",
      orgId: "org-2",
    });
    expect(auth?.mountGoogleOAuthRoutes).toBe(false);
  });

  it("applies explicit embedded database environment", () => {
    configureAgentNativeEmbeddedEnvironment({
      appName: "builder",
      databaseUrl: "postgres://example/db",
      databaseAuthToken: "secret",
    });

    expect(process.env.APP_NAME).toBe("builder");
    expect(process.env.DATABASE_URL).toBe("postgres://example/db");
    expect(process.env.DATABASE_AUTH_TOKEN).toBe("secret");
  });
});
