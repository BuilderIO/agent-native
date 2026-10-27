import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  getAiFilterState: vi.fn(),
  executeActions: vi.fn(),
  emit: vi.fn(),
  emitAsync: vi.fn(),
  hasEventAutomation: vi.fn(),
  activeRules: [] as Array<Record<string, unknown>>,
  userSettings: new Map<string, unknown>(),
  getUserSetting: vi.fn(),
  mutateUserSetting: vi.fn(),
  putUserSetting: vi.fn(),
  gmailGetProfile: vi.fn(),
  gmailListHistory: vi.fn(),
  gmailListMessages: vi.fn(),
  gmailGetMessage: vi.fn(),
  gmailBatchGetMessages: vi.fn(),
  isResolvedEngineUsableForRequest: vi.fn(),
  readDeployCredentialEnv: vi.fn(),
  registerBuiltinEngines: vi.fn(),
  resolveCredential: vi.fn(),
  resolveEngine: vi.fn(),
  resolveTextAutomationModelSettings: vi.fn(),
  decide: vi.fn(),
  getDecisionsStatus: vi.fn(),
  recordUsage: vi.fn(),
}));

vi.mock("@agent-native/core/agent/engine", () => ({
  isResolvedEngineUsableForRequest: mocks.isResolvedEngineUsableForRequest,
  registerBuiltinEngines: mocks.registerBuiltinEngines,
  resolveEngine: mocks.resolveEngine,
}));
vi.mock("@agent-native/core/decisions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/decisions")>()),
  decide: mocks.decide,
  getDecisionsStatus: mocks.getDecisionsStatus,
}));
vi.mock("@agent-native/core/usage", () => ({
  recordUsage: mocks.recordUsage,
}));
vi.mock("@agent-native/core/credentials", () => ({
  resolveCredential: mocks.resolveCredential,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestContext: () => undefined,
  readDeployCredentialEnv: mocks.readDeployCredentialEnv,
  runWithRequestContext: (_context: unknown, callback: () => unknown) =>
    callback(),
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
  mutateUserSetting: mocks.mutateUserSetting,
  putUserSetting: mocks.putUserSetting,
}));
vi.mock("@agent-native/core/event-bus", () => ({
  emit: mocks.emit,
  emitAsync: mocks.emitAsync,
}));
vi.mock("@agent-native/core/triggers", () => ({
  hasEventAutomation: mocks.hasEventAutomation,
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  and: vi.fn(),
  eq: vi.fn(),
}));
vi.mock("../db/index.js", () => ({
  db: { select: mocks.dbSelect },
  schema: {
    automationRules: { ownerEmail: {}, domain: {}, enabled: {} },
  },
}));
vi.mock("./ai-filter.js", () => ({
  getAiFilterState: mocks.getAiFilterState,
  recordAiFilterDecisions: vi.fn(),
}));
vi.mock("./automation-actions.js", () => ({
  buildLabelCache: vi.fn(),
  executeActions: mocks.executeActions,
}));
vi.mock("./automation-model.js", () => ({
  resolveTextAutomationModelSettings: mocks.resolveTextAutomationModelSettings,
}));
vi.mock("./google-api.js", () => ({
  gmailGetProfile: mocks.gmailGetProfile,
  gmailListHistory: mocks.gmailListHistory,
  gmailListMessages: mocks.gmailListMessages,
  gmailGetMessage: mocks.gmailGetMessage,
  gmailBatchGetMessages: mocks.gmailBatchGetMessages,
}));
vi.mock("./google-auth.js", () => ({}));

import { MAX_DECISION_PAYLOAD_BYTES } from "@agent-native/core/decisions";

import { aiPriorityEmailKey } from "../../shared/ai-priority.js";
import {
  evaluateAiFilterBackfillRules,
  previewAutomationPriority,
  previewAutomationRules,
  processAutomationsForAccount,
  rewriteAutomationRuleCondition,
} from "./automation-engine.js";

const email = {
  id: "email-1",
  threadId: "thread-1",
  accountEmail: "owner@example.com",
  from: "sender@example.test",
  to: "owner@example.com",
  subject: "Synthetic email",
  snippet: "Synthetic content",
  labelIds: ["INBOX"],
  date: "2026-09-22T00:00:00.000Z",
  isArchived: false,
  isTrashed: false,
};

function decisionResult(
  questions: Array<{ name: string; type: string }>,
  {
    probabilities = [],
    provider = "jev",
    model = provider === "jev" ? "jev-latest" : "gpt-6-luna",
    failures = [],
    refusals = [],
  }: {
    probabilities?: number[];
    provider?: "jev" | "openai";
    model?: string;
    failures?: string[];
    refusals?: string[];
  } = {},
) {
  const answers = Object.fromEntries(
    questions.flatMap((question, index) => {
      if (failures.includes(question.name)) return [];
      return [
        [
          question.name,
          refusals.includes(question.name)
            ? { type: "refusal", name: question.name }
            : {
                type: question.type,
                name: question.name,
                probability: probabilities[index] ?? 0.91,
              },
        ],
      ];
    }),
  );
  return {
    status: "ok",
    provider,
    model,
    answers,
    ...(failures.length
      ? {
          questionFailures: Object.fromEntries(
            failures.map((name) => [name, "invalid_response"]),
          ),
        }
      : {}),
  };
}

