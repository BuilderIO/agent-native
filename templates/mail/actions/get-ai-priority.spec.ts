import { beforeEach, describe, expect, it, vi } from "vitest";

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
      scores: new Map([["email-1", { score: 0.9 }]]),
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
});
