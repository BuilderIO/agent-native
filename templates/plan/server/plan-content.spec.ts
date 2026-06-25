import { describe, expect, it } from "vitest";

import {
  applyPlanContentPatches,
  migratePlanContent,
  planContentSchema,
  type PlanContent,
  type PlanWireframeNode,
} from "../shared/plan-content.js";
import {
  buildPlanContentHtml,
  createPlanDesignContent,
  createPlanContentFromSections,
  createPrototypeFromPlanContent,
  createPrototypePlanContent,
  createUiPlanContent,
  createVisualQuestionsContent,
  normalizePlanDesignContent,
  parsePlanContent,
  sanitizeCustomHtml,
  serializePlanContent,
} from "./plan-content.js";

describe("structured plan content", () => {
  it("backfills missing column/child ids so attribute-form columns validate", () => {
    // Mirrors the recap failure mode: a `columns` block authored as an
    // attribute array (no `<Column>` markup) leaves column `id`s and child
    // block `id`s unset. migrate must backfill them so the block validates
    // instead of failing the whole document at parse time.
    const raw = {
      title: "Recap",
      brief: "b",
      blocks: [
        { id: "b1", type: "rich-text", data: { markdown: "# Recap" } },
        {
          id: "b2",
          type: "columns",
          data: {
            columns: [
              {
                label: "Before",
                blocks: [{ type: "rich-text", data: { markdown: "old" } }],
              },
              {
                label: "After",
                blocks: [{ type: "rich-text", data: { markdown: "new" } }],
              },
            ],
          },
        },
      ],
    };

    const parsed = planContentSchema.parse(migratePlanContent(raw));
    const cols = (
      parsed.blocks[1] as Extract<
        PlanContent["blocks"][number],
        { type: "columns" }
      >
    ).data.columns;
    expect(typeof cols[0].id).toBe("string");
    expect(cols[0].id.length).toBeGreaterThan(0);
    expect(cols[1].id).not.toBe(cols[0].id);
    expect(typeof cols[0].blocks[0].id).toBe("string");
    expect(cols[0].blocks[0].data).toMatchObject({ markdown: "old" });
  });

  it("coerces a full-document wireframe nested in columns to a fragment instead of dropping the whole block", () => {
    // The exact recap failure mode from the field report: a `columns`
    // before/after whose wireframe `html` was authored as a full HTML document.
    // The pre-validation sanitizer must recurse into `columns` (it only handled
    // `tabs`) AND strip the document scaffold so the block validates and renders
    // — rather than degrading every column to an "Unsupported block" card with
    // "Wireframe html must be a bounded fragment...".
    const result = parsePlanContent({
      version: 2,
      title: "Recap",
      blocks: [
        {
          id: "cols",
          type: "columns",
          data: {
            columns: [
              {
                id: "before",
                label: "Before",
                blocks: [
                  {
                    id: "before-wf",
                    type: "wireframe",
                    data: {
                      surface: "panel",
                      html: '<!doctype html><html><head><style>.x{color:red}</style></head><body><div class="x">Old screen</div></body></html>',
                    },
                  },
                ],
              },
              {
                id: "after",
                label: "After",
                blocks: [
                  {
                    id: "after-wf",
                    type: "wireframe",
                    data: { surface: "panel", html: "<div>New screen</div>" },
                  },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(result).not.toBeNull();
    const block = result?.blocks[0];
    // The block survives as real `columns` (not a salvaged callout placeholder).
    expect(block?.type).toBe("columns");
    if (block?.type !== "columns") throw new Error("expected columns");
    const wf = block.data.columns[0]?.blocks[0];
    if (wf?.type !== "wireframe") throw new Error("expected wireframe");
    expect(wf.data.html).toContain("Old screen");
    const lower = wf.data.html?.toLowerCase() ?? "";
    expect(lower).not.toContain("<html");
    expect(lower).not.toContain("<head");
    expect(lower).not.toContain("<body");
    expect(lower).not.toContain("<style");
    expect(lower).not.toContain("doctype");
  });

  it("builds UI plans as native content with a canvas and kit-tree wireframes", () => {
    const content = createUiPlanContent({
      title: "Checkout flow",
      brief: "Review the checkout flow before implementation.",
      repoPath: "/Users/steve/project",
      states: [
        { name: "Overview", description: "Desktop review state." },
        { name: "Mobile", description: "Narrow purchase state." },
      ],
      components: [
        {
          name: "Comment handoff",
          description: "Reviewer comments stay pinned to exact states.",
        },
      ],
      implementationNotes:
        "Update templates/checkout/app/routes/checkout.tsx and related actions.",
    });

    expect(content.canvas?.frames).toHaveLength(2);
    expect(content.canvas?.frames[0]?.wireframe?.surface).toBe("desktop");
    expect(content.canvas?.frames[1]?.wireframe?.surface).toBe("mobile");
    expect(content.canvas?.frames[0]?.label).toBe("Overview");
    expect(content.canvas?.frames[0]?.legacyWireframe).toBeUndefined();
    expect(content.blocks.some((block) => block.type === "tabs")).toBe(true);
    expect(
      content.blocks.some((block) => block.type === "implementation-map"),
    ).toBe(true);
    // No region-based blocks should keep the deprecated discriminant.
    expect(
      content.blocks.every(
        (block) => block.type !== ("sketch-wireframe" as never),
      ),
    ).toBe(true);
    const desktopSidebar = findWireframeNode(
      content.canvas?.frames[0]?.wireframe?.screen ?? [],
      (node) => node.el === "sidebar",
    );
    expect(desktopSidebar?.children?.[0]).toMatchObject({
      el: "col",
      full: true,
    });
    const desktopSidebarChildren = desktopSidebar?.children ?? [];
    expect(desktopSidebarChildren[desktopSidebarChildren.length - 1]?.el).toBe(
      "box",
    );
    expect(
      findWireframeNode(
        desktopSidebar?.children ?? [],
        (node) => node.el === "navItem" && node.label === "Handoff",
      ),
    ).toBeTruthy();

    const html = buildPlanContentHtml({
      content,
      title: "Checkout flow",
      brief: "Review the checkout flow before implementation.",
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("canvas-export");
    expect(html).toContain("Checkout flow");
    expect(html).toContain("Implementation Map");
  });

  it("renders kit-tree wireframe captions in standalone HTML", () => {
    const content: PlanContent = {
      version: 2,
      title: "Captioned wireframe",
      blocks: [
        {
          id: "wf-1",
          type: "wireframe",
          data: {
            surface: "desktop",
            caption: "Calendar availability view",
            screen: [
              {
                id: "screen-root",
                el: "screen",
                children: [
                  {
                    id: "title-1",
                    el: "title",
                    text: "Weekly calendar",
                  },
                ],
              },
            ],
          },
        },
      ],
    };

    const html = buildPlanContentHtml({
      content,
      title: "Captioned wireframe",
      brief: "Render a captioned wireframe in standalone HTML.",
    });

    expect(html).toContain("kit-wireframe");
    expect(html).toContain('<p class="caption">Calendar availability view</p>');
  });

  it("anchors component context sidebar actions after a flexible content stack", () => {
    const content = createUiPlanContent({
      title: "Context X-Ray cleanup",
      brief: "Clean the agent sidebar context popover before implementation.",
      states: [
        {
          name: "Default popover",
          description: "Context X-Ray opens in the agent sidebar.",
        },
      ],
      components: [
        {
          name: "Context X-Ray widget",
          description: "A compact popover anchored in the agent sidebar.",
        },
      ],
    });

    const contextFrame = content.canvas?.frames.find(
      (frame) => frame.id === "frame-app-context",
    );
    const sidebar = findWireframeNode(
      contextFrame?.wireframe?.screen ?? [],
      (node) => node.el === "sidebar",
    );

    expect(sidebar?.children?.[0]).toMatchObject({
      el: "col",
      full: true,
    });
    const sidebarChildren = sidebar?.children ?? [];
    expect(sidebarChildren[sidebarChildren.length - 2]?.el).toBe("divider");
    expect(sidebarChildren[sidebarChildren.length - 1]).toMatchObject({
      el: "btn",
      label: "X-Ray",
      solid: true,
    });
  });

  it("keeps UI plans document-only when no states or components are supplied", () => {
    const content = createUiPlanContent({
      title: "Settings cleanup",
      brief: "Document the cleanup without a screen-state canvas.",
      states: [],
      components: [],
    });

    expect(content.canvas).toBeUndefined();
    expect(content.blocks.map((block) => block.type)).toEqual([
      "rich-text",
      "implementation-map",
    ]);

    const html = buildPlanContentHtml({
      content,
      title: "Settings cleanup",
      brief: "Document the cleanup without a screen-state canvas.",
    });

    expect(html).toContain("Visual Plan");
    expect(html).not.toContain("UI Plan");
  });

  it("turns section plans into editable content and optional canvas frames", () => {
    const content = createPlanContentFromSections({
      title: "Review flow",
      brief: "Sketch a review flow.",
      sections: [
        {
          id: "summary",
          type: "summary",
          title: "Goal",
          body: "Make feedback easy to consume.",
          html: null,
        },
        {
          id: "wire",
          type: "wireframe",
          title: "Reviewer screen",
          body: "Show comment and approval states.",
          html: null,
        },
      ],
    });

    expect(content.blocks.map((block) => block.type)).toEqual([
      "rich-text",
      "wireframe",
    ]);
    expect(content.canvas?.frames).toHaveLength(1);
    expect(content.canvas?.frames[0]?.wireframe?.screen.length ?? 0).toBe(1);
  });

  it("turns questions sections into reusable question-form blocks", () => {
    const content = createPlanContentFromSections({
      title: "Handoff review",
      brief: "Collect open decisions before implementation.",
      sections: [
        {
          id: "open-questions",
          type: "questions",
          title: "Open Questions",
          body: "- Which billing states matter?\n- What should happen offline?",
          html: null,
        },
      ],
    });

    expect(content.blocks).toHaveLength(1);
    const block = content.blocks[0];
    expect(block?.type).toBe("question-form");
    if (block?.type !== "question-form") return;
    expect(block.title).toBe("Open Questions");
    expect(block.data.submitLabel).toBe("Send to agent");
    expect(block.data.questions.map((question) => question.title)).toEqual([
      "Which billing states matter?",
      "What should happen offline?",
    ]);
    expect(block.data.questions[0]?.mode).toBe("freeform");
    expect(block.data.questions[0]?.placeholder).toBe(
      "Answer to revise the plan...",
    );
  });

  it("creates visual questions with kit-tree previews instead of standalone HTML", () => {
    const content = createVisualQuestionsContent({
      title: "Quick questions",
      brief: "Choose a layout direction.",
      questions: [
        {
          id: "layout",
          type: "visual",
          title: "Which layout direction?",
          allowOther: true,
          placeholder: "Describe another layout...",
          options: [
            { label: "Sidebar", preview: "desktop" },
            { label: "Mobile first", preview: "mobile" },
          ],
        },
      ],
    });

    const questionsBlock = content.blocks.find(
      (block) => block.type === "visual-questions",
    );
    expect(questionsBlock?.type).toBe("visual-questions");
    if (questionsBlock?.type !== "visual-questions") return;
    expect(questionsBlock.data.questions[0]?.allowOther).toBe(true);
    expect(questionsBlock.data.questions[0]?.placeholder).toBe(
      "Describe another layout...",
    );
    const preview = questionsBlock.data.questions[0]?.options?.[0]?.wireframe;
    expect(preview).toBeTruthy();
    // Preview must be the lean kit tree (surface + screen), never regions.
    expect(preview?.surface).toBeTruthy();
    expect(Array.isArray(preview?.screen)).toBe(true);
  });

  it("rejects duplicate canvas element IDs", () => {
    const result = planContentSchema.safeParse({
      version: 2,
      title: "Duplicate canvas IDs",
      canvas: {
        sections: [
          { id: "section-1", title: "First" },
          { id: "section-1", title: "Second" },
        ],
        frames: [
          { id: "frame-1", label: "First" },
          { id: "frame-1", label: "Second" },
        ],
        annotations: [
          { id: "annotation-1", text: "First note." },
          { id: "annotation-1", text: "Second note." },
        ],
      },
      blocks: [],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const messages = result.error.issues.map((issue) => issue.message);
    expect(messages).toContain("Duplicate canvas section id: section-1");
    expect(messages).toContain("Duplicate canvas frame id: frame-1");
    expect(messages).toContain("Duplicate canvas annotation id: annotation-1");
  });

  it("rejects duplicate wireframe node IDs", () => {
    const result = planContentSchema.safeParse({
      version: 2,
      title: "Duplicate wireframe node IDs",
      canvas: {
        frames: [
          {
            id: "frame-1",
            label: "Inline wireframe",
            wireframe: {
              surface: "desktop",
              screen: [
                {
                  id: "inline-root",
                  el: "screen",
                  children: [
                    { id: "inline-cta", el: "btn", text: "Save" },
                    { id: "inline-cta", el: "btn", text: "Done" },
                  ],
                },
              ],
            },
          },
        ],
      },
      blocks: [
        {
          id: "wf",
          type: "wireframe",
          data: {
            surface: "desktop",
            screen: [
              { id: "title-1", el: "title", text: "Today" },
              { id: "title-1", el: "title", text: "Tomorrow" },
            ],
          },
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const messages = result.error.issues.map((issue) => issue.message);
    expect(messages).toContain("Duplicate wireframe node id: title-1");
    expect(messages).toContain("Duplicate wireframe node id: inline-cta");
  });
});

function findWireframeNode(
  nodes: PlanWireframeNode[],
  predicate: (node: PlanWireframeNode) => boolean,
): PlanWireframeNode | null {
  for (const node of nodes) {
    if (predicate(node)) return node;
    const childMatch = findWireframeNode(node.children ?? [], predicate);
    if (childMatch) return childMatch;
  }
  return null;
}

describe("diff-aware blocks round-trip", () => {
  it("preserves change/was on data-model + api-endpoint and diff annotations", () => {
    const content = planContentSchema.parse({
      version: 1,
      title: "Diff-aware",
      brief: "Schema, API, and annotated diffs survive a round-trip.",
      blocks: [
        {
          id: "dm",
          type: "data-model",
          data: {
            entities: [
              {
                id: "plans",
                name: "plans",
                change: "modified",
                fields: [
                  { name: "id", type: "uuid", pk: true },
                  { name: "kind", type: "text", change: "added" },
                  {
                    name: "content",
                    type: "jsonb",
                    change: "modified",
                    was: "text",
                  },
                  { name: "legacy_html", type: "text", change: "removed" },
                ],
              },
            ],
          },
        },
        {
          id: "ep",
          type: "api-endpoint",
          data: {
            method: "POST",
            path: "/actions/:name",
            change: "modified",
            params: [
              {
                name: "scope",
                in: "query",
                required: true,
                change: "modified",
                was: "optional",
              },
              { name: "dryRun", in: "query", type: "boolean", change: "added" },
            ],
            responses: [
              { status: "200" },
              { status: "409", description: "Conflict", change: "added" },
            ],
          },
        },
        {
          id: "df",
          type: "diff",
          data: {
            filename: "server/plugins/auth.ts",
            language: "ts",
            before:
              "const token = readBearer(req)\nreturn verifyLegacy(token)\n",
            after:
              "const token = readBearer(req)\nreturn verifyMcp(token, aud)\n",
            mode: "unified",
            annotations: [
              {
                lines: "2",
                label: "MCP verify",
                note: "Routes the bearer path through MCP verify.",
              },
              {
                side: "before",
                lines: "2",
                note: "Drops the legacy verifier.",
              },
            ],
          },
        },
      ],
    } as PlanContent);

    const parsed = parsePlanContent(serializePlanContent(content));
    expect(parsed).not.toBeNull();

    const dm = parsed?.blocks.find((block) => block.id === "dm");
    expect(dm?.type).toBe("data-model");
    if (dm?.type === "data-model") {
      expect(dm.data.entities[0]?.change).toBe("modified");
      const fields = dm.data.entities[0]?.fields ?? [];
      expect(fields.find((field) => field.name === "kind")?.change).toBe(
        "added",
      );
      const contentField = fields.find((field) => field.name === "content");
      expect(contentField?.change).toBe("modified");
      expect(contentField?.was).toBe("text");
      expect(fields.find((field) => field.name === "legacy_html")?.change).toBe(
        "removed",
      );
    }

    const ep = parsed?.blocks.find((block) => block.id === "ep");
    expect(ep?.type).toBe("api-endpoint");
    if (ep?.type === "api-endpoint") {
      expect(ep.data.change).toBe("modified");
      expect(ep.data.params?.find((param) => param.name === "scope")?.was).toBe(
        "optional",
      );
      expect(
        ep.data.params?.find((param) => param.name === "dryRun")?.change,
      ).toBe("added");
      expect(
        ep.data.responses?.find((res) => res.status === "409")?.change,
      ).toBe("added");
    }

    const df = parsed?.blocks.find((block) => block.id === "df");
    expect(df?.type).toBe("diff");
    if (df?.type === "diff") {
      expect(df.data.annotations).toHaveLength(2);
      expect(df.data.annotations?.[0]?.lines).toBe("2");
      expect(df.data.annotations?.[1]?.side).toBe("before");
    }
  });
});

describe("custom-html safety", () => {
  it("serializes, parses, and rejects full custom HTML documents at validation", () => {
    const content = createUiPlanContent({
      title: "Source of truth",
      brief: "Use blocks.",
      states: [],
      components: [],
    });
    const serialized = serializePlanContent(content);

    expect(parsePlanContent(serialized)?.title).toBe("Source of truth");

    const result = planContentSchema.safeParse({
      version: 1,
      blocks: [
        {
          id: "bad-html",
          type: "custom-html",
          data: {
            html: "<html><body><script>alert(1)</script></body></html>",
          },
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("strips dangerous tags, handlers, and urls from stored custom html", () => {
    expect(sanitizeCustomHtml("<div>ok<script>alert(1)</script></div>")).toBe(
      "<div>ok</div>",
    );
    expect(sanitizeCustomHtml('<img src="x" onerror="alert(1)">')).toBe(
      '<img src="x">',
    );
    expect(sanitizeCustomHtml('<a href="javascript:alert(1)">x</a>')).toBe(
      "<a>x</a>",
    );
    expect(
      sanitizeCustomHtml('<iframe srcdoc="<script>x</script>"></iframe>'),
    ).toBe("");
  });

  it("coerces a full HTML document down to a bounded fragment", () => {
    // Wireframe / custom-html / diagram blocks must be bounded fragments; the
    // renderer owns the surrounding document and styling. When an agent authors
    // one as a full standalone page, drop the scaffold (doctype/html/head/body)
    // and keep the body content instead of rejecting the whole block.
    const out = sanitizeCustomHtml(
      '<!doctype html><html><head><title>t</title><style>.x{color:red}</style></head><body><div class="x">hi</div></body></html>',
    );
    expect(out).toContain("hi");
    const lower = out.toLowerCase();
    expect(lower).not.toContain("<html");
    expect(lower).not.toContain("<head");
    expect(lower).not.toContain("<body");
    expect(lower).not.toContain("<style");
    expect(lower).not.toContain("doctype");
  });

  it("sanitizes custom html when normalizing content for storage", () => {
    // A bounded fragment that passes the schema regex but still carries a risky
    // style tag should be cleaned by the action-boundary sanitizer.
    const normalized = serializePlanContent({
      version: 2,
      title: "Sanitized",
      brief: "Defense in depth.",
      blocks: [
        {
          id: "fragment",
          type: "custom-html",
          title: "Fragment",
          data: { html: "<button class='cta'>Open</button>" },
        },
      ],
    } as PlanContent);
    const parsed = parsePlanContent(normalized);
    const block = parsed?.blocks.find((item) => item.id === "fragment");
    expect(block?.type).toBe("custom-html");
  });

  it("exports custom HTML blocks as inert escaped source", () => {
    const content = planContentSchema.parse({
      version: 1,
      title: "Safe export",
      brief: "Custom fragments stay sandbox-only.",
      blocks: [
        {
          id: "fragment",
          type: "custom-html",
          title: "Prototype fragment",
          data: {
            html: '<button class="cta">Open</button>',
            css: ".cta { color: red; }",
          },
        },
      ],
    });

    const html = buildPlanContentHtml({
      content,
      title: "Safe export",
      brief: "Custom fragments stay sandbox-only.",
    });

    expect(html).toContain("sandboxed iframe");
    expect(html).toContain("&lt;button");
    expect(html).not.toContain('<button class="cta">Open</button>');
  });

  it("exports the document with the light default theme tokens", () => {
    const content = createUiPlanContent({
      title: "Light export",
      brief: "Export uses the light palette by default.",
      states: [],
      components: [],
    });
    const html = buildPlanContentHtml({
      content,
      title: "Light export",
      brief: "Export uses the light palette by default.",
    });
    // Light default token (warm paper background), not the hard-dark palette.
    expect(html).toContain("--paper: #ffffff");
    expect(html).toContain("color-scheme: light dark");
  });
});

describe("granular patch ops", () => {
  it("applies targeted content patches without replacing the whole plan", () => {
    const content = createUiPlanContent({
      title: "Patchable plan",
      brief: "Use stable block IDs.",
      states: [{ name: "Default", description: "Original copy." }],
      components: [],
    });
    const richText = content.blocks.find((block) => block.type === "rich-text");
    const firstFrameId = content.canvas?.frames[0]?.id;
    if (content.canvas) {
      content.canvas.annotations = [
        {
          id: "ann-review",
          targetId: firstFrameId,
          title: "Review",
          text: "Original note.",
          x: 120,
          y: 140,
        },
      ];
    }

    expect(richText?.type).toBe("rich-text");
    expect(firstFrameId).toBeTruthy();
    if (richText?.type !== "rich-text" || !firstFrameId) return;

    const patched = applyPlanContentPatches(content, [
      {
        op: "update-rich-text",
        blockId: richText.id,
        markdown: "Updated copy only.",
      },
      {
        op: "update-canvas-frame",
        frameId: firstFrameId,
        patch: { label: "Updated frame" },
      },
      {
        op: "update-canvas-annotation",
        annotationId: "ann-review",
        patch: { text: "Updated annotation only.", y: 220 },
      },
      {
        op: "append-canvas-annotation",
        annotation: {
          id: "ann-callout",
          type: "callout",
          text: "Point this at the primary action.",
          x: 180,
          y: 260,
          points: [
            { x: 180, y: 260 },
            { x: 420, y: 310 },
          ],
          style: { tone: "accent", stroke: "dashed", width: 2 },
        },
      },
      {
        op: "append-block",
        afterBlockId: richText.id,
        block: {
          id: "new-note",
          type: "callout",
          title: "Patch note",
          data: { body: "Added without rewriting the full document." },
        },
      },
    ]);

    const nextRichText = patched.blocks.find(
      (block) => block.id === richText.id,
    );
    expect(nextRichText?.type).toBe("rich-text");
    if (nextRichText?.type === "rich-text") {
      expect(nextRichText.data.markdown).toBe("Updated copy only.");
    }
    expect(patched.canvas?.frames[0]?.label).toBe("Updated frame");
    expect(patched.canvas?.annotations?.[0]?.text).toBe(
      "Updated annotation only.",
    );
    expect(patched.canvas?.annotations?.[0]?.y).toBe(220);
    expect(patched.canvas?.annotations?.[1]?.type).toBe("callout");
    expect(patched.canvas?.annotations?.[1]?.points?.[1]?.x).toBe(420);
    expect(patched.blocks.some((block) => block.id === "new-note")).toBe(true);
  });

  it("drops any legacy doc on update-rich-text so markdown is the only source of truth", () => {
    const content: PlanContent = {
      version: 2,
      title: "Doc drop",
      brief: "Markdown only.",
      blocks: [
        {
          id: "rt",
          type: "rich-text",
          // Simulate a legacy block that carried a stale Tiptap/ProseMirror doc.
          data: {
            markdown: "Old copy.",
            doc: { type: "doc", content: [{ type: "paragraph" }] },
          } as unknown as { markdown: string },
        },
      ],
    };

    const patched = applyPlanContentPatches(content, [
      {
        op: "update-rich-text",
        blockId: "rt",
        markdown: "New copy.",
      },
    ]);

    const nextRichText = patched.blocks.find((block) => block.id === "rt");
    expect(nextRichText?.type).toBe("rich-text");
    if (nextRichText?.type !== "rich-text") return;
    expect(nextRichText.data.markdown).toBe("New copy.");
    expect(Object.keys(nextRichText.data)).toEqual(["markdown"]);
    expect("doc" in nextRichText.data).toBe(false);
    expect((nextRichText.data as Record<string, unknown>).doc).toBeUndefined();
  });

  it("patches and replaces a kit-tree wireframe node by id", () => {
    const content: PlanContent = planContentSchema.parse({
      version: 2,
      title: "Kit tree",
      brief: "Patch one node.",
      blocks: [
        {
          id: "wf",
          type: "wireframe",
          title: "Today",
          data: {
            surface: "desktop",
            screen: [
              { id: "title-1", el: "title", text: "Today" },
              {
                id: "row-1",
                el: "row",
                children: [{ id: "btn-1", el: "btn", text: "Add" }],
              },
            ],
          },
        },
      ],
    });

    const patched = applyPlanContentPatches(content, [
      {
        op: "update-wireframe-node",
        blockId: "wf",
        nodeId: "btn-1",
        patch: { text: "Create", tone: "accent" },
      },
    ]);
    const wf = patched.blocks.find((block) => block.id === "wf");
    expect(wf?.type).toBe("wireframe");
    if (wf?.type !== "wireframe") return;
    const row = wf.data.screen.find((node) => node.id === "row-1");
    expect(row?.children?.[0]?.text).toBe("Create");
    expect(row?.children?.[0]?.tone).toBe("accent");

    const replaced = applyPlanContentPatches(content, [
      {
        op: "replace-wireframe-screen",
        blockId: "wf",
        screen: [{ el: "title", text: "Replaced" }],
      },
    ]);
    const replacedWf = replaced.blocks.find((block) => block.id === "wf");
    if (replacedWf?.type !== "wireframe") return;
    expect(replacedWf.data.screen).toHaveLength(1);
    // ensureNodeIds assigns ids on replace.
    expect(replacedWf.data.screen[0]?.id).toBeTruthy();
  });

  it("preserves linked canvas wireframes inline when replace-block changes a wireframe to prose", () => {
    // Design decision (PR #1081, commit 510f15d46): when a wireframe block is
    // replaced with a non-wireframe block (or removed), the canvas frame that
    // referenced it via blockId gets an inline snapshot copy of the wireframe
    // so the artboard stays visible on the canvas. This mirrors remove-block
    // behaviour and prevents the canvas from going blank after a document edit.
    // The frame's blockId is cleared (it is no longer a live reference); the
    // inline wireframe copy becomes the artboard's permanent visual content.
    const content: PlanContent = planContentSchema.parse({
      version: 2,
      title: "Linked",
      brief: "Canvas references a block.",
      canvas: {
        title: "Board",
        frames: [{ id: "frame-1", label: "Screen", blockId: "wf" }],
      },
      blocks: [
        {
          id: "wf",
          type: "wireframe",
          title: "Screen",
          data: { surface: "desktop", screen: [{ el: "title", text: "Hi" }] },
        },
      ],
    });

    const replaced = applyPlanContentPatches(content, [
      {
        op: "replace-block",
        blockId: "wf",
        block: {
          id: "wf",
          type: "rich-text",
          title: "Notes",
          data: { markdown: "No longer visual." },
        },
      },
    ]);
    // The frame retains its inline wireframe snapshot so the canvas artboard
    // remains visible; it no longer carries a live blockId reference.
    expect(replaced.canvas?.frames[0]?.wireframe?.surface).toBe("desktop");
    expect(replaced.canvas?.frames[0]?.blockId).toBeUndefined();
    expect(replaced.canvas?.frames[0]?.legacyWireframe).toBeUndefined();
  });
});

describe("back-compat parsing and migration", () => {
  it("migrates old sketch-wireframe blocks to the legacy-wireframe fallback", () => {
    const legacy = {
      version: 1,
      title: "Old plan",
      brief: "Region wireframes from before the kit-tree refactor.",
      blocks: [
        {
          id: "old-wire",
          type: "sketch-wireframe",
          title: "Old screen",
          data: {
            viewport: "desktop",
            regions: [
              { id: "r1", kind: "header", x: 5, y: 5, width: 90, height: 8 },
            ],
          },
        },
        {
          id: "old-diagram",
          type: "sketch-diagram",
          title: "Old flow",
          data: { nodes: [{ id: "n1", label: "Start" }], edges: [] },
        },
      ],
    };
    const parsed = parsePlanContent(JSON.stringify(legacy));
    expect(parsed).not.toBeNull();
    const wire = parsed?.blocks.find((block) => block.id === "old-wire");
    const diagram = parsed?.blocks.find((block) => block.id === "old-diagram");
    expect(wire?.type).toBe("legacy-wireframe");
    expect(diagram?.type).toBe("diagram");
    if (wire?.type === "legacy-wireframe") {
      expect(wire.data.regions).toHaveLength(1);
    }
  });

  it("migrates a retired decision block into a decision-tone callout", () => {
    const legacy = {
      version: 2,
      title: "Old plan",
      brief: "Has a decision block from before it was retired.",
      blocks: [
        {
          id: "dec-1",
          type: "decision",
          data: {
            question: "Which approach?",
            options: [
              {
                id: "o1",
                label: "Ship shared blocks",
                detail: "One source of truth.",
                recommended: true,
              },
              { id: "o2", label: "Keep copies", detail: "More drift." },
            ],
          },
        },
      ],
    };
    // Stored decision blocks must keep loading (the schema no longer has a
    // `decision` member) by migrating to a callout, not failing the whole plan.
    const parsed = parsePlanContent(JSON.stringify(legacy));
    expect(parsed).not.toBeNull();
    const block = parsed?.blocks.find((b) => b.id === "dec-1");
    expect(block?.type).toBe("callout");
    if (block?.type === "callout") {
      expect(block.data.tone).toBe("decision");
      expect(block.data.body).toContain("Which approach?");
      expect(block.data.body).toContain("Ship shared blocks");
      expect(block.data.body).toContain("recommended");
      expect(block.data.body).toContain("Keep copies");
    }
  });

  it("accepts a v1 content version without erasing the body", () => {
    const parsed = parsePlanContent(
      JSON.stringify({
        version: 1,
        title: "V1",
        brief: "Old version number, current shape.",
        blocks: [
          { id: "b1", type: "rich-text", data: { markdown: "Body kept." } },
        ],
      }),
    );
    expect(parsed?.blocks).toHaveLength(1);
  });

  it("returns null for non-content values (html-only / sections-only fallback)", () => {
    // An html-only or sections-only plan has no `content` column; parse must
    // return null so callers fall back to legacy html / section rendering.
    expect(parsePlanContent(null)).toBeNull();
    expect(parsePlanContent("")).toBeNull();
    expect(parsePlanContent("<!doctype html><html></html>")).toBeNull();
    expect(parsePlanContent("{not json")).toBeNull();
  });
});

describe("prototype plan content", () => {
  it("creates design-mode fallback content when no /plan-design screens are provided", () => {
    const content = createPlanDesignContent({
      title: "Billing redesign",
      brief: "Create a polished billing settings direction.",
      screens: [],
    });

    expect(content.canvas?.mode).toBe("design");
    expect(content.canvas?.frames[0]?.wireframe?.renderMode).toBe("design");
    expect(content.canvas?.frames[0]?.wireframe?.html).toContain(
      'data-design-id="primary-action"',
    );
    expect(content.prototype?.screens[0]?.renderMode).toBe("design");
    expect(content.prototype?.screens[0]?.css).toContain(".pd-shell");
  });

  it("normalizes supplied /plan-design content into design canvas and prototype surfaces", () => {
    const content = normalizePlanDesignContent(
      {
        version: 2,
        prototype: {
          initialScreenId: "settings",
          screens: [
            {
              id: "settings",
              html: '<main><button data-design-id="save">Save</button></main>',
            },
          ],
        },
        blocks: [
          { id: "notes", type: "rich-text", data: { markdown: "Keep" } },
        ],
      },
      {
        title: "Settings redesign",
        brief: "Make settings feel finished.",
        screens: [],
        designMd: "Use the product brand.",
        brandKit: { colors: { primary: "#0f766e" } },
        codebaseStyles: { vars: ["--radius"] },
      },
    );

    expect(content?.canvas?.mode).toBe("design");
    expect(content?.canvas?.design?.designMd).toContain("product brand");
    expect(content?.canvas?.design?.brandKit).toEqual({
      colors: { primary: "#0f766e" },
    });
    expect(content?.canvas?.frames[0]?.wireframe?.renderMode).toBe("design");
    expect(content?.prototype?.screens[0]?.renderMode).toBe("design");
    expect(content?.blocks[0]?.id).toBe("notes");
  });

  it("bounds /plan-design metadata records", () => {
    const result = planContentSchema.safeParse({
      version: 2,
      canvas: {
        mode: "design",
        design: {
          brandKit: { huge: "x".repeat(25_000) },
        },
        frames: [],
      },
      blocks: [],
    });

    expect(result.success).toBe(false);
  });

  it("accepts safe Alpine-like prototype directives but still rejects event handlers", () => {
    const result = planContentSchema.safeParse({
      version: 2,
      prototype: {
        initialScreenId: "todo",
        screens: [
          {
            id: "todo",
            title: "Todo prototype",
            html: `<div x-data="{ draft: '', todos: [] }"><input x-model="draft" @keydown.enter="todos.push({ text: draft })"><button x-on:click="draft = ''" :class="{ primary: draft }" x-show="draft">Add</button></div>`,
          },
        ],
      },
      blocks: [],
    });

    expect(result.success).toBe(true);

    const unsafe = planContentSchema.safeParse({
      version: 2,
      prototype: {
        initialScreenId: "bad",
        screens: [
          {
            id: "bad",
            html: `<button onclick="alert(1)">Bad</button>`,
          },
        ],
      },
      blocks: [],
    });

    expect(unsafe.success).toBe(false);
  });

  it("creates prototype-first content with static mocks and export preview", () => {
    const content = createPrototypePlanContent({
      title: "Review prototype",
      brief: "Does the review flow feel right?",
      screens: [
        {
          id: "start",
          title: "Start",
          summary: "Reviewer sees the request.",
          surface: "browser",
          html: '<div><h1>Request</h1><button data-goto="approved">Approve</button></div>',
          state: [{ label: "Mode", value: "Review" }],
        },
        {
          id: "approved",
          title: "Approved",
          summary: "Approved confirmation.",
          surface: "browser",
          html: "<div><h1>Approved</h1></div>",
        },
      ],
      transitions: [
        {
          from: "start",
          to: "approved",
          label: "Approve",
          trigger: "Click Approve",
        },
      ],
    });

    expect(content.prototype?.initialScreenId).toBe("start");
    expect(content.prototype?.screens).toHaveLength(2);
    expect(content.canvas?.title).toContain("Static Mocks");
    expect(
      content.blocks.some(
        (block) => block.type === "tabs" && block.title === "Static Mocks",
      ),
    ).toBe(true);

    const html = buildPlanContentHtml({
      content,
      title: "Review prototype",
      brief: "Does the review flow feel right?",
    });
    expect(html).toContain("prototype-export");
    expect(html).toContain("Approve");
  });

  it("patches prototype screens without regenerating the plan", () => {
    const content = planContentSchema.parse({
      version: 2,
      prototype: {
        initialScreenId: "start",
        screens: [
          {
            id: "start",
            title: "Start",
            html: "<div><h1>Start</h1><button>Next</button></div>",
          },
        ],
      },
      blocks: [],
    });

    const patched = applyPlanContentPatches(content, [
      {
        op: "patch-prototype-html",
        screenId: "start",
        edits: [{ find: ">Next<", replace: ">Continue<" }],
      },
      {
        op: "update-prototype-screen",
        screenId: "start",
        patch: {
          summary: "Updated interaction copy.",
          state: [{ label: "Copy", value: "Updated" }],
        },
      },
    ]);

    expect(patched.prototype?.screens[0]?.html).toContain(">Continue<");
    expect(patched.prototype?.screens[0]?.summary).toBe(
      "Updated interaction copy.",
    );
    expect(patched.prototype?.screens[0]?.state?.[0]?.value).toBe("Updated");
  });

  it("derives a prototype from HTML canvas frames", () => {
    const content = planContentSchema.parse({
      version: 2,
      title: "Canvas source",
      brief: "Convert this visual plan.",
      canvas: {
        title: "Flow",
        frames: [
          {
            id: "frame-start",
            label: "Start",
            surface: "browser",
            wireframe: {
              surface: "browser",
              html: "<div><h1>Start</h1></div>",
              caption: "Start state",
            },
          },
          {
            id: "frame-next",
            label: "Next",
            surface: "browser",
            wireframe: {
              surface: "browser",
              html: "<div><h1>Next</h1></div>",
            },
          },
        ],
        flow: [{ from: "frame-start", to: "frame-next", label: "Continue" }],
      },
      blocks: [],
    });

    const prototype = createPrototypeFromPlanContent(content);
    expect(prototype?.screens.map((screen) => screen.id)).toEqual([
      "frame-start",
      "frame-next",
    ]);
    expect(prototype?.transitions?.[0]).toMatchObject({
      from: "frame-start",
      to: "frame-next",
      label: "Continue",
    });
  });

  it("rejects prototype transitions that reference missing screens", () => {
    expect(() =>
      planContentSchema.parse({
        version: 2,
        prototype: {
          screens: [{ id: "start", html: "<div>Start</div>" }],
          transitions: [{ from: "start", to: "missing" }],
        },
        blocks: [],
      }),
    ).toThrow(/Transition target missing/);
  });
});

describe("patch-wireframe-html (granular html mockup edits)", () => {
  const htmlContent = (html: string): PlanContent =>
    planContentSchema.parse({
      version: 2,
      brief: "html wireframe",
      blocks: [
        { id: "wf1", type: "wireframe", data: { surface: "browser", html } },
      ],
    });
  const htmlOf = (content: PlanContent): string => {
    const block = content.blocks[0];
    if (block?.type !== "wireframe" || typeof block.data.html !== "string") {
      throw new Error("expected an html wireframe block");
    }
    return block.data.html;
  };

  it("applies a unique find/replace without regenerating the frame", () => {
    const next = applyPlanContentPatches(
      htmlContent('<button class="primary">Sign in</button><span>keep</span>'),
      [
        {
          op: "patch-wireframe-html",
          blockId: "wf1",
          edits: [{ find: ">Sign in<", replace: ">Continue<" }],
        },
      ],
    );
    expect(htmlOf(next)).toBe(
      '<button class="primary">Continue</button><span>keep</span>',
    );
  });

  it("throws when the find snippet is missing", () => {
    expect(() =>
      applyPlanContentPatches(htmlContent("<button>Sign in</button>"), [
        {
          op: "patch-wireframe-html",
          blockId: "wf1",
          edits: [{ find: "Log out", replace: "Continue" }],
        },
      ]),
    ).toThrow(/not present/i);
  });

  it("requires all:true when a find matches more than once", () => {
    const content = htmlContent("<i></i><i></i>");
    expect(() =>
      applyPlanContentPatches(content, [
        {
          op: "patch-wireframe-html",
          blockId: "wf1",
          edits: [{ find: "<i></i>", replace: "<b></b>" }],
        },
      ]),
    ).toThrow(/matched 2 times/i);
    const next = applyPlanContentPatches(content, [
      {
        op: "patch-wireframe-html",
        blockId: "wf1",
        edits: [{ find: "<i></i>", replace: "<b></b>", all: true }],
      },
    ]);
    expect(htmlOf(next)).toBe("<b></b><b></b>");
  });

  it("rejects a replacement that smuggles a script tag", () => {
    expect(() =>
      applyPlanContentPatches(htmlContent("<div>x</div>"), [
        {
          op: "patch-wireframe-html",
          blockId: "wf1",
          edits: [{ find: "x", replace: "<script>alert(1)</script>" }],
        },
      ]),
    ).toThrow();
  });
});

describe("patch-diagram-html (granular diagram edits)", () => {
  const diagramContent = (html: string): PlanContent =>
    planContentSchema.parse({
      version: 2,
      brief: "diagram",
      blocks: [{ id: "diagram1", type: "diagram", data: { html } }],
    });
  const htmlOf = (content: PlanContent): string => {
    const block = content.blocks[0];
    if (block?.type !== "diagram" || typeof block.data.html !== "string") {
      throw new Error("expected an html diagram block");
    }
    return block.data.html;
  };

  it("applies a unique find/replace without regenerating the diagram", () => {
    const next = applyPlanContentPatches(
      diagramContent(
        '<div class="diagram-panel"><span>Current label</span><svg></svg></div>',
      ),
      [
        {
          op: "patch-diagram-html",
          blockId: "diagram1",
          edits: [{ find: "Current label", replace: "Target label" }],
        },
      ],
    );
    expect(htmlOf(next)).toContain("Target label");
    expect(htmlOf(next)).toContain("<svg>");
  });

  it("throws when the find snippet is missing", () => {
    expect(() =>
      applyPlanContentPatches(diagramContent("<div>Label</div>"), [
        {
          op: "patch-diagram-html",
          blockId: "diagram1",
          edits: [{ find: "Missing", replace: "Updated" }],
        },
      ]),
    ).toThrow(/not present/i);
  });

  it("rejects a replacement that smuggles active diagram html", () => {
    expect(() =>
      applyPlanContentPatches(diagramContent("<div>Label</div>"), [
        {
          op: "patch-diagram-html",
          blockId: "diagram1",
          edits: [{ find: "Label", replace: '<svg onload="alert(1)" />' }],
        },
      ]),
    ).toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Per-block salvage                                                          */
/* -------------------------------------------------------------------------- */

describe("parsePlanContent per-block salvage", () => {
  const ZWSP = "​";
  const UNKNOWN_MARKER = `${ZWSP}__unknown_block__:`;

  it("returns a full document when all blocks are valid", () => {
    const result = parsePlanContent({
      version: 2,
      title: "Test",
      blocks: [
        { id: "b1", type: "rich-text", data: { markdown: "# Hello" } },
        { id: "b2", type: "callout", data: { body: "Info" } },
      ],
    });
    expect(result).not.toBeNull();
    expect(result?.blocks).toHaveLength(2);
    expect(result?.blocks[0]?.type).toBe("rich-text");
  });

  it("salvages good blocks and replaces the bad block with a callout placeholder", () => {
    const result = parsePlanContent({
      version: 2,
      title: "Mixed",
      blocks: [
        { id: "good1", type: "rich-text", data: { markdown: "Intro" } },
        // This block has an invalid structure (mermaid requires `data.code`).
        { id: "bad1", type: "mermaid", data: { notCode: "graph TD; A-->B" } },
        { id: "good2", type: "callout", data: { body: "Conclusion" } },
      ],
    });
    expect(result).not.toBeNull();
    expect(result?.blocks).toHaveLength(3);
    // Good blocks survive unchanged.
    expect(result?.blocks[0]?.type).toBe("rich-text");
    expect(result?.blocks[2]?.type).toBe("callout");
    // Bad block becomes a callout placeholder with the unknown-block marker.
    const placeholder = result?.blocks[1];
    expect(placeholder?.type).toBe("callout");
    expect(placeholder?.id).toBe("bad1");
    if (placeholder?.type !== "callout") throw new Error("expected callout");
    expect(placeholder.data.body).toContain(UNKNOWN_MARKER);
    expect(placeholder.data.body).toContain("mermaid");
  });

  it("preserves the block id and title in the placeholder", () => {
    const result = parsePlanContent({
      version: 2,
      blocks: [
        {
          id: "titled-bad",
          type: "mermaid",
          title: "My diagram",
          data: { wrong: true },
        },
      ],
    });
    expect(result).not.toBeNull();
    const block = result?.blocks[0];
    expect(block?.id).toBe("titled-bad");
    expect(block?.title).toBe("My diagram");
    if (block?.type !== "callout") throw new Error("expected callout");
    expect(block.data.body).toContain(UNKNOWN_MARKER);
    expect(block.data.body).toContain("mermaid");
  });

  it("returns null for a document whose entire block tree exceeds the depth budget", () => {
    // nestTabs(2000) exceeds exceedsPlanBlockDepth; salvage must bail, not return
    // a single placeholder for the whole document.
    function nestTabs(depth: number): unknown {
      let block: unknown = {
        id: "leaf",
        type: "rich-text",
        data: { markdown: "leaf" },
      };
      for (let i = 0; i < depth; i++) {
        block = {
          id: `t${i}`,
          type: "tabs",
          data: { tabs: [{ id: `tab${i}`, label: "Tab", blocks: [block] }] },
        };
      }
      return block;
    }
    const result = parsePlanContent({ version: 2, blocks: [nestTabs(2000)] });
    expect(result).toBeNull();
  });

  it("returns null when blocks is not an array", () => {
    const result = parsePlanContent({ version: 2, blocks: "nope" });
    expect(result).toBeNull();
  });

  it("caps salvaged blocks at 200", () => {
    const blocks = Array.from({ length: 250 }, (_, i) => ({
      id: `b${i}`,
      // Force a full-document parse failure by having one truly invalid block,
      // then fill the rest with valid ones (to confirm salvage trims to 200).
      type: i === 0 ? "mermaid" : "rich-text",
      data: i === 0 ? { wrong: true } : { markdown: "x" },
    }));
    const result = parsePlanContent({ version: 2, blocks });
    expect(result).not.toBeNull();
    // 250 → capped at 200 during salvage.
    expect(result!.blocks.length).toBeLessThanOrEqual(200);
  });
});
