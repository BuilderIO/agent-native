import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAutomationRules: vi.fn(),
  createAutomationRule: vi.fn(),
  startMailAiFilterBackfill: vi.fn(),
  processMailAiFilterBackfills: vi.fn(),
  readMailAiFilterBackfill: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  fail: (message: string, options: object) =>
    Object.assign(new Error(message), options),
}));
vi.mock("./automations.js", () => ({
  listAutomationRules: mocks.listAutomationRules,
  createAutomationRule: mocks.createAutomationRule,
}));
vi.mock("./ai-filter-backfill.js", () => ({
  startMailAiFilterBackfill: mocks.startMailAiFilterBackfill,
  processMailAiFilterBackfills: mocks.processMailAiFilterBackfills,
  readMailAiFilterBackfill: mocks.readMailAiFilterBackfill,
}));

import { HUMAN_AUTHOR_CLAUSE } from "../../shared/human-author.js";
import { addSplit } from "./add-split.js";
import { classifyAutomated } from "./inbox-classify.js";

const rule = {
  id: "rule-1",
  domain: "mail",
  kind: "ai-filter",
  name: "Investors",
  condition: "investors",
  actions: [{ type: "label", labelName: "Investors" }],
};

describe("addSplit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAutomationRules.mockResolvedValue([]);
    mocks.createAutomationRule.mockResolvedValue(rule);
    mocks.startMailAiFilterBackfill.mockResolvedValue({
      runId: "run-1",
      status: "queued",
    });
    mocks.readMailAiFilterBackfill.mockResolvedValue({ status: "completed" });
  });

  it("applies the general human-author rule instead of naming senders", async () => {
    await addSplit("o@example.com", {
      name: "Investors",
      condition: "Messages about fundraising",
    });
    const condition = mocks.createAutomationRule.mock.lastCall?.[1]?.condition;
    expect(condition).toContain("Messages about fundraising");
    expect(condition).toContain(HUMAN_AUTHOR_CLAUSE);
  });

  it("returns the split view route, not Settings", async () => {
    const result = await addSplit("o@example.com", {
      name: "Investors",
      condition: "x",
    });
    expect(result.appView.route).toBe("/inbox?split=investors");
  });

  it("returns an existing split with the same rule instead of failing", async () => {
    mocks.listAutomationRules.mockResolvedValue([rule]);
    const result = await addSplit("o@example.com", {
      name: " investors ",
      condition: "x",
    });
    expect(result).toMatchObject({ created: false, rule });
    expect(mocks.createAutomationRule).not.toHaveBeenCalled();
    expect(result.appView.route).toBe("/inbox?split=investors");
  });

  it("runs the backfill instead of leaving it queued", async () => {
    const result = await addSplit("o@example.com", {
      name: "Investors",
      condition: "x",
    });
    expect(mocks.processMailAiFilterBackfills).toHaveBeenCalledWith(
      "o@example.com",
      "run-1",
      expect.any(Number),
    );
    expect(result.backfill).toEqual({ status: "completed", runId: "run-1" });
  });

  it("reports a typed failure when the backfill cannot start", async () => {
    mocks.startMailAiFilterBackfill.mockRejectedValue(
      Object.assign(new Error("Mail AI filtering is disabled."), {
        errorCode: "ai_filter_disabled",
      }),
    );
    const result = await addSplit("o@example.com", {
      name: "Investors",
      condition: "x",
    });
    expect(result.created).toBe(true);
    expect(result.backfill).toMatchObject({
      status: "failed",
      errorCode: "ai_filter_disabled",
    });
  });

  it("reports a failed run as failed", async () => {
    mocks.readMailAiFilterBackfill.mockResolvedValue({
      status: "failed",
      error: "boom",
    });
    const result = await addSplit("o@example.com", {
      name: "Investors",
      condition: "x",
    });
    expect(result.backfill).toMatchObject({ status: "failed", error: "boom" });
  });
});

describe("human author filter", () => {
  const base = { headers: [], labelIds: [] };
  it.each([
    "noreply@x.com",
    "notifications@github.com",
    "dependabot[bot]@users.noreply.github.com",
    "deploy-bot@x.com",
    "bot@x.com",
  ])("excludes %s", (fromEmail) => {
    expect(classifyAutomated({ ...base, fromEmail })).toBe("automated");
  });
  it("keeps people", () => {
    expect(classifyAutomated({ ...base, fromEmail: "abbott@x.com" })).toBe(
      "unclassified",
    );
    expect(classifyAutomated({ ...base, fromEmail: "robot.fan@x.com" })).toBe(
      "unclassified",
    );
  });
});
