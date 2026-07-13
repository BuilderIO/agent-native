import { afterEach, describe, expect, it, vi } from "vitest";

import { IntegrationIdentityDeclinedError } from "./identity.js";
import { createIntegrationsPlugin } from "./plugin.js";
import type { PlatformAdapter } from "./types.js";

const getSessionMock = vi.hoisted(() => vi.fn());
const getOrgContextMock = vi.hoisted(() =>
  vi.fn(async () => ({ orgId: "org-qa", role: "owner" })),
);
const resolveOrgIdForEmailMock = vi.hoisted(() =>
  vi.fn(async () => "org-owner"),
);
const runWithRequestContextMock = vi.hoisted(() =>
  vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
);
const getIntegrationConfigMock = vi.hoisted(() =>
  vi.fn(async () => ({ configData: { enabled: false } })),
);
const saveIntegrationConfigMock = vi.hoisted(() => vi.fn());
const processIntegrationTaskMock = vi.hoisted(() => vi.fn());
const handleWebhookMock = vi.hoisted(() =>
  vi.fn(async () => ({ status: 200, body: "ok" })),
);
const resourceGetByPathMock = vi.hoisted(() => vi.fn(async () => null));
const resourceListMock = vi.hoisted(() => vi.fn(async () => []));
const resourceListAccessibleMock = vi.hoisted(() => vi.fn(async () => []));
const resourceGetMock = vi.hoisted(() => vi.fn(async () => null));
const claimPendingTaskMock = vi.hoisted(() => vi.fn());
const markTaskCompletedMock = vi.hoisted(() => vi.fn());
const markTaskFailedMock = vi.hoisted(() => vi.fn());
const markTaskRetryableMock = vi.hoisted(() => vi.fn());
const insertPendingTaskMock = vi.hoisted(() => vi.fn());

vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: vi.fn(async () => []),
}));

vi.mock("../server/auth.js", () => ({
  getSession: getSessionMock,
}));

vi.mock("../org/context.js", () => ({
  getOrgContext: getOrgContextMock,
  resolveOrgIdForEmail: resolveOrgIdForEmailMock,
}));

vi.mock("../server/request-context.js", () => ({
  runWithRequestContext: runWithRequestContextMock,
}));

vi.mock("./config-store.js", () => ({
  getIntegrationConfig: getIntegrationConfigMock,
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
  WORKSPACE_OWNER: "workspace",
  organizationIdFromResourceOwner: () => null,
  sharedResourceOwner: (orgId?: string | null) =>
    orgId ? `organization:${orgId}` : "shared",
  ensurePersonalDefaults: vi.fn(async () => {}),
  resourceGet: resourceGetMock,
  resourceGetByPath: resourceGetByPathMock,
  resourceList: resourceListMock,
  resourceListAccessible: resourceListAccessibleMock,
}));

vi.mock("./pending-tasks-store.js", () => ({
  MAX_PENDING_TASK_ATTEMPTS: 3,
  claimPendingTask: claimPendingTaskMock,
  getPendingTask: vi.fn(),
  getNextPendingTaskIdForThread: vi.fn(async () => null),
  insertPendingTask: insertPendingTaskMock,
  isDuplicateEventError: vi.fn(() => false),
  markTaskCompleted: markTaskCompletedMock,
  markTaskFailed: markTaskFailedMock,
  markTaskRetryable: markTaskRetryableMock,
}));

vi.mock("./webhook-handler.js", async () => {
  const actual = await vi.importActual<typeof import("./webhook-handler.js")>(
    "./webhook-handler.js",
  );
  return {
    ...actual,
    handleWebhook: handleWebhookMock,
    processIntegrationTask: processIntegrationTaskMock,
  };
});

// Default mirrors the real non-Slack service path so existing webhook tests
// keep their behavior; individual tests override with mockRejectedValueOnce.
const resolveDefaultExecutionContextMock = vi.hoisted(() =>
  vi.fn(async (incoming: { platform: string }) => ({
    ownerEmail: `integration@${incoming.platform}`,
    orgId: null,
    principalType: "service" as const,
  })),
);

