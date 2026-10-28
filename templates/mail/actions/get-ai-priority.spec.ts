import { beforeEach, describe, expect, it, vi } from "vitest";

import { aiPriorityEmailKey } from "../shared/ai-priority.js";

const mocks = vi.hoisted(() => ({
  getDecisionsStatus: vi.fn(),
  getRequestUserEmail: vi.fn(),
  getUserSetting: vi.fn(),
  getAiPriorityCache: vi.fn(),
  getCachedPriorityScores: vi.fn(),
  mergePriorityCache: vi.fn(),
  saveAiPriorityCache: vi.fn(),
  listAutomationRules: vi.fn(),
  previewAutomationPriority: vi.fn(),
  cacheLookups: [] as Array<{ provider: string; model: string }>,
  cacheEntries: [] as Array<Record<string, unknown>>,
}));

vi.mock("@agent-native/core/decisions", () => ({
  getDecisionsStatus: mocks.getDecisionsStatus,
  JEV_DECISIONS_MODEL: "jev-latest",
  OPENAI_DECISIONS_MODEL: "gpt-6-luna",
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
}));
vi.mock("../server/lib/automations.js", () => ({
  listAutomationRules: mocks.listAutomationRules,
}));
vi.mock("../server/lib/ai-priority.js", () => ({
  getAiPriorityCache: mocks.getAiPriorityCache,
  getCachedPriorityScores: mocks.getCachedPriorityScores,
  mergePriorityCache: mocks.mergePriorityCache,
  saveAiPriorityCache: mocks.saveAiPriorityCache,
}));
vi.mock("../server/lib/automation-engine.js", () => ({
  previewAutomationPriority: mocks.previewAutomationPriority,
}));

import action from "./get-ai-priority";

const email = (id: string, accountEmail?: string) => ({
  id,
  threadId: `thread-${id}`,
  ...(accountEmail ? { accountEmail } : {}),
  from: "sender@example.test",
  to: "owner@example.test",
  subject: "Synthetic test message",
  snippet: "No real email data.",
  labelIds: ["INBOX"],
  date: "2026-09-22T00:00:00.000Z",
  isArchived: false,
  isTrashed: false,
});

function status(
  ready: Array<"jev" | "openai">,
  providerOrder: Array<"jev" | "openai"> = ["jev", "openai"],
) {
  return {
    providerOrder,
    providers: (["jev", "openai"] as const).map((provider) => ({
      provider,
      status: ready.includes(provider) ? "ready" : "not_configured",
    })),
  };
}

