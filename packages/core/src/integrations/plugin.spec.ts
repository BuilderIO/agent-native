import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlatformAdapter } from "./types.js";
import { createIntegrationsPlugin } from "./plugin.js";

const getSessionMock = vi.hoisted(() => vi.fn());
const saveIntegrationConfigMock = vi.hoisted(() => vi.fn());

vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: vi.fn(async () => []),
}));

vi.mock("../server/auth.js", () => ({
  getSession: getSessionMock,
}));

vi.mock("./config-store.js", () => ({
  getIntegrationConfig: vi.fn(async () => ({ configData: { enabled: false } })),
  saveIntegrationConfig: saveIntegrationConfigMock,
}));

vi.mock("./pending-tasks-retry-job.js", () => ({
  startPendingTasksRetryJob: vi.fn(),
}));

vi.mock("./google-docs-poller.js", () => ({
  startGoogleDocsPoller: vi.fn(),
  handlePushNotification: vi.fn(),
}));

vi.mock("../resources/store.js", () => ({
  SHARED_OWNER: "shared",
  resourceGetByPath: vi.fn(async () => null),
}));

function createNitroApp() {
  return { h3: { "~middleware": [] as any[] } };
}

async function dispatch(nitroApp: any, pathname: string, method = "GET") {
  const event = {
    method,
    url: new URL(`https://app.test${pathname}`),
    path: pathname,
    context: {},
    node: {
      req: {
        method,
        url: pathname,
        headers: {
          host: "app.test",
          "x-forwarded-proto": "https",
        },
      },
      res: {
        statusCode: 200,
        setHeader() {},
      },
    },
  };
  let index = 0;
  const next = async (): Promise<unknown> => {
    const middleware = nitroApp.h3["~middleware"][index++];
    if (!middleware) return { fellThrough: true };
    return middleware(event, next);
  };
  const body = await next();
  return { body, status: event.node.res.statusCode };
}

const adapter: PlatformAdapter = {
  platform: "fake",
  label: "Fake",
  getRequiredEnvKeys: () => [],
  handleVerification: async () => ({ handled: false }),
  verifyWebhook: async () => true,
  parseIncomingMessage: async () => null,
  sendResponse: async () => {},
  formatAgentResponse: (text: string) => ({ text, platformContext: {} }),
  getStatus: async () => ({
    platform: "fake",
    label: "Fake",
    enabled: false,
    configured: true,
  }),
};

describe("integrations plugin routes", () => {
  afterEach(() => {
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
    vi.clearAllMocks();
  });

  it("requires a session for integration status", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [adapter] })(nitroApp);

    const result = await dispatch(nitroApp, "/_agent-native/integrations/status");

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "unauthorized" });
  });

  it("advertises webhook URLs under APP_BASE_PATH", async () => {
    process.env.APP_BASE_PATH = "/docs";
    getSessionMock.mockResolvedValueOnce({
      email: "alice+qa@agent-native.test",
    });
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [adapter] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/docs/_agent-native/integrations/status",
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual([
      expect.objectContaining({
        platform: "fake",
        webhookUrl: "https://app.test/docs/_agent-native/integrations/fake/webhook",
      }),
    ]);
  });

  it("requires a session before mutating integration config", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [adapter] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/fake/enable",
      "POST",
    );

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ error: "unauthorized" });
    expect(saveIntegrationConfigMock).not.toHaveBeenCalled();
  });
});
