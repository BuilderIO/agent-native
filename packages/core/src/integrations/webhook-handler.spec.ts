import type { H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IncomingMessage, PlatformAdapter } from "./types.js";
import {
  handleWebhook,
  resolveBaseUrl,
  resolveIntegrationApiKey,
} from "./webhook-handler.js";

const insertPendingTaskMock = vi.hoisted(() => vi.fn());
const isDuplicateEventErrorMock = vi.hoisted(() => vi.fn(() => false));
const resolveOrgIdForEmailMock = vi.hoisted(() => vi.fn());
const getOwnerApiKeyMock = vi.hoisted(() => vi.fn());
const getOwnerActiveApiKeyMock = vi.hoisted(() => vi.fn());
const readDeployCredentialEnvMock = vi.hoisted(() => vi.fn());
const canUseDeployCredentialFallbackForRequestMock = vi.hoisted(() => vi.fn());

vi.mock("./pending-tasks-store.js", () => ({
  insertPendingTask: insertPendingTaskMock,
  isDuplicateEventError: isDuplicateEventErrorMock,
}));

vi.mock("../org/context.js", () => ({
  resolveOrgIdForEmail: resolveOrgIdForEmailMock,
}));

vi.mock("../agent/production-agent.js", async () => {
  const actual = await vi.importActual<
    typeof import("../agent/production-agent.js")
  >("../agent/production-agent.js");
  return {
    actionsToEngineTools: vi.fn(() => []),
    engineToProvider: vi.fn((engineName: string) => engineName),
    getOwnerActiveApiKey: getOwnerActiveApiKeyMock,
    getOwnerApiKey: getOwnerApiKeyMock,
    runAgentLoop: vi.fn(),
    filterInitialEngineTools: actual.filterInitialEngineTools,
  };
});

vi.mock("../server/credential-provider.js", () => ({
  canUseDeployCredentialFallbackForRequest:
    canUseDeployCredentialFallbackForRequestMock,
  readDeployCredentialEnv: readDeployCredentialEnvMock,
}));

vi.mock("./internal-token.js", () => ({
  signInternalToken: vi.fn(() => "signed-token"),
}));

function createEvent(): H3Event {
  return {
    node: {
      req: {
        headers: {
          host: "app.test",
          "x-forwarded-proto": "https",
        },
      },
    },
  } as unknown as H3Event;
}

function createIncoming(timestamp = Date.now()): IncomingMessage {
  return {
    platform: "fake",
    externalThreadId: "thread-1",
    text: "hello",
    senderName: "QA User",
    platformContext: { channel: "C123" },
    timestamp,
  };
}

function createAdapter(sendResponse = vi.fn()): PlatformAdapter {
  return {
    platform: "fake",
    label: "Fake",
    getRequiredEnvKeys: () => [],
    handleVerification: async () => ({ handled: false }),
    verifyWebhook: async () => true,
    parseIncomingMessage: async () => null,
    sendResponse,
    formatAgentResponse: (text) => ({ text, platformContext: {} }),
    getStatus: async () => ({
      platform: "fake",
      label: "Fake",
      enabled: true,
      configured: true,
    }),
  };
}

