import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getJevContextCredentials: vi.fn(),
  getOwnerApiKeyForEngine: vi.fn(),
  isJevEnabled: vi.fn(),
  requestJev: vi.fn(),
  requestOpenAiDecision: vi.fn(),
}));

vi.mock("../agent/production-agent.js", () => ({
  getJevContextCredentials: mocks.getJevContextCredentials,
  getOwnerApiKeyForEngine: mocks.getOwnerApiKeyForEngine,
}));
vi.mock("../app-config/index.js", () => ({
  getAppConfig: () => ({
    decisions: { providerOrder: ["jev", "openai"], timeoutMs: 10_000 },
  }),
}));
vi.mock("../server/request-context.js", () => ({
  getRequestOrgId: () => "org-example",
}));
vi.mock("./providers/jev.js", () => ({
  isJevEnabled: mocks.isJevEnabled,
  requestJev: mocks.requestJev,
}));
vi.mock("./providers/openai.js", () => ({
  OPENAI_DECISIONS_MODEL: "gpt-6-luna",
  requestOpenAiDecision: mocks.requestOpenAiDecision,
  DecisionProviderRequestError: class DecisionProviderRequestError extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  },
}));

import {
  __resetDecisionCacheForTests,
  decide,
  getDecisionsStatus,
} from "./decide.js";

const ownerEmail = "owner@example.test";
const choiceQuestion = {
  type: "choice" as const,
  name: "route",
  instructions: "Which team should handle this?",
  choices: [
    { value: "billing", description: "Payment questions" },
    { value: "technical", description: "Product problems" },
  ],
};

