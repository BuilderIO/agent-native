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
      viewport: { zoom: 0.81, pan: { x: 24, y: 36 } },
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
      notes: [
        {
          id: "legacy-review-note",
          title: "Legacy review note",
          body: "Legacy canvas notes survive source sync.",
          arrowToFrameId: "confirm-artboard",
          x: 1040,
          y: 520,
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
    expect(folder[".plan-state.json"]).toContain('"zoom": 0.81');
    expect(folder["canvas.mdx"]).toContain("Legacy canvas notes survive");
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
    expect(parsed.canvas?.viewport?.zoom).toBe(0.81);
    expect(parsed.canvas?.viewport?.pan?.x).toBe(24);
    expect(parsed.canvas?.annotations?.map((note) => note.id)).toContain(
      "legacy-review-note",
    );
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

  it("patches document-level wireframe nodes when there is no canvas file", async () => {
    const folder = {
      "plan.mdx": `---
title: "Document wireframe"
version: 2
---

<WireframeBlock id="doc-wireframe" title="Inline wireframe">
  <Screen surface="browser" caption="Inline state">
    <FrameScreen id="doc-screen">
      <Btn id="doc-cta" text="Old label" />
    </FrameScreen>
  </Screen>
</WireframeBlock>
`,
    };

    const patched = await applyPlanMdxSourcePatches(folder, [
      {
        op: "update-wireframe-node",
        nodeId: "doc-cta",
        patch: { text: "New label", tone: "accent" },
      },
    ]);

    expect(patched["plan.mdx"]).toContain('text="New label"');
    expect(patched["plan.mdx"]).toContain('tone="accent"');

    const parsed = await parsePlanMdxFolder(patched);
    const wireframe = parsed.blocks.find(
      (block) => block.id === "doc-wireframe",
    );
    expect(wireframe?.type).toBe("wireframe");
    if (wireframe?.type === "wireframe") {
      expect(wireframe.data.screen[0]?.children?.[0]?.text).toBe("New label");
    }
  });

  it("reports missing canvas files before canvas-only source patches", async () => {
    const folder = {
      "plan.mdx": `---
title: "Document only"
version: 2
---

<RichText id="summary">No canvas here.</RichText>
`,
    };

    await expect(
      applyPlanMdxSourcePatches(folder, [
        {
          op: "update-annotation",
          annotationId: "missing-note",
          patch: { text: "Updated" },
        },
      ]),
    ).rejects.toThrow(
      "canvas.mdx is not present; cannot update annotation missing-note",
    );

    await expect(
      applyPlanMdxSourcePatches(folder, [
        {
          op: "replace-artboard",
          artboardId: "missing-board",
          mdx: `<Artboard id="missing-board" />`,
        },
      ]),
    ).rejects.toThrow(
      "canvas.mdx is not present; cannot replace artboard missing-board",
    );

    await expect(
      applyPlanMdxSourcePatches(folder, [
        {
          op: "update-component-prop",
          file: "canvas.mdx",
          componentId: "missing-component",
          prop: "title",
          value: "Updated",
        },
      ]),
    ).rejects.toThrow(
      "canvas.mdx is not present; cannot update component missing-component",
    );
  });

  it("throws on unsupported MDX attribute expressions", async () => {
    await expect(
      parsePlanMdxFolder({
        "plan.mdx": `---
title: "Bad expression"
version: 2
---

<WireframeBlock id="bad-wireframe">
  <Screen surface="browser">
    <FrameScreen id="bad-screen">
      <Lines id="bad-lines" widths={notJson} />
    </FrameScreen>
  </Screen>
</WireframeBlock>
`,
      }),
    ).rejects.toThrow(
      'Unsupported MDX attribute expression for "widths": {notJson}',
    );
  });
});