describe("get-ai-priority action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cacheLookups = [];
    mocks.cacheEntries = [];
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.getDecisionsStatus.mockResolvedValue(status([]));
    mocks.getUserSetting.mockResolvedValue(null);
    mocks.getAiPriorityCache.mockImplementation(async () => ({
      entries: mocks.cacheEntries,
      model: null,
    }));
    mocks.getCachedPriorityScores.mockImplementation(
      (cache, emails, key, provider, model) => {
        mocks.cacheLookups.push({ provider, model });
        const entries = new Map(
          cache.entries
            .filter(
              (entry) =>
                entry.instructionKey === key &&
                entry.provider === provider &&
                entry.model === model,
            )
            .map((entry) => [
              aiPriorityEmailKey(
                entry.accountEmail as string | undefined,
                entry.emailId as string,
              ),
              entry,
            ]),
        );
        return new Map(
          emails.flatMap((item) => {
            const entry = entries.get(
              aiPriorityEmailKey(item.accountEmail, item.id),
            );
            return entry && entry.fingerprint === item.fingerprint
              ? [
                  [
                    aiPriorityEmailKey(item.accountEmail, item.id),
                    {
                      emailId: item.id,
                      ...(item.accountEmail
                        ? { accountEmail: item.accountEmail }
                        : {}),
                      score: entry.score as number,
                      ...(typeof entry.reason === "string"
                        ? { reason: entry.reason }
                        : {}),
                    },
                  ] as const,
                ]
              : [];
          }),
        );
      },
    );
    mocks.mergePriorityCache.mockImplementation((_cache, entries, model) => ({
      entries: [..._cache.entries, ...entries],
      model,
    }));
    mocks.listAutomationRules.mockResolvedValue([]);
    mocks.saveAiPriorityCache.mockImplementation(async (_owner, cache) => {
      mocks.cacheEntries = cache.entries;
      return cache;
    });
    mocks.previewAutomationPriority.mockImplementation(
      async (emails: Array<{ id: string; accountEmail?: string }>) => ({
        scores: new Map(
          emails.map((item) => [
            aiPriorityEmailKey(item.accountEmail, item.id),
            {
              score: 0.8,
              provider: "openai",
              model: "gpt-6-luna",
            },
          ]),
        ),
        failures: [],
        evaluatedCount: emails.length,
        failedCount: 0,
        model: { provider: "openai", model: "gpt-6-luna" },
      }),
    );
  });

  it("returns a typed not-configured error when no decision provider is ready", async () => {
    await expect(action.run({ emails: [] })).rejects.toMatchObject({
      errorCode: "jev_not_enabled",
      statusCode: 403,
    });
    expect(mocks.previewAutomationPriority).not.toHaveBeenCalled();
  });

  it("uses OpenAI when it is the only configured provider", async () => {
    mocks.getDecisionsStatus.mockResolvedValue(status(["openai"]));

    const result = await action.run({ emails: [email("email-1")] });

    expect(result.scores).toEqual([{ emailId: "email-1", score: 0.8 }]);
    expect(result).toMatchObject({
      eligibleCount: 1,
      evaluatedCount: 1,
      failedCount: 0,
      model: { provider: "openai", model: "gpt-6-luna" },
    });
    expect(mocks.cacheLookups).toEqual([
      { provider: "openai", model: "gpt-6-luna" },
    ]);
    expect(mocks.previewAutomationPriority).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "email-1" })],
      "owner@example.com",
      expect.any(String),
      expect.any(AbortSignal),
      ["openai"],
    );
    expect(mocks.saveAiPriorityCache).toHaveBeenCalledWith(
      "owner@example.com",
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            emailId: "email-1",
            provider: "openai",
            model: "gpt-6-luna",
          }),
        ],
        model: { provider: "openai", model: "gpt-6-luna" },
      }),
    );
  });

  it("keeps Jev-first provider selection when both providers are configured", async () => {
    mocks.getDecisionsStatus.mockResolvedValue(status(["jev", "openai"]));
    mocks.previewAutomationPriority.mockResolvedValueOnce({
      scores: new Map([
        [
          aiPriorityEmailKey(undefined, "email-1"),
          {
            score: 0.9,
            provider: "jev",
            model: "jev-latest",
          },
        ],
      ]),
      failures: [],
      evaluatedCount: 1,
      failedCount: 0,
      model: { provider: "jev", model: "jev-latest" },
    });

    const result = await action.run({ emails: [email("email-1")] });

    expect(mocks.cacheLookups).toEqual([
      { provider: "jev", model: "jev-latest" },
      { provider: "openai", model: "gpt-6-luna" },
    ]);
    expect(result.model).toEqual({ provider: "jev", model: "jev-latest" });
    expect(mocks.saveAiPriorityCache).toHaveBeenCalledWith(
      "owner@example.com",
      expect.objectContaining({
        entries: [
          expect.objectContaining({ provider: "jev", model: "jev-latest" }),
        ],
      }),
    );
  });

  it("changes the cache provider identity when the ready provider changes", async () => {
    mocks.getDecisionsStatus
      .mockResolvedValueOnce(status(["openai"]))
      .mockResolvedValueOnce(status(["jev"]));
    mocks.previewAutomationPriority
      .mockResolvedValueOnce({
        scores: new Map([
          [
            aiPriorityEmailKey(undefined, "email-1"),
            {
              score: 0.4,
              provider: "openai",
              model: "gpt-6-luna",
            },
          ],
        ]),
        failures: [],
        evaluatedCount: 1,
        failedCount: 0,
        model: { provider: "openai", model: "gpt-6-luna" },
      })
      .mockResolvedValueOnce({
        scores: new Map([
          [
            aiPriorityEmailKey(undefined, "email-1"),
            {
              score: 0.7,
              provider: "jev",
              model: "jev-latest",
            },
          ],
        ]),
        failures: [],
        evaluatedCount: 1,
        failedCount: 0,
        model: { provider: "jev", model: "jev-latest" },
      });

    await action.run({ emails: [email("email-1")] });
    await action.run({ emails: [email("email-1")] });

    expect(mocks.cacheLookups).toEqual([
      { provider: "openai", model: "gpt-6-luna" },
      { provider: "jev", model: "jev-latest" },
    ]);
    expect(mocks.previewAutomationPriority).toHaveBeenCalledTimes(2);
  });

  it("reuses an OpenAI cache entry after Jev falls through once", async () => {
    mocks.getDecisionsStatus.mockResolvedValue(status(["jev", "openai"]));

    const first = await action.run({ emails: [email("email-1")] });
    const second = await action.run({ emails: [email("email-1")] });

    expect(first.scores).toEqual([{ emailId: "email-1", score: 0.8 }]);
    expect(second.scores).toEqual(first.scores);
    expect(second.model).toEqual({ provider: "openai", model: "gpt-6-luna" });
    expect(mocks.cacheLookups).toEqual([
      { provider: "jev", model: "jev-latest" },
      { provider: "openai", model: "gpt-6-luna" },
      { provider: "jev", model: "jev-latest" },
      { provider: "openai", model: "gpt-6-luna" },
    ]);
    expect(mocks.previewAutomationPriority).toHaveBeenCalledOnce();
    expect(mocks.previewAutomationPriority.mock.calls[0]?.[4]).toEqual([
      "jev",
      "openai",
    ]);
  });

  it("keeps a Priority ranking on one provider when cache entries are split", async () => {
    mocks.getDecisionsStatus.mockResolvedValue(status(["jev", "openai"]));
    mocks.getCachedPriorityScores.mockImplementation(
      (
        _cache,
        candidateEmails: Array<{ id: string; accountEmail?: string }>,
        _key,
        provider: string,
        model: string,
      ) => {
        mocks.cacheLookups.push({ provider, model });
        const emailId = provider === "jev" ? "email-1" : "email-2";
        const candidate = candidateEmails.find(({ id }) => id === emailId);
        if (!candidate) return new Map();
        return new Map([
          [
            aiPriorityEmailKey(candidate.accountEmail, candidate.id),
            {
              emailId,
              score: provider === "jev" ? 0.95 : 0.1,
            },
          ],
        ]);
      },
    );
    mocks.previewAutomationPriority.mockResolvedValueOnce({
      scores: new Map([
        [
          aiPriorityEmailKey(undefined, "email-2"),
          {
            emailId: "email-2",
            score: 0.7,
            provider: "jev",
            model: "jev-latest",
          },
        ],
      ]),
      failures: [],
      evaluatedCount: 1,
      failedCount: 0,
      model: { provider: "jev", model: "jev-latest" },
    });

    const result = await action.run({
      emails: [email("email-1"), email("email-2")],
    });

    expect(result.scores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ emailId: "email-1", score: 0.95 }),
        expect.objectContaining({ emailId: "email-2", score: 0.7 }),
      ]),
    );
    expect(result.model).toEqual({ provider: "jev", model: "jev-latest" });
    expect(mocks.previewAutomationPriority.mock.calls[0]?.[4]).toEqual(["jev"]);
  });

  it("returns successful scores with per-email failures and no fallback scores", async () => {
    mocks.getDecisionsStatus.mockResolvedValue(status(["openai"]));
    mocks.previewAutomationPriority.mockResolvedValueOnce({
      scores: new Map([
        [
          aiPriorityEmailKey(undefined, "email-1"),
          {
            score: 0.92,
            provider: "openai",
            model: "gpt-6-luna",
          },
        ],
      ]),
      failures: [{ emailId: "email-2", reason: "refusal" }],
      evaluatedCount: 1,
      failedCount: 1,
      model: { provider: "openai", model: "gpt-6-luna" },
    });

    const result = await action.run({
      emails: [email("email-1"), email("email-2")],
    });

    expect(result.scores).toEqual([{ emailId: "email-1", score: 0.92 }]);
    expect(result).toMatchObject({
      eligibleCount: 2,
      evaluatedCount: 1,
      failedCount: 1,
      failures: [{ emailId: "email-2", reason: "refusal" }],
    });
    expect(mocks.saveAiPriorityCache).toHaveBeenCalledWith(
      "owner@example.com",
      expect.objectContaining({
        entries: [expect.objectContaining({ emailId: "email-1" })],
      }),
    );
  });

  it("returns provider failures with successful scores cached", async () => {
    mocks.getDecisionsStatus.mockResolvedValue(status(["openai"]));
    mocks.previewAutomationPriority.mockResolvedValueOnce({
      scores: new Map([
        [
          aiPriorityEmailKey(undefined, "email-1"),
          {
            score: 0.92,
            provider: "openai",
            model: "gpt-6-luna",
          },
        ],
      ]),
      failures: [
        { emailId: "email-2", reason: "provider_error", retryable: true },
      ],
      evaluatedCount: 1,
      failedCount: 1,
      model: { provider: "openai", model: "gpt-6-luna" },
    });

    const result = await action.run({
      emails: [email("email-1"), email("email-2")],
    });

    expect(result.scores).toEqual([{ emailId: "email-1", score: 0.92 }]);
    expect(result).toMatchObject({
      evaluatedCount: 1,
      failedCount: 1,
      failures: [
        { emailId: "email-2", reason: "provider_error", retryable: true },
      ],
    });
    expect(mocks.saveAiPriorityCache).toHaveBeenCalledWith(
      "owner@example.com",
      expect.objectContaining({
        entries: [expect.objectContaining({ emailId: "email-1" })],
      }),
    );
  });

  it("falls through the unavailable Jev space to OpenAI", async () => {
    mocks.getDecisionsStatus.mockResolvedValue(status(["openai"]));

    await action.run({ emails: [email("email-1")] });

    expect(mocks.cacheLookups[0]).toEqual({
      provider: "openai",
      model: "gpt-6-luna",
    });
    expect(mocks.previewAutomationPriority).toHaveBeenCalledOnce();
  });

  it("scores matching message IDs independently across accounts", async () => {
    mocks.getDecisionsStatus.mockResolvedValue(status(["openai"]));
    mocks.previewAutomationPriority.mockImplementationOnce(
      async (emails: Array<{ id: string; accountEmail?: string }>) => ({
        scores: new Map(
          emails.map((item) => [
            aiPriorityEmailKey(item.accountEmail, item.id),
            {
              score: item.accountEmail === "first@example.test" ? 0.2 : 0.9,
              provider: "openai",
              model: "gpt-6-luna",
            },
          ]),
        ),
        failures: [],
        evaluatedCount: emails.length,
        failedCount: 0,
        model: { provider: "openai", model: "gpt-6-luna" },
      }),
    );

    const result = await action.run({
      emails: [
        email("shared-message-id", "first@example.test"),
        email("shared-message-id", "second@example.test"),
      ],
    });

    expect(result.scores).toEqual([
      {
        emailId: "shared-message-id",
        accountEmail: "first@example.test",
        score: 0.2,
      },
      {
        emailId: "shared-message-id",
        accountEmail: "second@example.test",
        score: 0.9,
      },
    ]);
  });
});