vi.mock("./identity.js", async () => {
  const actual =
    await vi.importActual<typeof import("./identity.js")>("./identity.js");
  return {
    ...actual,
    resolveDefaultIntegrationExecutionContext:
      resolveDefaultExecutionContextMock,
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

function claimedTask(attempts: number) {
  return {
    id: `task-attempt-${attempts}`,
    platform: "fake",
    externalThreadId: "fake-thread",
    payload: JSON.stringify({
      incoming: {
        platform: "fake",
        externalThreadId: "fake-thread",
        text: "retry this message",
        platformContext: {},
        timestamp: Date.now(),
      },
    }),
    ownerEmail: "owner+qa@example.com",
    orgId: null,
    status: "processing",
    attempts,
    errorMessage: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: null,
  };
}

describe("integrations plugin routes", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalA2ASecret = process.env.A2A_SECRET;

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
    process.env.NODE_ENV = originalNodeEnv;
    if (originalA2ASecret === undefined) {
      delete process.env.A2A_SECRET;
    } else {
      process.env.A2A_SECRET = originalA2ASecret;
    }
    vi.clearAllMocks();
    getIntegrationConfigMock.mockImplementation(async () => ({
      configData: { enabled: false },
      owner: null,
    }));
    getOrgContextMock.mockResolvedValue({ orgId: "org-qa", role: "owner" });
    resolveOrgIdForEmailMock.mockResolvedValue("org-owner");
    runWithRequestContextMock.mockImplementation(
      (_ctx: unknown, fn: () => unknown) => fn(),
    );
    handleWebhookMock.mockResolvedValue({ status: 200, body: "ok" });
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

  it("serves a deployment-qualified Slack Agent View manifest", async () => {
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [adapter] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/slack/manifest",
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      display_information: { name: "Agent Native" },
      features: {
        app_home: {
          messages_tab_enabled: true,
          messages_tab_read_only_enabled: false,
        },
        agent_view: {
          agent_description: expect.any(String),
        },
      },
      oauth_config: {
        redirect_urls: [
          "https://app.test/_agent-native/integrations/slack/oauth/callback",
        ],
      },
      settings: {
        event_subscriptions: {
          request_url:
            "https://app.test/_agent-native/integrations/slack/webhook",
          bot_events: expect.arrayContaining([
            "app_home_opened",
            "app_context_changed",
            "message.im",
          ]),
        },
        interactivity: {
          request_url:
            "https://app.test/_agent-native/integrations/slack/interactions",
        },
      },
    });
  });

  it("runs integration status checks in the signed-in request context", async () => {
    getSessionMock.mockResolvedValue({
      email: "alice+qa@agent-native.test",
    });
    getOrgContextMock.mockResolvedValue({ orgId: "org-team", role: "admin" });
    const getStatus = vi.fn(async () => ({
      platform: "fake",
      label: "Fake",
      enabled: false,
      configured: true,
    }));
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({
      adapters: [{ ...adapter, getStatus }],
    })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/fake/status",
    );

    expect(result.status).toBe(200);
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(runWithRequestContextMock).toHaveBeenCalledWith(
      {
        userEmail: "alice+qa@agent-native.test",
        orgId: "org-team",
      },
      expect.any(Function),
    );
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

  it("loads compact owner resources when processing queued integration tasks", async () => {
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
      orgId: "org-qa",
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
      if (owner === "organization:org-qa" && path === "AGENTS.md") {
        return { content: "Builder organization instruction" };
      }
      if (owner === "owner+qa@example.com" && path === "AGENTS.md") {
        return { content: "Personal Dispatch instruction" };
      }
      if (owner === "owner+qa@example.com" && path === "memory/MEMORY.md") {
        return { content: "Personal Dispatch memory" };
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
    expect(options.systemPrompt).toContain(
      "Organization learnings above and your personal memory (memory/MEMORY.md) are available via the `resources` tool",
    );
    expect(options.systemPrompt).toContain("Builder organization instruction");
    expect(options.systemPrompt).not.toContain("Personal Dispatch memory");
    expect(resourceGetByPathMock).not.toHaveBeenCalledWith(
      "owner+qa@example.com",
      "memory/MEMORY.md",
    );
    expect(markTaskCompletedMock).toHaveBeenCalledWith("task-with-resources");
    expect(runWithRequestContextMock).toHaveBeenCalledWith(
      {
        userEmail: "owner+qa@example.com",
        orgId: "org-qa",
        isIntegrationCaller: true,
      },
      expect.any(Function),
    );
  });

  it("delivers persisted system notices from the fresh task processor", async () => {
    process.env.NODE_ENV = "development";
    const sendSystemNotice = vi.fn(async () => {});
    const noticeAdapter: PlatformAdapter = {
      ...adapter,
      platform: "slack",
      label: "Slack",
      sendSystemNotice,
    };
    const incoming = {
      platform: "slack",
      externalThreadId: "A1:T1:D1:4.4",
      text: "",
      senderId: "U1",
      tenantId: "T1",
      conversationType: "dm",
      platformContext: { teamId: "T1", channelId: "D1" },
      timestamp: Date.now(),
    };
    claimPendingTaskMock.mockResolvedValueOnce({
      id: "notice-task",
      platform: "slack",
      externalThreadId: incoming.externalThreadId,
      payload: JSON.stringify({
        kind: "system-notice",
        incoming,
        text: "Please reconnect Slack.",
        dedupeKey: "decline:T1:U1:unverified",
        dedupeTtlMs: 300_000,
      }),
      ownerEmail: "integration@slack",
      orgId: null,
      status: "processing",
      attempts: 1,
      errorMessage: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null,
    });
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [noticeAdapter] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/process-task",
      "POST",
      { taskId: "notice-task" },
    );

    expect(result.status).toBe(200);
    expect(sendSystemNotice).toHaveBeenCalledWith(
      expect.objectContaining({ externalThreadId: incoming.externalThreadId }),
      "Please reconnect Slack.",
      {
        dedupeKey: "decline:T1:U1:unverified",
        dedupeTtlMs: 300_000,
      },
    );
    expect(processIntegrationTaskMock).not.toHaveBeenCalled();
    expect(markTaskCompletedMock).toHaveBeenCalledWith("notice-task");
  });

  it("retries persisted system notices when delivery fails", async () => {
    process.env.NODE_ENV = "development";
    const sendSystemNotice = vi.fn(async () => {
      throw new Error("Slack bot token not configured for system notice");
    });
    const noticeAdapter: PlatformAdapter = {
      ...adapter,
      platform: "slack",
      label: "Slack",
      sendSystemNotice,
    };
    const incoming = {
      platform: "slack",
      externalThreadId: "A1:T1:D1:5.5",
      text: "",
      senderId: "U1",
      tenantId: "T1",
      conversationType: "dm",
      platformContext: { teamId: "T1", channelId: "D1" },
      timestamp: Date.now(),
    };
    claimPendingTaskMock.mockResolvedValueOnce({
      id: "notice-task-retry",
      platform: "slack",
      externalThreadId: "system-notice:notice-task-retry",
      payload: JSON.stringify({
        kind: "system-notice",
        incoming,
        text: "Please reconnect Slack.",
      }),
      ownerEmail: "integration@slack",
      orgId: null,
      status: "processing",
      attempts: 1,
      errorMessage: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null,
    });
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [noticeAdapter] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/process-task",
      "POST",
      { taskId: "notice-task-retry" },
    );

    expect(result.status).toBe(500);
    expect(sendSystemNotice).toHaveBeenCalledTimes(1);
    expect(markTaskRetryableMock).toHaveBeenCalledWith(
      "notice-task-retry",
      "Slack bot token not configured for system notice",
    );
    expect(markTaskCompletedMock).not.toHaveBeenCalled();
  });

  it("reschedules transient processor failures without terminally scrubbing the task", async () => {
    process.env.NODE_ENV = "development";
    claimPendingTaskMock.mockResolvedValueOnce(claimedTask(1));
    processIntegrationTaskMock.mockRejectedValueOnce(
      new Error("temporary downstream outage"),
    );
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [adapter] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/process-task",
      "POST",
      { taskId: "task-attempt-1" },
    );

    expect(result.status).toBe(500);
    expect(markTaskRetryableMock).toHaveBeenCalledWith(
      "task-attempt-1",
      "temporary downstream outage",
    );
    expect(markTaskFailedMock).not.toHaveBeenCalled();
  });

  it("terminally fails a processor task only after its retry budget is exhausted", async () => {
    process.env.NODE_ENV = "development";
    claimPendingTaskMock.mockResolvedValueOnce(claimedTask(3));
    processIntegrationTaskMock.mockRejectedValueOnce(
      new Error("permanent after retries"),
    );
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({ adapters: [adapter] })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/process-task",
      "POST",
      { taskId: "task-attempt-3" },
    );

    expect(result.status).toBe(500);
    expect(markTaskFailedMock).toHaveBeenCalledWith(
      "task-attempt-3",
      "permanent after retries",
    );
    expect(markTaskRetryableMock).not.toHaveBeenCalled();
  });

  it("defers scoped resource loading until after webhook acknowledgement", async () => {
    getIntegrationConfigMock.mockResolvedValueOnce({
      configData: { enabled: true },
      owner: "owner+qa@example.com",
    });
    resolveOrgIdForEmailMock.mockResolvedValueOnce("org-owner");
    resourceGetByPathMock.mockImplementation(async (owner, path) => {
      if (owner === "shared" && path === "AGENTS.md") {
        return { content: "Shared Dispatch instruction" };
      }
      if (owner === "owner+qa@example.com" && path === "AGENTS.md") {
        return { content: "Personal Dispatch instruction" };
      }
      if (owner === "owner+qa@example.com" && path === "memory/MEMORY.md") {
        return { content: "Personal Dispatch memory" };
      }
      return null;
    });
    const incomingAdapter: PlatformAdapter = {
      ...adapter,
      parseIncomingMessage: async () => ({
        platform: "fake",
        externalThreadId: "fake-thread",
        text: "create an app",
        senderId: "UQA",
        platformContext: {},
        timestamp: Date.now(),
      }),
    };
    let activeCredentialContext: unknown = null;
    runWithRequestContextMock.mockImplementation(
      async (context: unknown, fn: () => unknown) => {
        const previous = activeCredentialContext;
        activeCredentialContext = context;
        try {
          return await fn();
        } finally {
          activeCredentialContext = previous;
        }
      },
    );
    const resolveOwner = vi.fn(async () => {
      expect(activeCredentialContext).toEqual({
        userEmail: "owner+qa@example.com",
        orgId: "org-owner",
        isIntegrationCaller: true,
      });
      return "owner+qa@example.com";
    });
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({
      adapters: [incomingAdapter],
      systemPrompt: "Base prompt.",
      resolveOwner,
    })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/fake/webhook",
      "POST",
      { event: "message" },
    );

    expect(result.status).toBe(200);
    expect(resolveOrgIdForEmailMock).toHaveBeenCalledWith(
      "owner+qa@example.com",
    );
    expect(runWithRequestContextMock).toHaveBeenCalledWith(
      {
        userEmail: "owner+qa@example.com",
        orgId: "org-owner",
        isIntegrationCaller: true,
      },
      expect.any(Function),
    );
    expect(handleWebhookMock).toHaveBeenCalledTimes(1);
    expect(resolveOwner).toHaveBeenCalledTimes(1);
    const [, options] = handleWebhookMock.mock.calls[0];
    expect(options.systemPrompt).toBe("Base prompt.");
    expect(options.ownerEmail).toBe("owner+qa@example.com");
    expect(resourceGetByPathMock).not.toHaveBeenCalled();
    // No app `actions` were configured on this plugin instance, so the
    // "keep on the first request" list is empty — everything merged into
    // `options.actions` (integration memory, call-agent) is deferred behind
    // the tool-search entry `handleWebhook` attaches. See
    // `initialToolNames` on `WebhookHandlerOptions`.
    expect(options.initialToolNames).toEqual([]);
  });

  it("passes the app's own action names as initialToolNames so framework additions defer behind tool-search", async () => {
    getIntegrationConfigMock.mockResolvedValueOnce({
      configData: { enabled: true },
    });
    const incomingAdapter: PlatformAdapter = {
      ...adapter,
      parseIncomingMessage: async () => ({
        platform: "fake",
        externalThreadId: "thread-qa",
        text: "hello",
        senderName: "QA User",
        platformContext: {},
        timestamp: Date.now(),
      }),
    };
    handleWebhookMock.mockResolvedValue({ status: 200, body: "ok" });
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({
      adapters: [incomingAdapter],
      systemPrompt: "Base prompt.",
      actions: {
        "template-action": {
          tool: { description: "App action", parameters: {} },
          run: async () => "ok",
        } as any,
      },
    })(nitroApp);

    await dispatch(
      nitroApp,
      "/_agent-native/integrations/fake/webhook",
      "POST",
      { event: "message" },
    );

    expect(handleWebhookMock).toHaveBeenCalledTimes(1);
    const [, options] = handleWebhookMock.mock.calls[0];
    expect(options.initialToolNames).toEqual(["template-action"]);
    // The framework additions are still present in the executable registry
    // (so a tool-search-discovered call can still run) — just excluded from
    // the "reveal up front" list checked above.
    expect(Object.keys(options.actions)).toEqual(
      expect.arrayContaining(["call-agent", "template-action"]),
    );
  });

  it("politely declines a Slack DM when the default identity ladder declines", async () => {
    getIntegrationConfigMock.mockResolvedValueOnce({
      configData: { enabled: true },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok")),
    );
    const sendSystemNotice = vi.fn(async () => {});
    const slackDmAdapter: PlatformAdapter = {
      ...adapter,
      platform: "slack",
      label: "Slack",
      parseIncomingMessage: async () => ({
        platform: "slack",
        externalThreadId: "A1:T1:D1:1.1",
        text: "hello",
        senderId: "U1",
        tenantId: "T1",
        conversationType: "dm",
        platformContext: { teamId: "T1", channelId: "D1" },
        timestamp: Date.now(),
      }),
      sendSystemNotice,
    };
    resolveDefaultExecutionContextMock.mockRejectedValueOnce(
      new IntegrationIdentityDeclinedError(
        "guest",
        "guest member declined",
        "This assistant is only available to members of this workspace's organization.",
      ),
    );
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({
      adapters: [slackDmAdapter],
      systemPrompt: "Base prompt.",
    })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/slack/webhook",
      "POST",
      { event: "message" },
    );

    expect(result.status).toBe(200);
    expect(result.body).toBe("ok");
    expect(sendSystemNotice).not.toHaveBeenCalled();
    expect(insertPendingTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "slack",
        externalThreadId: expect.stringMatching(/^system-notice:notice-/),
        externalEventKey: expect.stringContaining(
          "system-notice:decline:T1:U1:guest:",
        ),
      }),
    );
    const persisted = JSON.parse(
      insertPendingTaskMock.mock.calls[0][0].payload,
    );
    expect(persisted).toEqual(
      expect.objectContaining({
        kind: "system-notice",
        text: "This assistant is only available to members of this workspace's organization.",
        dedupeKey: "decline:T1:U1:guest",
        dedupeTtlMs: 5 * 60 * 1_000,
      }),
    );
    expect(handleWebhookMock).not.toHaveBeenCalled();
  });

  it("keeps persisted system notices out of the user thread queue", async () => {
    getIntegrationConfigMock.mockResolvedValueOnce({
      configData: { enabled: true },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok")),
    );
    const slackDmAdapter: PlatformAdapter = {
      ...adapter,
      platform: "slack",
      label: "Slack",
      parseIncomingMessage: async () => ({
        platform: "slack",
        externalThreadId: "A1:T1:D1:notice-lane",
        text: "hello",
        senderId: "U1",
        tenantId: "T1",
        conversationType: "dm",
        platformContext: { teamId: "T1", channelId: "D1" },
        timestamp: Date.now(),
      }),
      sendSystemNotice: vi.fn(async () => {}),
    };
    resolveDefaultExecutionContextMock.mockRejectedValueOnce(
      new IntegrationIdentityDeclinedError(
        "guest",
        "guest member declined",
        "Members only.",
      ),
    );
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({
      adapters: [slackDmAdapter],
      systemPrompt: "Base prompt.",
    })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/slack/webhook",
      "POST",
      { event: "message" },
    );

    expect(result.status).toBe(200);
    expect(insertPendingTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        externalThreadId: expect.stringMatching(/^system-notice:notice-/),
      }),
    );
    expect(insertPendingTaskMock.mock.calls[0][0].externalThreadId).not.toBe(
      "A1:T1:D1:notice-lane",
    );
    const persisted = JSON.parse(
      insertPendingTaskMock.mock.calls[0][0].payload,
    );
    expect(persisted.incoming.externalThreadId).toBe("A1:T1:D1:notice-lane");
  });

  it("does not let a legacy owner resolver bypass a declined Slack DM identity", async () => {
    getIntegrationConfigMock.mockResolvedValueOnce({
      configData: { enabled: true },
    });
    const sendSystemNotice = vi.fn(async () => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok")),
    );
    const resolveOwner = vi.fn(async () => "legacy-owner@example.com");
    const slackDmAdapter: PlatformAdapter = {
      ...adapter,
      platform: "slack",
      label: "Slack",
      parseIncomingMessage: async () => ({
        platform: "slack",
        externalThreadId: "A1:T1:D1:1.1",
        text: "hello",
        senderId: "U1",
        tenantId: "T1",
        conversationType: "dm",
        platformContext: { teamId: "T1", channelId: "D1" },
        timestamp: Date.now(),
      }),
      sendSystemNotice,
    };
    resolveDefaultExecutionContextMock.mockRejectedValueOnce(
      new IntegrationIdentityDeclinedError(
        "guest",
        "guest member declined",
        "This assistant is only available to organization members.",
      ),
    );
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({
      adapters: [slackDmAdapter],
      systemPrompt: "Base prompt.",
      resolveOwner,
    })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/slack/webhook",
      "POST",
      { event: "message" },
    );

    expect(result.status).toBe(200);
    expect(sendSystemNotice).not.toHaveBeenCalled();
    expect(insertPendingTaskMock).toHaveBeenCalledTimes(1);
    expect(resolveOwner).not.toHaveBeenCalled();
    expect(handleWebhookMock).not.toHaveBeenCalled();
  });

  it("lets a custom execution-context resolver fully own Slack DM identity resolution", async () => {
    getIntegrationConfigMock.mockResolvedValueOnce({
      configData: { enabled: true },
    });
    const slackDmAdapter: PlatformAdapter = {
      ...adapter,
      platform: "slack",
      label: "Slack",
      parseIncomingMessage: async () => ({
        platform: "slack",
        externalThreadId: "A1:T1:D1:custom-auth",
        text: "hello",
        senderId: "U-custom",
        tenantId: "T1",
        conversationType: "dm",
        platformContext: { teamId: "T1", channelId: "D1" },
        timestamp: Date.now(),
      }),
      sendSystemNotice: vi.fn(async () => {}),
    };
    const resolveExecutionContext = vi.fn(async () => ({
      ownerEmail: "custom-auth@example.test",
      orgId: "org-custom",
      principalType: "member" as const,
    }));
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({
      adapters: [slackDmAdapter],
      systemPrompt: "Base prompt.",
      resolveExecutionContext,
    })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/slack/webhook",
      "POST",
      { event: "message" },
    );

    expect(result.status).toBe(200);
    expect(resolveDefaultExecutionContextMock).not.toHaveBeenCalled();
    expect(resolveExecutionContext).toHaveBeenCalledTimes(1);
    expect(handleWebhookMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ownerEmail: "custom-auth@example.test",
        orgId: "org-custom",
      }),
    );
  });

  it("fails closed for unlinked Slack DM members unless the anonymous org tier is explicitly enabled", async () => {
    getIntegrationConfigMock.mockResolvedValueOnce({
      configData: { enabled: true },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok")),
    );
    const slackDmAdapter: PlatformAdapter = {
      ...adapter,
      platform: "slack",
      label: "Slack",
      parseIncomingMessage: async () => ({
        platform: "slack",
        externalThreadId: "A1:T1:D1:2.2",
        text: "hello",
        senderId: "U-unlinked",
        tenantId: "T1",
        conversationType: "dm",
        platformContext: { teamId: "T1", channelId: "D1" },
        timestamp: Date.now(),
      }),
      sendSystemNotice: vi.fn(async () => {}),
    };
    resolveDefaultExecutionContextMock.mockResolvedValueOnce({
      ownerEmail: "integration@slack",
      orgId: "org-qa",
      principalType: "service",
      anonymousMember: true,
    });
    const resolveOwner = vi.fn(async () => "cross-org-sender@example.test");
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({
      appId: "mail",
      adapters: [slackDmAdapter],
      systemPrompt: "Base prompt.",
      resolveOwner,
    })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/slack/webhook",
      "POST",
      { event: "message" },
    );

    expect(result.status).toBe(200);
    expect(handleWebhookMock).not.toHaveBeenCalled();
    expect(resolveOwner).not.toHaveBeenCalled();
    expect(insertPendingTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        externalThreadId: expect.stringMatching(/^system-notice:notice-/),
        externalEventKey: expect.stringContaining(
          "system-notice:anonymous-tier-disabled:T1:U-unlinked:",
        ),
      }),
    );
    const persisted = JSON.parse(
      insertPendingTaskMock.mock.calls[0][0].payload,
    );
    expect(persisted.text).toContain("users:read.email scope");
  });

  it("allows the anonymous Slack DM org tier only with explicit plugin opt-in", async () => {
    getIntegrationConfigMock.mockResolvedValueOnce({
      configData: { enabled: true },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok")),
    );
    const slackDmAdapter: PlatformAdapter = {
      ...adapter,
      platform: "slack",
      label: "Slack",
      parseIncomingMessage: async () => ({
        platform: "slack",
        externalThreadId: "A1:T1:D1:3.3",
        text: "hello",
        senderId: "U-opted-in",
        tenantId: "T1",
        conversationType: "dm",
        platformContext: { teamId: "T1", channelId: "D1" },
        timestamp: Date.now(),
      }),
      sendSystemNotice: vi.fn(async () => {}),
    };
    resolveDefaultExecutionContextMock.mockResolvedValueOnce({
      ownerEmail: "integration@slack",
      orgId: "org-qa",
      principalType: "service",
      anonymousMember: true,
    });
    const nitroApp = createNitroApp();
    await createIntegrationsPlugin({
      adapters: [slackDmAdapter],
      systemPrompt: "Base prompt.",
      allowAnonymousOrgScopedSlackDm: true,
    })(nitroApp);

    const result = await dispatch(
      nitroApp,
      "/_agent-native/integrations/slack/webhook",
      "POST",
      { event: "message" },
    );

    expect(result.status).toBe(200);
    expect(handleWebhookMock).toHaveBeenCalledTimes(1);
    expect(insertPendingTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        externalThreadId: expect.stringMatching(/^system-notice:notice-/),
        externalEventKey: expect.stringContaining(
          "system-notice:anonymous-tier:T1:U-opted-in:",
        ),
      }),
    );
  });

  it("persists stable decline dedupe keys per sender and reason", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      getIntegrationConfigMock.mockResolvedValue({
        configData: { enabled: true },
      });
      const slackDmAdapter: PlatformAdapter = {
        ...adapter,
        platform: "slack",
        label: "Slack",
        parseIncomingMessage: async () => ({
          platform: "slack",
          externalThreadId: "A9:T-dedupe:D-dedupe:1.1",
          text: "hello",
          senderId: "U-dedupe",
          tenantId: "T-dedupe",
          conversationType: "dm",
          platformContext: { teamId: "T-dedupe", channelId: "D-dedupe" },
          timestamp: Date.now(),
        }),
        sendSystemNotice: vi.fn(async () => {}),
      };
      const declineWith = (
        reason: ConstructorParameters<
          typeof IntegrationIdentityDeclinedError
        >[0],
      ) =>
        resolveDefaultExecutionContextMock.mockRejectedValueOnce(
          new IntegrationIdentityDeclinedError(
            reason,
            `${reason} declined`,
            `Declined: ${reason}.`,
          ),
        );
      const nitroApp = createNitroApp();
      await createIntegrationsPlugin({
        adapters: [slackDmAdapter],
        systemPrompt: "Base prompt.",
      })(nitroApp);
      const post = () =>
        dispatch(
          nitroApp,
          "/_agent-native/integrations/slack/webhook",
          "POST",
          {
            event: "message",
          },
        );

      declineWith("unverified");
      const first = await post();
      expect(first.status).toBe(200);
      expect(first.body).toBe("ok");
      expect(insertPendingTaskMock).toHaveBeenCalledTimes(1);

      declineWith("unverified");
      const second = await post();
      expect(second.status).toBe(200);
      expect(second.body).toBe("ok");
      expect(insertPendingTaskMock).toHaveBeenCalledTimes(2);
      expect(insertPendingTaskMock.mock.calls[0][0].externalEventKey).toBe(
        insertPendingTaskMock.mock.calls[1][0].externalEventKey,
      );

      declineWith("guest");
      const third = await post();
      expect(third.status).toBe(200);
      expect(insertPendingTaskMock).toHaveBeenCalledTimes(3);
      expect(insertPendingTaskMock.mock.calls[2][0].externalEventKey).not.toBe(
        insertPendingTaskMock.mock.calls[1][0].externalEventKey,
      );
      expect(handleWebhookMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
