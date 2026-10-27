import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { JevContextCredentials } from "../agent/production-agent.js";
import { DECISION_PROVIDER_CAPABILITIES } from "./capabilities.js";

const mocks = vi.hoisted(() => ({
  getJevContextCredentials: vi.fn(),
  getOwnerApiKeyForEngine: vi.fn(),
  isJevEnabled: vi.fn(),
  JevProviderRequestError: class JevProviderRequestError extends Error {
    constructor(readonly reason: string) {
      super(reason);
    }
  },
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
  JevProviderRequestError: mocks.JevProviderRequestError,
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
const scoreQuestion = {
  type: "score" as const,
  name: "urgency",
  instructions: "How soon does this need attention?",
  levels: [
    { label: "none", description: "No action is needed." },
    { label: "this_week", description: "It can wait a few days." },
    { label: "today", description: "It needs attention today." },
  ],
};
const jevScoreAnswer = {
  type: "score",
  score: 2,
  legend: {
    "answer-a": "none: No action is needed.",
    "answer-b": "this_week: It can wait a few days.",
    "answer-c": "today: It needs attention today.",
  },
  probabilities: { "answer-a": 0.2, "answer-b": 0.5, "answer-c": 0.3 },
  confidence: 0.82,
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
    vi.useRealTimers();
    vi.clearAllMocks();
    __resetDecisionCacheForTests();
  });

  it("marks Builder Jev score support as verified", () => {
    expect(DECISION_PROVIDER_CAPABILITIES.jev.builderProxy.score).toEqual({
      status: "verified",
      enabled: true,
    });
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
        timeoutMs: expect.any(Number),
      }),
    );
    const timeoutMs = mocks.requestOpenAiDecision.mock.calls[0]?.[0].timeoutMs;
    expect(timeoutMs).toBeGreaterThan(0);
    expect(timeoutMs).toBeLessThanOrEqual(10_000);
    expect(mocks.getJevContextCredentials).toHaveBeenCalledOnce();
  });

  it("times out when OpenAI credential lookup exceeds the decision budget", async () => {
    vi.useFakeTimers();
    mocks.getOwnerApiKeyForEngine.mockReturnValue(new Promise(() => {}));

    const pending = decide({
      ownerEmail,
      input: "I was charged twice.",
      questions: [choiceQuestion],
      options: { providers: ["openai"], timeoutMs: 1_000 },
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toEqual({
      status: "failed",
      reason: "timeout",
      provider: "openai",
    });
    expect(mocks.requestOpenAiDecision).not.toHaveBeenCalled();
  });

  it("times out during Jev credential lookup before trying another provider", async () => {
    vi.useFakeTimers();
    mocks.getJevContextCredentials.mockReturnValue(
      new Promise<JevContextCredentials>(() => {}),
    );

    const pending = decide({
      ownerEmail,
      input: "I was charged twice.",
      questions: [choiceQuestion],
      options: { providers: ["jev", "openai"], timeoutMs: 1_000 },
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toEqual({
      status: "failed",
      reason: "timeout",
      provider: "jev",
    });
    expect(mocks.getOwnerApiKeyForEngine).not.toHaveBeenCalled();
  });

  it("sends mixed predicate, choice, and score questions through Builder Jev once", async () => {
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
        urgency: jevScoreAnswer,
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
      scoreQuestion,
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
        urgency: {
          type: "score",
          name: "urgency",
          score: 1.1,
          levels: [
            { value: 0, label: "none", description: "No action is needed." },
            {
              value: 1,
              label: "this_week",
              description: "It can wait a few days.",
            },
            {
              value: 2,
              label: "today",
              description: "It needs attention today.",
            },
          ],
          probabilities: [
            { value: 0, probability: 0.2 },
            { value: 1, probability: 0.5 },
            { value: 2, probability: 0.3 },
          ],
          confidence: 0.82,
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
            urgency: {
              type: "score",
              instructions: "How soon does this need attention?",
              criteria: [
                "none: No action is needed.",
                "this_week: It can wait a few days.",
                "today: It needs attention today.",
              ],
            },
          },
        },
      }),
    );
    expect(mocks.requestJev).toHaveBeenCalledOnce();
    expect(mocks.requestOpenAiDecision).not.toHaveBeenCalled();
  });

  it("supports a score-only request through Builder Jev", async () => {
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: undefined,
      personalApiKey: undefined,
      directApiKey: undefined,
      builderAuth: { authorization: "Bearer fake-builder-session" },
    });
    mocks.isJevEnabled.mockResolvedValue(true);
    mocks.requestJev.mockResolvedValue({
      answers: { urgency: jevScoreAnswer },
    });

    const result = await decide({
      ownerEmail,
      input: "A task can wait a few days.",
      questions: [scoreQuestion],
      options: { providers: ["jev"] },
    });

    expect(result).toMatchObject({
      status: "ok",
      provider: "jev",
      answers: { urgency: { type: "score", score: 1.1 } },
    });
    expect(mocks.getJevContextCredentials).toHaveBeenCalledOnce();
    expect(mocks.requestJev).toHaveBeenCalledOnce();
    expect(mocks.requestOpenAiDecision).not.toHaveBeenCalled();
  });

  it.each([
    [
      "missing legend",
      {
        type: "score",
        score: 2,
        probabilities: {
          "answer-a": 0.2,
          "answer-b": 0.5,
          "answer-c": 0.3,
        },
        confidence: 0.82,
      },
    ],
    [
      "missing probabilities",
      {
        type: "score",
        score: 2,
        legend: jevScoreAnswer.legend,
        confidence: 0.82,
      },
    ],
    [
      "out-of-range probability",
      {
        ...jevScoreAnswer,
        probabilities: { ...jevScoreAnswer.probabilities, "answer-b": 1.1 },
      },
    ],
  ] as const)(
    "returns invalid_response for a Jev score with %s",
    async (_case, answer) => {
      mocks.getJevContextCredentials.mockResolvedValue({
        apiKey: "jev-test-key",
        personalApiKey: undefined,
        directApiKey: "jev-test-key",
        builderAuth: null,
      });
      mocks.requestJev.mockResolvedValue({ answers: { urgency: answer } });

      const result = await decide({
        ownerEmail,
        input: "A task can wait a few days.",
        questions: [scoreQuestion],
        options: { providers: ["jev"] },
      });

      expect(result).toEqual({
        status: "failed",
        reason: "invalid_response",
        provider: "jev",
      });
    },
  );

  it("reports verified and unverified question capabilities separately from readiness", async () => {
    const result = await getDecisionsStatus(ownerEmail);

    expect(result.capabilities).toEqual({
      jev: {
        builderProxy: {
          predicate: { status: "verified", enabled: true },
          choice: { status: "verified", enabled: true },
          score: { status: "verified", enabled: true },
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

  it("propagates cancellation during a status credential lookup", async () => {
    let beginLookup!: () => void;
    let resolveLookup!: (value: { apiKey: string }) => void;
    const lookupStarted = new Promise<void>((resolve) => {
      beginLookup = resolve;
    });
    const lookup = new Promise<{ apiKey: string }>((resolve) => {
      resolveLookup = resolve;
    });
    mocks.getOwnerApiKeyForEngine.mockImplementation(async () => {
      beginLookup();
      return lookup;
    });
    const controller = new AbortController();

    const pending = getDecisionsStatus(ownerEmail, {
      signal: controller.signal,
    });
    await lookupStarted;
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    resolveLookup({ apiKey: "openai-test-key" });
    expect(mocks.getJevContextCredentials).toHaveBeenCalledOnce();
  });

  it("checks Jev readiness when the OpenAI status credential lookup times out", async () => {
    vi.useFakeTimers();
    mocks.getOwnerApiKeyForEngine.mockReturnValue(new Promise(() => {}));
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: "jev-test-key",
      personalApiKey: "jev-test-key",
      builderAuth: null,
    });

    const pending = getDecisionsStatus(ownerEmail);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toMatchObject({
      providers: [
        { provider: "openai", status: "unknown" },
        { provider: "jev", status: "ready" },
      ],
    });
    expect(mocks.getJevContextCredentials).toHaveBeenCalledOnce();
  });

  it("bounds status credential and entitlement checks to the configured timeout", async () => {
    vi.useFakeTimers();
    mocks.getOwnerApiKeyForEngine.mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
      return { apiKey: "openai-test-key" };
    });
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: undefined,
      personalApiKey: undefined,
      builderAuth: {
        authorization: "Bearer fake-builder-session",
        spaceId: "space-test",
        userId: "user-test",
      },
    });
    mocks.isJevEnabled.mockReturnValue(new Promise(() => {}));

    const pending = getDecisionsStatus(ownerEmail);
    await vi.advanceTimersByTimeAsync(6_000);

    await expect(pending).resolves.toMatchObject({
      providers: [
        { provider: "openai", status: "ready" },
        { provider: "jev", status: "unknown" },
      ],
    });
    expect(mocks.isJevEnabled).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ timeoutMs: 6_000 }),
    );
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

  it("uses a scoped Jev key when Builder auth lookup fails", async () => {
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: "org-jev-test-key",
      personalApiKey: undefined,
      directApiKey: "org-jev-test-key",
      builderAuth: null,
      builderAuthLookupFailed: true,
    });
    mocks.requestJev.mockResolvedValue({
      answers: { urgent: { type: "noul", noul: 0.95 } },
    });

    const result = await decide({
      ownerEmail,
      input: "A ticket",
      questions: [
        {
          type: "predicate",
          name: "urgent",
          instructions: "Is this urgent?",
        },
      ],
      options: { providers: ["jev"] },
    });

    expect(result).toMatchObject({ status: "ok", provider: "jev" });
    expect(mocks.requestJev).toHaveBeenCalledWith(
      expect.objectContaining({ directApiKey: "org-jev-test-key" }),
    );
    expect(mocks.isJevEnabled).not.toHaveBeenCalled();
  });

  it("uses a verified Builder gateway when the direct Jev key lookup fails", async () => {
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: undefined,
      personalApiKey: undefined,
      directApiKey: undefined,
      builderAuth: {
        authorization: "Bearer fake-builder-session",
        spaceId: "space-test",
        userId: "user-test",
      },
      apiKeyLookupFailed: true,
    });
    mocks.isJevEnabled.mockResolvedValue(true);
    mocks.requestJev.mockResolvedValue({
      answers: { urgent: { type: "noul", noul: 0.95 } },
    });

    const result = await decide({
      ownerEmail,
      input: "A ticket",
      questions: [
        {
          type: "predicate",
          name: "urgent",
          instructions: "Is this urgent?",
        },
      ],
      options: { providers: ["jev"] },
    });

    expect(result).toMatchObject({ status: "ok", provider: "jev" });
    expect(mocks.requestJev).toHaveBeenCalledWith(
      expect.objectContaining({ builderAuth: expect.anything() }),
    );
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

  it("does not use a deployment key after an owner credential lookup fails", async () => {
    mocks.getOwnerApiKeyForEngine.mockImplementation(
      async (_engine, _email, options) => {
        options?.onLookupFailure?.();
        return {
          apiKey: "deployment-key",
          credentialProvenance: { scope: "deployment" },
        };
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
    expect(mocks.getOwnerApiKeyForEngine).toHaveBeenCalledWith(
      "ai-sdk:openai",
      ownerEmail,
      expect.objectContaining({ allowDeploymentFallback: false }),
    );
    expect(mocks.requestOpenAiDecision).not.toHaveBeenCalled();
  });

  it("returns aborted when cancellation arrives during credential lookup before a cache hit", async () => {
    const request = {
      ownerEmail,
      input: "I was charged twice.",
      questions: [choiceQuestion],
      options: { cacheKey: "ticket-cancelled-during-lookup" },
    };
    await decide(request);

    let beginLookup!: () => void;
    let resolveLookup!: (value: { apiKey: string }) => void;
    const lookupStarted = new Promise<void>((resolve) => {
      beginLookup = resolve;
    });
    const lookup = new Promise<{ apiKey: string }>((resolve) => {
      resolveLookup = resolve;
    });
    mocks.getOwnerApiKeyForEngine.mockImplementation(async () => {
      beginLookup();
      return lookup;
    });

    const controller = new AbortController();
    const pending = decide({
      ...request,
      options: { ...request.options, signal: controller.signal },
    });
    await lookupStarted;
    controller.abort();

    await expect(pending).resolves.toEqual({
      status: "failed",
      reason: "aborted",
      provider: "openai",
    });
    resolveLookup({ apiKey: "openai-test-key" });
    expect(mocks.requestOpenAiDecision).toHaveBeenCalledOnce();
  });

  it("returns aborted when cancellation arrives during Jev credential lookup", async () => {
    let beginLookup!: () => void;
    let resolveLookup!: (value: JevContextCredentials) => void;
    const lookupStarted = new Promise<void>((resolve) => {
      beginLookup = resolve;
    });
    const lookup = new Promise<JevContextCredentials>((resolve) => {
      resolveLookup = resolve;
    });
    mocks.getJevContextCredentials.mockImplementation(async () => {
      beginLookup();
      return lookup;
    });

    const controller = new AbortController();
    const pending = decide({
      ownerEmail,
      input: "A ticket",
      questions: [choiceQuestion],
      options: { providers: ["jev"], signal: controller.signal },
    });
    await lookupStarted;
    controller.abort();

    await expect(pending).resolves.toEqual({
      status: "failed",
      reason: "aborted",
      provider: "jev",
    });
    resolveLookup({
      apiKey: undefined,
      personalApiKey: undefined,
      builderAuth: null,
    });
    expect(mocks.requestJev).not.toHaveBeenCalled();
  });

  it("preserves typed Jev timeout errors", async () => {
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: undefined,
      personalApiKey: undefined,
      builderAuth: {
        authorization: "Bearer fake-builder-session",
        spaceId: "space-test",
        userId: "user-test",
      },
    });
    mocks.isJevEnabled.mockResolvedValue(true);
    mocks.requestJev.mockRejectedValue(
      new mocks.JevProviderRequestError("timeout"),
    );

    const result = await decide({
      ownerEmail,
      input: "A ticket",
      questions: [
        {
          type: "predicate",
          name: "urgent",
          instructions: "Is this urgent?",
        },
      ],
      options: { providers: ["jev"] },
    });

    expect(result).toEqual({
      status: "failed",
      reason: "timeout",
      provider: "jev",
    });
  });

  it("shares the signal and remaining timeout with Jev entitlement and request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: undefined,
      personalApiKey: undefined,
      builderAuth: {
        authorization: "Bearer fake-builder-session",
        spaceId: "space-test",
        userId: "user-test",
      },
    });
    mocks.isJevEnabled.mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(400);
      return true;
    });
    mocks.requestJev.mockResolvedValue({
      answers: { urgent: { type: "noul", noul: 0.95 } },
    });
    const controller = new AbortController();

    const result = await decide({
      ownerEmail,
      input: "A ticket",
      questions: [
        {
          type: "predicate",
          name: "urgent",
          instructions: "Is this urgent?",
        },
      ],
      options: { providers: ["jev"], signal: controller.signal },
    });

    expect(result).toMatchObject({ status: "ok", provider: "jev" });
    expect(mocks.isJevEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ builderAuth: expect.anything() }),
      { signal: controller.signal, timeoutMs: 10_000 },
    );
    expect(mocks.requestJev).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal, timeoutMs: 9_600 }),
    );
  });

  it("passes the remaining decision deadline to OpenAI after Jev is disabled", async () => {
    vi.useFakeTimers();
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: undefined,
      personalApiKey: undefined,
      builderAuth: {
        authorization: "Bearer fake-builder-session",
        spaceId: "space-test",
        userId: "user-test",
      },
    });
    mocks.isJevEnabled.mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
      return false;
    });

    const result = await decide({
      ownerEmail,
      input: "I was charged twice.",
      questions: [choiceQuestion],
      options: { providers: ["jev", "openai"], timeoutMs: 10_000 },
    });

    expect(result).toMatchObject({ status: "ok", provider: "openai" });
    expect(mocks.requestOpenAiDecision).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 6_000 }),
    );
  });

  it("returns aborted when cancellation arrives during the Jev entitlement check", async () => {
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: undefined,
      personalApiKey: undefined,
      builderAuth: {
        authorization: "Bearer fake-builder-session",
        spaceId: "space-test",
        userId: "user-test",
      },
    });
    let beginEntitlementCheck!: () => void;
    const entitlementStarted = new Promise<void>((resolve) => {
      beginEntitlementCheck = resolve;
    });
    mocks.isJevEnabled.mockImplementation(
      async (_credentials, options) =>
        new Promise((_resolve, reject) => {
          beginEntitlementCheck();
          options?.signal?.addEventListener(
            "abort",
            () => reject(new mocks.JevProviderRequestError("aborted")),
            { once: true },
          );
        }),
    );
    const controller = new AbortController();
    const pending = decide({
      ownerEmail,
      input: "A ticket",
      questions: [
        {
          type: "predicate",
          name: "urgent",
          instructions: "Is this urgent?",
        },
      ],
      options: { providers: ["jev"], signal: controller.signal },
    });

    await entitlementStarted;
    controller.abort();

    await expect(pending).resolves.toEqual({
      status: "failed",
      reason: "aborted",
      provider: "jev",
    });
    expect(mocks.requestJev).not.toHaveBeenCalled();
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
