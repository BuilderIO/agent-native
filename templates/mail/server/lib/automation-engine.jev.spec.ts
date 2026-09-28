import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  getAiFilterState: vi.fn(),
  executeActions: vi.fn(),
  emit: vi.fn(),
  emitAsync: vi.fn(),
  listSubscriptions: vi.fn(),
  refreshEventSubscriptions: vi.fn(),
  activeRules: [] as Array<Record<string, unknown>>,
  userSettings: new Map<string, unknown>(),
  getJevContextCredentials: vi.fn(),
  getUserSetting: vi.fn(),
  mutateUserSetting: vi.fn(),
  putUserSetting: vi.fn(),
  gmailGetProfile: vi.fn(),
  gmailListHistory: vi.fn(),
  gmailListMessages: vi.fn(),
  gmailGetMessage: vi.fn(),
  gmailBatchGetMessages: vi.fn(),
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
  mutateUserSetting: mocks.mutateUserSetting,
  putUserSetting: mocks.putUserSetting,
}));
vi.mock("@agent-native/core/event-bus", () => ({
  emit: mocks.emit,
  emitAsync: mocks.emitAsync,
  listSubscriptions: mocks.listSubscriptions,
}));
vi.mock("@agent-native/core/triggers", () => ({
  refreshEventSubscriptions: mocks.refreshEventSubscriptions,
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
  resolveAutomationModelSettings:
    mocks.resolveAutomationModelSettings.mockResolvedValue({
      engine: "typesafe",
      model: "jev-latest",
    }),
  resolveTextAutomationModelSettings: vi.fn(),
  TYPESAFE_AUTOMATION_ENGINE: "typesafe",
  TYPESAFE_AUTOMATION_MODEL: "jev-latest",
}));
vi.mock("./google-api.js", () => ({
  gmailGetProfile: mocks.gmailGetProfile,
  gmailListHistory: mocks.gmailListHistory,
  gmailListMessages: mocks.gmailListMessages,
  gmailGetMessage: mocks.gmailGetMessage,
  gmailBatchGetMessages: mocks.gmailBatchGetMessages,
}));
vi.mock("./google-auth.js", () => ({}));

import { aiPriorityEmailKey } from "../../shared/ai-priority.js";
import {
  evaluateAiFilterBackfillRules,
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
    mocks.gmailGetProfile.mockReset();
    mocks.gmailListHistory.mockReset();
    mocks.gmailListMessages.mockReset();
    mocks.gmailGetMessage.mockReset();
    mocks.gmailBatchGetMessages.mockReset();
    mocks.userSettings.clear();
    mocks.listSubscriptions.mockReturnValue([]);
    mocks.refreshEventSubscriptions.mockResolvedValue(true);
    mocks.activeRules = [{ id: "rule-1", kind: "automation", actions: "[]" }];
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: undefined,
      personalApiKey: undefined,
      builderAuth,
    });
    mocks.isJevEnabled.mockResolvedValue(true);
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
    mocks.requestJevThroughBuilder.mockResolvedValue({
      answers: { q_0_0: { noul: 0.91 } },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("checks model availability while processing a queued backfill", async () => {
    mocks.resolveAutomationModelSettings.mockResolvedValueOnce({
      engine: "ai-sdk:openrouter",
      model: "openai/gpt-5.6-luna",
    });
    mocks.isResolvedEngineUsableForRequest.mockResolvedValue(false);

    await expect(
      evaluateAiFilterBackfillRules(
        [],
        [],
        "unavailable-owner@example.com",
        {} as never,
      ),
    ).rejects.toThrow("No LLM provider is connected for Mail AI rules.");
  });

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

  it("emits received-mail events for new arrivals without local rules or Jev", async () => {
    mocks.activeRules = [];
    mocks.listSubscriptions.mockReturnValue([
      { id: "received-mail", event: "mail.message.received" },
    ]);
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
    expect(mocks.isJevEnabled).not.toHaveBeenCalled();
  });

  it("drains paginated received-mail history without skipping overflow", async () => {
    mocks.activeRules = [];
    mocks.listSubscriptions.mockReturnValue([
      { id: "received-mail", event: "mail.message.received" },
    ]);
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
    mocks.listSubscriptions.mockReturnValue([
      { id: "received-mail", event: "mail.message.received" },
    ]);
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
    mocks.requestJevThroughBuilder.mockResolvedValue({
      answers: {
        q_0_0: { noul: 0.99 },
        q_1_0: { noul: 0.99 },
      },
    });
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

    expect(mocks.requestJevThroughBuilder).toHaveBeenCalledOnce();
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
    mocks.requestJevThroughBuilder.mockResolvedValue({
      answers: {
        q_0_0: { noul: 0.99 },
      },
    });
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

  it("baselines event history before an event automation subscribes", async () => {
    mocks.activeRules = [];

    await processAutomationsForAccount(
      "owner@example.com",
      "mailbox@example.com",
      "google-access-token",
    );

    expect(mocks.gmailGetProfile).toHaveBeenCalledWith(
      "google-access-token",
      "incremental",
    );
    expect(mocks.gmailListHistory).not.toHaveBeenCalled();
    expect(mocks.gmailListMessages).not.toHaveBeenCalled();
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
    expect(mocks.refreshEventSubscriptions).toHaveBeenCalledOnce();
    expect(mocks.gmailListHistory).not.toHaveBeenCalled();
  });

  it("does not refresh the event cursor when durable subscriptions cannot be loaded", async () => {
    mocks.activeRules = [];
    mocks.userSettings.set(
      "owner@example.com:mail-received-events:mailbox@example.com:watermark",
      { lastHistoryId: "saved-history", lastTimestamp: 1 },
    );
    mocks.refreshEventSubscriptions.mockResolvedValueOnce(false);

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

  it("does not persist a malformed cursor when Gmail history fallback cannot refresh it", async () => {
    mocks.activeRules = [];
    mocks.listSubscriptions.mockReturnValue([
      { id: "received-mail", event: "mail.message.received" },
    ]);
    const watermarkKey = "mail-received-events:mailbox@example.com:watermark";
    mocks.userSettings.set(`owner@example.com:${watermarkKey}`, {
      lastHistoryId: "expired-history",
      lastTimestamp: Date.now(),
    });
    mocks.gmailListHistory.mockRejectedValueOnce(new Error("history expired"));
    mocks.gmailListMessages.mockResolvedValueOnce({ messages: [] });
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
    mocks.listSubscriptions.mockReturnValue([
      { id: "received-mail", event: "mail.message.received" },
    ]);
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
    mocks.listSubscriptions.mockReturnValue([
      { id: "received-mail", event: "mail.message.received" },
    ]);
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
    mocks.listSubscriptions.mockReturnValue([
      { id: "received-mail", event: "mail.message.received" },
    ]);
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
    );
    expect(mocks.emitAsync).toHaveBeenCalledWith(
      "mail.message.received",
      expect.objectContaining({ messageId: "arrived-during-fallback" }),
      expect.anything(),
    );
  });

  it("persists fallback candidates when the Gmail batch request fails", async () => {
    mocks.activeRules = [];
    mocks.listSubscriptions.mockReturnValue([
      { id: "received-mail", event: "mail.message.received" },
    ]);
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
});
