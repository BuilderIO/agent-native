import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  getAiFilterState: vi.fn(),
  getJevContextCredentials: vi.fn(),
  getUserSetting: vi.fn(),
  isResolvedEngineUsableForRequest: vi.fn(),
  isJevEnabled: vi.fn(),
  readDeployCredentialEnv: vi.fn(),
  registerBuiltinEngines: vi.fn(),
  resolveCredential: vi.fn(),
  resolveEngine: vi.fn(),
  resolveAutomationModelSettings: vi.fn(),
  requestJevThroughBuilder: vi.fn(),
}));

vi.mock("@agent-native/core/agent/engine", () => ({
  isResolvedEngineUsableForRequest: mocks.isResolvedEngineUsableForRequest,
  registerBuiltinEngines: mocks.registerBuiltinEngines,
  resolveEngine: mocks.resolveEngine,
}));
vi.mock("@agent-native/core/credentials", () => ({
  resolveCredential: mocks.resolveCredential,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestContext: () => undefined,
  getJevContextCredentials: mocks.getJevContextCredentials,
  isJevEnabled: mocks.isJevEnabled,
  readDeployCredentialEnv: mocks.readDeployCredentialEnv,
  requestJevThroughBuilder: mocks.requestJevThroughBuilder,
  runWithRequestContext: (_context: unknown, callback: () => unknown) =>
    callback(),
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
  putUserSetting: vi.fn(),
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
  executeActions: vi.fn(),
}));
vi.mock("./automation-model.js", () => ({
  resolveAutomationModelSettings:
    mocks.resolveAutomationModelSettings.mockResolvedValue({
      engine: "typesafe",
      model: "jev-latest",
    }),
  resolveTextAutomationModelSettings: vi.fn(),
  TYPESAFE_AUTOMATION_ENGINE: "typesafe",
  TYPESAFE_AUTOMATION_MODEL: "jev-latest",
}));
vi.mock("./google-api.js", () => ({}));
vi.mock("./google-auth.js", () => ({}));

import { aiPriorityEmailKey } from "../../shared/ai-priority.js";
import {
  previewAutomationPriority,
  previewAutomationRules,
  processAutomationsForAccount,
} from "./automation-engine.js";

const builderAuth = { authorization: "Bearer builder-test-token" };
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

