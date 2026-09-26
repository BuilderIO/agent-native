import { beforeEach, describe, expect, it, vi } from "vitest";

import { aiPriorityEmailKey } from "../shared/ai-priority.js";

const mocks = vi.hoisted(() => ({
  getRequestUserEmail: vi.fn(),
  getAiFilterState: vi.fn(),
  listAutomationRules: vi.fn(),
  previewAutomationRules: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));
vi.mock("../server/lib/ai-filter.js", () => ({
  getAiFilterState: mocks.getAiFilterState,
}));
vi.mock("../server/lib/automations.js", () => ({
  listAutomationRules: mocks.listAutomationRules,
}));
vi.mock("../server/lib/automation-engine.js", () => ({
  previewAutomationRules: mocks.previewAutomationRules,
}));

import action from "./preview-ai-filter.js";

const email = {
  id: "shared-id",
  threadId: "shared-thread",
  from: "sender@example.test",
  to: "owner@example.test",
  subject: "Synthetic message",
  snippet: "Synthetic content",
  labelIds: ["INBOX"],
  date: "2026-09-22T00:00:00.000Z",
  isArchived: false,
  isTrashed: false,
};

describe("preview-ai-filter action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue("owner@example.test");
    mocks.getAiFilterState.mockResolvedValue({ feedback: [] });
    mocks.listAutomationRules.mockResolvedValue([
      {
        id: "rule-1",
        kind: "ai-filter",
        enabled: true,
        name: "Important",
        condition: "Work message",
        actions: [],
      },
    ]);
  });

  it("returns shared-ID results for their matching connected accounts", async () => {
    const firstAccount = "first@example.test";
    const secondAccount = "second@example.test";
    mocks.previewAutomationRules.mockResolvedValue({
      matches: new Map([
        [aiPriorityEmailKey(firstAccount, email.id), []],
        [
          aiPriorityEmailKey(secondAccount, email.id),
          [{ ruleId: "rule-1", confidence: 0.95 }],
        ],
      ]),
      model: { engine: "typesafe", model: "jev-latest" },
    });

    const result = await action.run({
      emails: [
        { ...email, accountEmail: firstAccount },
        { ...email, accountEmail: secondAccount },
      ],
    });

    expect(result.emails.map(({ matches }) => matches)).toEqual([
      [],
      [{ ruleId: "rule-1", confidence: 0.95 }],
    ]);
  });
});