describe("Mail decision automation routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.gmailGetProfile.mockReset();
    mocks.gmailListHistory.mockReset();
    mocks.gmailListMessages.mockReset();
    mocks.gmailGetMessage.mockReset();
    mocks.gmailBatchGetMessages.mockReset();
    mocks.userSettings.clear();
    mocks.hasEventAutomation.mockResolvedValue(false);
    mocks.activeRules = [{ id: "rule-1", kind: "automation", actions: "[]" }];
    mocks.getDecisionsStatus.mockResolvedValue({
      providerOrder: ["jev", "openai"],
      providers: [
        { provider: "jev", status: "ready" },
        { provider: "openai", status: "not_configured" },
      ],
    });
    mocks.getAiFilterState.mockResolvedValue({ enabled: false, feedback: [] });
    mocks.emitAsync.mockResolvedValue(undefined);
    mocks.getUserSetting.mockImplementation(
      async (owner: string, key: string) =>
        mocks.userSettings.get(`${owner}:${key}`) ?? null,
    );
    mocks.putUserSetting.mockImplementation(
      async (owner: string, key: string, value: unknown) => {
        mocks.userSettings.set(`${owner}:${key}`, value);
      },
    );
    mocks.mutateUserSetting.mockImplementation(
      async (
        owner: string,
        key: string,
        updater: (
          current: Record<string, unknown> | null,
        ) => Record<string, unknown>,
      ) => {
        const settingKey = `${owner}:${key}`;
        const current = mocks.userSettings.get(settingKey);
        const next = updater(
          current && typeof current === "object"
            ? (current as Record<string, unknown>)
            : null,
        );
        mocks.userSettings.set(settingKey, next);
        return next;
      },
    );
    mocks.gmailGetProfile.mockResolvedValue({ historyId: "history-1" });
    mocks.gmailListHistory.mockResolvedValue({ historyId: "history-2" });
    mocks.gmailListMessages.mockResolvedValue({ messages: [] });
    mocks.gmailGetMessage.mockResolvedValue({});
    mocks.gmailBatchGetMessages.mockResolvedValue([]);
    mocks.resolveCredential.mockResolvedValue(undefined);
    mocks.resolveEngine.mockImplementation(
      async (options: { apiKey?: string }) => ({
        defaultModel: "claude-sonnet-5",
        stream: vi.fn(),
        configured: Boolean(options.apiKey),
      }),
    );
    mocks.isResolvedEngineUsableForRequest.mockImplementation(
      async (engine: { configured?: boolean }) => Boolean(engine.configured),
    );
    mocks.readDeployCredentialEnv.mockReturnValue(undefined);
    mocks.dbSelect.mockReturnValue({
      from: () => ({
        where: async () => [...mocks.activeRules],
      }),
    });
    mocks.decide.mockImplementation(
      async ({
        questions,
      }: {
        questions: Array<{ name: string; type: string }>;
      }) => decisionResult(questions),
    );
    mocks.resolveTextAutomationModelSettings.mockResolvedValue({});
    mocks.recordUsage.mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("evaluates Mail AI rules through the shared decision action", async () => {
    const result = await previewAutomationRules(
      [email],
      [
        {
          id: "rule-1",
          name: "Important",
          condition: "Finance updates",
          actions: [],
        },
      ],
      "owner@example.com",
    );

    expect(
      result.matches.get(aiPriorityEmailKey(email.accountEmail, email.id)),
    ).toEqual([
      expect.objectContaining({
        ruleId: "rule-1",
        confidence: 0.91,
        provider: "jev",
        model: "jev-latest",
      }),
    ]);
    expect(result).toMatchObject({ evaluatedCount: 1, failedCount: 0 });
    expect(mocks.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: "owner@example.com",
        questions: [expect.objectContaining({ type: "predicate" })],
      }),
    );
    expect(mocks.resolveTextAutomationModelSettings).not.toHaveBeenCalled();
  });

  it("keeps AI-filter results distinct for matching IDs across accounts", async () => {
    mocks.decide.mockImplementationOnce(
      async ({
        questions,
      }: {
        questions: Array<{ name: string; type: string }>;
      }) => decisionResult(questions, { probabilities: [0.2, 0.91] }),
    );
    const firstAccount = "first@example.test";
    const secondAccount = "second@example.test";
    const result = await previewAutomationRules(
      [
        { ...email, accountEmail: firstAccount },
        { ...email, accountEmail: secondAccount },
      ],
      [
        {
          id: "rule-1",
          name: "Important",
          condition: "Finance updates",
          actions: [],
        },
      ],
      "owner@example.com",
    );

    expect(
      result.matches.get(aiPriorityEmailKey(firstAccount, email.id)),
    ).toEqual([]);
    expect(
      result.matches.get(aiPriorityEmailKey(secondAccount, email.id)),
    ).toEqual([
      expect.objectContaining({ ruleId: "rule-1", confidence: 0.91 }),
    ]);
  });

  it("preserves a complete no-match classification", async () => {
    mocks.decide.mockImplementationOnce(
      async ({
        questions,
      }: {
        questions: Array<{ name: string; type: string }>;
      }) => decisionResult(questions, { probabilities: [0.2] }),
    );
    const result = await previewAutomationRules(
      [email],
      [
        {
          id: "rule-1",
          name: "Important",
          condition: "Finance updates",
          actions: [],
        },
      ],
      "owner@example.com",
    );

    expect(
      result.matches.get(aiPriorityEmailKey(email.accountEmail, email.id)),
    ).toEqual([]);
    expect(result).toMatchObject({ evaluatedCount: 1, failedCount: 0 });
  });

  it("keeps long rule conditions in structured input instead of question instructions", async () => {
    const condition = "important detail ".repeat(400);
    mocks.decide.mockImplementationOnce(
      async ({
        input,
        questions,
      }: {
        input: Array<{ value: { rules: Array<{ condition: string }> } }>;
        questions: Array<{ name: string; type: string; instructions: string }>;
      }) => {
        expect(input[0]?.value.rules[0]?.condition).toBe(condition);
        expect(questions[0]?.instructions.length).toBeLessThan(4_000);
        return decisionResult(questions);
      },
    );

    const result = await previewAutomationRules(
      [email],
      [
        {
          id: "rule-1",
          name: "Important",
          condition,
          actions: [],
        },
      ],
      "owner@example.com",
    );

    expect(result).toMatchObject({ evaluatedCount: 1, failedCount: 0 });
  });

  it("includes only the latest twenty saved feedback examples in rule input", async () => {
    const feedback = Array.from({ length: 25 }, (_, index) => ({
      id: `feedback-${index}`,
      disposition: index % 2 === 0 ? ("spam" as const) : ("not_spam" as const),
      sender: `sender-${index}@example.test`,
      subject: `Subject ${index}`,
      comment: `Note ${index}`,
      createdAt: index,
    }));
    mocks.getAiFilterState.mockResolvedValue({ enabled: true, feedback });
    mocks.decide.mockImplementationOnce(
      async ({
        input,
        questions,
      }: {
        input: Array<{
          value: {
            feedback: Array<Record<string, unknown>>;
          };
        }>;
        questions: Array<{
          name: string;
          type: string;
          instructions: string;
        }>;
      }) => {
        expect(input[0]?.value.feedback).toEqual(
          feedback
            .slice(-20)
            .map(({ disposition, sender, subject, comment }) => ({
              decision: disposition === "spam" ? "unwanted" : "keep",
              sender,
              subject,
              comment,
            })),
        );
        expect(questions[0]?.instructions).toContain("user-confirmed feedback");
        expect(
          new TextEncoder().encode(JSON.stringify({ input, questions }))
            .byteLength,
        ).toBeLessThanOrEqual(MAX_DECISION_PAYLOAD_BYTES);
        return decisionResult(questions);
      },
    );

    const result = await previewAutomationRules(
      [email],
      [
        {
          id: "rule-1",
          name: "Important",
          condition: "Finance updates",
          actions: [],
        },
      ],
      "owner@example.com",
    );

    expect(result).toMatchObject({ evaluatedCount: 1, failedCount: 0 });
  });

  it("reports a single rule above the payload limit without aborting evaluation", async () => {
    const result = await previewAutomationRules(
      [email],
      [
        {
          id: "rule-1",
          name: "Important",
          condition: "x".repeat(MAX_DECISION_PAYLOAD_BYTES + 1),
          actions: [],
        },
      ],
      "owner@example.com",
    );

    expect(result).toMatchObject({ evaluatedCount: 0, failedCount: 1 });
    expect(result.failures).toEqual([
      expect.objectContaining({
        emailId: email.id,
        ruleId: "rule-1",
        reason: "invalid_input",
        retryable: false,
      }),
    ]);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("reports refusal and omitted answers per email without creating scores", async () => {
    const messages = [
      { ...email, id: "matched" },
      { ...email, id: "omitted" },
      { ...email, id: "refused" },
    ];
    mocks.decide.mockImplementationOnce(
      async ({
        questions,
      }: {
        questions: Array<{ name: string; type: string }>;
      }) =>
        decisionResult(questions, {
          probabilities: [0.91, 0, 0],
          failures: ["q_1"],
          refusals: ["q_2"],
        }),
    );

    const result = await previewAutomationPriority(
      messages,
      "owner@example.com",
      "Prioritize work messages.",
    );

    expect(
      result.scores.get(aiPriorityEmailKey(email.accountEmail, "matched")),
    ).toMatchObject({ score: 0.91 });
    expect(
      result.scores.has(aiPriorityEmailKey(email.accountEmail, "omitted")),
    ).toBe(false);
    expect(
      result.scores.has(aiPriorityEmailKey(email.accountEmail, "refused")),
    ).toBe(false);
    expect(result).toMatchObject({ evaluatedCount: 1, failedCount: 2 });
    expect(result.failures).toEqual([
      expect.objectContaining({
        emailId: "omitted",
        reason: "invalid_response",
      }),
      expect.objectContaining({ emailId: "refused", reason: "refusal" }),
    ]);
  });

  it("reports a fully incomplete priority response as failed emails", async () => {
    const messages = [
      { ...email, id: "first" },
      { ...email, id: "second" },
    ];
    mocks.decide.mockImplementationOnce(
      async ({
        questions,
      }: {
        questions: Array<{ name: string; type: string }>;
      }) => decisionResult(questions, { failures: ["q_0", "q_1"] }),
    );

    const result = await previewAutomationPriority(
      messages,
      "owner@example.com",
      "Prioritize work messages.",
    );

    expect(result.scores.size).toBe(0);
    expect(result).toMatchObject({ evaluatedCount: 0, failedCount: 2 });
    expect(result.failures).toEqual([
      expect.objectContaining({ emailId: "first", reason: "invalid_response" }),
      expect.objectContaining({
        emailId: "second",
        reason: "invalid_response",
      }),
    ]);
  });

  it("uses the OpenAI decision result for rule scoring when Jev is unavailable", async () => {
    mocks.getDecisionsStatus.mockResolvedValue({
      providerOrder: ["jev", "openai"],
      providers: [
        { provider: "jev", status: "not_configured" },
        { provider: "openai", status: "ready" },
      ],
    });
    mocks.decide.mockImplementationOnce(
      async ({
        questions,
      }: {
        questions: Array<{ name: string; type: string }>;
      }) =>
        decisionResult(questions, {
          provider: "openai",
          probabilities: [0.84],
        }),
    );

    const result = await evaluateAiFilterBackfillRules(
      [email],
      [
        {
          id: "rule-1",
          name: "Important",
          condition: "Finance updates",
          actions: [],
        },
      ],
      "owner@example.com",
      [],
    );

    expect(result.model).toEqual({ provider: "openai", model: "gpt-6-luna" });
    expect(
      result.matches.get(aiPriorityEmailKey(email.accountEmail, email.id)),
    ).toEqual([
      expect.objectContaining({
        provider: "openai",
        model: "gpt-6-luna",
        confidence: 0.84,
      }),
    ]);
  });

  it("splits long rule requests at the serialized decision payload limit", async () => {
    const rules = Array.from({ length: 80 }, (_, index) => ({
      id: `large-rule-${index}`,
      name: `Large rule ${index}`,
      condition: `Match this phrase ${"x".repeat(3_500)}`,
      actions: [],
    }));
    mocks.decide.mockImplementation(
      async ({
        questions,
      }: {
        questions: Array<{ name: string; type: string }>;
      }) => decisionResult(questions),
    );

    const result = await evaluateAiFilterBackfillRules(
      [email],
      rules,
      "owner@example.com",
      [],
    );

    expect(result.evaluatedCount).toBe(rules.length);
    expect(mocks.decide.mock.calls.length).toBeGreaterThan(1);
    for (const [request] of mocks.decide.mock.calls) {
      const serialized = JSON.stringify({
        input: request.input,
        questions: request.questions,
      });
      expect(
        new TextEncoder().encode(serialized).byteLength,
      ).toBeLessThanOrEqual(MAX_DECISION_PAYLOAD_BYTES);
    }
  });

  it("records usage with the actual decision provider and model", async () => {
    mocks.decide.mockImplementationOnce(
      async ({
        questions,
      }: {
        questions: Array<{ name: string; type: string }>;
      }) => ({
        ...decisionResult(questions, { provider: "openai" }),
        usage: { inputTokens: 12, outputTokens: 4 },
      }),
    );

    await previewAutomationRules(
      [email],
      [
        {
          id: "rule-1",
          name: "Important",
          condition: "Finance updates",
          actions: [],
        },
      ],
      "owner@example.com",
    );

    expect(mocks.recordUsage).toHaveBeenCalledWith({
      ownerEmail: "owner@example.com",
      inputTokens: 12,
      outputTokens: 4,
      model: "gpt-6-luna",
      engineName: "openai",
      label: "automation",
      app: "mail",
    });
  });

  it("splits Priority requests by serialized bytes and keeps guidance out of questions", async () => {
    const emails = Array.from({ length: 50 }, (_, index) => ({
      ...email,
      id: `large-${index}`,
      subject: "\u0000".repeat(500),
      snippet: "\u0000".repeat(2_000),
    }));
    const requestBytes: number[] = [];
    const guidance = "Prioritize the user's guidance. ".repeat(200);
    mocks.decide.mockImplementation(
      async ({
        input,
        questions,
      }: {
        input: Array<{ value: { guidance: string } }>;
        questions: Array<{ name: string; type: string; instructions: string }>;
      }) => {
        requestBytes.push(
          new TextEncoder().encode(JSON.stringify({ input, questions }))
            .byteLength,
        );
        expect(input[0]?.value.guidance).toBe(guidance);
        expect(
          questions.every((question) => question.instructions.length < 4_000),
        ).toBe(true);
        return decisionResult(questions);
      },
    );

    const result = await previewAutomationPriority(
      emails,
      "owner@example.com",
      guidance,
    );

    expect(requestBytes.length).toBeGreaterThan(1);
    expect(
      requestBytes.every((size) => size <= MAX_DECISION_PAYLOAD_BYTES),
    ).toBe(true);
    expect(result).toMatchObject({ evaluatedCount: 50, failedCount: 0 });
  });

  it("reports a single Priority email above the payload limit without calling the provider", async () => {
    const result = await previewAutomationPriority(
      [email],
      "owner@example.com",
      "x".repeat(MAX_DECISION_PAYLOAD_BYTES + 1),
    );

    expect(result).toMatchObject({ evaluatedCount: 0, failedCount: 1 });
    expect(result.failures).toEqual([
      expect.objectContaining({
        emailId: email.id,
        reason: "invalid_input",
        retryable: false,
      }),
    ]);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("warns when usage recording fails without failing the rule evaluation", async () => {
    mocks.recordUsage.mockRejectedValueOnce(new Error("usage unavailable"));
    mocks.decide.mockImplementationOnce(
      async ({
        questions,
      }: {
        questions: Array<{ name: string; type: string }>;
      }) => ({
        ...decisionResult(questions),
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    );
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      const result = await previewAutomationRules(
        [email],
        [
          {
            id: "rule-1",
            name: "Important",
            condition: "Finance updates",
            actions: [],
          },
        ],
        "owner@example.com",
      );

      expect(result.failedCount).toBe(0);
      expect(
        result.matches.get(aiPriorityEmailKey(email.accountEmail, email.id)),
      ).toHaveLength(1);
      expect(warning).toHaveBeenCalledWith(
        "[automation-engine] Mail decision usage recording failed.",
      );
    } finally {
      warning.mockRestore();
    }
  });

  it("keeps priority answers distinct across accounts and records the provider model", async () => {
    mocks.decide.mockImplementationOnce(
      async ({
        questions,
      }: {
        questions: Array<{ name: string; type: string }>;
      }) =>
        decisionResult(questions, {
          provider: "openai",
          probabilities: [0.2, 0.9],
        }),
    );
    const result = await previewAutomationPriority(
      [
        { ...email, accountEmail: "first@example.test" },
        { ...email, accountEmail: "second@example.test" },
      ],
      "owner@example.com",
      "Prioritize work messages.",
    );

    expect(
      result.scores.get(aiPriorityEmailKey("first@example.test", email.id)),
    ).toMatchObject({ score: 0.2, provider: "openai", model: "gpt-6-luna" });
    expect(
      result.scores.get(aiPriorityEmailKey("second@example.test", email.id)),
    ).toMatchObject({ score: 0.9, provider: "openai", model: "gpt-6-luna" });
    const request = mocks.decide.mock.calls[0]?.[0] as {
      input: Array<{ value: { emails: Array<Record<string, unknown>> } }>;
    };
    expect(request.input[0]?.value.emails[0]).not.toHaveProperty("labels");
  });

  it("scores priority batches with a concurrency limit of three", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mocks.decide.mockImplementation(
      async ({
        questions,
      }: {
        questions: Array<{ name: string; type: string }>;
      }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return decisionResult(questions, {
          probabilities: questions.map(() => 0.7),
        });
      },
    );
    const emails = Array.from({ length: 200 }, (_, index) => ({
      ...email,
      id: "email-" + index,
      threadId: "thread-" + index,
    }));

    const result = await previewAutomationPriority(
      emails,
      "owner@example.com",
      "Prioritize work messages.",
    );

    expect(mocks.decide).toHaveBeenCalledTimes(4);
    expect(maxInFlight).toBe(3);
    expect(result.scores.size).toBe(200);
  });

  it("keeps decision batches within the provider question limit", async () => {
    const emails = Array.from({ length: 20 }, (_, index) => ({
      ...email,
      id: "email-" + index,
    }));
    const rules = Array.from({ length: 21 }, (_, index) => ({
      id: "rule-" + index,
      name: "Rule " + index,
      condition: "Condition " + index,
      actions: [],
    }));

    const result = await previewAutomationRules(
      emails,
      rules,
      "owner@example.com",
    );

    const requests = mocks.decide.mock.calls.map(
      ([input]) => input as { questions: Array<unknown> },
    );
    expect(requests.map(({ questions }) => questions.length)).toEqual([
      400, 20,
    ]);
    expect(result.evaluatedCount).toBe(420);
  });

  it("continues to use a text model for rewriting AI-filter rules", async () => {
    mocks.resolveTextAutomationModelSettings.mockResolvedValue({
      engine: "anthropic",
      model: "claude-sonnet-5",
    });
    mocks.resolveCredential.mockResolvedValue(undefined);
    mocks.readDeployCredentialEnv.mockReturnValue(undefined);
    mocks.resolveEngine.mockResolvedValue({
      defaultModel: "claude-sonnet-5",
      stream: async function* () {
        yield { type: "text-delta", text: "Invoices from the finance team" };
      },
    });

    await expect(
      rewriteAutomationRuleCondition(
        "owner@example.com",
        { id: "rule-1", name: "Important", condition: "Old rule", actions: [] },
        [],
      ),
    ).resolves.toBe("Invoices from the finance team");
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("reports unavailable decision status during automation polling", async () => {
    mocks.getDecisionsStatus.mockRejectedValue(
      new Error("Decision provider status unavailable"),
    );

    await expect(
      processAutomationsForAccount(
        "owner@example.com",
        "mailbox@example.com",
        "google-access-token",
      ),
    ).resolves.toMatchObject({
      accountEmail: "mailbox@example.com",
      messagesProcessed: 0,
      errors: 1,
    });
  });

  it("emits received-mail events for new arrivals without local rules or Jev", async () => {
    mocks.activeRules = [];
    mocks.hasEventAutomation.mockResolvedValue(true);
    const ownerEmail = "owner@example.com";
    const accountEmail = "mailbox@example.com";

    await processAutomationsForAccount(
      ownerEmail,
      accountEmail,
      "google-access-token",
    );

    mocks.gmailListHistory.mockResolvedValueOnce({
      historyId: "history-2",
      history: [
        {
          messagesAdded: [
            { message: { id: "incoming-1", labelIds: ["INBOX"] } },
          ],
        },
      ],
    });
    mocks.gmailBatchGetMessages.mockResolvedValueOnce([
      {
        id: "incoming-1",
        data: {
          id: "incoming-1",
          threadId: "thread-1",
          labelIds: ["INBOX"],
          snippet: "The agenda is attached.",
          payload: {
            headers: [
              { name: "From", value: "person@example.test" },
              { name: "To", value: accountEmail },
              { name: "Subject", value: "Meeting agenda" },
            ],
          },
        },
      },
    ]);

    await processAutomationsForAccount(
      ownerEmail,
      accountEmail,
      "google-access-token",
    );

    expect(mocks.emit).not.toHaveBeenCalled();
    expect(mocks.emitAsync).toHaveBeenCalledWith(
      "mail.message.received",
      expect.objectContaining({
        messageId: "incoming-1",
        accountEmail,
        subject: "Meeting agenda",
      }),
      expect.objectContaining({
        owner: ownerEmail,
        eventId: `mail.message.received:${accountEmail}:incoming-1`,
      }),
    );
    expect(mocks.getDecisionsStatus).not.toHaveBeenCalled();
  });

  it("aborts an in-flight Gmail read and still releases the poll lease", async () => {
    mocks.activeRules = [];
    mocks.hasEventAutomation.mockResolvedValue(true);
    const ownerEmail = "owner@example.com";
    const accountEmail = "mailbox@example.com";
    const watermarkKey = `${ownerEmail}:mail-received-events:${accountEmail}:watermark`;
    mocks.userSettings.set(watermarkKey, {
      lastHistoryId: "history-1",
      lastTimestamp: Date.now(),
    });

    let signalHistoryStarted = () => {};
    const historyStarted = new Promise<void>((resolve) => {
      signalHistoryStarted = resolve;
    });
    mocks.gmailListHistory.mockImplementationOnce(
      (
        _accessToken: string,
        _params: unknown,
        _lane: string,
        signal?: AbortSignal,
      ) =>
        new Promise((_resolve, reject) => {
          if (!signal) throw new Error("Expected the sweep signal.");
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
          signalHistoryStarted();
        }),
    );

    const controller = new AbortController();
    const poll = processAutomationsForAccount(
      ownerEmail,
      accountEmail,
      "google-access-token",
      controller.signal,
    );
    await historyStarted;
    controller.abort();

    await expect(poll).rejects.toBe(controller.signal.reason);
    expect(mocks.gmailListHistory).toHaveBeenCalledWith(
      "google-access-token",
      expect.objectContaining({ startHistoryId: "history-1" }),
      "incremental",
      controller.signal,
    );
    expect(mocks.gmailListMessages).not.toHaveBeenCalled();
    expect(mocks.gmailBatchGetMessages).not.toHaveBeenCalled();
    expect(mocks.emitAsync).not.toHaveBeenCalled();
    expect(mocks.executeActions).not.toHaveBeenCalled();
    expect(
      mocks.userSettings.get(
        `${ownerEmail}:mail-automation-poll:${accountEmail}:lease`,
      ),
    ).toEqual({ claimToken: "", leaseUntil: 0 });
  });

  it("drains paginated received-mail history without skipping overflow", async () => {
    mocks.activeRules = [];
    mocks.hasEventAutomation.mockResolvedValue(true);
    const ownerEmail = "owner@example.com";
    const accountEmail = "mailbox@example.com";

    await processAutomationsForAccount(
      ownerEmail,
      accountEmail,
      "google-access-token",
    );

    const messageIds = Array.from(
      { length: 60 },
      (_, index) => `incoming-${index}`,
    );
    mocks.gmailListHistory
      .mockResolvedValueOnce({
        historyId: "history-page-1",
        nextPageToken: "page-2",
        history: [
          {
            messagesAdded: messageIds.slice(0, 40).map((id) => ({
              message: { id, labelIds: ["INBOX"] },
            })),
          },
        ],
      })
      .mockResolvedValueOnce({
        historyId: "history-page-2",
        nextPageToken: "page-3",
        history: [
          {
            messagesAdded: messageIds.slice(40).map((id) => ({
              message: { id, labelIds: ["INBOX"] },
            })),
          },
        ],
      })
      .mockResolvedValueOnce({
        historyId: "history-final",
        history: [
          {
            messagesAdded: [
              { message: { id: "incoming-60", labelIds: ["INBOX"] } },
            ],
          },
        ],
      });
    mocks.gmailBatchGetMessages.mockImplementation(
      async (_accessToken: string, ids: string[]) =>
        ids.map((id) => ({
          id,
          data: {
            id,
            threadId: `thread-${id}`,
            labelIds: ["INBOX"],
            payload: { headers: [] },
          },
        })),
    );

    await processAutomationsForAccount(
      ownerEmail,
      accountEmail,
      "google-access-token",
    );

    const watermarkKey = `${ownerEmail}:mail-received-events:${accountEmail}:watermark`;
    expect(mocks.userSettings.get(watermarkKey)).toMatchObject({
      lastHistoryId: "history-1",
      pageToken: "page-3",
      pendingMessageIds: messageIds.slice(50),
    });
    expect(mocks.gmailListHistory).toHaveBeenNthCalledWith(
      2,
      "google-access-token",
      expect.objectContaining({
        startHistoryId: "history-1",
        pageToken: "page-2",
      }),
      "incremental",
      undefined,
    );
    expect(mocks.emitAsync).toHaveBeenCalledTimes(50);

    await processAutomationsForAccount(
      ownerEmail,
      accountEmail,
      "google-access-token",
    );

    expect(mocks.gmailListHistory).toHaveBeenLastCalledWith(
      "google-access-token",
      expect.objectContaining({
        startHistoryId: "history-1",
        pageToken: "page-3",
      }),
      "incremental",
      undefined,
    );
    expect(mocks.userSettings.get(watermarkKey)).toMatchObject({
      lastHistoryId: "history-final",
    });
    expect(mocks.userSettings.get(watermarkKey)).not.toHaveProperty(
      "pageToken",
    );
    expect(mocks.userSettings.get(watermarkKey)).not.toHaveProperty(
      "pendingMessageIds",
    );
    expect(mocks.emitAsync).toHaveBeenCalledTimes(61);
  });

  it("serializes polls per account while allowing other accounts to progress", async () => {
    mocks.activeRules = [];
    mocks.hasEventAutomation.mockResolvedValue(true);
    const ownerEmail = "owner@example.com";
    const accountEmail = "mailbox@example.com";
    await processAutomationsForAccount(
      ownerEmail,
      accountEmail,
      "google-access-token",
    );

    let signalHistoryStarted = () => {};
    let releaseHistory: ((value: unknown) => void) | undefined;
    const historyStarted = new Promise<void>((resolve) => {
      signalHistoryStarted = resolve;
    });
    mocks.gmailListHistory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseHistory = resolve;
          signalHistoryStarted();
        }),
    );
    mocks.gmailBatchGetMessages.mockResolvedValueOnce([
      {
        id: "only-in-one",
        data: {
          id: "only-in-one",
          threadId: "thread-only",
          labelIds: ["INBOX"],
          payload: { headers: [] },
        },
      },
    ]);

    const firstPoll = processAutomationsForAccount(
      ownerEmail,
      accountEmail,
      "google-access-token",
    );
    await historyStarted;

    const sameAccount = await processAutomationsForAccount(
      ownerEmail,
      accountEmail,
      "google-access-token",
    );
    expect(sameAccount).toMatchObject({ messagesProcessed: 0, errors: 0 });
    expect(mocks.gmailListHistory).toHaveBeenCalledOnce();

    const otherAccount = await processAutomationsForAccount(
      ownerEmail,
      "other-mailbox@example.com",
      "google-access-token",
    );
    expect(otherAccount).toMatchObject({ messagesProcessed: 0, errors: 0 });

    releaseHistory?.({
      historyId: "history-2",
      history: [
        {
          messagesAdded: [
            { message: { id: "only-in-one", labelIds: ["INBOX"] } },
          ],
        },
      ],
    });
    await firstPoll;

    expect(mocks.emitAsync).toHaveBeenCalledOnce();
  });

  it("does not notify for matching mail received before its rule was updated", async () => {
    const now = Date.now();
    mocks.activeRules = [
      {
        id: "notify-rule",
        kind: "ai-filter",
        name: "Notify on project updates",
        condition: "Project updates",
        actions: JSON.stringify([
          { type: "label", labelName: "agent-native-important" },
          { type: "notify" },
        ]),
        enabled: 1,
        createdAt: now,
        updatedAt: now,
      },
    ];
    mocks.getAiFilterState.mockResolvedValue({
      enabled: true,
      feedback: [],
      suggestionThreshold: 0.5,
    });
    mocks.executeActions.mockResolvedValue({ successes: 1, failures: 0 });
    mocks.decide.mockImplementationOnce(
      async ({
        questions,
      }: {
        questions: Array<{ name: string; type: string }>;
      }) =>
        decisionResult(questions, { probabilities: questions.map(() => 0.99) }),
    );
    mocks.userSettings.set("owner@example.com:automation-watermark", {
      lastHistoryId: "history-1",
      lastTimestamp: Date.now(),
    });
    mocks.gmailListHistory.mockResolvedValueOnce({
      historyId: "history-2",
      history: [
        {
          messagesAdded: [
            { message: { id: "old-match", labelIds: ["INBOX"] } },
            { message: { id: "new-match", labelIds: ["INBOX"] } },
          ],
        },
      ],
    });
    mocks.gmailBatchGetMessages.mockResolvedValueOnce([
      {
        id: "old-match",
        data: {
          id: "old-match",
          threadId: "thread-old",
          internalDate: String(now - 60_000),
          labelIds: ["INBOX"],
          payload: { headers: [] },
        },
      },
      {
        id: "new-match",
        data: {
          id: "new-match",
          threadId: "thread-new",
          internalDate: String(now + 1_000),
          labelIds: ["INBOX"],
          payload: { headers: [] },
        },
      },
    ]);

    await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(mocks.decide).toHaveBeenCalledOnce();
    expect(mocks.executeActions.mock.calls).toEqual([
      [
        [{ type: "label", labelName: "agent-native-important" }],
        expect.objectContaining({ messageId: "old-match" }),
      ],
      [
        [
          { type: "label", labelName: "agent-native-important" },
          { type: "notify" },
        ],
        expect.objectContaining({ messageId: "new-match" }),
      ],
    ]);
  });

  it("retries a failed notification after committing the message cursor", async () => {
    const now = Date.now();
    mocks.activeRules = [
      {
        id: "notify-rule",
        kind: "ai-filter",
        name: "Notify on project updates",
        condition: "Project updates",
        actions: JSON.stringify([{ type: "notify" }]),
        enabled: 1,
        createdAt: now,
        updatedAt: now,
      },
    ];
    mocks.getAiFilterState.mockResolvedValue({
      enabled: true,
      feedback: [],
      suggestionThreshold: 0.5,
    });
    mocks.decide.mockImplementationOnce(
      async ({
        questions,
      }: {
        questions: Array<{ name: string; type: string }>;
      }) =>
        decisionResult(questions, { probabilities: questions.map(() => 0.99) }),
    );
    mocks.executeActions
      .mockResolvedValueOnce({
        successes: 0,
        failures: 1,
        failedActions: [{ type: "notify" }],
      })
      .mockResolvedValueOnce({
        successes: 1,
        failures: 0,
        failedActions: [],
      });
    mocks.userSettings.set("owner@example.com:automation-watermark", {
      lastHistoryId: "history-1",
      lastTimestamp: now,
    });
    mocks.gmailListHistory
      .mockResolvedValueOnce({
        historyId: "history-2",
        history: [
          {
            messagesAdded: [
              { message: { id: "failed-notification", labelIds: ["INBOX"] } },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({ historyId: "history-3" });
    const emailResponse = [
      {
        id: "failed-notification",
        data: {
          id: "failed-notification",
          threadId: "thread-1",
          internalDate: String(now + 1_000),
          labelIds: ["INBOX"],
          payload: {
            headers: [
              { name: "From", value: "school@example.test" },
              { name: "Subject", value: "Field trip update" },
            ],
          },
        },
      },
    ];
    mocks.gmailBatchGetMessages
      .mockResolvedValueOnce(emailResponse)
      .mockResolvedValueOnce(emailResponse);

    const first = await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(first.errors).toBe(1);
    expect(
      mocks.userSettings.get("owner@example.com:automation-watermark"),
    ).toMatchObject({ lastHistoryId: "history-2" });
    const pendingKey =
      "owner@example.com:mail-automation-pending-notifications:mailbox@example.com";
    const pending = mocks.userSettings.get(pendingKey) as Array<{
      ruleId: string;
      messageId: string;
      committed: boolean;
      attempts: number;
      nextAttemptAt: number;
    }>;
    expect(pending).toMatchObject([
      {
        ruleId: "notify-rule",
        messageId: "failed-notification",
        committed: true,
        attempts: 1,
      },
    ]);
    expect(pending[0]!.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(
      mocks.userSettings.get("owner@example.com:automation-processed-ids"),
    ).toMatchObject({ ids: ["failed-notification"] });
    mocks.userSettings.set(pendingKey, [
      { ...pending[0]!, nextAttemptAt: Date.now() - 1 },
    ]);

    await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(mocks.executeActions).toHaveBeenCalledTimes(2);
    expect(
      mocks.userSettings.get(
        "owner@example.com:mail-automation-pending-notifications:mailbox@example.com",
      ),
    ).toEqual([]);
  });

  it("keeps failed poll classifications pending for a later retry", async () => {
    const now = Date.now();
    mocks.activeRules = [
      {
        id: "tag-rule",
        domain: "mail",
        kind: "ai-filter",
        name: "Project updates",
        condition: "Project updates",
        actions: JSON.stringify([
          { type: "label", labelName: "Project updates" },
        ]),
        enabled: 1,
        createdAt: now,
        updatedAt: now,
      },
    ];
    mocks.getAiFilterState.mockResolvedValue({
      enabled: true,
      autoFilter: false,
      autoFilterThreshold: 0.92,
      suggestionThreshold: 0.5,
      feedback: [],
      decisions: [],
    });
    mocks.executeActions.mockResolvedValue({ successes: 1, failures: 0 });
    mocks.userSettings.set("owner@example.com:automation-watermark", {
      lastHistoryId: "history-1",
      lastTimestamp: now,
    });
    mocks.gmailListHistory
      .mockResolvedValueOnce({
        historyId: "history-2",
        history: [
          {
            messagesAdded: [
              { message: { id: "partial", labelIds: ["INBOX"] } },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({ historyId: "history-3", history: [] });
    mocks.gmailBatchGetMessages
      .mockResolvedValueOnce([
        {
          id: "partial",
          data: {
            id: "partial",
            threadId: "thread-partial",
            internalDate: String(now + 1_000),
            labelIds: ["INBOX"],
            payload: { headers: [] },
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "partial",
          data: {
            id: "partial",
            threadId: "thread-partial",
            internalDate: String(now + 1_000),
            labelIds: ["INBOX"],
            payload: { headers: [] },
          },
        },
      ]);
    mocks.decide
      .mockImplementationOnce(
        async ({
          questions,
        }: {
          questions: Array<{ name: string; type: string }>;
        }) => decisionResult(questions, { failures: ["q_0"] }),
      )
      .mockImplementationOnce(
        async ({
          questions,
        }: {
          questions: Array<{ name: string; type: string }>;
        }) => decisionResult(questions),
      );

    const result = await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(result).toMatchObject({
      errors: 1,
      decisionFailures: [
        {
          emailId: "partial",
          accountEmail: "mailbox@example.com",
          ruleId: "tag-rule",
          reason: "invalid_response",
        },
      ],
    });
    expect(mocks.executeActions).not.toHaveBeenCalled();
    expect(
      mocks.userSettings.get("owner@example.com:automation-watermark"),
    ).toMatchObject({ pendingMessageIds: ["partial"] });
    expect(
      mocks.userSettings.get("owner@example.com:automation-processed-ids"),
    ).toMatchObject({ ids: [] });

    const retried = await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(retried.decisionFailures).toEqual([]);
    expect(mocks.executeActions).toHaveBeenCalledTimes(1);
    expect(mocks.gmailBatchGetMessages).toHaveBeenCalledTimes(2);
    expect(
      mocks.userSettings.get("owner@example.com:automation-watermark"),
    ).not.toHaveProperty("pendingMessageIds");
    expect(
      mocks.userSettings.get("owner@example.com:automation-processed-ids"),
    ).toMatchObject({ ids: ["partial"] });
  });

  it("queues every pair in a batch after a top-level decision failure", async () => {
    const now = Date.now();
    mocks.activeRules = [
      {
        id: "tag-rule",
        domain: "mail",
        kind: "automation",
        name: "Project updates",
        condition: "Project updates",
        actions: JSON.stringify([{ type: "star" }]),
        enabled: 1,
        createdAt: now,
        updatedAt: now,
      },
    ];
    mocks.userSettings.set("owner@example.com:automation-watermark", {
      lastHistoryId: "history-1",
      lastTimestamp: now,
    });
    mocks.gmailListHistory.mockResolvedValueOnce({
      historyId: "history-2",
      history: [
        {
          messagesAdded: [{ message: { id: "failed", labelIds: ["INBOX"] } }],
        },
      ],
    });
    mocks.gmailBatchGetMessages.mockResolvedValueOnce([
      {
        id: "failed",
        data: {
          id: "failed",
          threadId: "thread-failed",
          internalDate: String(now + 1_000),
          labelIds: ["INBOX"],
          payload: { headers: [] },
        },
      },
    ]);
    mocks.decide.mockResolvedValueOnce({
      status: "failed",
      reason: "provider_error",
      provider: "jev",
    });

    const result = await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(result).toMatchObject({
      errors: 1,
      decisionFailures: [
        {
          emailId: "failed",
          accountEmail: "mailbox@example.com",
          ruleId: "tag-rule",
          reason: "provider_error",
          retryable: true,
        },
      ],
    });
    expect(mocks.executeActions).not.toHaveBeenCalled();
    expect(
      mocks.userSettings.get("owner@example.com:automation-watermark"),
    ).toMatchObject({
      pendingMessageIds: ["failed"],
      pendingDecisionAttempts: { failed: 1 },
    });
    expect(
      mocks.userSettings.get("owner@example.com:automation-processed-ids"),
    ).toMatchObject({ ids: [] });
  });

  it("executes successful rule matches before terminalizing an oversized rule", async () => {
    const now = Date.now();
    mocks.activeRules = [
      {
        id: "successful-rule",
        domain: "mail",
        kind: "automation",
        name: "Star project mail",
        condition: "Project updates",
        actions: JSON.stringify([{ type: "star" }]),
        enabled: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "oversized-rule",
        domain: "mail",
        kind: "automation",
        name: "Oversized rule",
        condition: "x".repeat(MAX_DECISION_PAYLOAD_BYTES + 1),
        actions: JSON.stringify([{ type: "trash" }]),
        enabled: 1,
        createdAt: now,
        updatedAt: now,
      },
    ];
    mocks.executeActions.mockResolvedValue({ successes: 1, failures: 0 });
    mocks.userSettings.set("owner@example.com:automation-watermark", {
      lastHistoryId: "history-1",
      lastTimestamp: now,
    });
    mocks.gmailListHistory.mockResolvedValueOnce({
      historyId: "history-2",
      history: [
        {
          messagesAdded: [{ message: { id: "partial", labelIds: ["INBOX"] } }],
        },
      ],
    });
    mocks.gmailBatchGetMessages.mockResolvedValueOnce([
      {
        id: "partial",
        data: {
          id: "partial",
          threadId: "thread-partial",
          internalDate: String(now + 1_000),
          labelIds: ["INBOX"],
          payload: { headers: [] },
        },
      },
    ]);

    const result = await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(result).toMatchObject({
      errors: 1,
      decisionFailures: [
        expect.objectContaining({
          emailId: "partial",
          ruleId: "oversized-rule",
          reason: "invalid_input",
          retryable: false,
        }),
      ],
    });
    expect(mocks.executeActions).toHaveBeenCalledOnce();
    expect(mocks.executeActions).toHaveBeenCalledWith(
      [{ type: "star" }],
      expect.objectContaining({ messageId: "partial" }),
    );
    expect(
      mocks.userSettings.get("owner@example.com:automation-watermark"),
    ).not.toHaveProperty("pendingMessageIds");
    expect(
      mocks.userSettings.get("owner@example.com:automation-processed-ids"),
    ).toMatchObject({ ids: ["partial"] });
  });

  it("leaves history capacity when decision retry IDs fill the pending queue", async () => {
    const now = Date.now();
    const accountEmail = "mailbox@example.com";
    const pendingIds = Array.from(
      { length: 50 },
      (_, index) => `stalled-${index}`,
    );
    mocks.activeRules = [
      {
        id: "tag-rule",
        domain: "mail",
        kind: "ai-filter",
        name: "Project updates",
        condition: "Project updates",
        actions: JSON.stringify([
          { type: "label", labelName: "Project updates" },
        ]),
        enabled: 1,
        createdAt: now,
        updatedAt: now,
      },
    ];
    mocks.getAiFilterState.mockResolvedValue({ enabled: true, feedback: [] });
    mocks.userSettings.set("owner@example.com:automation-watermark", {
      lastHistoryId: "history-1",
      lastTimestamp: now,
      pendingMessageIds: pendingIds,
    });
    mocks.gmailListHistory.mockResolvedValueOnce({
      historyId: "history-2",
      history: [
        {
          messagesAdded: [
            { message: { id: "new-inbox-message", labelIds: ["INBOX"] } },
          ],
        },
      ],
    });
    mocks.gmailBatchGetMessages.mockImplementationOnce(
      async (_accessToken: string, ids: string[]) =>
        ids.map((id) => ({
          id,
          data: {
            id,
            threadId: `thread-${id}`,
            labelIds: ["INBOX"],
            payload: { headers: [] },
          },
        })),
    );
    mocks.decide.mockImplementationOnce(
      async ({
        questions,
      }: {
        questions: Array<{ name: string; type: string }>;
      }) =>
        decisionResult(questions, {
          failures: questions.map(({ name }) => name),
        }),
    );

    const result = await processAutomationsForAccount(
      "owner@example.com",
      accountEmail,
      "google-access-token",
    );

    expect(result.messagesProcessed).toBe(41);
    expect(mocks.gmailBatchGetMessages).toHaveBeenCalledWith(
      "google-access-token",
      expect.arrayContaining([...pendingIds.slice(0, 40), "new-inbox-message"]),
      "metadata",
      "incremental",
      undefined,
    );
    expect(
      mocks.userSettings.get("owner@example.com:automation-watermark"),
    ).toMatchObject({
      lastHistoryId: "history-2",
      pendingMessageIds: expect.arrayContaining(["new-inbox-message"]),
      pendingDecisionAttempts: { "new-inbox-message": 1 },
    });
  });

  it("stops retrying a decision after the bounded attempt limit", async () => {
    const now = Date.now();
    mocks.activeRules = [
      {
        id: "tag-rule",
        domain: "mail",
        kind: "ai-filter",
        name: "Project updates",
        condition: "Project updates",
        actions: JSON.stringify([
          { type: "label", labelName: "Project updates" },
        ]),
        enabled: 1,
        createdAt: now,
        updatedAt: now,
      },
    ];
    mocks.getAiFilterState.mockResolvedValue({ enabled: true, feedback: [] });
    mocks.userSettings.set("owner@example.com:automation-watermark", {
      lastHistoryId: "history-1",
      lastTimestamp: now,
      pendingMessageIds: ["stuck"],
      pendingDecisionAttempts: { stuck: 4 },
    });
    mocks.gmailListHistory.mockResolvedValueOnce({
      historyId: "history-2",
      history: [],
    });
    mocks.gmailBatchGetMessages.mockResolvedValueOnce([
      {
        id: "stuck",
        data: {
          id: "stuck",
          threadId: "thread-stuck",
          labelIds: ["INBOX"],
          payload: { headers: [] },
        },
      },
    ]);
    mocks.decide.mockImplementationOnce(
      async ({
        questions,
      }: {
        questions: Array<{ name: string; type: string }>;
      }) => decisionResult(questions, { failures: ["q_0"] }),
    );

    await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(
      mocks.userSettings.get("owner@example.com:automation-watermark"),
    ).toMatchObject({ lastHistoryId: "history-2" });
    expect(
      mocks.userSettings.get("owner@example.com:automation-watermark"),
    ).not.toHaveProperty("pendingMessageIds");
    expect(
      mocks.userSettings.get("owner@example.com:automation-watermark"),
    ).not.toHaveProperty("pendingDecisionAttempts");
    expect(
      mocks.userSettings.get("owner@example.com:automation-processed-ids"),
    ).toMatchObject({ ids: ["stuck"] });
  });

  it("drops notification retries after the attempt limit", async () => {
    mocks.activeRules = [];
    mocks.userSettings.set(
      "owner@example.com:mail-automation-pending-notifications:mailbox@example.com",
      [
        {
          ruleId: "notify-rule",
          messageId: "exhausted-notification",
          from: "sender@example.test",
          subject: "Update",
          snippet: "Details",
          createdAt: Date.now(),
          attempts: 8,
          nextAttemptAt: Date.now() + 60_000,
          committed: true,
        },
      ],
    );

    const result = await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(result.errors).toBe(1);
    expect(mocks.executeActions).not.toHaveBeenCalled();
    expect(
      mocks.userSettings.get(
        "owner@example.com:mail-automation-pending-notifications:mailbox@example.com",
      ),
    ).toEqual([]);
  });

  it("baselines event history on the first poll after an event subscription", async () => {
    mocks.activeRules = [];
    mocks.hasEventAutomation.mockResolvedValue(true);

    await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(mocks.gmailGetProfile).toHaveBeenCalledWith(
      "google-access-token",
      "incremental",
      false,
      undefined,
    );
    expect(mocks.gmailListHistory).not.toHaveBeenCalled();
    expect(mocks.gmailListMessages).not.toHaveBeenCalled();
    expect(mocks.emitAsync).not.toHaveBeenCalled();
    expect(
      mocks.userSettings.get(
        "owner@example.com:mail-received-events:mailbox@example.com:watermark",
      ),
    ).toEqual(expect.objectContaining({ lastHistoryId: "history-1" }));
  });

  it("refreshes the received-mail cursor while no event automation is subscribed", async () => {
    mocks.activeRules = [];
    mocks.userSettings.set(
      "owner@example.com:mail-received-events:mailbox@example.com:watermark",
      { lastHistoryId: "stale-history", lastTimestamp: 1 },
    );
    mocks.gmailGetProfile.mockResolvedValueOnce({ historyId: "fresh-history" });

    await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(mocks.putUserSetting).toHaveBeenCalledWith(
      "owner@example.com",
      "mail-received-events:mailbox@example.com:watermark",
      expect.objectContaining({ lastHistoryId: "fresh-history" }),
    );
    expect(mocks.hasEventAutomation).toHaveBeenCalledWith(
      "mail.message.received",
    );
    expect(mocks.gmailListHistory).not.toHaveBeenCalled();
  });

  it("does not refresh the event cursor when durable subscriptions cannot be loaded", async () => {
    mocks.activeRules = [];
    mocks.userSettings.set(
      "owner@example.com:mail-received-events:mailbox@example.com:watermark",
      { lastHistoryId: "saved-history", lastTimestamp: 1 },
    );
    mocks.hasEventAutomation.mockRejectedValueOnce(
      new Error("resource store unavailable"),
    );

    const result = await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(result.errors).toBe(1);
    expect(mocks.putUserSetting).not.toHaveBeenCalledWith(
      "owner@example.com",
      "mail-received-events:mailbox@example.com:watermark",
      expect.anything(),
    );
    expect(mocks.gmailGetProfile).not.toHaveBeenCalled();
  });

  it("does not persist a malformed cursor when Gmail cannot reset it", async () => {
    mocks.activeRules = [];
    mocks.hasEventAutomation.mockResolvedValue(true);
    const watermarkKey = "mail-received-events:mailbox@example.com:watermark";
    mocks.userSettings.set(`owner@example.com:${watermarkKey}`, {
      lastHistoryId: "expired-history",
      lastTimestamp: Date.now(),
    });
    mocks.gmailListHistory.mockRejectedValueOnce(
      new Error("Google API error (404): history expired"),
    );
    mocks.gmailGetProfile.mockRejectedValueOnce(
      new Error("profile unavailable"),
    );

    const result = await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(result.errors).toBe(1);
    expect(mocks.putUserSetting).not.toHaveBeenCalledWith(
      "owner@example.com",
      watermarkKey,
      expect.anything(),
    );
  });

  it("keeps a message pending when Gmail batch and refill fetches both fail", async () => {
    mocks.activeRules = [];
    mocks.hasEventAutomation.mockResolvedValue(true);
    mocks.userSettings.set(
      "owner@example.com:mail-received-events:mailbox@example.com:watermark",
      { lastHistoryId: "history-1", lastTimestamp: Date.now() },
    );
    mocks.gmailListHistory.mockResolvedValueOnce({
      historyId: "history-2",
      history: [
        {
          messagesAdded: [
            { message: { id: "retry-message", labelIds: ["INBOX"] } },
            { message: { id: "good-message", labelIds: ["INBOX"] } },
          ],
        },
      ],
    });
    mocks.gmailBatchGetMessages.mockResolvedValueOnce([
      { id: "retry-message", data: null, error: "HTTP 503" },
      {
        id: "good-message",
        data: {
          id: "good-message",
          threadId: "thread-good",
          labelIds: ["INBOX"],
          payload: { headers: [] },
        },
      },
    ]);
    mocks.gmailGetMessage.mockRejectedValueOnce(
      new Error("Google API error (503): temporary failure"),
    );

    await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(mocks.putUserSetting).toHaveBeenCalledWith(
      "owner@example.com",
      "mail-received-events:mailbox@example.com:watermark",
      expect.objectContaining({
        lastHistoryId: "history-2",
        pendingMessageIds: ["retry-message"],
      }),
    );
    expect(mocks.emitAsync).toHaveBeenCalledOnce();
  });

  it("continues Gmail fallback listing across pages", async () => {
    mocks.activeRules = [];
    mocks.hasEventAutomation.mockResolvedValue(true);
    mocks.userSettings.set(
      "owner@example.com:mail-received-events:mailbox@example.com:watermark",
      { lastHistoryId: "expired-history", lastTimestamp: Date.now() },
    );
    const firstPageIds = Array.from(
      { length: 50 },
      (_, index) => `page-one-${index}`,
    );
    const secondPageIds = Array.from(
      { length: 10 },
      (_, index) => `page-two-${index}`,
    );
    const toBatchResults = (ids: string[]) =>
      ids.map((id) => ({
        id,
        data: {
          id,
          threadId: id,
          labelIds: ["INBOX"],
          payload: { headers: [] },
        },
      }));

    mocks.gmailListHistory.mockRejectedValueOnce(new Error("history expired"));
    mocks.gmailGetProfile.mockResolvedValueOnce({ historyId: "fallback-base" });
    mocks.gmailListMessages
      .mockResolvedValueOnce({
        messages: firstPageIds.map((id) => ({ id })),
        nextPageToken: "fallback-page-two",
      })
      .mockResolvedValueOnce({ messages: secondPageIds.map((id) => ({ id })) });
    mocks.gmailBatchGetMessages.mockImplementation(async (_token, ids) =>
      toBatchResults(ids),
    );

    await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(mocks.gmailListMessages).toHaveBeenCalledOnce();
    await expect(
      mocks.gmailListMessages.mock.results[0]?.value,
    ).resolves.toEqual(
      expect.objectContaining({ nextPageToken: "fallback-page-two" }),
    );
    expect(
      mocks.userSettings.get(
        "owner@example.com:mail-received-events:mailbox@example.com:watermark",
      ),
    ).toEqual(
      expect.objectContaining({
        lastHistoryId: "fallback-base",
        fallbackPageToken: "fallback-page-two",
      }),
    );
    expect(mocks.gmailGetProfile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.gmailListMessages.mock.invocationCallOrder[0],
    );

    await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(mocks.gmailListMessages).toHaveBeenNthCalledWith(
      2,
      "google-access-token",
      expect.objectContaining({ pageToken: "fallback-page-two" }),
      "incremental",
      undefined,
    );
    expect(mocks.emitAsync).toHaveBeenCalledTimes(60);
    expect(
      mocks.userSettings.get(
        "owner@example.com:mail-received-events:mailbox@example.com:watermark",
      ),
    ).not.toHaveProperty("fallbackPageToken");
  });

  it("keeps the fallback history cursor when history fails during a list continuation", async () => {
    mocks.activeRules = [];
    mocks.hasEventAutomation.mockResolvedValue(true);
    const watermarkKey =
      "owner@example.com:mail-received-events:mailbox@example.com:watermark";
    mocks.userSettings.set(watermarkKey, {
      lastHistoryId: "fallback-base",
      fallbackPageToken: "fallback-page-two",
      lastTimestamp: Date.now(),
    });
    mocks.gmailListHistory
      .mockRejectedValueOnce(new Error("temporary history failure"))
      .mockResolvedValueOnce({
        historyId: "history-after-arrival",
        history: [
          {
            messagesAdded: [
              {
                message: {
                  id: "arrived-during-fallback",
                  labelIds: ["INBOX"],
                },
              },
            ],
          },
        ],
      });
    mocks.gmailListMessages.mockResolvedValueOnce({ messages: [] });
    mocks.gmailBatchGetMessages.mockResolvedValueOnce([
      {
        id: "arrived-during-fallback",
        data: {
          id: "arrived-during-fallback",
          threadId: "arrived-during-fallback",
          labelIds: ["INBOX"],
          payload: { headers: [] },
        },
      },
    ]);

    await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(mocks.gmailGetProfile).not.toHaveBeenCalled();
    expect(mocks.gmailListMessages).toHaveBeenCalledWith(
      "google-access-token",
      expect.objectContaining({ pageToken: "fallback-page-two" }),
      "incremental",
      undefined,
    );
    expect(mocks.userSettings.get(watermarkKey)).toMatchObject({
      lastHistoryId: "fallback-base",
    });

    await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(mocks.gmailListHistory).toHaveBeenNthCalledWith(
      2,
      "google-access-token",
      expect.objectContaining({ startHistoryId: "fallback-base" }),
      "incremental",
      undefined,
    );
    expect(mocks.emitAsync).toHaveBeenCalledWith(
      "mail.message.received",
      expect.objectContaining({ messageId: "arrived-during-fallback" }),
      expect.anything(),
    );
  });

  it("persists fallback candidates when the Gmail batch request fails", async () => {
    mocks.activeRules = [];
    mocks.hasEventAutomation.mockResolvedValue(true);
    const watermarkKey =
      "owner@example.com:mail-received-events:mailbox@example.com:watermark";
    mocks.userSettings.set(watermarkKey, {
      lastHistoryId: "expired-history",
      lastTimestamp: Date.now(),
    });
    mocks.gmailListHistory.mockRejectedValueOnce(new Error("history expired"));
    mocks.gmailGetProfile.mockResolvedValueOnce({ historyId: "fallback-base" });
    mocks.gmailListMessages.mockResolvedValueOnce({
      messages: [{ id: "retry-one" }, { id: "retry-two" }],
    });
    mocks.gmailBatchGetMessages
      .mockRejectedValueOnce(new Error("batch unavailable"))
      .mockResolvedValueOnce([
        {
          id: "retry-one",
          data: {
            id: "retry-one",
            threadId: "retry-one",
            labelIds: ["INBOX"],
            payload: { headers: [] },
          },
        },
        {
          id: "retry-two",
          data: {
            id: "retry-two",
            threadId: "retry-two",
            labelIds: ["INBOX"],
            payload: { headers: [] },
          },
        },
      ]);

    const failedPoll = await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(failedPoll.errors).toBe(1);
    expect(mocks.userSettings.get(watermarkKey)).toEqual(
      expect.objectContaining({
        lastHistoryId: "fallback-base",
        pendingMessageIds: ["retry-one", "retry-two"],
      }),
    );

    await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(mocks.emitAsync).toHaveBeenCalledTimes(2);
    expect(mocks.gmailListMessages).toHaveBeenCalledOnce();
  });

  it("resets an expired Gmail cursor without replaying recent mail", async () => {
    mocks.activeRules = [];
    mocks.hasEventAutomation.mockResolvedValue(true);
    const watermarkKey =
      "owner@example.com:mail-received-events:mailbox@example.com:watermark";
    mocks.userSettings.set(watermarkKey, {
      lastHistoryId: "expired-history",
      fallbackPageToken: "old-fallback-page",
      lastTimestamp: Date.now(),
    });
    mocks.gmailListHistory
      .mockRejectedValueOnce(
        new Error("Google API error (404): history expired"),
      )
      .mockResolvedValueOnce({
        historyId: "history-after-new-mail",
        history: [
          {
            messagesAdded: [
              { message: { id: "new-mail", labelIds: ["INBOX"] } },
            ],
          },
        ],
      });
    mocks.gmailGetProfile.mockResolvedValueOnce({ historyId: "fresh-history" });
    mocks.gmailBatchGetMessages.mockResolvedValueOnce([
      {
        id: "new-mail",
        data: {
          id: "new-mail",
          threadId: "new-mail",
          labelIds: ["INBOX"],
          payload: { headers: [] },
        },
      },
    ]);

    await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(mocks.gmailListMessages).not.toHaveBeenCalled();
    expect(mocks.emitAsync).not.toHaveBeenCalled();
    expect(mocks.userSettings.get(watermarkKey)).toEqual(
      expect.objectContaining({ lastHistoryId: "fresh-history" }),
    );
    expect(mocks.userSettings.get(watermarkKey)).not.toHaveProperty(
      "fallbackPageToken",
    );

    await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(mocks.gmailListHistory).toHaveBeenNthCalledWith(
      2,
      "google-access-token",
      expect.objectContaining({ startHistoryId: "fresh-history" }),
      "incremental",
      undefined,
    );
    expect(mocks.emitAsync).toHaveBeenCalledWith(
      "mail.message.received",
      expect.objectContaining({ messageId: "new-mail" }),
      expect.anything(),
    );
  });
});