describe("Mail Jev automation routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: undefined,
      personalApiKey: undefined,
      builderAuth,
    });
    mocks.isJevEnabled.mockResolvedValue(true);
    mocks.getAiFilterState.mockResolvedValue({ enabled: false, feedback: [] });
    mocks.getUserSetting.mockResolvedValue(null);
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
        where: async () => [
          { id: "rule-1", kind: "automation", actions: "[]" },
        ],
      }),
    });
    mocks.requestJevThroughBuilder.mockResolvedValue({
      answers: { q_0_0: { noul: 0.91 } },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("resolves a saved scoped Anthropic credential for the owner", async () => {
    mocks.resolveCredential.mockResolvedValue("saved-workspace-key");
    mocks.resolveAutomationModelSettings.mockResolvedValueOnce({
      engine: "anthropic",
      model: "claude-sonnet-5",
    });

    await previewAutomationRules([], [], "key-owner@example.com", {} as never);

    expect(mocks.resolveCredential).toHaveBeenCalledWith("ANTHROPIC_API_KEY", {
      userEmail: "key-owner@example.com",
    });
    expect(mocks.resolveEngine).toHaveBeenCalledWith({
      engineOption: "anthropic",
      apiKey: "saved-workspace-key",
    });
  });

  it("evaluates Mail AI filters through Builder without a user key", async () => {
    const result = await previewAutomationRules(
      [email],
      [
        {
          id: "rule-1",
          name: "Important",
          condition: "Work from the finance team",
          actions: [],
        },
      ],
      "owner@example.com",
      {} as never,
    );

    expect(
      result.matches.get(aiPriorityEmailKey(email.accountEmail, email.id)),
    ).toEqual([
      expect.objectContaining({ ruleId: "rule-1", confidence: 0.91 }),
    ]);
    expect(mocks.requestJevThroughBuilder).toHaveBeenCalledWith(
      builderAuth,
      expect.objectContaining({ model: "jev-latest" }),
      { timeoutMs: 12_000 },
    );
  });

  it("keeps AI-filter results distinct for matching IDs across accounts", async () => {
    mocks.requestJevThroughBuilder.mockResolvedValue({
      answers: {
        q_0_0: { noul: 0.2 },
        q_1_0: { noul: 0.91 },
      },
    });

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
          condition: "Work from the finance team",
          actions: [],
        },
      ],
      "owner@example.com",
      {} as never,
    );

    expect(result.matches.size).toBe(2);
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
    mocks.requestJevThroughBuilder.mockResolvedValue({
      answers: { q_0_0: { noul: 0.2 } },
    });

    const result = await previewAutomationRules(
      [email],
      [
        {
          id: "rule-1",
          name: "Important",
          condition: "Work from the finance team",
          actions: [],
        },
      ],
      "owner@example.com",
      {} as never,
    );

    expect(
      result.matches.get(aiPriorityEmailKey(email.accountEmail, email.id)),
    ).toEqual([]);
  });

  it("fails when Jev omits a rule answer instead of treating it as no-match", async () => {
    mocks.requestJevThroughBuilder.mockResolvedValue({ answers: {} });

    await expect(
      previewAutomationRules(
        [email],
        [
          {
            id: "rule-1",
            name: "Important",
            condition: "Work from the finance team",
            actions: [],
          },
        ],
        "owner@example.com",
        { feedback: [] } as never,
      ),
    ).rejects.toThrow("TypeSafe Jev omitted one or more rule answers.");
  });

  it("fails when a model omits an email classification", async () => {
    mocks.resolveAutomationModelSettings.mockResolvedValueOnce({
      engine: "anthropic",
      model: "claude-sonnet-5",
    });
    mocks.resolveCredential.mockResolvedValue("test-anthropic-key");
    mocks.resolveEngine.mockImplementation(async () => ({
      defaultModel: "claude-sonnet-5",
      configured: true,
      stream: async function* () {
        yield { type: "text-delta", text: "[]" };
      },
    }));

    await expect(
      previewAutomationRules(
        [email],
        [
          {
            id: "rule-1",
            name: "Important",
            condition: "Work from the finance team",
            actions: [],
          },
        ],
        "owner@example.com",
        { feedback: [] } as never,
      ),
    ).rejects.toThrow("Model omitted one or more email classifications.");
  });

  it("bounds Anthropic rule results per response", async () => {
    mocks.resolveAutomationModelSettings.mockResolvedValueOnce({
      engine: "anthropic",
      model: "claude-sonnet-5",
    });
    mocks.resolveCredential.mockResolvedValue("test-anthropic-key");
    const calls: Array<{ emailIds: string[]; ruleIds: string[] }> = [];
    mocks.resolveEngine.mockImplementation(async () => ({
      defaultModel: "claude-sonnet-5",
      configured: true,
      stream: async function* (input: {
        messages: Array<{ content: Array<{ text: string }> }>;
      }) {
        const prompt = input.messages[0]!.content[0]!.text;
        const emailIds = [...prompt.matchAll(/\(emailId: (.+)\) ---/g)].map(
          ([, id]) => JSON.parse(id!),
        );
        const ruleIds = [...prompt.matchAll(/^\d+\. \[id: ([^\]]+)\]/gm)].map(
          ([, id]) => id!,
        );
        calls.push({ emailIds, ruleIds });
        yield {
          type: "text-delta",
          text: JSON.stringify(
            emailIds.map((emailId) => ({
              emailId,
              matches: ruleIds.map((ruleId) => ({
                ruleId,
                match: false,
                confidence: 0,
              })),
            })),
          ),
        };
      },
    }));

    const emails = Array.from({ length: 10 }, (_, index) => ({
      ...email,
      id: `email-${index}`,
      threadId: `thread-${index}`,
    }));
    const rules = Array.from({ length: 4 }, (_, index) => ({
      id: `rule-${index}`,
      name: `Rule ${index}`,
      condition: `Condition ${index}`,
      actions: [],
    }));
    const result = await previewAutomationRules(
      emails,
      rules,
      "large-batch@example.test",
      { feedback: [] } as never,
    );

    expect(
      calls.map(({ emailIds, ruleIds }) => emailIds.length * ruleIds.length),
    ).toEqual([32, 8]);
    expect(result.matches.size).toBe(10);
    expect([...result.matches.values()]).toEqual(
      Array.from({ length: 10 }, () => []),
    );
  });

  it("keeps Jev priority answers distinct for matching IDs across accounts", async () => {
    mocks.requestJevThroughBuilder.mockResolvedValue({
      answers: {
        q_0: { noul: 0.2 },
        q_1: { noul: 0.9 },
      },
    });
    const result = await previewAutomationPriority(
      [
        { ...email, accountEmail: "first@example.test" },
        { ...email, accountEmail: "second@example.test" },
      ],
      "owner@example.com",
      "Prioritize work messages.",
      { builderAuth } as never,
    );

    expect(
      result.scores.get(aiPriorityEmailKey("first@example.test", email.id)),
    ).toMatchObject({
      score: 0.2,
    });
    expect(
      result.scores.get(aiPriorityEmailKey("second@example.test", email.id)),
    ).toMatchObject({
      score: 0.9,
    });
    const requestBody = mocks.requestJevThroughBuilder.mock.calls[0]?.[1] as {
      state: { emails: Array<Record<string, unknown>> };
    };
    expect(requestBody.state.emails[0]).not.toHaveProperty("labels");
  });

  it("scores priority batches with a concurrency limit of three", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mocks.requestJevThroughBuilder.mockImplementation(
      async (_auth: unknown, body: { questions: Record<string, unknown> }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return {
          answers: Object.fromEntries(
            Object.keys(body.questions).map((question) => [
              question,
              { noul: 0.7 },
            ]),
          ),
        };
      },
    );
    const emails = Array.from({ length: 200 }, (_, index) => ({
      ...email,
      id: `email-${index}`,
      threadId: `thread-${index}`,
    }));

    const result = await previewAutomationPriority(
      emails,
      "owner@example.com",
      "Prioritize work messages.",
      { builderAuth } as never,
    );

    expect(mocks.requestJevThroughBuilder).toHaveBeenCalledTimes(4);
    expect(maxInFlight).toBe(3);
    expect(result.scores.size).toBe(200);
  });

  it("does not use a deployment key as direct fallback", async () => {
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: "deployment-jev-key",
      personalApiKey: undefined,
      builderAuth,
    });
    mocks.requestJevThroughBuilder.mockRejectedValue(
      new Error("Builder proxy unavailable"),
    );
    vi.stubGlobal("fetch", vi.fn());

    await expect(
      previewAutomationRules(
        [email],
        [
          {
            id: "rule-1",
            name: "Important",
            condition: "Work from the finance team",
            actions: [],
          },
        ],
        "owner@example.com",
        {} as never,
      ),
    ).rejects.toThrow("Builder proxy unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps using the legacy Typesafe deployment key for saved automation settings", async () => {
    mocks.isJevEnabled.mockResolvedValue(false);
    mocks.readDeployCredentialEnv.mockReturnValue("legacy-typesafe-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ answers: { q_0_0: { noul: 0.91 } } }), {
          status: 200,
        }),
      ),
    );

    const result = await previewAutomationRules(
      [email],
      [
        {
          id: "rule-1",
          name: "Important",
          condition: "Work from the finance team",
          actions: [],
        },
      ],
      "owner@example.com",
      {} as never,
    );

    expect(
      result.matches.get(aiPriorityEmailKey(email.accountEmail, email.id)),
    ).toEqual([
      expect.objectContaining({ ruleId: "rule-1", confidence: 0.91 }),
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.typesafe.ai/v1/systemone",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer legacy-typesafe-key",
        }),
      }),
    );
    expect(mocks.requestJevThroughBuilder).not.toHaveBeenCalled();
  });

  it("surfaces entitlement lookup failures rather than reporting Jev disabled", async () => {
    mocks.isJevEnabled.mockRejectedValue(
      new Error("Could not check Jev credentials or Builder entitlement."),
    );

    await expect(
      previewAutomationRules(
        [email],
        [
          {
            id: "rule-1",
            name: "Important",
            condition: "Work from the finance team",
            actions: [],
          },
        ],
        "owner@example.com",
        {} as never,
      ),
    ).rejects.toThrow(
      "Could not check Jev credentials or Builder entitlement.",
    );
  });

  it("returns an automation error when Jev availability cannot be checked", async () => {
    mocks.isJevEnabled.mockRejectedValue(
      new Error("Builder Jev availability unavailable"),
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
});
