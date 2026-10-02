import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const credentialMocks = vi.hoisted(() => ({
  builderReady: vi.fn<() => Promise<boolean>>(),
  resolveSecret: vi.fn<(key: string) => Promise<any>>(),
  authFailure:
    vi.fn<(args: { key: string; value: string }) => Promise<unknown>>(),
}));

vi.mock("./credential-provider.js", () => ({
  assertCredentialStoreReadable: vi.fn(),
  getProviderCredentialAuthFailure: (args: { key: string; value: string }) =>
    credentialMocks.authFailure(args),
  prefetchSecrets: vi.fn(async () => undefined),
  resolveHasBuilderGatewayCredential: () => credentialMocks.builderReady(),
  resolveSecretDetailed: (key: string) => credentialMocks.resolveSecret(key),
}));

import {
  AGENT_CHAT_AI_SETUP_REQUIRED_CODE,
  isAgentChatAiSetupReady,
  isAgentChatAiSetupRequiredError,
  queuedMessagesNeedAgentChatAiSetup,
  requireAgentChatAiSetup,
} from "./agent-chat-ai-setup.js";

describe("Agent-Native chat AI setup gate", () => {
  beforeEach(() => {
    credentialMocks.builderReady.mockResolvedValue(false);
    credentialMocks.resolveSecret.mockResolvedValue({
      value: null,
      lookupFailed: false,
    });
    credentialMocks.authFailure.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects chat without Builder or a scoped provider API key", async () => {
    await expect(requireAgentChatAiSetup()).rejects.toMatchObject({
      statusCode: 403,
      data: { code: AGENT_CHAT_AI_SETUP_REQUIRED_CODE },
    });
    const refusal = await requireAgentChatAiSetup().catch(
      (error: unknown) => error,
    );
    expect(isAgentChatAiSetupRequiredError(refusal)).toBe(true);
    expect(isAgentChatAiSetupRequiredError(new Error("other"))).toBe(false);
  });

  it("accepts a usable Builder gateway or OAuth credential", async () => {
    credentialMocks.builderReady.mockResolvedValue(true);

    await expect(isAgentChatAiSetupReady()).resolves.toBe(true);
    expect(credentialMocks.resolveSecret).not.toHaveBeenCalled();
  });

  it.each(["user", "org", "workspace"] as const)(
    "accepts recognized provider API keys from the %s scope",
    async (source) => {
      credentialMocks.resolveSecret.mockImplementation(async (key: string) =>
        key === "OPENAI_API_KEY"
          ? { value: "sk-test-key", source, lookupFailed: false }
          : { value: null, lookupFailed: false },
      );

      await expect(isAgentChatAiSetupReady()).resolves.toBe(true);
      expect(credentialMocks.authFailure).toHaveBeenCalledWith({
        key: "OPENAI_API_KEY",
        value: "sk-test-key",
      });
    },
  );

  it("accepts a locally allowed provider key from the resolver", async () => {
    credentialMocks.resolveSecret.mockImplementation(async (key: string) =>
      key === "OPENAI_API_KEY"
        ? { value: "site-key", source: "env", lookupFailed: false }
        : { value: null, lookupFailed: false },
    );

    await expect(isAgentChatAiSetupReady()).resolves.toBe(true);
  });

  it("does not accept a hosted deploy provider key hidden by the resolver", async () => {
    credentialMocks.resolveSecret.mockResolvedValue({
      value: null,
      lookupFailed: false,
    });

    await expect(isAgentChatAiSetupReady()).resolves.toBe(false);
  });

  it.each([
    ["OPENAI_BASE_URL", "user"],
    ["OLLAMA_BASE_URL", "workspace"],
    ["OLLAMA_BASE_URL", "env"],
  ] as const)(
    "accepts a configured custom endpoint without requiring a provider key (%s from %s)",
    async (endpointKey, source) => {
      credentialMocks.resolveSecret.mockImplementation(async (key: string) =>
        key === endpointKey
          ? {
              value:
                endpointKey === "OLLAMA_BASE_URL"
                  ? "http://localhost:11434"
                  : "https://ai-gateway.example/v1",
              source,
              lookupFailed: false,
            }
          : { value: null, lookupFailed: false },
      );

      await expect(isAgentChatAiSetupReady()).resolves.toBe(true);
      expect(credentialMocks.authFailure).not.toHaveBeenCalled();
    },
  );

  it("surfaces an unreadable custom endpoint store", async () => {
    credentialMocks.resolveSecret.mockImplementation(async (key: string) =>
      key === "OLLAMA_BASE_URL"
        ? { value: null, lookupFailed: true }
        : { value: null, lookupFailed: false },
    );

    await expect(isAgentChatAiSetupReady()).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it("allows a local endpoint when its recognized OpenAI API key is usable", async () => {
    credentialMocks.resolveSecret.mockImplementation(async (key: string) =>
      key === "OPENAI_API_KEY"
        ? { value: "sk-local-key", source: "user", lookupFailed: false }
        : { value: null, lookupFailed: false },
    );

    await expect(isAgentChatAiSetupReady()).resolves.toBe(true);
  });

  it("does not treat an engine label without a saved endpoint as AI setup", async () => {
    await expect(isAgentChatAiSetupReady()).resolves.toBe(false);
    expect(
      credentialMocks.resolveSecret.mock.calls.map(([key]) => key),
    ).toEqual([
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GOOGLE_GENERATIVE_AI_API_KEY",
      "OPENROUTER_API_KEY",
      "GROQ_API_KEY",
      "MISTRAL_API_KEY",
      "COHERE_API_KEY",
      "OPENAI_BASE_URL",
      "OLLAMA_BASE_URL",
    ]);
  });

  it("does not accept a provider key marked as rejected", async () => {
    credentialMocks.resolveSecret.mockImplementation(async (key: string) =>
      key === "OPENAI_API_KEY"
        ? {
            value: "sk-test-rejected",
            source: "user",
            lookupFailed: false,
          }
        : { value: null, lookupFailed: false },
    );
    credentialMocks.authFailure.mockResolvedValue({ status: 401 });

    await expect(isAgentChatAiSetupReady()).resolves.toBe(false);
  });

  it("surfaces unreadable credential stores instead of claiming no setup", async () => {
    credentialMocks.resolveSecret.mockResolvedValue({
      value: null,
      lookupFailed: true,
      cause: new Error("credential store unavailable"),
    });

    await expect(isAgentChatAiSetupReady()).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it("allows queue deletions but gates additions, edits, and reordering", () => {
    const existing = JSON.stringify({
      queuedMessages: [
        { id: "first", text: "one" },
        { id: "second", text: "two" },
      ],
    });

    expect(
      queuedMessagesNeedAgentChatAiSetup(existing, [
        { id: "second", text: "two" },
      ]),
    ).toBe(false);
    expect(queuedMessagesNeedAgentChatAiSetup(existing, [])).toBe(false);
    expect(
      queuedMessagesNeedAgentChatAiSetup(existing, [
        { id: "third", text: "three" },
      ]),
    ).toBe(true);
    expect(
      queuedMessagesNeedAgentChatAiSetup(existing, [
        { id: "first", text: "edited" },
      ]),
    ).toBe(true);
    expect(
      queuedMessagesNeedAgentChatAiSetup(existing, [
        { id: "second", text: "two" },
        { id: "first", text: "one" },
      ]),
    ).toBe(true);
  });

  it("wires the same strict gate before interactive dispatch and queue additions", () => {
    const plugin = readFileSync(
      new URL("./agent-chat-plugin.ts", import.meta.url),
      "utf8",
    );
    const invokeStart = plugin.indexOf("const invokeAgentChatHandler");
    const invokeEnd = plugin.indexOf("// A Function URL", invokeStart);
    const invokeBlock = plugin.slice(invokeStart, invokeEnd);
    expect(
      invokeBlock.indexOf("await requireAgentChatAiSetup();"),
    ).toBeGreaterThan(-1);
    expect(
      invokeBlock.indexOf("await requireAgentChatAiSetup();"),
    ).toBeLessThan(invokeBlock.indexOf("return handler(event);"));
    // A refused turn is answered in its thread before the 403 is rethrown.
    expect(
      invokeBlock.indexOf("await recordSetupRequiredTurn(event, error);"),
    ).toBeGreaterThan(invokeBlock.indexOf("await requireAgentChatAiSetup();"));
    expect(
      invokeBlock.indexOf("await recordSetupRequiredTurn(event, error);"),
    ).toBeLessThan(invokeBlock.indexOf("throw error;"));

    const queueStart = plugin.indexOf("// POST /threads/:id/queued");
    const queueEnd = plugin.indexOf('isThreadSubroute("rename")', queueStart);
    const queueBlock = plugin.slice(queueStart, queueEnd);
    expect(queueBlock).toContain('mutation.type === "append"');
    expect(queueBlock).toContain('mutation.type === "moveToTop"');
    expect(queueBlock.indexOf("requireAgentChatAiSetup()")).toBeLessThan(
      queueBlock.indexOf("const result = await mutateThreadQueuedMessages("),
    );
  });

  it("exposes strict chat eligibility on the existing engine status response", () => {
    const routes = readFileSync(
      new URL("./core-routes-plugin.ts", import.meta.url),
      "utf8",
    );
    expect(routes).toContain("export interface AgentEngineStatusResponse");
    expect(routes).toContain("chatEligible: boolean");
    expect(routes).toContain("isAgentChatAiSetupReady()");
  });
});
