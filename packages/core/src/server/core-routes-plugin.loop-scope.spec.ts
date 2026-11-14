import { H3, type H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrgContext: vi.fn(),
  canUpdate: vi.fn(async () => true),
  read: vi.fn(async () => ({ maxIterations: 400 })),
  write: vi.fn(async () => ({ maxIterations: 12 })),
}));
vi.mock("./auth.js", async (original) => ({
  ...(await original<typeof import("./auth.js")>()),
  getSession: async () => ({
    email: "member@example.test",
    orgId: "stale-org",
  }),
}));
vi.mock("../org/context.js", async (original) => ({
  ...(await original<typeof import("../org/context.js")>()),
  getOrgContext: mocks.getOrgContext,
}));
vi.mock("../agent/loop-settings.js", async (original) => ({
  ...(await original<typeof import("../agent/loop-settings.js")>()),
  canUpdateAgentLoopSettings: mocks.canUpdate,
  readAgentLoopSettings: mocks.read,
  writeAgentLoopSettings: mocks.write,
}));
vi.mock("../deploy/route-discovery.js", async (original) => ({
  ...(await original<typeof import("../deploy/route-discovery.js")>()),
  getMissingDefaultPlugins: vi.fn(async () => []),
}));

import { createCoreRoutesPlugin } from "./core-routes-plugin.js";
import { sessionResolutionFailure } from "./session-resolution-errors.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("AWS_LAMBDA_FUNCTION_NAME", "fake-loop-scope-test");
  mocks.getOrgContext.mockReset().mockResolvedValue({ orgId: "verified-org" });
});
afterEach(() => vi.unstubAllEnvs());

async function request() {
  const middleware: Array<
    (event: H3Event, next: () => Promise<unknown>) => unknown
  > = [];
  const plugin = createCoreRoutesPlugin({
    disableHealth: true,
    disableAppState: true,
    disableEmbedRoute: true,
    disablePing: true,
  });
  await plugin({ h3: { "~middleware": middleware } } as Parameters<
    typeof plugin
  >[0]);
  const app = new H3();
  app.use((event: H3Event) => {
    let index = 0;
    const next = async (): Promise<unknown> => {
      const handler = middleware[index++];
      return handler ? handler(event, next) : undefined;
    };
    return next();
  });
  return app.fetch(
    new Request("https://app.example.test/_agent-native/agent-loop-settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Native-CSRF": "1",
      },
      body: JSON.stringify({ maxIterations: 12 }),
    }),
  );
}

describe("agent-loop settings verified org scope", () => {
  it.each(["57014", "42501"])(
    "stops before reading or writing settings on org failure %s",
    async (code) => {
      const cause = Object.assign(new Error("Fake membership failure"), {
        code,
      });
      mocks.getOrgContext.mockRejectedValue(sessionResolutionFailure(cause));
      const response = await request();
      expect(response.status).toBe(code === "57014" ? 503 : 500);
      expect(response.headers.get("Retry-After")).toBe(
        code === "57014" ? "5" : null,
      );
      expect(mocks.canUpdate).not.toHaveBeenCalled();
      expect(mocks.read).not.toHaveBeenCalled();
      expect(mocks.write).not.toHaveBeenCalled();
      expect(await response.text()).not.toContain(cause.message);
    },
  );

  it.each(["verified-org", null])(
    "writes only in the verified scope %s",
    async (orgId) => {
      mocks.getOrgContext.mockResolvedValue({ orgId });
      const response = await request();
      expect(response.status).toBe(200);
      expect(mocks.write).toHaveBeenCalledWith(
        { userEmail: "member@example.test", orgId },
        12,
      );
    },
  );
});
