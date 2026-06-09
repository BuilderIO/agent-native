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
      mode: "design",
      title: "Checkout board",
      design: {
        designMd: "Use polished checkout review surfaces.",
        brandKit: {
          colors: { primary: "#0f766e", ink: "#111827" },
          radius: { card: "8px" },
        },
        codebaseStyles: {
          cssVars: { "--radius-card": "8px", "--color-primary": "#0f766e" },
        },
        notes: "Prefer dense operational UI over marketing layout.",
        styleSources: [
          {
            kind: "design-md",
            title: "design.md",
            summary: "Primary design brief.",
          },
          {
            kind: "codebase",
            title: "app/globals.css",
            summary: "Existing CSS custom properties.",
          },
        ],
      },
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
        {
          id: "overview-callout",
          type: "callout",
          text: "Point reviewers to the save action.",
          x: 220,
          y: 300,
          points: [
            { x: 220, y: 300 },
            { x: 520, y: 360 },
          ],
          style: { tone: "accent", stroke: "dashed", width: 2 },
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
    expect(folder["plan.mdx"]).toContain(
      "# Visual plan: open https://plan.agent-native.com/plans/plan_test in a browser for the canvas and review UI.",
    );
    expect(folder["plan.mdx"]).toContain(
      'visualUrl: "https://plan.agent-native.com/plans/plan_test"',
    );
    expect(folder["plan.mdx"]).not.toMatch(/^planId:/m);
    expect(folder["plan.mdx"]).not.toMatch(/^source:/m);
    expect(folder["plan.mdx"]).toContain("<RichText");
    expect(folder["plan.mdx"]).toContain("<ImplementationMap");
    expect(folder["canvas.mdx"]).toContain("<DesignBoard");
    expect(folder["canvas.mdx"]).toContain(
      "{/* Canvas source. Open https://plan.agent-native.com/plans/plan_test */}",
    );
    expect(folder["canvas.mdx"]).toContain("\n  <Section");
    expect(folder["canvas.mdx"]).toContain("\n    <Artboard");
    expect(folder["canvas.mdx"]).toContain("\n      <Screen");
    expect(folder["canvas.mdx"]).toContain('mode="design"');
    expect(folder["canvas.mdx"]).toContain("styleSources");
    expect(folder["canvas.mdx"]).toContain("<Artboard");
    expect(folder["canvas.mdx"]).toContain("<FrameScreen");
    expect(folder["canvas.mdx"]).toContain("<Annotation");
    expect(folder["canvas.mdx"]).toContain('type="callout"');
    expect(folder["canvas.mdx"]).toContain("points={");
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
    expect(parsed.canvas?.mode).toBe("design");
    expect(
      parsed.canvas?.design?.styleSources?.map((source) => source.title),
    ).toEqual(["design.md", "app/globals.css"]);
    expect(parsed.canvas?.design?.brandKit?.colors).toMatchObject({
      primary: "#0f766e",
    });
    expect(parsed.canvas?.annotations?.map((note) => note.id)).toContain(
      "legacy-review-note",
    );
    const callout = parsed.canvas?.annotations?.find(
      (annotation) => annotation.id === "overview-callout",
    );
    expect(callout?.type).toBe("callout");
    expect(callout?.points?.[1]?.x).toBe(520);
    expect(callout?.style?.stroke).toBe("dashed");
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

  it("rejects invalid annotation placement values before writing source", async () => {
    const folder = await exportPlanContentToMdxFolder({
      content: sampleContent(),
      title: "Checkout review flow",
    });
    const patches = [
      {
        op: "update-annotation",
        annotationId: "overview-note",
        patch: { placement: "middle" },
      },
    ] as unknown as Parameters<typeof applyPlanMdxSourcePatches>[1];

    await expect(applyPlanMdxSourcePatches(folder, patches)).rejects.toThrow(
      /Invalid option|invalid/i,
    );
  });

  it("patches block-linked wireframe nodes in both plan and canvas source", async () => {
    const folder = {
      "plan.mdx": `---
title: "Linked wireframe"
version: 2
---

<WireframeBlock id="overview-block" title="Overview state">
  <Screen surface="browser">
    <FrameScreen id="shared-screen">
      <Btn id="shared-cta" text="Old label" />
    </FrameScreen>
  </Screen>
</WireframeBlock>
`,
      "canvas.mdx": `<DesignBoard title="Linked board">
  <Section id="main" title="Main">
    <Artboard id="overview-artboard" blockId="overview-block" label="Overview" x={80} y={80}>
      <Screen surface="browser">
        <FrameScreen id="shared-screen">
          <Btn id="shared-cta" text="Old label" />
        </FrameScreen>
      </Screen>
    </Artboard>
  </Section>
</DesignBoard>
`,
    };

    const patched = await applyPlanMdxSourcePatches(folder, [
      {
        op: "update-wireframe-node",
        nodeId: "shared-cta",
        patch: { text: "New label", tone: "accent" },
      },
    ]);

    expect(patched["plan.mdx"]).toContain('text="New label"');
    expect(patched["canvas.mdx"]).toContain('text="New label"');

    const parsed = await parsePlanMdxFolder(patched);
    const frameButton =
      parsed.canvas?.frames[0]?.wireframe?.screen[0]?.children?.[0];
    expect(frameButton?.text).toBe("New label");
  });

  it("assigns stable IDs to imported wireframe nodes without ids", async () => {
    const parsed = await parsePlanMdxFolder({
      "plan.mdx": `---
title: "Generated IDs"
version: 2
---

<WireframeBlock id="inline-wireframe" title="Inline wireframe">
  <Screen surface="browser">
    <FrameScreen>
      <Btn text="Continue" />
    </FrameScreen>
  </Screen>
</WireframeBlock>
`,
    });
    const wireframe = parsed.blocks.find(
      (block) => block.id === "inline-wireframe",
    );
    expect(wireframe?.type).toBe("wireframe");
    if (wireframe?.type !== "wireframe") throw new Error("Expected wireframe");

    const generatedScreenId = wireframe.data.screen[0]?.id;
    const generatedButtonId = wireframe.data.screen[0]?.children?.[0]?.id;
    expect(generatedScreenId).toBe(
      "node-screen-plan-block-0-inline-wireframe-screen-0",
    );
    expect(generatedButtonId).toBe(
      "node-btn-plan-block-0-inline-wireframe-screen-0-0",
    );

    const exported = await exportPlanContentToMdxFolder({
      content: parsed,
      title: "Generated IDs",
    });
    expect(exported["plan.mdx"]).toContain(`id="${generatedButtonId}"`);

    const patched = await applyPlanMdxSourcePatches(exported, [
      {
        op: "update-wireframe-node",
        nodeId: generatedButtonId ?? "",
        patch: { text: "Review" },
      },
    ]);

    expect(patched["plan.mdx"]).toContain('text="Review"');
  });

  it("keeps generated wireframe node IDs distinct across independent owners", async () => {
    const parsed = await parsePlanMdxFolder({
      "plan.mdx": `---
title: "Independent wireframes"
version: 2
---

<WireframeBlock id="doc-wireframe" title="Document wireframe">
  <Screen surface="browser">
    <FrameScreen>
      <Btn text="Document action" />
    </FrameScreen>
  </Screen>
</WireframeBlock>
`,
      "canvas.mdx": `<DesignBoard title="Board">
  <Artboard id="canvas-artboard" label="Canvas" x={80} y={80}>
    <Screen surface="browser">
      <FrameScreen>
        <Btn text="Canvas action" />
      </FrameScreen>
    </Screen>
  </Artboard>
</DesignBoard>
`,
    });
    const wireframe = parsed.blocks.find(
      (block) => block.id === "doc-wireframe",
    );
    expect(wireframe?.type).toBe("wireframe");
    if (wireframe?.type !== "wireframe") throw new Error("Expected wireframe");
    const documentButtonId = wireframe.data.screen[0]?.children?.[0]?.id;
    const canvasButtonId =
      parsed.canvas?.frames[0]?.wireframe?.screen[0]?.children?.[0]?.id;

    expect(documentButtonId).toBe(
      "node-btn-plan-block-0-doc-wireframe-screen-0-0",
    );
    expect(canvasButtonId).toBe("node-btn-canvas-0-canvas-artboard-screen-0-0");
    expect(documentButtonId).not.toBe(canvasButtonId);
  });

  it("rejects duplicate explicit wireframe node IDs during import", async () => {
    await expect(
      parsePlanMdxFolder({
        "plan.mdx": `---
title: "Duplicate parent IDs"
version: 2
---

<WireframeBlock id="duplicate-parent-wireframe">
  <Screen surface="browser">
    <FrameScreen>
      <Row id="dup">
        <Btn text="First" />
      </Row>
      <Row id="dup">
        <Btn text="Second" />
      </Row>
    </FrameScreen>
  </Screen>
</WireframeBlock>
`,
      }),
    ).rejects.toThrow("Duplicate wireframe node id: dup");
  });

  it("keeps generated IDs distinct for punctuation-equivalent owner IDs", async () => {
    const parsed = await parsePlanMdxFolder({
      "plan.mdx": `---
title: "Punctuation IDs"
version: 2
---

<WireframeBlock id="foo_bar">
  <Screen surface="browser">
    <FrameScreen>
      <Btn text="Underscore" />
    </FrameScreen>
  </Screen>
</WireframeBlock>

<WireframeBlock id="foo-bar">
  <Screen surface="browser">
    <FrameScreen>
      <Btn text="Hyphen" />
    </FrameScreen>
  </Screen>
</WireframeBlock>
`,
    });

    const first = parsed.blocks.find((block) => block.id === "foo_bar");
    const second = parsed.blocks.find((block) => block.id === "foo-bar");
    expect(first?.type).toBe("wireframe");
    expect(second?.type).toBe("wireframe");
    if (first?.type !== "wireframe" || second?.type !== "wireframe")
      throw new Error("Expected wireframes");

    const firstButtonId = first.data.screen[0]?.children?.[0]?.id;
    const secondButtonId = second.data.screen[0]?.children?.[0]?.id;
    expect(firstButtonId).toBe("node-btn-plan-block-0-foo-bar-screen-0-0");
    expect(secondButtonId).toBe("node-btn-plan-block-1-foo-bar-screen-0-0");
    expect(firstButtonId).not.toBe(secondButtonId);
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

  it("resolves a template-literal html attribute on <Screen> to a string", async () => {
    const parsed = await parsePlanMdxFolder({
      "plan.mdx": `---
title: "Template literal html"
version: 2
---

<WireframeBlock id="tl-wireframe" title="Template literal wireframe">
  <Screen surface="browser" html={\`<div>hi</div>\`} />
</WireframeBlock>
`,
    });
    const wireframe = parsed.blocks.find(
      (block) => block.id === "tl-wireframe",
    );
    expect(wireframe?.type).toBe("wireframe");
    if (wireframe?.type !== "wireframe") throw new Error("Expected wireframe");
    expect(wireframe.data.surface).toBe("browser");
    expect(wireframe.data.html).toBe("<div>hi</div>");
  });

  it("throws on a template-literal html attribute that interpolates ${…}", async () => {
    await expect(
      parsePlanMdxFolder({
        "plan.mdx": `---
title: "Interpolated template literal"
version: 2
---

<WireframeBlock id="interp-wireframe">
  <Screen surface="browser" html={\`<div>\${value}</div>\`} />
</WireframeBlock>
`,
      }),
    ).rejects.toThrow(/template literal|\$\{/i);
  });

  it("throws on a standalone bare <Screen> instead of emitting raw text", async () => {
    await expect(
      parsePlanMdxFolder({
        "plan.mdx": `---
title: "Bare screen"
version: 2
---

<Screen surface="browser" html={\`<div>hi</div>\`} />
`,
      }),
    ).rejects.toThrow(/Malformed wireframe|WireframeBlock/i);
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
