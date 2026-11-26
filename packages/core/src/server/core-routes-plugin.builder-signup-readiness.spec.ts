import { createApp, defineEventHandler } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMissingDefaultPlugins: vi.fn(async () => [] as string[]),
  settings: new Map<string, Record<string, unknown>>(),
  track: vi.fn(),
}));

vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: mocks.getMissingDefaultPlugins,
}));

vi.mock("./better-auth-instance.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./better-auth-instance.js")>()),
  getAuthSecret: () => "test-only-core-routes-readiness-secret",
  getBetterAuthInternalAdapter: async () => ({
    findUserByEmail: async () => ({
      user: { id: "new-user", createdAt: new Date() },
    }),
  }),
}));

vi.mock("../settings/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../settings/store.js")>()),
  getSetting: async (key: string) => mocks.settings.get(key) ?? null,
  putSetting: async (key: string, value: Record<string, unknown>) => {
    mocks.settings.set(key, value);
  },
  mutateSetting: async (
    key: string,
    update: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown>,
  ) => {
    const next = update(mocks.settings.get(key) ?? null);
    mocks.settings.set(key, next);
    return next;
  },
}));

vi.mock("../tracking/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tracking/index.js")>()),
  track: mocks.track,
  flushTracking: vi.fn(async () => []),
}));

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import { startBuilderSignupForVerifiedSession } from "./builder-signup-experiment.js";
import { createCoreRoutesPlugin } from "./core-routes-plugin.js";
import {
  BUILDER_SIGNUP_EXPERIMENT_PATH,
  markFrameworkRoutesReadyBeforeBootstrap,
} from "./framework-request-handler.js";

describe("createCoreRoutesPlugin Builder signup cold-start readiness", () => {
  beforeEach(() => {
    mocks.settings.clear();
    mocks.track.mockReset();
    mocks.getMissingDefaultPlugins.mockReset();
    resetAppConfigForTests();
    defineAppConfig({
      app: { id: "agent-native-crm", slug: "crm" },
      onboarding: {
        builderSignupHostedHosts: ["crm.agent-native.com"],
        builderSignupAutomaticPercent: 100,
        builderSignupExperimentId: "crm_builder_signup_v1",
      },
    });
  });

  afterEach(() => {
    resetAppConfigForTests();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete (globalThis as Record<string, unknown>)
      .__AGENT_NATIVE_SERVER_RUNTIME__;
  });

  async function flushEventLoop() {
    for (let i = 0; i < 20; i += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  it("holds a cold-start signup request until the route is mounted instead of answering 404", async () => {
    let releaseBootstrap!: () => void;
    const bootstrapGate = new Promise<void>((resolve) => {
      releaseBootstrap = resolve;
    });
    mocks.getMissingDefaultPlugins.mockImplementationOnce(async () => {
      await bootstrapGate;
      return [];
    });

    const h3 = createApp();
    const nitroApp = { h3 };
    markFrameworkRoutesReadyBeforeBootstrap(nitroApp, ["/_agent-native/auth"]);
    const plugin = createCoreRoutesPlugin();
    const pluginDone = plugin(nitroApp);

    h3.use(
      "/_test/start-verified",
      defineEventHandler(async (event) => {
        await startBuilderSignupForVerifiedSession(event, {
          email: "qa@example.invalid",
          userId: "new-user",
          token: "session-token",
          emailVerified: true,
        });
        return { ok: true };
      }),
    );

    let assignedSettled = false;
    const assignedPromise = h3
      .fetch(
        new Request(
          `https://crm.agent-native.com${BUILDER_SIGNUP_EXPERIMENT_PATH}`,
          { headers: { host: "crm.agent-native.com" } },
        ),
      )
      .finally(() => {
        assignedSettled = true;
      });
    let startedSettled = false;
    const startedPromise = h3
      .fetch(
        new Request("https://crm.agent-native.com/_test/start-verified", {
          headers: { host: "crm.agent-native.com" },
        }),
      )
      .finally(() => {
        startedSettled = true;
      });

    await flushEventLoop();
    expect(assignedSettled).toBe(false);
    expect(startedSettled).toBe(false);

    releaseBootstrap();
    await pluginDone;

    const assigned = await assignedPromise;
    expect(assigned.status).toBe(200);
    expect(assigned.headers.get("cache-control")).toBe("no-store");
    expect(await assigned.json()).toMatchObject({
      status: "assigned",
      variant: "automatic",
      experimentId: "crm_builder_signup_v1",
    });

    const started = await startedPromise;
    expect(started.status).toBe(200);
    expect(await started.json()).toEqual({ ok: true });

    const unlisted = await h3.fetch(
      new Request(
        `https://unlisted.example.com${BUILDER_SIGNUP_EXPERIMENT_PATH}`,
        { headers: { host: "unlisted.example.com" } },
      ),
    );
    expect(unlisted.status).toBe(200);
    expect(await unlisted.json()).toEqual({ status: "disabled" });

    const crossOrigin = await h3.fetch(
      new Request(
        `https://crm.agent-native.com${BUILDER_SIGNUP_EXPERIMENT_PATH}`,
        {
          method: "POST",
          headers: {
            host: "crm.agent-native.com",
            "content-type": "application/json",
            "sec-fetch-site": "cross-site",
          },
          body: JSON.stringify({ operation: "status" }),
        },
      ),
    );
    expect(crossOrigin.status).toBe(403);
  });
});
