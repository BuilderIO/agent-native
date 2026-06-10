import { describe, expect, it } from "vitest";
import {
  buildInitialPlanCommentRows,
  buildPlanHtml,
  buildUpdatedPlanCommentRows,
  deriveSectionsFromText,
  newId,
  summarizePlan,
} from "./plans.js";
import { buildUiPlanHtml } from "./ui-plan-html.js";
import { buildVisualQuestionsHtml } from "./visual-questions-html.js";
import { createVisualQuestionsSchema } from "../actions/create-visual-questions.js";
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
  it("generates URL-friendly dashed IDs", () => {
    expect(newId("plan")).toMatch(/^plan-[0-9a-f]{16}$/);
    expect(newId("plan")).not.toContain("plan_");
  });

  it("keeps non-plan generated IDs compatible", () => {
    expect(newId("cmt")).toMatch(/^cmt_[0-9a-f]{16}$/);
  });

  it("summarizes sections and open comments", () => {
    const summary = summarizePlan(
      [section("a", "summary"), section("b", "wireframe")],
      [comment("c1", "open"), comment("c2", "resolved")],
    );

    expect(summary.sectionCounts).toEqual({ summary: 1, wireframe: 1 });
    expect(summary.commentCount).toBe(2);
    expect(summary.openCommentCount).toBe(1);
  });

  it("builds threaded initial comment rows with parent context first", () => {
    const rows = buildInitialPlanCommentRows({
      planId: "plan_threaded",
      now: "2026-06-05T00:00:00.000Z",
      requestEmail: "reviewer@example.com",
      requestName: "Reviewer",
      comments: [
        {
          id: "reply",
          parentCommentId: "root",
          kind: "comment",
          status: "open",
          message: "Inline reply",
          createdBy: "human",
        },
        {
          id: "root",
          sectionId: "section-a",
          kind: "annotation",
          status: "open",
          anchor: JSON.stringify({ blockId: "wireframe-a" }),
          message: "Can we discuss this?",
          createdBy: "human",
        },
      ],
    });

    expect(rows.map((row) => row.id)).toEqual(["root", "reply"]);
    expect(rows[0]).toMatchObject({
      id: "root",
      parentCommentId: null,
      sectionId: "section-a",
      kind: "annotation",
      authorEmail: "reviewer@example.com",
      authorName: "Reviewer",
    });
    expect(JSON.parse(rows[0].anchor ?? "{}")).toEqual({
      blockId: "wireframe-a",
      resolutionTarget: "agent",
      mentions: [],
    });
    expect(rows[1]).toMatchObject({
      id: "reply",
      parentCommentId: "root",
      sectionId: "section-a",
      kind: "annotation",
      authorEmail: "reviewer@example.com",
      authorName: "Reviewer",
    });
    expect(JSON.parse(rows[1].anchor ?? "{}")).toEqual({
      blockId: "wireframe-a",
      resolutionTarget: "agent",
      mentions: [],
    });
  });

  it("rejects missing or cyclic initial comment parents", () => {
    expect(() =>
      buildInitialPlanCommentRows({
        planId: "plan_missing",
        now: "2026-06-05T00:00:00.000Z",
        comments: [
          {
            id: "reply",
            parentCommentId: "missing",
            kind: "comment",
            status: "open",
            message: "Reply",
            createdBy: "human",
          },
        ],
      }),
    ).toThrow("Parent comment missing was not found in initial comments.");

    expect(() =>
      buildInitialPlanCommentRows({
        planId: "plan_cycle",
        now: "2026-06-05T00:00:00.000Z",
        comments: [
          {
            id: "a",
            parentCommentId: "b",
            kind: "comment",
            status: "open",
            message: "A",
            createdBy: "human",
          },
          {
            id: "b",
            parentCommentId: "a",
            kind: "comment",
            status: "open",
            message: "B",
            createdBy: "human",
          },
        ],
      }),
    ).toThrow("Initial comment threads contain a parent cycle.");
  });

  it("builds update comment rows against existing and pending parents", () => {
    const rows = buildUpdatedPlanCommentRows({
      planId: "plan_update",
      now: "2026-06-05T00:00:00.000Z",
      requestEmail: "reviewer@example.com",
      requestName: "Reviewer",
      existingComments: [
        {
          id: "existing-root",
          sectionId: "section-existing",
          kind: "annotation",
          anchor: JSON.stringify({ blockId: "existing-wireframe" }),
        },
      ],
      comments: [
        {
          id: "reply-to-new-root",
          parentCommentId: "new-root",
          kind: "comment",
          status: "open",
          message: "Reply before root",
          createdBy: "human",
        },
        {
          id: "new-root",
          sectionId: "section-new",
          kind: "comment",
          status: "open",
          anchor: JSON.stringify({ blockId: "new-wireframe" }),
          message: "New root",
          createdBy: "human",
        },
        {
          id: "reply-to-existing-root",
          parentCommentId: "existing-root",
          kind: "comment",
          status: "open",
          message: "Reply to existing",
          createdBy: "human",
        },
      ],
    });

    expect(rows.map((row) => row.id)).toEqual([
      "new-root",
      "reply-to-existing-root",
      "reply-to-new-root",
    ]);
    expect(rows[1]).toMatchObject({
      id: "reply-to-existing-root",
      parentCommentId: "existing-root",
      sectionId: "section-existing",
      kind: "annotation",
      anchor: JSON.stringify({ blockId: "existing-wireframe" }),
    });
    expect(rows[2]).toMatchObject({
      id: "reply-to-new-root",
      parentCommentId: "new-root",
      sectionId: "section-new",
      kind: "comment",
      authorEmail: "reviewer@example.com",
      authorName: "Reviewer",
    });
    expect(JSON.parse(rows[2].anchor ?? "{}")).toEqual({
      blockId: "new-wireframe",
      resolutionTarget: "agent",
      mentions: [],
    });
  });

  it("stores queryable resolver metadata and infers human routing from mentions", () => {
    const mention = "@[Tiana](mailto:tiana%40example.com)";
    const rows = buildInitialPlanCommentRows({
      planId: "plan_comment_metadata",
      now: "2026-06-05T00:00:00.000Z",
      comments: [
        {
          id: "agent-root",
          sectionId: "section-a",
          kind: "annotation",
          status: "open",
          anchor: JSON.stringify({ anchorKind: "text", textQuote: "CTA" }),
          message: "Please tune this for the agent.",
          createdBy: "human",
          resolutionTarget: "agent",
        },
        {
          id: "mention-root",
          kind: "comment",
          status: "open",
          message: `${mention} should approve this copy.`,
          createdBy: "human",
        },
        {
          id: "reply-inherits",
          parentCommentId: "agent-root",
          kind: "comment",
          status: "open",
          message: "Additional context for the same agent task.",
          createdBy: "human",
        },
        {
          id: "reply-mentions-human",
          parentCommentId: "agent-root",
          kind: "comment",
          status: "open",
          message: `${mention} please sanity-check the policy.`,
          createdBy: "human",
        },
      ],
    });

    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get("agent-root")?.resolutionTarget).toBe("agent");
    expect(JSON.parse(byId.get("agent-root")?.anchor ?? "{}")).toMatchObject({
      resolutionTarget: "agent",
    });
    expect(byId.get("mention-root")?.resolutionTarget).toBe("human");
    expect(JSON.parse(byId.get("mention-root")?.mentionsJson ?? "[]")).toEqual([
      { label: "Tiana", email: "tiana@example.com" },
    ]);
    expect(byId.get("reply-inherits")?.resolutionTarget).toBe("agent");
    expect(byId.get("reply-mentions-human")?.resolutionTarget).toBe("human");
  });

  it("rejects missing or cyclic update comment parents", () => {
    expect(() =>
      buildUpdatedPlanCommentRows({
        planId: "plan_update_missing",
        now: "2026-06-05T00:00:00.000Z",
        existingComments: [],
        comments: [
          {
            id: "reply",
            parentCommentId: "missing",
            kind: "comment",
            status: "open",
            message: "Reply",
            createdBy: "human",
          },
        ],
      }),
    ).toThrow(
      "Parent comment missing was not found on plan plan_update_missing.",
    );

    expect(() =>
      buildUpdatedPlanCommentRows({
        planId: "plan_update_cycle",
        now: "2026-06-05T00:00:00.000Z",
        existingComments: [],
        comments: [
          {
            id: "a",
            parentCommentId: "b",
            kind: "comment",
            status: "open",
            message: "A",
            createdBy: "human",
          },
          {
            id: "b",
            parentCommentId: "a",
            kind: "comment",
            status: "open",
            message: "B",
            createdBy: "human",
          },
        ],
      }),
    ).toThrow("Updated comment threads contain a parent cycle.");
  });

  it("turns imported text into visual companion sections", () => {
    const sections = deriveSectionsFromText(
      "# Checkout plan\n\n- Build the new flow\n\n## UI mockup\n\nShow two states.",
    );

    expect(sections.some((item) => item.type === "mockup")).toBe(true);
    expect(sections.some((item) => item.type === "diagram")).toBe(true);
  });

  it("detects implementation sections from file-level plans", () => {
    const sections = deriveSectionsFromText(
      "# Implementation\n\n- templates/plan/app/pages/PlansPage.tsx — symbols: `injectAnnotationRuntime`; add code preview popovers.\n\n```tsx\nfunction injectAnnotationRuntime() {}\n```",
    );

    expect(sections.some((item) => item.type === "implementation")).toBe(true);
  });

  it("detects UI mockup sections separately from generic wireframes", () => {
    const sections = deriveSectionsFromText(
      "# UI mockups\n\nShow default, empty, loading, and mobile states for the plan review screen.",
    );

    expect(sections.some((item) => item.type === "mockup")).toBe(true);
  });

  it("builds a UI-first hybrid plan with a top canvas and document tabs", () => {
    const html = buildUiPlanHtml({
      title: "/ui-plan review",
      brief: "Start with high-fidelity UI states before implementation notes.",
      source: "codex",
      repoPath: "/Users/steve/project",
      states: [
        {
          name: "Default",
          description: "Primary review state with comments available.",
        },
        {
          name: "Error",
          description: "Recover from failed handoff.",
        },
        {
          name: "Mobile",
          description: "Narrow screen review and comment handoff.",
        },
      ],
      components: [
        {
          name: "Comment popover",
          description: "Inline composer near the selected UI region.",
        },
      ],
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain('data-ui-plan-mode="hybrid-document"');
    expect(html).toContain('data-has-top-canvas="true"');
    expect(html).toContain("canvas-viewport");
    expect(html).toContain(
      ".top-canvas-section { position: relative; height: 65vh;",
    );
    expect(html).not.toContain("canvas-toolbar");
    expect(html).not.toContain("Wireframe canvas");
    expect(html).toContain(
      "--canvas: #1d1c1b; --grid-line: rgba(244,244,242,.024)",
    );
    expect(html).toContain("--bg: #1f1e1d");
    expect(html).not.toContain('window.dispatchEvent(new Event("resize"))');
    expect(html).toContain(
      'window.dispatchEvent(new Event("agent-native-plan-board-layout-change"))',
    );
    expect(html).toContain(
      "background-size: var(--grid-size) var(--grid-size)",
    );
    expect(html).toContain(
      "background-position: var(--grid-offset-x) var(--grid-offset-y)",
    );
    expect(html).toContain("canvas-annotation");
    expect(html).toContain("annotation-arrow");
    expect(html).not.toContain('class="canvas-helper-note');
    expect(html).not.toContain('class="annotation-note"');
    expect(html).not.toContain('class="frame-caption"');
    expect(html).not.toContain("<span>::</span>");
    expect(html).not.toContain("doc-meta");
    expect(html).toContain("--wire-surface: #202020");
    expect(html).toContain(
      ".wire-window { position: absolute; inset: 0; overflow: hidden; border: 1.5px solid var(--wire-line); border-radius: 5px; background: var(--wire-surface); color: var(--ink); filter: url(#ui-plan-roughen); box-shadow: none;",
    );
    expect(html).toContain(
      ".phone-shell { position: absolute; inset: 0; overflow: hidden; border: 1.5px solid var(--wire-line); border-radius: 25px; background: var(--wire-surface); color: var(--ink); filter: url(#ui-plan-roughen); box-shadow: none;",
    );
    expect(html).toContain("pre code, pre code *");
    expect(html).toContain("background: var(--code-bg)");
    expect(html).toContain(
      ".tab-list { display: inline-flex; width: fit-content; max-width: 100%; gap: 8px; border: 0;",
    );
    expect(html).toContain("notion-plan");
    expect(html).toContain("data-plan-tabs");
    expect(html).toContain('data-tab-target="state-ui-default-0"');
    expect(html).toContain('data-tab-panel="state-ui-error-1"');
    expect(html).toContain("sketch-flow-diagram");
    expect(html).toContain("doc-component-tabs");
    expect(html).toContain("Implementation Map");
    expect(html).toContain("file-map-preview");
    expect(html).toContain('data-tab-target="ui-file-create-action"');
    expect(html).toContain('data-tab-panel="ui-file-create-action"');
    expect(html).toContain("Excalifont-Regular.woff2");
    expect(html).not.toContain("tweaks-panel");
    expect(html).not.toContain("/Users/steve/project");
  });

  it("skips the top canvas when no visual states or components are supplied", () => {
    const html = buildUiPlanHtml({
      title: "/ui-plan document review",
      brief: "This plan only needs a clean interactive document.",
      source: "codex",
      repoPath: "/Users/steve/project",
    });

    expect(html).toContain('data-ui-plan-mode="hybrid-document"');
    expect(html).not.toContain('data-has-top-canvas="true"');
    expect(html).not.toContain('<div class="canvas-viewport"');
    expect(html).not.toContain('<div class="flow-connector"');
    expect(html).toContain("What Matters Most");
    expect(html).toContain("No dedicated top wireframes were supplied");
    expect(html).toContain("Implementation Map");
  });

  it("builds an interactive visual questions intake form", () => {
    const html = buildVisualQuestionsHtml({
      title: "Quick questions about your todo app",
      brief: "Answer visually before the UI plan.",
      source: "codex",
      repoPath: "/Users/steve/project",
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain('data-visual-questions="true"');
    expect(html).toContain("Visual intake");
    expect(html).toContain('data-question-type="single"');
    expect(html).toContain('data-question-type="multi"');
    expect(html).toContain('data-question-type="freeform"');
    expect(html).toContain('data-question-type="visual"');
    expect(html).toContain("vq-chip");
    expect(html).toContain("vq-visual-options");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    expect(html).toContain("vq-preview-diagram");
    expect(html).toContain("visual-questions-summary");
    expect(html).toContain("data-vq-copy");
    expect(html).toContain("data-vq-send");
    expect(html).toContain("agent-native-visual-questions-copy");
    expect(html).toContain("agent-native-visual-questions-send-to-agent");
    expect(html).toContain("function parentOrigin()");
    expect(html).toContain("window.__agentNativePlanParentOrigin");
    expect(html).toContain("const targetOrigin = parentOrigin();");
    expect(html).not.toContain('}, "*");');
    expect(html).not.toContain("Answer with visuals first.");
    expect(html).not.toContain("Visual question previews");
    expect(html).not.toContain("questions -> visual plan");
    expect(html).toContain("create or refine a UI-first visual plan");
    expect(html).not.toContain("/Users/steve/project</p>");
  });

  it("renders custom visual question schemas", () => {
    const html = buildVisualQuestionsHtml({
      title: "Checkout intake",
      brief: "Choose the checkout direction.",
      questions: [
        {
          id: "checkout-layout",
          type: "visual",
          title: "Pick a checkout layout",
          options: [
            {
              label: "One page",
              preview: "desktop",
              description: "Everything stays visible.",
            },
            {
              label: "Stepper",
              preview: "flow",
              description: "Guide the user in phases.",
            },
          ],
        },
        {
          id: "constraints",
          type: "freeform",
          title: "Constraints",
          placeholder: "Payment, tax, inventory...",
        },
      ],
    });

    expect(html).toContain("checkout-layout");
    expect(html).toContain("Pick a checkout layout");
    expect(html).toContain("One page");
    expect(html).toContain("Stepper");
    expect(html).toContain("vq-preview-flow");
    expect(html).toContain("Payment, tax, inventory...");
  });

  it("rejects duplicate custom visual question ids", () => {
    const result = createVisualQuestionsSchema.safeParse({
      brief: "Clarify the UI before planning.",
      questions: [
        {
          id: "audience",
          type: "single",
          title: "Who is this for?",
        },
        {
          id: "audience",
          type: "freeform",
          title: "Any audience notes?",
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        "Question IDs must be unique: audience",
      );
      expect(result.error.issues[0]?.path).toEqual(["questions", 1, "id"]);
    }
  });

  it("renders a complete iframe-safe visual plan", () => {
    const bundle: PlanBundle = {
      plan: {
        id: "plan_1",
        title: "Invite flow",
        brief: "Make the plan scannable.",
        kind: "plan",
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
        kind: "plan",
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
        kind: "plan",
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
        kind: "plan",
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
        kind: "plan",
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