describe("decide", () => {
  beforeEach(() => {
    __resetDecisionCacheForTests();
    mocks.getOwnerApiKeyForEngine.mockResolvedValue({
      apiKey: "openai-test-key",
    });
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: undefined,
      personalApiKey: undefined,
      builderAuth: null,
    });
    mocks.isJevEnabled.mockResolvedValue(false);
    mocks.requestOpenAiDecision.mockResolvedValue({
      answers: [
        {
          type: "choice",
          name: "route",
          choice: "billing",
          probabilities: [
            { value: "billing", probability: 0.92 },
            { value: "technical", probability: 0.08 },
          ],
          confidence: 0.92,
        },
      ],
    });
    mocks.requestJev.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    __resetDecisionCacheForTests();
  });

  it("uses the configured default provider and returns typed keyed answers", async () => {
    const result = await decide({
      ownerEmail,
      input: "I was charged twice.",
      questions: [choiceQuestion],
    });

    expect(result).toEqual({
      status: "ok",
      provider: "openai",
      model: "gpt-6-luna",
      answers: {
        route: {
          type: "choice",
          name: "route",
          choice: "billing",
          probabilities: [
            { value: "billing", probability: 0.92 },
            { value: "technical", probability: 0.08 },
          ],
          confidence: 0.92,
        },
      },
    });
    expect(mocks.requestOpenAiDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        input: "I was charged twice.",
        apiKey: "openai-test-key",
        timeoutMs: 10_000,
      }),
    );
    expect(mocks.getJevContextCredentials).toHaveBeenCalledOnce();
  });

  it("maps predicate and choice questions for the Builder Jev proxy", async () => {
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: undefined,
      personalApiKey: undefined,
      directApiKey: undefined,
      builderAuth: {
        authorization: "Bearer fake-builder-session",
        spaceId: "space-test",
        userId: "user-test",
      },
    });
    mocks.isJevEnabled.mockResolvedValue(true);
    mocks.requestJev.mockResolvedValue({
      answers: {
        urgent: { type: "noul", noul: 0.9 },
        route: {
          type: "choice",
          choice: "billing",
          probabilities: { billing: 0.8, technical: 0.2 },
          confidence: 0.8,
        },
      },
      usage: { input_tokens: 42, output_tokens: 8 },
    });

    const questions = [
      {
        type: "predicate" as const,
        name: "urgent",
        instructions: "Does the report need immediate attention?",
      },
      choiceQuestion,
    ];
    const result = await decide({
      ownerEmail,
      input: [{ type: "json", value: { ticket: "duplicate charge" } }],
      questions,
      options: { providers: ["jev"] },
    });

    expect(result).toMatchObject({
      status: "ok",
      provider: "jev",
      model: "jev-latest",
      answers: {
        urgent: { type: "predicate", name: "urgent", probability: 0.9 },
        route: {
          type: "choice",
          name: "route",
          choice: "billing",
          probabilities: [
            { value: "billing", probability: 0.8 },
            { value: "technical", probability: 0.2 },
          ],
        },
      },
      usage: { inputTokens: 42, outputTokens: 8 },
    });
    expect(mocks.requestJev).toHaveBeenCalledWith(
      expect.objectContaining({
        builderAuth: {
          authorization: "Bearer fake-builder-session",
          spaceId: "space-test",
          userId: "user-test",
        },
        request: {
          model: "jev-latest",
          state: {
            input: [{ type: "json", value: { ticket: "duplicate charge" } }],
          },
          questions: {
            urgent: {
              type: "noul",
              instructions: "Does the report need immediate attention?",
            },
            route: {
              type: "choice",
              instructions: "Which team should handle this?",
              criteria: {
                billing: "Payment questions",
                technical: "Product problems",
              },
            },
          },
        },
      }),
    );
  });

  it("skips Jev's unverified score capability and continues to OpenAI", async () => {
    const scoreQuestion = {
      type: "score" as const,
      name: "severity",
      instructions: "How severe is the issue?",
      levels: [
        { label: "low", description: "A minor inconvenience" },
        { label: "medium", description: "A task has a workaround" },
        { label: "high", description: "The task is blocked" },
      ],
    };
    mocks.requestOpenAiDecision.mockResolvedValue({
      answers: [
        {
          type: "score",
          name: "severity",
          score: 1.1,
          probabilities: [
            { value: 0, probability: 0.1 },
            { value: 1, probability: 0.7 },
            { value: 2, probability: 0.2 },
          ],
          confidence: 0.55,
        },
      ],
    });

    const result = await decide({
      ownerEmail,
      input: "A task fails but a workaround is available.",
      questions: [scoreQuestion],
    });

    expect(result).toMatchObject({ status: "ok", provider: "openai" });
    expect(mocks.getJevContextCredentials).not.toHaveBeenCalled();
    expect(mocks.requestJev).not.toHaveBeenCalled();
    expect(mocks.requestOpenAiDecision).toHaveBeenCalledOnce();
  });

  it("returns an unverified-capability failure for a Jev-only score request", async () => {
    const result = await decide({
      ownerEmail,
      input: "A task fails but a workaround is available.",
      questions: [
        {
          type: "score",
          name: "severity",
          instructions: "How severe is the issue?",
          levels: [
            { label: "low", description: "A minor inconvenience" },
            { label: "medium", description: "A task has a workaround" },
            { label: "high", description: "The task is blocked" },
          ],
        },
      ],
      options: { providers: ["jev"] },
    });

    expect(result).toEqual({
      status: "failed",
      reason: "unverified_capability",
      provider: "jev",
      questionNames: ["severity"],
    });
    expect(mocks.getJevContextCredentials).not.toHaveBeenCalled();
    expect(mocks.requestJev).not.toHaveBeenCalled();
  });

  it("reports verified and unverified question capabilities separately from readiness", async () => {
    const result = await getDecisionsStatus(ownerEmail);

    expect(result.capabilities).toEqual({
      jev: {
        builderProxy: {
          predicate: { status: "verified", enabled: true },
          choice: { status: "verified", enabled: true },
          score: { status: "unverified", enabled: false },
        },
      },
      openai: {
        decisionsApi: {
          predicate: { status: "verified", enabled: true },
          choice: { status: "verified", enabled: true },
          score: { status: "verified", enabled: true },
        },
      },
    });
    expect(result.providers).toEqual([
      { provider: "openai", status: "ready" },
      { provider: "jev", status: "not_configured" },
    ]);
  });

  it("continues past a provider with no key and does not call it", async () => {
    mocks.getOwnerApiKeyForEngine.mockResolvedValue({ apiKey: undefined });
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: "jev-test-key",
      personalApiKey: "jev-test-key",
      builderAuth: null,
    });
    mocks.requestJev.mockResolvedValue({
      answers: { route: { type: "choice", choice: "billing" } },
    });

    const result = await decide({
      ownerEmail,
      input: "I was charged twice.",
      questions: [choiceQuestion],
    });

    expect(result).toMatchObject({ status: "ok", provider: "jev" });
    expect(mocks.requestOpenAiDecision).not.toHaveBeenCalled();
    expect(mocks.requestJev).toHaveBeenCalledOnce();
  });

  it("skips Jev for image input and uses OpenAI when it is next", async () => {
    mocks.requestOpenAiDecision.mockResolvedValue({
      answers: [
        {
          type: "predicate",
          name: "damaged",
          probability: 0.91,
        },
      ],
    });

    const result = await decide({
      ownerEmail,
      input: [{ type: "image", url: "https://example.test/package.jpg" }],
      questions: [
        {
          type: "predicate",
          name: "damaged",
          instructions: "Is the product visibly damaged?",
        },
      ],
      options: { providers: ["jev", "openai"] },
    });

    expect(result).toMatchObject({ status: "ok", provider: "openai" });
    expect(mocks.getJevContextCredentials).not.toHaveBeenCalled();
  });

  it("returns unknown credential lookup as a failure instead of absence", async () => {
    mocks.getOwnerApiKeyForEngine.mockImplementation(
      async (_engine, _email, options) => {
        options.onLookupFailure();
        return { apiKey: undefined };
      },
    );

    const result = await decide({
      ownerEmail,
      input: "A ticket",
      questions: [choiceQuestion],
    });

    expect(result).toEqual({
      status: "failed",
      reason: "credentials_unavailable",
      provider: "openai",
    });
    expect(mocks.getJevContextCredentials).toHaveBeenCalledOnce();
  });

  it("does not switch providers after a configured provider fails", async () => {
    mocks.requestOpenAiDecision.mockRejectedValue(new Error("network error"));

    const result = await decide({
      ownerEmail,
      input: "A ticket",
      questions: [choiceQuestion],
    });

    expect(result).toEqual({
      status: "failed",
      reason: "provider_error",
      provider: "openai",
    });
    expect(mocks.getJevContextCredentials).toHaveBeenCalledOnce();
  });

  it("rejects JSON input that cannot be serialized", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    const result = await decide({
      ownerEmail,
      input: [{ type: "json", value: cyclic }],
      questions: [choiceQuestion],
    });

    expect(result).toEqual({ status: "failed", reason: "invalid_input" });
    expect(mocks.requestOpenAiDecision).not.toHaveBeenCalled();
  });

  it("caches only an explicitly keyed, identical decision per provider and model", async () => {
    const request = {
      ownerEmail,
      input: "I was charged twice.",
      questions: [choiceQuestion],
      options: { cacheKey: "ticket-42" },
    };

    const first = await decide(request);
    const second = await decide(request);

    expect(first).toMatchObject({ status: "ok", cached: false });
    expect(second).toMatchObject({ status: "ok", cached: true });
    expect(mocks.requestOpenAiDecision).toHaveBeenCalledOnce();
  });

  it("reports missing credentials as not configured", async () => {
    mocks.getOwnerApiKeyForEngine.mockResolvedValue({ apiKey: undefined });

    const result = await decide({
      ownerEmail,
      input: "A ticket",
      questions: [choiceQuestion],
    });

    expect(result).toEqual({
      status: "not_configured",
      reason: "missing_credentials",
      providers: ["jev", "openai"],
    });
  });
});
