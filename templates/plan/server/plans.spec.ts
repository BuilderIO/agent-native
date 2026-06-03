import { describe, expect, it } from "vitest";
import {
  buildPlanHtml,
  deriveSectionsFromText,
  summarizePlan,
} from "./plans.js";
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
  it("summarizes sections and open comments", () => {
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

  it("detects implementation sections from file-level plans", () => {
    const sections = deriveSectionsFromText(
      "# Implementation\n\n- templates/plan/app/pages/PlansPage.tsx — symbols: `injectAnnotationRuntime`; add code preview popovers.\n\n```tsx\nfunction injectAnnotationRuntime() {}\n```",
    );

    expect(sections.some((item) => item.type === "implementation")).toBe(true);
  });

  it("renders a complete iframe-safe visual plan", () => {
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
  });

  it("renders tabbed visual sections for diagrams and wireframes", () => {
    const bundle: PlanBundle = {
      plan: {
        id: "plan_1",
        title: "Tabbed visuals",
        brief: "Compare multiple views without stacking them.",
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
      sections: [
        section("sec_wire", "wireframe", "Reader states"),
        section("sec_diagram", "diagram", "Agent flow"),
      ],
      comments: [],
      events: [],
      summary: {
        sectionCounts: { wireframe: 1, diagram: 1 },
        commentCount: 0,
        openCommentCount: 0,
      },
    };

    const html = buildPlanHtml(bundle);
    expect(html).toContain("data-plan-tabs");
    expect(html).toContain('data-tab-target="reader"');
    expect(html).toContain('data-tab-target="handoff"');
  });

  it("skips divider-only empty sections", () => {
    const empty = section("sec_empty", "summary", "");
    empty.body = "";
    empty.html = "";
    const filled = section("sec_filled", "summary", "Keep me");
    const bundle: PlanBundle = {
      plan: {
        id: "plan_1",
        title: "No empty sections",
        brief: "Avoid blank dividers.",
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
      sections: [empty, filled],
      comments: [],
      events: [],
      summary: {
        sectionCounts: { summary: 2 },
        commentCount: 0,
        openCommentCount: 0,
      },
    };

    const html = buildPlanHtml(bundle);
    expect(html).not.toContain('id="sec_empty"');
    expect(html).toContain('id="sec_filled"');
  });

  it("renders file references as previewable implementation tabs", () => {
    const implementation = section(
      "sec_impl",
      "implementation",
      "Files to change",
    );
    implementation.body =
      "- templates/plan/app/pages/PlansPage.tsx:210 — symbols: `AnnotationPopover`; render comment popovers near pins.\n\n```tsx\nfunction AnnotationPopover() {\n  return null;\n}\n```";
    const bundle: PlanBundle = {
      plan: {
        id: "plan_1",
        title: "Implementation plan",
        brief: "Show file-level work.",
        status: "review",
        source: "codex",
        repoPath: "/Users/steve/project",
        currentFocus: null,
        html: null,
        markdown: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        approvedAt: null,
      },
      sections: [implementation],
      comments: [],
      events: [],
      summary: {
        sectionCounts: { implementation: 1 },
        commentCount: 0,
        openCommentCount: 0,
      },
    };

    const html = buildPlanHtml(bundle);
    expect(html).toContain("implementation-map");
    expect(html).toContain("implementation-file-tabs");
    expect(html).toContain("implementation-file-list");
    expect(html).toContain("implementation-file-tab");
    expect(html).toContain("implementation-file-panel tab-panel");
    expect(html).toContain("data-plan-tabs");
    expect(html).toContain("data-tab-target");
    expect(html).toContain("data-tab-panel");
    expect(html).toContain("PlansPage.tsx");
    expect(html).toContain("templates/plan/app/pages/PlansPage.tsx");
    expect(html).not.toContain("PlansPage.tsx:210");
    expect(html).toContain("inline-code-preview");
    expect(html).not.toContain("data-agent-native-code-preview");
    expect(html).not.toContain("data-agent-native-hover-preview");
    expect(html).toContain("data-agent-native-editor-picker");
    expect(html).toContain("data-agent-native-editor-trigger");
    expect(html).toContain('data-agent-native-editor-option="cursor"');
    expect(html).toContain("data-agent-native-open-file");
    expect(html).toContain("/Users/steve/project/");
    expect(html).toContain("tabler-icon-brand-vscode");
    expect(html).toContain("tabler-icon-brand-finder");
    expect(html).toContain('<option value="finder">Finder</option>');
    expect(html).toContain('<option value="terminal">Terminal</option>');
    expect(html).toContain('<option value="ghostty">Ghostty</option>');
    expect(html).toContain('<option value="xcode">Xcode</option>');
    expect(html).not.toContain('<div class="code-preview-title"');
    expect(html).not.toContain(".code-preview-title");
    expect(html).not.toContain(">Preview</button>");
    expect(html).not.toContain(">VS Code</button>");
    expect(html).not.toContain(">Cursor</button>");
    expect(html).toContain("AnnotationPopover");
  });

  it("keeps markdown implementation files free of noisy badges", () => {
    const implementation = section(
      "sec_impl",
      "implementation",
      "Files to change",
    );
    implementation.body =
      "- templates/plan/README.md — symbols: `README`, `Install`, `Review Loop`; explain the install flow.";
    const bundle: PlanBundle = {
      plan: {
        id: "plan_1",
        title: "Implementation plan",
        brief: "Show file-level work.",
        status: "review",
        source: "codex",
        repoPath: "/Users/steve/project",
        currentFocus: null,
        html: null,
        markdown: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        approvedAt: null,
      },
      sections: [implementation],
      comments: [],
      events: [],
      summary: {
        sectionCounts: { implementation: 1 },
        commentCount: 0,
        openCommentCount: 0,
      },
    };

    const html = buildPlanHtml(bundle);

    expect(html).toContain("README.md");
    expect(html).not.toContain("<code>README</code>");
    expect(html).not.toContain("<code>Install</code>");
    expect(html).not.toContain('<div class="symbol-list">');
  });
});
