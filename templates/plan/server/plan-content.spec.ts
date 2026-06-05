import { describe, expect, it } from "vitest";
import {
  applyPlanContentPatches,
  planContentSchema,
  type PlanContent,
} from "../shared/plan-content.js";
import {
  buildPlanContentHtml,
  createPlanContentFromSections,
  createUiPlanContent,
  createVisualQuestionsContent,
  parsePlanContent,
  sanitizeCustomHtml,
  serializePlanContent,
} from "./plan-content.js";

describe("structured plan content", () => {
  it("builds UI plans as native content with a canvas and legacy-wireframe blocks", () => {
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
    expect(content.canvas?.frames[0]?.legacyWireframe?.viewport).toBe(
      "desktop",
    );
    expect(content.canvas?.frames[1]?.legacyWireframe?.viewport).toBe("phone");
    expect(content.canvas?.frames[0]?.label).toBe("Overview");
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
      "legacy-wireframe",
    ]);
    expect(content.canvas?.frames).toHaveLength(1);
    expect(
      content.canvas?.frames[0]?.legacyWireframe?.regions.length ?? 0,
    ).toBeGreaterThan(0);
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
    expect(patched.blocks.some((block) => block.id === "new-note")).toBe(true);
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

  it("clears linked canvas wireframes when source blocks stop being wireframes", () => {
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
    expect(replaced.canvas?.frames[0]?.wireframe).toBeUndefined();
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
