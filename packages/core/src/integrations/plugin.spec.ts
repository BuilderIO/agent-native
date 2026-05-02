import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlatformAdapter } from "./types.js";
import { createIntegrationsPlugin } from "./plugin.js";

const getSessionMock = vi.hoisted(() => vi.fn());
const saveIntegrationConfigMock = vi.hoisted(() => vi.fn());
const processIntegrationTaskMock = vi.hoisted(() => vi.fn());
const resourceGetByPathMock = vi.hoisted(() => vi.fn(async () => null));
const claimPendingTaskMock = vi.hoisted(() => vi.fn());
const markTaskCompletedMock = vi.hoisted(() => vi.fn());
const markTaskFailedMock = vi.hoisted(() => vi.fn());

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
  resourceGetByPath: resourceGetByPathMock,
}));

vi.mock("./pending-tasks-store.js", () => ({
  claimPendingTask: claimPendingTaskMock,
  getPendingTask: vi.fn(),
  insertPendingTask: vi.fn(),
  isDuplicateEventError: vi.fn(() => false),
  markTaskCompleted: markTaskCompletedMock,
  markTaskFailed: markTaskFailedMock,
}));

vi.mock("./webhook-handler.js", async () => {
  const actual = await vi.importActual<typeof import("./webhook-handler.js")>(
    "./webhook-handler.js",
  );
  return {
    ...actual,
    processIntegrationTask: processIntegrationTaskMock,
  };
});

function createNitroApp() {
  return { h3: { "~middleware": [] as any[] } };
}

async function dispatch(
  nitroApp: any,
  pathname: string,
  method = "GET",
  body?: unknown,
) {
  const url = `https://app.test${pathname}`;
  const requestBody = body === undefined ? undefined : JSON.stringify(body);
  const event = {
    method,
    url: new URL(url),
    path: pathname,
    context: {},
    req: new Request(url, {
      method,
      body: requestBody,
      headers: {
        host: "app.test",
        "x-forwarded-proto": "https",
        ...(requestBody ? { "content-type": "application/json" } : {}),
      },
    }),
    res: {
      status: 200,
      headers: new Headers(),
    },
    node: {
      req: {
        method,
        url: pathname,
        headers: {
          host: "app.test",
          "x-forwarded-proto": "https",
          ...(requestBody ? { "content-type": "application/json" } : {}),
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
  const responseBody = await next();
  return { body: responseBody, status: event.res.status };
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
  const originalNodeEnv = process.env.NODE_ENV;
  const originalA2ASecret = process.env.A2A_SECRET;

  afterEach(() => {
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
    process.env.NODE_ENV = originalNodeEnv;
    if (originalA2ASecret === undefined) {
      delete process.env.A2A_SECRET;
    } else {
      process.env.A2A_SECRET = originalA2ASecret;
    }
    vi.clearAllMocks();
    resourceGetByPathMock.mockImplementation(async () => null);
  });

  it("requires a session for integration status", async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [adapter] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/status",
    );

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
        webhookUrl:
          "https://app.test/docs/_agent-native/integrations/fake/webhook",
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

  it("answers platform verification challenges before requiring enablement", async () => {
    const challengeAdapter: PlatformAdapter = {
      ...adapter,
      handleVerification: async () => ({
        handled: true,
        response: { challenge: "qa-challenge" },
      }),
    };
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [challengeAdapter] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/fake/webhook",
      "POST",
      { type: "url_verification" },
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ challenge: "qa-challenge" });
  });

  it("refuses unsigned task processing in production when A2A_SECRET is missing", async () => {
    delete process.env.A2A_SECRET;
    process.env.NODE_ENV = "production";
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [adapter] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/process-task",
      "POST",
      { taskId: "task-prod-auth" },
    );

    expect(result.status).toBe(503);
    expect(result.body).toEqual({
      error:
        "A2A_SECRET not configured — internal token signing is required to process integration tasks in production.",
    });
  });

  it("loads owner resources when processing queued integration tasks", async () => {
    process.env.NODE_ENV = "development";
    claimPendingTaskMock.mockResolvedValueOnce({
      id: "task-with-resources",
      platform: "fake",
      externalThreadId: "fake-thread",
      payload: JSON.stringify({
        incoming: {
          platform: "fake",
          externalThreadId: "fake-thread",
          text: "create an app",
          senderId: "UQA",
          platformContext: {},
          timestamp: Date.now(),
        },
      }),
      ownerEmail: "owner+qa@example.com",
      orgId: null,
      status: "processing",
      attempts: 1,
      errorMessage: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null,
    });
    resourceGetByPathMock.mockImplementation(async (owner, path) => {
      if (owner === "shared" && path === "AGENTS.md") {
        return { content: "Shared Dispatch instruction" };
      }
      if (owner === "owner+qa@example.com" && path === "AGENTS.md") {
        return { content: "Personal Dispatch instruction" };
      }
      return null;
    });
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({
      adapters: [adapter],
      systemPrompt: "Base prompt.",
    })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/process-task",
      "POST",
      { taskId: "task-with-resources" },
    );

    expect(result.status).toBe(200);
    expect(processIntegrationTaskMock).toHaveBeenCalledTimes(1);
    const [, options] = processIntegrationTaskMock.mock.calls[0];
    expect(options.systemPrompt).toContain("Base prompt.");
    expect(options.systemPrompt).toContain("Shared Dispatch instruction");
    expect(options.systemPrompt).toContain("Personal Dispatch instruction");
    expect(markTaskCompletedMock).toHaveBeenCalledWith("task-with-resources");
  });
});