describe("integration webhook handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveOrgIdForEmailMock.mockResolvedValue("org-qa");
    insertPendingTaskMock.mockResolvedValue(undefined);
    isDuplicateEventErrorMock.mockReturnValue(false);
    getOwnerApiKeyMock.mockResolvedValue(undefined);
    getOwnerActiveApiKeyMock.mockResolvedValue(undefined);
    readDeployCredentialEnvMock.mockReturnValue(undefined);
    canUseDeployCredentialFallbackForRequestMock.mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("enqueues and dispatches without sending a platform response inline", async () => {
    const sendResponse = vi.fn();
    const incoming = createIncoming(1001);

    const result = await handleWebhook(createEvent(), {
      adapter: createAdapter(sendResponse),
      systemPrompt: "system",
      actions: {},
      model: "test-model",
      apiKey: "test-key",
      ownerEmail: "alice+qa@agent-native.test",
      incoming,
    });

    expect(result).toEqual({ status: 200, body: "ok" });
    expect(insertPendingTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "fake",
        externalThreadId: "thread-1",
        ownerEmail: "alice+qa@agent-native.test",
        orgId: "org-qa",
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://app.test/_agent-native/integrations/process-task",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer signed-token",
        }),
      }),
    );
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("never returns a verification challenge before authenticating it", async () => {
    const adapter = {
      ...createAdapter(),
      handleVerification: vi.fn(async () => ({
        handled: true as const,
        response: { type: 1 },
      })),
      verifyWebhook: vi.fn(async () => false),
    };

    const result = await handleWebhook(createEvent(), {
      adapter,
      systemPrompt: "system",
      actions: {},
      apiKey: "test-key",
      ownerEmail: "alice+qa@agent-native.test",
    });

    expect(adapter.handleVerification).toHaveBeenCalledOnce();
    expect(adapter.verifyWebhook).toHaveBeenCalledOnce();
    expect(result).toEqual({
      status: 401,
      body: { error: "Invalid webhook signature" },
    });
  });

  it("returns a provider-specific deferred acknowledgement after enqueue", async () => {
    const incoming = createIncoming(1003);
    const adapter = {
      ...createAdapter(),
      capabilities: { deferredWebhookResponse: true },
      getImmediateWebhookResponse: () => ({
        status: 200,
        body: { type: 5 },
      }),
    };

    const result = await handleWebhook(createEvent(), {
      adapter,
      systemPrompt: "system",
      actions: {},
      apiKey: "test-key",
      ownerEmail: "alice+qa@agent-native.test",
      incoming,
    });

    expect(insertPendingTaskMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: 200, body: { type: 5 } });
  });

  it("uses provider event references for retry-stable queue idempotency", async () => {
    const incoming = {
      ...createIncoming(Date.now()),
      platform: "discord",
      externalThreadId: "app:example:guild:example:channel:example",
      replyRef: "fallback-reference-example",
      platformContext: {
        interactionId: "interaction-id-example",
      },
    };

    await handleWebhook(createEvent(), {
      adapter: createAdapter(),
      systemPrompt: "system",
      actions: {},
      apiKey: "test-key",
      ownerEmail: "alice+qa@agent-native.test",
      incoming,
    });

    expect(insertPendingTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        externalEventKey:
          "discord:app:example:guild:example:channel:example:interaction-id-example",
      }),
    );
  });

  it("bounds dispatch settling for providers with a 3-second acknowledgement deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const incoming = createIncoming(1004);
    const adapter = {
      ...createAdapter(),
      capabilities: { deferredWebhookResponse: true },
      getImmediateWebhookResponse: () => ({
        status: 200,
        body: { type: 5 },
      }),
    };
    let settled = false;
    const response = handleWebhook(createEvent(), {
      adapter,
      systemPrompt: "system",
      actions: {},
      apiKey: "test-key",
      ownerEmail: "alice+qa@agent-native.test",
      incoming,
    }).then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(1_499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(response).resolves.toEqual({
      status: 200,
      body: { type: 5 },
    });
  });

  it("lets a slow cold-host dispatch settle before returning a deferred acknowledgement", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) =>
            setTimeout(
              () => resolve(new Response("ok", { status: 200 })),
              1_200,
            ),
          ),
      ),
    );
    const incoming = createIncoming(1005);
    const adapter = {
      ...createAdapter(),
      capabilities: { deferredWebhookResponse: true },
      getImmediateWebhookResponse: () => ({
        status: 200,
        body: { type: 5 },
      }),
    };
    let settled = false;
    const response = handleWebhook(createEvent(), {
      adapter,
      systemPrompt: "system",
      actions: {},
      apiKey: "test-key",
      ownerEmail: "alice+qa@agent-native.test",
      incoming,
    }).then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(1_199);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(response).resolves.toEqual({
      status: 200,
      body: { type: 5 },
    });
  });

  it("returns the deferred acknowledgement for duplicate deliveries", async () => {
    const duplicateError = new Error("duplicate event");
    insertPendingTaskMock.mockRejectedValueOnce(duplicateError);
    isDuplicateEventErrorMock.mockImplementation(
      (error) => error === duplicateError,
    );
    const incoming = createIncoming(1006);
    const adapter = {
      ...createAdapter(),
      capabilities: { deferredWebhookResponse: true },
      getImmediateWebhookResponse: () => ({
        status: 200,
        body: { type: 5 },
      }),
    };

    await expect(
      handleWebhook(createEvent(), {
        adapter,
        systemPrompt: "system",
        actions: {},
        apiKey: "test-key",
        ownerEmail: "alice+qa@agent-native.test",
        incoming,
      }),
    ).resolves.toEqual({ status: 200, body: { type: 5 } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not reflect inbound Host into self-dispatch URLs in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("URL", "");
    vi.stubEnv("DEPLOY_URL", "");
    vi.stubEnv("BETTER_AUTH_URL", "");

    expect(() => resolveBaseUrl(createEvent())).toThrow(
      /requires APP_URL, URL, DEPLOY_URL, or BETTER_AUTH_URL/,
    );
  });

  it("does not enqueue or send when beforeProcess handles silently", async () => {
    const sendResponse = vi.fn();

    const result = await handleWebhook(createEvent(), {
      adapter: createAdapter(sendResponse),
      systemPrompt: "system",
      actions: {},
      model: "test-model",
      apiKey: "test-key",
      ownerEmail: "alice+qa@agent-native.test",
      incoming: createIncoming(1002),
      beforeProcess: async () => ({ handled: true }),
    });

    expect(result).toEqual({ status: 200, body: "ok" });
    expect(insertPendingTaskMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("returns the deferred acknowledgement when beforeProcess handles the interaction", async () => {
    const incoming = createIncoming(1007);
    incoming.responseContext = {
      interactionToken: "interaction-token-example",
    };
    const adapter = {
      ...createAdapter(),
      capabilities: { deferredWebhookResponse: true },
      getImmediateWebhookResponse: () => ({
        status: 200,
        body: { type: 5 },
      }),
    };

    const result = await handleWebhook(createEvent(), {
      adapter,
      systemPrompt: "system",
      actions: {},
      apiKey: "test-key",
      ownerEmail: "alice+qa@agent-native.test",
      incoming,
      beforeProcess: async () => ({ handled: true }),
    });

    expect(result).toEqual({ status: 200, body: { type: 5 } });
    expect(insertPendingTaskMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not use deploy-level fallback keys for guarded integration runs", async () => {
    canUseDeployCredentialFallbackForRequestMock.mockReturnValue(false);
    readDeployCredentialEnvMock.mockReturnValue("deploy-provider-key");

    await expect(
      resolveIntegrationApiKey(
        "anthropic",
        "alice+qa@agent-native.test",
        "plugin-api-key",
      ),
    ).resolves.toBeUndefined();
    expect(readDeployCredentialEnvMock).not.toHaveBeenCalled();
  });

  it("allows scoped integration owner keys before deploy fallback policy", async () => {
    canUseDeployCredentialFallbackForRequestMock.mockReturnValue(false);
    getOwnerApiKeyMock.mockResolvedValue("scoped-owner-key");

    await expect(
      resolveIntegrationApiKey(
        "anthropic",
        "alice+qa@agent-native.test",
        "plugin-api-key",
      ),
    ).resolves.toBe("scoped-owner-key");
  });
});
