import { beforeEach, describe, expect, it, vi } from "vitest";

import { aiPriorityEmailKey } from "../shared/ai-priority.js";

const mocks = vi.hoisted(() => ({
  getJevContextCredentials: vi.fn(),
  getRequestUserEmail: vi.fn(),
  isJevEnabled: vi.fn(),
  getAiPriorityCache: vi.fn(),
  getCachedPriorityScores: vi.fn(),
  mergePriorityCache: vi.fn(),
  saveAiPriorityCache: vi.fn(),
  listAutomationRules: vi.fn(),
  previewAutomationPriority: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getJevContextCredentials: mocks.getJevContextCredentials,
  getRequestUserEmail: mocks.getRequestUserEmail,
  isJevEnabled: mocks.isJevEnabled,
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

describe("get-ai-priority action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.com");
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: undefined,
      builderAuth: null,
      personalApiKey: undefined,
    });
    mocks.isJevEnabled.mockResolvedValue(false);
    mocks.getAiPriorityCache.mockResolvedValue({ entries: [], model: null });
    mocks.getCachedPriorityScores.mockReturnValue(new Map());
    mocks.mergePriorityCache.mockImplementation((_cache, entries, model) => ({
      entries,
      model,
    }));
    mocks.listAutomationRules.mockResolvedValue([]);
    mocks.saveAiPriorityCache.mockResolvedValue({ entries: [], model: null });
  });

  it("rejects direct action calls when Jev is not configured", async () => {
    await expect(action.run({ emails: [] })).rejects.toThrow(
      /Jev is not enabled/,
    );
    expect(mocks.listAutomationRules).not.toHaveBeenCalled();
    expect(mocks.previewAutomationPriority).not.toHaveBeenCalled();
  });

  it("uses Builder credentials to score Mail Priority with Jev", async () => {
    const builderAuth = {
      authorization: "Bearer builder-test-token",
      spaceId: "builder-space-1",
      userId: "builder-user-1",
    };
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: undefined,
      personalApiKey: undefined,
      builderAuth,
    });
    mocks.isJevEnabled.mockResolvedValue(true);
    mocks.previewAutomationPriority.mockResolvedValue({
      scores: new Map([
        [aiPriorityEmailKey(undefined, "email-1"), { score: 0.9 }],
      ]),
      model: { engine: "typesafe", model: "typesafe/jev-latest" },
    });

    await action.run({
      emails: [
        {
          id: "email-1",
          threadId: "thread-1",
          from: "sender@example.test",
          to: "owner@example.test",
          subject: "Synthetic test message",
          snippet: "No real email data.",
          labelIds: ["INBOX"],
          date: "2026-09-22T00:00:00.000Z",
          isArchived: false,
          isTrashed: false,
        },
      ],
    });

    expect(mocks.previewAutomationPriority).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "email-1" })]),
      "owner@example.com",
      expect.any(String),
      { apiKey: undefined, personalApiKey: undefined, builderAuth },
      expect.any(AbortSignal),
    );
  });

  it("scores matching message IDs independently across accounts", async () => {
    const model = { engine: "typesafe", model: "typesafe/jev-latest" };
    mocks.getJevContextCredentials.mockResolvedValue({
      apiKey: undefined,
      personalApiKey: undefined,
      builderAuth: { authorization: "Bearer builder-test-token" },
    });
    mocks.isJevEnabled.mockResolvedValue(true);
    mocks.previewAutomationPriority.mockImplementation(
      async (emails: Array<{ id: string; accountEmail?: string }>) => ({
        scores: new Map(
          emails.map((email) => [
            aiPriorityEmailKey(email.accountEmail, email.id),
            {
              score: email.accountEmail === "first@example.test" ? 0.2 : 0.9,
            },
          ]),
        ),
        model,
      }),
    );

    const result = await action.run({
      emails: ["first", "second"].map((account) => ({
        id: "shared-message-id",
        threadId: `thread-${account}`,
        accountEmail: `${account}@example.test`,
        from: "sender@example.test",
        to: "owner@example.test",
        subject: "Synthetic test message",
        snippet: "No real email data.",
        labelIds: ["INBOX"],
        date: "2026-09-22T00:00:00.000Z",
        isArchived: false,
        isTrashed: false,
      })),
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
    expect(mocks.saveAiPriorityCache).toHaveBeenCalledWith(
      "owner@example.com",
      expect.objectContaining({
        entries: expect.arrayContaining([
          expect.objectContaining({
            emailId: "shared-message-id",
            accountEmail: "first@example.test",
            score: 0.2,
          }),
          expect.objectContaining({
            emailId: "shared-message-id",
            accountEmail: "second@example.test",
            score: 0.9,
          }),
        ]),
      }),
    );
  });
});
