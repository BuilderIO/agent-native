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
});
