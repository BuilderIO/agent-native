import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildDeepLink: vi.fn(),
  createAutomationRule: vi.fn(),
  deleteAutomationRule: vi.fn(),
  getRequestUserEmail: vi.fn(),
  listAutomationRules: vi.fn(),
  readMailAiFilterBackfill: vi.fn(),
  startMailAiFilterBackfill: vi.fn(),
  updateAutomationRule: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: mocks.buildDeepLink,
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("../server/lib/automations.js", () => ({
  createAutomationRule: mocks.createAutomationRule,
  deleteAutomationRule: mocks.deleteAutomationRule,
  listAutomationRules: mocks.listAutomationRules,
  updateAutomationRule: mocks.updateAutomationRule,
}));

vi.mock("../server/lib/ai-filter-backfill.js", () => ({
  readMailAiFilterBackfill: mocks.readMailAiFilterBackfill,
  startMailAiFilterBackfill: mocks.startMailAiFilterBackfill,
}));

import { createManageEmailRulesAction } from "./manage-automations.js";

const ownerEmail = "owner@example.test";

describe("manage-email-rules chat action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestUserEmail.mockReturnValue(ownerEmail);
    mocks.buildDeepLink.mockImplementation(({ to }: { to: string }) => to);
    mocks.listAutomationRules.mockResolvedValue([]);
    mocks.createAutomationRule.mockImplementation(
      async (
        email: string,
        input: {
          name: string;
          condition: string;
          actions: Array<Record<string, unknown>>;
          domain: string;
          kind: string;
          enabled?: boolean;
        },
      ) => ({
        id: "rule-1",
        ownerEmail: email,
        domain: input.domain,
        kind: input.kind,
        name: input.name,
        condition: input.condition,
        actions: input.actions,
        enabled: input.enabled ?? true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    mocks.startMailAiFilterBackfill.mockResolvedValue({
      runId: "run-1",
      status: "queued",
    });
    mocks.readMailAiFilterBackfill.mockResolvedValue({
      runId: "run-1",
      status: "queued",
      perRule: [],
    });
  });

  it("creates tag rules through AI-filter CRUD and reports queued backfill", async () => {
    const action = createManageEmailRulesAction(true);
    const result = await action.run({
      action: "create",
      name: "Newsletters",
      condition: "from newsletters",
      actions: JSON.stringify([{ type: "label", labelName: "Newsletters" }]),
    });

    expect(mocks.createAutomationRule).toHaveBeenCalledWith(
      ownerEmail,
      expect.objectContaining({ domain: "mail", kind: "ai-filter" }),
    );
    expect(mocks.startMailAiFilterBackfill).toHaveBeenCalledWith(ownerEmail, [
      "rule-1",
    ]);
    expect(result).toMatchObject({
      id: "rule-1",
      mode: "tag",
      operation: "create",
      sentence: "from newsletters",
      enabled: true,
      appliedCounts: null,
      backfillRunId: "run-1",
      backfillStatus: "queued",
      settingsHref: "/settings?section=ai-filter",
    });
  });

  it("lists rule names and action effects with their mode classification", async () => {
    mocks.listAutomationRules.mockResolvedValue([
      {
        id: "legacy-rule",
        domain: "mail",
        kind: "automation",
        name: "Star my manager",
        condition: "from my manager",
        actions: [{ type: "star" }],
        enabled: true,
      },
      {
        id: "ai-rule",
        domain: "mail",
        kind: "ai-filter",
        name: "AI tag: receipts",
        condition: "Receipts from online shops",
        actions: [{ type: "label", labelName: "Receipts" }],
        enabled: false,
      },
    ]);

    const result = await createManageEmailRulesAction(true).run({
      action: "list",
    });

    expect(result).toMatchObject({
      mode: "list",
      rules: [
        {
          id: "legacy-rule",
          name: "Star my manager",
          mode: "automation",
          actions: [{ type: "star" }],
        },
        {
          id: "ai-rule",
          name: "AI tag: receipts",
          mode: "tag",
          tagName: "Receipts",
          actions: [{ type: "label", labelName: "Receipts" }],
        },
      ],
    });
  });

  it("returns per-rule counts when the backfill has started", async () => {
    mocks.readMailAiFilterBackfill.mockResolvedValue({
      runId: "run-1",
      status: "running",
      perRule: [{ ruleId: "rule-1", name: "Newsletters", appliedCount: 2 }],
    });

    const action = createManageEmailRulesAction(true);
    const result = await action.run({
      action: "create",
      name: "Newsletters",
      condition: "from newsletters",
      actions: JSON.stringify([{ type: "label", labelName: "Newsletters" }]),
    });

    expect(result).toMatchObject({
      appliedCounts: [
        { ruleId: "rule-1", name: "Newsletters", appliedCount: 2 },
      ],
      backfillRunId: "run-1",
      backfillStatus: "running",
    });
  });

  it("updates label/archive rules through shared CRUD and starts a new backfill", async () => {
    mocks.listAutomationRules.mockResolvedValue([
      {
        id: "rule-1",
        domain: "mail",
        kind: "automation",
        enabled: true,
      },
    ]);
    mocks.updateAutomationRule.mockResolvedValue({
      id: "rule-1",
      domain: "mail",
      kind: "ai-filter",
      condition: "from the team",
      actions: [{ type: "archive" }],
      enabled: true,
    });

    const action = createManageEmailRulesAction(true);
    const result = await action.run({
      action: "update",
      id: "rule-1",
      actions: JSON.stringify([{ type: "archive" }]),
    });

    expect(mocks.updateAutomationRule).toHaveBeenCalledWith(
      ownerEmail,
      "rule-1",
      expect.objectContaining({
        kind: "ai-filter",
        actions: [{ type: "archive" }],
      }),
    );
    expect(mocks.startMailAiFilterBackfill).toHaveBeenCalledWith(ownerEmail, [
      "rule-1",
    ]);
    expect(result).toMatchObject({ mode: "archive", operation: "update" });
  });

  it("reports a queued backfill for an updated AI rule", async () => {
    mocks.listAutomationRules.mockResolvedValue([
      {
        id: "rule-1",
        domain: "mail",
        kind: "ai-filter",
        condition: "from the team",
        actions: [{ type: "archive" }],
        enabled: true,
      },
    ]);
    mocks.updateAutomationRule.mockResolvedValue({
      id: "rule-1",
      domain: "mail",
      kind: "ai-filter",
      condition: "from the team about planning",
      actions: [{ type: "archive" }],
      enabled: true,
    });
    const result = await createManageEmailRulesAction(true).run({
      action: "update",
      id: "rule-1",
      condition: "from the team about planning",
    });

    expect(mocks.startMailAiFilterBackfill).toHaveBeenCalledWith(ownerEmail, [
      "rule-1",
    ]);
    expect(mocks.readMailAiFilterBackfill).toHaveBeenCalledWith(
      ownerEmail,
      "run-1",
    );
    expect(result).toMatchObject({
      operation: "update",
      backfillRunId: "run-1",
      backfillStatus: "queued",
      appliedCounts: null,
    });
    expect(result).not.toHaveProperty("backfillError");
  });

  it("keeps star rules on legacy automation behavior", async () => {
    const action = createManageEmailRulesAction(true);
    const result = await action.run({
      action: "create",
      name: "Star my manager",
      condition: "from my manager",
      actions: JSON.stringify([{ type: "star" }]),
    });

    expect(mocks.createAutomationRule).toHaveBeenCalledWith(
      ownerEmail,
      expect.objectContaining({ kind: "automation" }),
    );
    expect(mocks.startMailAiFilterBackfill).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      mode: "automation",
      backfillStatus: "not-applicable",
      settingsHref: "/settings?section=automations",
    });
  });

  it("deletes through shared CRUD", async () => {
    mocks.listAutomationRules.mockResolvedValue([
      {
        id: "rule-1",
        domain: "mail",
        kind: "ai-filter",
        condition: "from newsletters",
        actions: [{ type: "label", labelName: "Newsletters" }],
        enabled: true,
      },
    ]);

    const action = createManageEmailRulesAction(true);
    const result = await action.run({ action: "delete", id: "rule-1" });

    expect(mocks.deleteAutomationRule).toHaveBeenCalledWith(
      ownerEmail,
      "rule-1",
    );
    expect(result).toMatchObject({
      id: "rule-1",
      mode: "tag",
      operation: "delete",
      enabled: false,
      deleted: true,
    });
  });

  it("creates an Important rule from a mode and one sentence", async () => {
    const action = createManageEmailRulesAction(true);
    const result = await action.run({
      action: "create",
      mode: "important",
      sentence: "Messages from my manager Priya",
    });

    expect(mocks.createAutomationRule).toHaveBeenCalledWith(
      ownerEmail,
      expect.objectContaining({
        name: "AI important: Messages from my manager Priya",
        condition: "Messages from my manager Priya",
        actions: [{ type: "label", labelName: "agent-native-important" }],
        kind: "ai-filter",
      }),
    );
    expect(result).toMatchObject({
      mode: "important",
      sentence: "Messages from my manager Priya",
      enabled: true,
      appliedCounts: null,
      backfillRunId: "run-1",
      settingsHref: "/settings?section=ai-filter",
    });
  });

  it("creates an AI tag from a mode, sentence, and label name", async () => {
    const action = createManageEmailRulesAction(true);
    const result = await action.run({
      action: "create",
      mode: "tag",
      sentence: "Receipts and order confirmations",
      tagName: "Receipts",
    });

    expect(mocks.createAutomationRule).toHaveBeenCalledWith(
      ownerEmail,
      expect.objectContaining({
        name: "AI tag: Receipts and order confirmations",
        condition: "Receipts and order confirmations",
        actions: [{ type: "label", labelName: "Receipts" }],
        kind: "ai-filter",
      }),
    );
    expect(result).toMatchObject({ mode: "tag", tagName: "Receipts" });
  });

  it("creates a Filtered rule from a mode and one sentence", async () => {
    const action = createManageEmailRulesAction(true);
    const result = await action.run({
      action: "create",
      mode: "filter",
      sentence: "Cold sales pitches I have not replied to",
    });

    expect(mocks.createAutomationRule).toHaveBeenCalledWith(
      ownerEmail,
      expect.objectContaining({
        actions: [
          { type: "label", labelName: "agent-native-filtered" },
          { type: "archive" },
        ],
        kind: "ai-filter",
      }),
    );
    expect(result).toMatchObject({
      mode: "filter",
      sentence: "Cold sales pitches I have not replied to",
    });
  });

  it("updates a matching tag rule by mode and sentence", async () => {
    mocks.listAutomationRules.mockResolvedValue([
      {
        id: "rule-1",
        domain: "mail",
        kind: "ai-filter",
        name: "AI tag: Receipts",
        condition: "Receipts from shops",
        actions: [
          { type: "label", labelName: "Receipts" },
          { type: "archive" },
        ],
        enabled: true,
      },
    ]);
    mocks.updateAutomationRule.mockResolvedValue({
      id: "rule-1",
      domain: "mail",
      kind: "ai-filter",
      name: "AI tag: Receipts from online shops",
      condition: "Receipts from online shops",
      actions: [{ type: "label", labelName: "Receipts" }, { type: "archive" }],
      enabled: true,
    });

    const action = createManageEmailRulesAction(true);
    const result = await action.run({
      action: "update",
      id: "rule-1",
      mode: "tag",
      sentence: "Receipts from online shops",
    });

    expect(mocks.updateAutomationRule).toHaveBeenCalledWith(
      ownerEmail,
      "rule-1",
      expect.objectContaining({
        kind: "ai-filter",
        name: "AI tag: Receipts from online shops",
        condition: "Receipts from online shops",
        actions: [
          { type: "label", labelName: "Receipts" },
          { type: "archive" },
        ],
      }),
    );
    expect(result).toMatchObject({ mode: "tag", tagName: "Receipts" });
  });
});
