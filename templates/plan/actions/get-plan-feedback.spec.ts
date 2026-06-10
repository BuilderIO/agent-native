import { describe, expect, it, vi } from "vitest";
import type {
  Plan,
  PlanBundle,
  PlanComment,
  PlanSection,
} from "../shared/types.js";

vi.mock("@agent-native/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core")>()),
  defineAction: (entry: unknown) => entry,
  embedApp: vi.fn(() => ({ title: "stub" })),
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
      events: [
        {
          id: "evt_1",
          planId: "plan_1",
          type: "plan.updated",
          message: "Human added inline visual plan feedback.",
          payload: {
            insertedCommentIds: ["human-open"],
            contentPatchOps: [],
          },
          createdBy: "human",
          createdAt: "2026-01-01T00:00:01.000Z",
        },
      ],
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
    expect(
      (
        result.comments[0] as PlanComment & {
          anchorDetails?: string[];
        }
      ).anchorDetails,
    ).toEqual([
      "Expected resolver: agent",
      'Location: Implementation steps: "Initialize npm project"',
    ]);
    expect(
      (
        result as PlanBundle & {
          recentReviewEvents?: Array<{ payload?: unknown }>;
        }
      ).recentReviewEvents?.[0]?.payload,
    ).toEqual({
      insertedCommentIds: ["human-open"],
      contentPatchOps: [],
    });
  });

  it("returns actionable, human-review, target, and visual-overflow manifests", async () => {
    const visualComments = Array.from({ length: 9 }, (_, index) => {
      const item = comment(`visual-${index}`, "human");
      item.kind = "annotation";
      item.anchor = JSON.stringify({
        anchorKind: "point",
        targetKind: "canvas",
        canvasX: index * 10,
        canvasY: index * 5,
        planAnnotationId: `pin-${index}`,
      });
      return item;
    });
    const humanReview = comment("human-review", "human");
    humanReview.resolutionTarget = "human";
    humanReview.anchor = JSON.stringify({
      anchorKind: "text",
      sectionTitle: "Policy",
      textQuote: "Require manager approval",
    });
    const prototypeVisual = comment("prototype-visual", "human");
    prototypeVisual.anchor = JSON.stringify({
      anchorKind: "visual",
      targetKind: "prototype",
      screenId: "confirm",
      targetX: 42,
      targetY: 36,
    });

    loadPlanBundleMock.mockResolvedValueOnce({
      plan,
      sections: [section],
      comments: [...visualComments, prototypeVisual, humanReview],
      events: [],
      summary: {
        sectionCounts: { summary: 1 },
        commentCount: 11,
        openCommentCount: 11,
      },
    } satisfies PlanBundle);

    const result = (await action.run({ planId: "plan_1" })) as PlanBundle & {
      actionableThreads: Array<{ id: string; resolutionTarget: string }>;
      humanReviewThreads: Array<{ id: string; resolutionTarget: string }>;
      targets: Array<{ targetId: string }>;
      feedbackSummary: {
        actionableThreadCount: number;
        humanReviewThreadCount: number;
        visualThreadCount: number;
        feedbackImageBudget: number;
        overflowVisualCount: number;
      };
      overflowVisual: Array<{ id: string; anchorDetails: string[] }>;
      instructions: string[];
    };

    expect(result.actionableThreads.map((thread) => thread.id)).toEqual(
      expect.arrayContaining(["visual-0", "prototype-visual"]),
    );
    expect(result.humanReviewThreads).toEqual([
      expect.objectContaining({
        id: "human-review",
        resolutionTarget: "human",
      }),
    ]);
    expect(result.targets.map((target) => target.targetId)).toContain(
      "canvas-annotation:pin-0",
    );
    expect(result.feedbackSummary).toMatchObject({
      actionableThreadCount: 10,
      humanReviewThreadCount: 1,
      visualThreadCount: 10,
      feedbackImageBudget: 8,
      overflowVisualCount: 2,
    });
    expect(
      (
        result.threads as Array<{
          id: string;
          isVisual: boolean;
          anchorDetails: string[];
        }>
      ).find((thread) => thread.id === "prototype-visual"),
    ).toMatchObject({
      isVisual: true,
      anchorDetails: expect.arrayContaining(["Prototype screen: confirm"]),
    });
    expect(result.overflowVisual).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "visual-8",
          anchorDetails: expect.arrayContaining(["Canvas point: 80, 40"]),
        }),
      ]),
    );
    expect(result.instructions.join("\n")).toContain(
      "Focused screenshot attachments",
    );
  });
});
