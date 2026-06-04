import { describe, expect, it } from "vitest";
import {
  applyPlanContentPatches,
  planContentSchema,
} from "../shared/plan-content.js";
import {
  buildPlanContentHtml,
  createPlanContentFromSections,
  createUiPlanContent,
  createVisualQuestionsContent,
  parsePlanContent,
  serializePlanContent,
} from "./plan-content.js";

describe("structured plan content", () => {
  it("builds UI plans as native content with a canvas and rich blocks", () => {
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
    expect(content.canvas?.frames[0]).not.toHaveProperty("x");
    expect(content.canvas?.frames[0]?.wireframe?.viewport).toBe("desktop");
    expect(content.canvas?.frames[1]?.wireframe?.viewport).toBe("phone");
    expect(content.blocks.some((block) => block.type === "tabs")).toBe(true);
    expect(
      content.blocks.some((block) => block.type === "implementation-map"),
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
      "sketch-wireframe",
    ]);
    expect(content.canvas?.frames).toHaveLength(1);
  });

  it("creates visual questions with sketch previews instead of standalone HTML", () => {
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
    expect(
      questionsBlock.data.questions[0]?.options?.[0]?.wireframe,
    ).toBeTruthy();
  });

  it("serializes, parses, and rejects full custom HTML documents", () => {
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

  it("rejects custom HTML event handlers and dangerous URL attributes", () => {
    const eventHandlerResult = planContentSchema.safeParse({
      version: 1,
      blocks: [
        {
          id: "bad-handler",
          type: "custom-html",
          data: {
            html: '<img src="x" onerror="alert(1)">',
          },
        },
      ],
    });

    const srcDocResult = planContentSchema.safeParse({
      version: 1,
      blocks: [
        {
          id: "bad-srcdoc",
          type: "custom-html",
          data: {
            html: '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
          },
        },
      ],
    });

    expect(eventHandlerResult.success).toBe(false);
    expect(srcDocResult.success).toBe(false);
  });

  it("exports custom HTML blocks as inert source", () => {
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

  it("deduplicates generated state, tab, and frame IDs", () => {
    const content = createUiPlanContent({
      title: "Checkout flow",
      brief: "Compare repeated loading states.",
      states: [
        { name: "Loading", description: "Initial loading." },
        { name: "Loading", description: "Payment loading." },
      ],
      components: [],
    });
    const stateTabs = content.blocks.find(
      (block) => block.type === "tabs" && block.title === "Screen States",
    );

    expect(content.canvas?.frames.map((frame) => frame.id)).toEqual([
      "frame-loading",
      "frame-loading-2",
    ]);
    expect(stateTabs?.type).toBe("tabs");
    if (stateTabs?.type === "tabs") {
      expect(stateTabs.data.tabs.map((tab) => tab.id)).toEqual([
        "loading",
        "loading-2",
      ]);
    }
  });

  it("uses product-specific compact regions for Context X-Ray component plans", () => {
    const content = createUiPlanContent({
      title: "Context X-Ray component cleanup",
      brief:
        "Plan a compact Context X-Ray popover in the agent sidebar, not a desktop/mobile app flow.",
      states: [
        {
          name: "Default popover",
          description:
            "Context X-Ray popover with token meter, list/map toggle, conversation group, and row actions.",
        },
        {
          name: "Expanded segment",
          description:
            "Segment detail with user/tool rows and pin/evict controls.",
        },
        {
          name: "Map view",
          description:
            "Treemap mode with token distribution, legend, and selected summary.",
        },
        {
          name: "Chat cleanup",
          description:
            "Chat messages and composer after removing visible step chrome.",
        },
      ],
      components: [
        {
          name: "Token meter",
          description:
            "Small usage readout with compact meter, pinned count, and evicted count.",
        },
      ],
    });

    expect(content.canvas?.title).toBe("Component States");
    expect(content.canvas?.flow).toBeUndefined();
    expect(content.canvas?.frames[0]?.width).toBe(360);
    expect(
      content.canvas?.frames[0]?.wireframe?.regions.map(
        (region) => region.label,
      ),
    ).toContain("Context X-Ray");
    expect(
      content.canvas?.frames[0]?.wireframe?.regions.map(
        (region) => region.label,
      ),
    ).toContain("2.0k used");
    expect(
      content.canvas?.frames[2]?.wireframe?.regions.map(
        (region) => region.label,
      ),
    ).toContain("Token map");
    expect(
      content.canvas?.frames[3]?.wireframe?.regions.map(
        (region) => region.label,
      ),
    ).toContain("Composer");
    expect(
      content.canvas?.frames[3]?.wireframe?.regions.map(
        (region) => region.label,
      ),
    ).not.toContain("Step");

    const componentTabs = content.blocks.find(
      (block) => block.type === "tabs" && block.title === "Interaction Notes",
    );
    expect(componentTabs?.type).toBe("tabs");
    if (componentTabs?.type === "tabs") {
      expect(
        componentTabs.data.tabs[0]?.blocks.some(
          (block) => block.type === "sketch-wireframe",
        ),
      ).toBe(true);
    }
  });

  it("applies targeted content patches without replacing the whole plan", () => {
    const content = createUiPlanContent({
      title: "Patchable plan",
      brief: "Use stable block IDs.",
      states: [{ name: "Default", description: "Original copy." }],
      components: [],
    });
    const richText = content.blocks.find((block) => block.type === "rich-text");
    const wireframe = content.blocks
      .flatMap((block) =>
        block.type === "tabs"
          ? block.data.tabs.flatMap((tab) => tab.blocks)
          : [],
      )
      .find((block) => block.type === "sketch-wireframe");
    const firstFrameId = content.canvas?.frames[0]?.id;

    expect(richText?.type).toBe("rich-text");
    expect(wireframe?.type).toBe("sketch-wireframe");
    expect(firstFrameId).toBeTruthy();
    if (
      richText?.type !== "rich-text" ||
      wireframe?.type !== "sketch-wireframe" ||
      !firstFrameId
    ) {
      return;
    }

    const patched = applyPlanContentPatches(content, [
      {
        op: "update-rich-text",
        blockId: richText.id,
        markdown: "Updated copy only.",
      },
      {
        op: "update-wireframe-region",
        blockId: wireframe.id,
        regionId: wireframe.data.regions[0]?.id ?? "missing",
        patch: { width: 88, label: "Updated" },
      },
      {
        op: "update-canvas-frame",
        frameId: firstFrameId,
        patch: { title: "Updated frame" },
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
    const nextWireframe = patched.blocks
      .flatMap((block) =>
        block.type === "tabs"
          ? block.data.tabs.flatMap((tab) => tab.blocks)
          : [],
      )
      .find((block) => block.id === wireframe.id);

    expect(nextRichText?.type).toBe("rich-text");
    if (nextRichText?.type === "rich-text") {
      expect(nextRichText.data.markdown).toBe("Updated copy only.");
    }
    expect(nextWireframe?.type).toBe("sketch-wireframe");
    if (nextWireframe?.type === "sketch-wireframe") {
      expect(nextWireframe.data.regions[0]?.label).toBe("Updated");
      expect(nextWireframe.data.regions[0]?.width).toBe(88);
    }
    expect(patched.canvas?.frames[0]?.title).toBe("Updated frame");
    expect(patched.canvas?.frames[0]?.wireframe?.regions[0]?.label).toBe(
      "Updated",
    );
    expect(patched.canvas?.frames[0]?.wireframe?.regions[0]?.width).toBe(88);
    expect(patched.blocks.some((block) => block.id === "new-note")).toBe(true);
  });
});
