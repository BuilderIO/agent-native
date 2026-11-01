import { createApp } from "h3";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getSession: vi.fn(),
  getUserSetting: vi.fn(),
  validate: vi.fn(),
  init: [] as Promise<void>[],
  hooks: new Map<string, Array<() => void | Promise<void>>>(),
}));

vi.mock("./framework-request-handler.js", async (original) => ({
  ...(await original<typeof import("./framework-request-handler.js")>()),
  awaitBootstrap: () => Promise.resolve(),
  getH3App: (nitro: { h3App: ReturnType<typeof createApp> }) => nitro.h3App,
  markDefaultPluginProvided: vi.fn(),
  trackPluginInit: (_nitro: unknown, promise: Promise<void>): void => {
    mocks.init.push(promise);
  },
}));
vi.mock("../db/client.js", async (original) => ({
  ...(await original<typeof import("../db/client.js")>()),
  getDbExec: () => ({ execute: mocks.execute }),
}));
vi.mock("./auth.js", async (original) => ({
  ...(await original<typeof import("./auth.js")>()),
  getSession: mocks.getSession,
}));
vi.mock("../settings/user-settings.js", async (original) => ({
  ...(await original<typeof import("../settings/user-settings.js")>()),
  getUserSetting: mocks.getUserSetting,
}));
vi.mock("../org/federation.js", async (original) => ({
  ...(await original<typeof import("../org/federation.js")>()),
  validateFederatedOrganizationMembership: mocks.validate,
}));
vi.mock("../agent/run-store.js", async (original) => ({
  ...(await original<typeof import("../agent/run-store.js")>()),
  listUnclaimedBackgroundRunRows: vi.fn(async () => []),
  reapAllStaleRuns: vi.fn(async () => ({
    scanned: 0,
    reaped: 0,
    failed: 0,
    truncated: false,
  })),
}));
vi.mock("../mcp-client/index.js", async (original) => ({
  ...(await original<typeof import("../mcp-client/index.js")>()),
  buildMergedConfig: vi.fn(async () => null),
  startMcpConfigRefresh: () => () => {},
}));
vi.mock("../jobs/scheduler.js", () => ({
  processRecurringJobs: vi.fn(async () => {}),
}));
vi.mock("../triggers/dispatcher.js", () => ({
  initTriggerDispatcher: vi.fn(async () => {}),
}));
vi.mock("../chat-threads/migrations.js", () => ({
  runChatThreadDataMigrations: vi.fn(async () => {}),
}));
vi.mock("./social-og-image.js", () => ({
  createAgentNativeOgImageHandler: () => () => new Response(),
}));

import { resetAppConfigForTests } from "../app-config/index.js";
import { getOrgContext } from "../org/context.js";
import { __resetProcessMemberOrgCacheForTests } from "../org/request-org-cache.js";
import { createAgentChatPlugin } from "./agent-chat-plugin.js";
import { verifyAgentChatStreamToken } from "./agent-chat-stream.js";

const app = createApp();
beforeAll(async () => {
  vi.stubEnv("APP_URL", "https://example.test");
  vi.stubEnv("BETTER_AUTH_SECRET", "agent-chat-stream-test-secret-0123456789");
  createAgentChatPlugin({
    actions: () => ({}),
    a2aAgentDelegation: false,
    frameworkTools: "minimal",
    leanPrompt: true,
    mcp: { enabled: false },
    resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  })({
    h3App: app,
    hooks: {
      hook(name: string, callback: () => void | Promise<void>) {
        mocks.hooks.set(name, [...(mocks.hooks.get(name) ?? []), callback]);
      },
    },
  });
  await mocks.init.at(-1);
});
afterAll(async () => {
  for (const callback of mocks.hooks.get("close") ?? []) await callback();
  vi.unstubAllEnvs();
  resetAppConfigForTests();
});
beforeEach(() => {
  vi.clearAllMocks();
  __resetProcessMemberOrgCacheForTests();
  vi.stubEnv("ORG_CREATION", "closed");
  vi.stubEnv("AUTO_CREATE_DEFAULT_ORG", "0");
  resetAppConfigForTests();
  mocks.getSession.mockResolvedValue({ email: "fresh@example.test" });
  mocks.getUserSetting.mockResolvedValue(null);
  mocks.execute.mockResolvedValue({ rows: [] });
});

async function tokenRequest() {
  return app.fetch(
    new Request("http://example.test/_agent-native/agent-chat/stream-token"),
  );
}

it("does not mint a stream token for a caller without required membership", async () => {
  const response = await tokenRequest();
  const body = await response.json();
  expect(response.status).toBe(403);
  expect(body.token).toBeUndefined();
});

it("does not mint a stream token for a revoked selected federation even when another membership remains", async () => {
  mocks.getUserSetting.mockResolvedValue({ orgId: "f" });
  mocks.execute.mockImplementation(async ({ sql }: { sql: string }) => {
    if (sql.includes("FROM org_members m"))
      return {
        rows: [
          {
            orgId: "f",
            orgName: "Federated",
            role: "owner",
            identityAuthority: "https://identity.example.test",
            identityId: "f",
          },
          { orgId: "a", orgName: "A", role: "member" },
        ],
      };
    if (sql.includes("FROM org_members") && sql.includes("SELECT org_id"))
      return { rows: [{ org_id: "a" }] };
    return { rows: [] };
  });
  mocks.validate.mockResolvedValue({ active: false });
  const response = await tokenRequest();
  const body = await response.json();
  expect(mocks.validate).toHaveBeenCalled();
  expect(response.status).toBe(403);
  expect(body.token).toBeUndefined();
});

it("mints an explicit personal token even with another membership", async () => {
  mocks.getUserSetting.mockResolvedValue({ orgId: null });
  mocks.execute.mockImplementation(async ({ sql }: { sql: string }) => {
    if (sql.includes("FROM org_members m"))
      return { rows: [{ orgId: "a", orgName: "A", role: "member" }] };
    if (sql.includes("FROM org_members") && sql.includes("SELECT org_id"))
      return { rows: [{ org_id: "a" }] };
    return { rows: [] };
  });
  const response = await tokenRequest();
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(await verifyAgentChatStreamToken(body.token)).toEqual({
    ownerEmail: "fresh@example.test",
    orgId: null,
    orgScope: "personal",
  });
});

it("does not mint a stream token when membership resolution is unavailable", async () => {
  mocks.execute.mockImplementation(async ({ sql }: { sql: string }) => {
    if (sql.includes("FROM org_members m"))
      throw new Error("membership unavailable");
    if (sql.includes("FROM org_members") && sql.includes("SELECT org_id"))
      return { rows: [{ org_id: "a" }] };
    return { rows: [] };
  });
  const response = await tokenRequest();
  expect(response.status).toBe(503);
  expect((await response.json()).token).toBeUndefined();
});
