import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildDeepLink: vi.fn(),
  getRequestUserEmail: vi.fn(),
  listAutomationRules: vi.fn(),
  rewriteAutomationRuleCondition: vi.fn(),
  startMailAiFilterBackfill: vi.fn(),
  updateAutomationRule: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: mocks.buildDeepLink,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/automation-engine.js", () => ({
  rewriteAutomationRuleCondition: mocks.rewriteAutomationRuleCondition,
}));

vi.mock("../server/lib/automations.js", () => ({
  listAutomationRules: mocks.listAutomationRules,
  updateAutomationRule: mocks.updateAutomationRule,
}));

vi.mock("../server/lib/ai-filter-backfill.js", () => ({
  startMailAiFilterBackfill: mocks.startMailAiFilterBackfill,
}));

import action from "./refine-ai-filter.js";

const filteredRule = {
  id: "rule-1",
  ownerEmail: "owner@example.test",
  domain: "mail",
  kind: "ai-filter",
  name: "AI spam",
  condition: "Cold sales email",
  actions: [
    { type: "label", labelName: "agent-native-filtered" },
    { type: "archive" },
  ],
  enabled: true,
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:00:00.000Z",
};

describe("refine-ai-filter action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildDeepLink.mockReturnValue("/settings?section=ai-filter");
    mocks.getRequestUserEmail.mockReturnValue("owner@example.test");
    mocks.listAutomationRules.mockResolvedValue([filteredRule]);
    mocks.rewriteAutomationRuleCondition.mockResolvedValue(
      "Cold sales email from senders I have not replied to",
    );
    mocks.updateAutomationRule.mockResolvedValue({
      ...filteredRule,
      condition: "Cold sales email from senders I have not replied to",
    });
    mocks.startMailAiFilterBackfill.mockResolvedValue({
      runId: "backfill-1",
      status: "queued",
    });
  });

  it("saves the refined rule and queues the same rule against recent mail", async () => {
    const result = await action.run({
      ruleId: "rule-1",
      corrections: [
        {
          emailId: "email-1",
          sender: "Sales <sales@example.test>",
          subject: "A cold pitch",
          snippet: "A short introduction to our latest offer.",
          expectedMatch: true,
        },
      ],
    });

    expect(mocks.startMailAiFilterBackfill).toHaveBeenCalledWith(
      "owner@example.test",
      ["rule-1"],
    );
    expect(result).toMatchObject({
      id: "rule-1",
      mode: "filter",
      sentence: "Cold sales email from senders I have not replied to",
      enabled: true,
      appliedCounts: null,
      backfillRunId: "backfill-1",
      backfillStatus: "queued",
      settingsHref: "/settings?section=ai-filter",
    });
  });

  it("reports a saved rule when recent-mail application cannot start", async () => {
    mocks.startMailAiFilterBackfill.mockRejectedValue(new Error("disabled"));

    const result = await action.run({
      ruleId: "rule-1",
      corrections: [
        {
          emailId: "email-1",
          sender: "Sales <sales@example.test>",
          subject: "A cold pitch",
          snippet: "A short introduction to our latest offer.",
          expectedMatch: true,
        },
      ],
    });

    expect(result).toMatchObject({
      id: "rule-1",
      backfillStatus: "failed",
      settingsHref: "/settings?section=ai-filter",
    });
  });
});
