import { describe, expect, it } from "vitest";
import { planContentSchema, type PlanContent } from "../shared/plan-content.js";
import {
  applyPlanMdxSourcePatches,
  exportPlanContentToMdxFolder,
  parsePlanMdxFolder,
} from "./plan-mdx.js";

function sampleContent(): PlanContent {
  return planContentSchema.parse({
    version: 2,
    title: "Checkout review flow",
    brief: "Review checkout states before implementation.",
    canvas: {
      title: "Checkout board",
      sections: [
        {
          id: "primary-flow",
          title: "Primary flow",
          artboardIds: ["overview-artboard", "confirm-artboard"],
        },
      ],
      frames: [
        {
          id: "overview-artboard",
          label: "Overview",
          surface: "desktop",
          x: 120,
          y: 80,
          width: 760,
          height: 480,
          wireframe: {
            surface: "desktop",
            caption: "Overview state",
            screen: [
              {
                id: "overview-screen",
                el: "screen",
                children: [
                  {
                    id: "overview-shell",
                    el: "row",
                    children: [
                      {
                        id: "overview-sidebar",
                        el: "sidebar",
                        children: [
                          {
                            id: "nav-checkout",
                            el: "navItem",
                            text: "Checkout",
                            active: true,
                          },
                        ],
                      },
                      {
                        id: "overview-main",
                        el: "main",
                        children: [
                          {
                            id: "overview-title",
                            el: "title",
                            text: "Checkout",
                          },
                          {
                            id: "checkout-row",
                            el: "taskRow",
                            text: "Confirm shipping address",
                            due: "Soon",
                            dueTone: "warn",
                          },
                          {
                            id: "cta-save",
                            el: "btn",
                            text: "Continue",
                            tone: "accent",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
        {
          id: "confirm-artboard",
          label: "Confirm",
          surface: "popover",
          x: 980,
          y: 120,
          width: 360,
          height: 320,
          wireframe: {
            surface: "popover",
            caption: "Confirmation popover",
            screen: [
              {
                id: "confirm-screen",
                el: "screen",
                children: [
                  { id: "confirm-title", el: "title", text: "Ready?" },
                  { id: "confirm-copy", el: "text", text: "Review changes." },
                ],
              },
            ],
          },
        },
      ],
      flow: [
        { from: "overview-artboard", to: "confirm-artboard", label: "Step 1" },
      ],
      annotations: [
        {
          id: "overview-note",
          title: "Design note",
          text: "Keep the main action visible.",
          targetId: "overview-artboard",
          placement: "bottom",
          x: 140,
          y: 620,
        },
      ],
    },
    blocks: [
      {
        id: "summary",
        type: "rich-text",
        title: "What matters",
        editable: true,
        data: {
          markdown:
            "Use this plan as the review source before touching checkout code.",
        },
      },
      {
        id: "implementation",
        type: "implementation-map",
        title: "Implementation map",
        data: {
          files: [
            {
              path: "templates/checkout/app/routes/checkout.tsx",
              title: "Checkout route",
              note: "Update review state and continue action.",
              language: "tsx",
            },
          ],
        },
      },
    ],
  });
}

describe("plan MDX source adapter", () => {
  it("exports plan.mdx and canvas.mdx with the semantic board vocabulary", async () => {
    const folder = await exportPlanContentToMdxFolder({
      content: sampleContent(),
      title: "Checkout review flow",
      planId: "plan_test",
      url: "/plans/plan_test",
    });

    expect(folder["plan.mdx"]).toContain('title: "Checkout review flow"');
    expect(folder["plan.mdx"]).toContain("<RichText");
    expect(folder["plan.mdx"]).toContain("<ImplementationMap");
    expect(folder["canvas.mdx"]).toContain("<DesignBoard");
    expect(folder["canvas.mdx"]).toContain("<Artboard");
    expect(folder["canvas.mdx"]).toContain("<FrameScreen");
    expect(folder["canvas.mdx"]).toContain("<Annotation");
    expect(folder["canvas.mdx"]).toContain("<Connector");
    expect(folder[".plan-state.json"]).toContain('"canvas"');
  });

  it("round-trips MDX back to normalized JSON without losing wireframes", async () => {
    const source = sampleContent();
    const folder = await exportPlanContentToMdxFolder({
      content: source,
      title: source.title ?? "Plan",
    });

    const parsed = await parsePlanMdxFolder(folder);

    expect(parsed.title).toBe(source.title);
    expect(parsed.blocks.map((block) => block.id)).toContain("summary");
    expect(parsed.canvas?.frames).toHaveLength(2);
    expect(parsed.canvas?.frames[0]?.wireframe?.screen[0]?.id).toBe(
      "overview-screen",
    );
    expect(
      parsed.canvas?.frames[0]?.wireframe?.screen[0]?.children?.[0]
        ?.children?.[1]?.children?.[2]?.text,
    ).toBe("Continue");
  });

  it("applies small source patches by stable semantic ids", async () => {
    const folder = await exportPlanContentToMdxFolder({
      content: sampleContent(),
      title: "Checkout review flow",
    });

    const patched = await applyPlanMdxSourcePatches(folder, [
      {
        op: "replace-markdown-block",
        blockId: "summary",
        markdown: "## Updated\n\nOnly this text changed.",
      },
      {
        op: "update-wireframe-node",
        nodeId: "cta-save",
        patch: { text: "Review order", tone: "ok" },
      },
      {
        op: "update-annotation",
        annotationId: "overview-note",
        patch: { text: "Point reviewers to the primary action.", y: 650 },
      },
    ]);

    expect(patched["plan.mdx"]).toContain("Only this text changed.");
    expect(patched["canvas.mdx"]).toContain('text="Review order"');
    expect(patched["canvas.mdx"]).toContain('tone="ok"');
    expect(patched["canvas.mdx"]).toContain("Point reviewers");

    const parsed = await parsePlanMdxFolder(patched);
    const summary = parsed.blocks.find((block) => block.id === "summary");
    expect(summary?.type).toBe("rich-text");
    if (summary?.type === "rich-text") {
      expect(summary.data.markdown).toContain("Only this text changed.");
    }
    const main =
      parsed.canvas?.frames[0]?.wireframe?.screen[0]?.children?.[0]
        ?.children?.[1];
    expect(main?.children?.[2]?.text).toBe("Review order");
    expect(parsed.canvas?.annotations?.[0]?.y).toBe(650);
  });

  it("replaces a single artboard from an MDX fragment", async () => {
    const folder = await exportPlanContentToMdxFolder({
      content: sampleContent(),
      title: "Checkout review flow",
    });

    const patched = await applyPlanMdxSourcePatches(folder, [
      {
        op: "replace-artboard",
        artboardId: "confirm-artboard",
        mdx: `<Artboard id="confirm-artboard" label="Confirm" surface="popover" x={980} y={120} width={360} height={320}>
  <Screen surface="popover" caption="Updated confirmation">
    <FrameScreen id="confirm-screen">
      <Title id="confirm-title" text="Ship it?" />
      <Btn id="confirm-submit" text="Confirm" tone="accent" />
    </FrameScreen>
  </Screen>
</Artboard>`,
      },
    ]);

    const parsed = await parsePlanMdxFolder(patched);
    expect(parsed.canvas?.frames[1]?.wireframe?.caption).toBe(
      "Updated confirmation",
    );
    expect(
      parsed.canvas?.frames[1]?.wireframe?.screen[0]?.children?.[1]?.id,
    ).toBe("confirm-submit");
  });
});
