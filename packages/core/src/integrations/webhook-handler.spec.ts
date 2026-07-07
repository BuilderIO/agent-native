import type { H3Event } from "h3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IncomingMessage, PlatformAdapter } from "./types.js";
import {
  handleWebhook,
  resolveBaseUrl,
  resolveIntegrationApiKey,
} from "./webhook-handler.js";

const insertPendingTaskMock = vi.hoisted(() => vi.fn());
const resolveOrgIdForEmailMock = vi.hoisted(() => vi.fn());
const getOwnerApiKeyMock = vi.hoisted(() => vi.fn());
const getOwnerActiveApiKeyMock = vi.hoisted(() => vi.fn());
const readDeployCredentialEnvMock = vi.hoisted(() => vi.fn());
const canUseDeployCredentialFallbackForRequestMock = vi.hoisted(() => vi.fn());

vi.mock("./pending-tasks-store.js", () => ({
  insertPendingTask: insertPendingTaskMock,
}));

vi.mock("../org/context.js", () => ({
  resolveOrgIdForEmail: resolveOrgIdForEmailMock,
}));

vi.mock("../agent/production-agent.js", () => ({
  actionsToEngineTools: vi.fn(() => []),
  engineToProvider: vi.fn((engineName: string) => engineName),
  getOwnerActiveApiKey: getOwnerActiveApiKeyMock,
  getOwnerApiKey: getOwnerApiKeyMock,
  runAgentLoop: vi.fn(),
}));

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
