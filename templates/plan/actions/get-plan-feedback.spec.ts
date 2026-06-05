import { describe, expect, it, vi } from "vitest";
import type {
  Plan,
  PlanBundle,
  PlanComment,
  PlanSection,
} from "../shared/types.js";

vi.mock("@agent-native/core", () => ({
  defineAction: (entry: unknown) => entry,
}));

const loadPlanBundleMock = vi.fn();
vi.mock("../server/plans.js", () => ({
  loadPlanBundle: (planId: string) => loadPlanBundleMock(planId),
}));

const action = (await import("./get-plan-feedback.js")).default as {
  run: (args: { planId: string }) => Promise<PlanBundle>;
};

const plan: Plan = {
  id: "plan_1",
  title: "Invite flow",
  brief: "Make the plan scannable.",
  status: "review",
  source: "codex",
  repoPath: null,
  currentFocus: null,
  html: null,
  markdown: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  approvedAt: null,
};

const section: PlanSection = {
  id: "sec_1",
  planId: "plan_1",
  type: "summary",
  title: "Summary",
  body: "Review this.",
  html: null,
  order: 0,
  createdBy: "agent",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function comment(
  id: string,
  createdBy: PlanComment["createdBy"],
  consumedAt: string | null = null,
): PlanComment {
  return {
    id,
    planId: "plan_1",
    sectionId: null,
    kind: "comment",
    status: "open",
    anchor: null,
    message: id,
    createdBy,
    consumedAt,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("get-plan-feedback action", () => {
  it("returns only unconsumed human comments", async () => {
    loadPlanBundleMock.mockResolvedValueOnce({
      plan,
      sections: [section],
      comments: [
        comment("human-open", "human"),
        comment("human-consumed", "human", "2026-01-01T01:00:00.000Z"),
        comment("agent-open", "agent"),
        comment("import-open", "import"),
      ],
      events: [],
      summary: {
        sectionCounts: { summary: 1 },
        commentCount: 4,
        openCommentCount: 4,
      },
    } satisfies PlanBundle);

    const result = await action.run({ planId: "plan_1" });

    expect(loadPlanBundleMock).toHaveBeenCalledWith("plan_1");
    expect(result.comments.map((item) => item.id)).toEqual(["human-open"]);
  });

  it("adds concise anchor context for agents", async () => {
    const anchored = comment("human-open", "human");
    anchored.anchor = JSON.stringify({
      anchorKind: "text",
      sectionTitle: "Implementation steps",
      textQuote: "Initialize npm project",
      x: 40,
      y: 20,
    });
    loadPlanBundleMock.mockResolvedValueOnce({
      plan,
      sections: [section],
      comments: [anchored],
      events: [],
      summary: {
        sectionCounts: { summary: 1 },
        commentCount: 1,
        openCommentCount: 1,
      },
    } satisfies PlanBundle);

    const result = await action.run({ planId: "plan_1" });

    expect(
      (result.comments[0] as PlanComment & { anchorContext?: string })
        .anchorContext,
    ).toBe('Implementation steps: "Initialize npm project"');
  });
});
