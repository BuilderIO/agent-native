import { describe, expect, it } from "vitest";
import {
  buildPlanHtml,
  deriveSectionsFromText,
  summarizePlan,
} from "./_plans.js";
import type { PlanBundle, PlanComment, PlanSection } from "../shared/types.js";

function section(
  id: string,
  type: PlanSection["type"],
  title = id,
): PlanSection {
  return {
    id,
    planId: "plan_1",
    type,
    title,
    body: `Body for ${title}`,
    html: null,
    order: 0,
    createdBy: "agent",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function comment(id: string, status: PlanComment["status"]): PlanComment {
  return {
    id,
    planId: "plan_1",
    sectionId: null,
    kind: "comment",
    status,
    anchor: null,
    message: id,
    createdBy: "human",
    consumedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("Plans helpers", () => {
  it("summarizes sections and open comments without proof concepts", () => {
    const summary = summarizePlan(
      [section("a", "summary"), section("b", "wireframe")],
      [comment("c1", "open"), comment("c2", "resolved")],
    );

    expect(summary.sectionCounts).toEqual({ summary: 1, wireframe: 1 });
    expect(summary.commentCount).toBe(2);
    expect(summary.openCommentCount).toBe(1);
  });

  it("turns imported text into visual companion sections", () => {
    const sections = deriveSectionsFromText(
      "# Checkout plan\n\n- Build the new flow\n\n## UI mockup\n\nShow two states.",
    );

    expect(sections.some((item) => item.type === "wireframe")).toBe(true);
    expect(sections.some((item) => item.type === "diagram")).toBe(true);
  });

  it("renders a complete iframe-safe HTML plan document", () => {
    const bundle: PlanBundle = {
      plan: {
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
      },
      sections: [section("sec_1", "wireframe", "Review the UI")],
      comments: [],
      events: [],
      summary: {
        sectionCounts: { wireframe: 1 },
        commentCount: 0,
        openCommentCount: 0,
      },
    };

    const html = buildPlanHtml(bundle);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Review the UI");
    expect(html).not.toContain("proof");
  });
});
