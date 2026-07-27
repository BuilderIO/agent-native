import {
  BlockRegistry,
  serializeSpecBlock,
  parseSpecBlock,
  createAttrReader,
  type MdxJsxNode,
} from "@agent-native/core/blocks/server";
import { describe, expect, it } from "vitest";

import { registerPlanBlocks } from "../shared/plan-block-registry.js";
import { planContentSchema, type PlanContent } from "../shared/plan-content.js";
import {
  exportPlanContentToMdxFolder,
  parsePlanMdxFolder,
} from "./plan-mdx.js";

/**
 * Phase B — the PLAN-SPECIFIC `wireframe` block, converted to a registry spec.
 * It proves the registry's CUSTOM-Edit + nested-MDX (`serializeChildren` /
 * `parseChildren`) path: the body is a `<Screen>` kit-tree subtree, not flat
 * attributes or a single markdown string. These tests assert the registry path
 * is byte-identical to the legacy `<WireframeBlock>…<Screen>…</Screen>…` form and
 * reproduces the exact stable node ids, so stored plans round-trip unchanged.
 */

function wireframeContent(): PlanContent {
  return planContentSchema.parse({
    version: 2,
    title: "Registry wireframe",
    brief: "Proving the block registry round-trips the wireframe.",
    blocks: [
      {
        id: "wf-1",
        type: "wireframe",
        title: "Overview state",
        data: {
          surface: "browser",
          caption: "Inbox",
          screen: [
            {
              id: "screen-root",
              el: "screen",
              children: [
                { id: "title-1", el: "title", text: "Inbox" },
                { id: "btn-1", el: "btn", text: "Compose", tone: "accent" },
              ],
            },
          ],
        },
      },
    ],
  });
}

describe("plan block registry — wireframe", () => {
  it("serializes a wireframe through the registry in the legacy nested-MDX form", () => {
    const registry = new BlockRegistry();
    registerPlanBlocks(registry);
    const spec = registry.get("wireframe");
    expect(spec).toBeDefined();

    const mdx = serializeSpecBlock(spec!, {
      id: "wf-1",
      title: "Overview state",
      data: {
        surface: "browser",
        caption: "Inbox",
        screen: [
          {
            id: "screen-root",
            el: "screen",
            children: [{ id: "btn-1", el: "btn", text: "Compose" }],
          },
        ],
      },
    });

    // Exactly the legacy `<WireframeBlock id title>…<Screen surface caption>…kit
    // tree…</Screen>…</WireframeBlock>` shape, with kit primitives mapped to their
    // component names (screen→FrameScreen, btn→Btn) and `id` first per node.
    expect(mdx).toBe(
      [
        '<WireframeBlock id="wf-1" title="Overview state">',
        '<Screen surface="browser" caption="Inbox">',
        '  <FrameScreen id="screen-root">',
        '    <Btn id="btn-1" text="Compose" />',
        "  </FrameScreen>",
        "</Screen>",
        "</WireframeBlock>",
      ].join("\n"),
    );
  });

  it("round-trips a wireframe through the registry MDX path (export → parse) with stable ids", async () => {
    const source = wireframeContent();
    const folder = await exportPlanContentToMdxFolder({
      content: source,
      title: source.title,
      brief: source.brief,
    });

    // The exported plan.mdx contains a real `<WireframeBlock>` with a nested
    // `<Screen>` and kit primitives.
    expect(folder["plan.mdx"]).toContain("<WireframeBlock");
    expect(folder["plan.mdx"]).toContain("<Screen");
    expect(folder["plan.mdx"]).toContain('surface="browser"');
    expect(folder["plan.mdx"]).toContain("<FrameScreen");
    expect(folder["plan.mdx"]).toContain('text="Compose"');

    const parsed = await parsePlanMdxFolder(folder);
    const wireframe = parsed.blocks.find((block) => block.type === "wireframe");
    expect(wireframe).toBeDefined();
    if (wireframe && wireframe.type === "wireframe") {
      expect(wireframe.id).toBe("wf-1");
      expect(wireframe.data.surface).toBe("browser");
      expect(wireframe.data.caption).toBe("Inbox");
      // Provided ids survive the round-trip.
      expect(wireframe.data.screen?.[0]?.id).toBe("screen-root");
      expect(wireframe.data.screen?.[0]?.children?.[0]?.id).toBe("title-1");
      expect(wireframe.data.screen?.[0]?.children?.[1]?.text).toBe("Compose");
    }
  });

  it("round-trips the explicit wireframe frame option on the nested Screen", async () => {
    const source = planContentSchema.parse({
      version: 2,
      title: "Borderless docs wireframe",
      blocks: [
        {
          id: "wf-borderless",
          type: "wireframe",
          data: {
            surface: "browser",
            frame: "hide",
            html: "<div>Getting started sketch</div>",
          },
        },
      ],
    });
    const folder = await exportPlanContentToMdxFolder({
      content: source,
      title: source.title,
    });

    expect(folder["plan.mdx"]).toContain("<Screen");
    expect(folder["plan.mdx"]).toContain('surface="browser"');
    expect(folder["plan.mdx"]).toContain('frame="hide"');

    const parsed = await parsePlanMdxFolder(folder);
    const wireframe = parsed.blocks.find(
      (block) => block.id === "wf-borderless",
    );
    expect(wireframe?.type).toBe("wireframe");
    if (wireframe?.type !== "wireframe") throw new Error("Expected wireframe");
    expect(wireframe.data.frame).toBe("hide");
  });

  it("assigns the same stable node ids the legacy parser derived (no drift)", async () => {
    // A WireframeBlock whose nodes have NO ids — the registry parser must derive
    // the identical `node-<el>-<idContext>-screen-<i>...` ids the legacy
    // `parseScreen`/`createStableWireframeNodeId` produced.
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

    expect(wireframe.data.screen?.[0]?.id).toBe(
      "node-screen-plan-block-0-inline-wireframe-screen-0",
    );
    expect(wireframe.data.screen?.[0]?.children?.[0]?.id).toBe(
      "node-btn-plan-block-0-inline-wireframe-screen-0-0",
    );
  });

  it("parses an empty/malformed wireframe (no Screen) to a safe default", () => {
    const registry = new BlockRegistry();
    registerPlanBlocks(registry);
    const spec = registry.get("wireframe");
    expect(spec).toBeDefined();

    // A node with no <Screen> child still parses to a valid (empty) wireframe.
    const node: MdxJsxNode = {
      type: "mdxJsxFlowElement",
      name: "WireframeBlock",
      attributes: [],
      children: [],
    };
    const result = parseSpecBlock(
      registry,
      node,
      { id: "wf-empty" },
      "",
      "ctx",
    );
    expect(result?.type).toBe("wireframe");
    const data = result?.data as { surface: string; screen: unknown[] };
    expect(data.surface).toBe("desktop");
    expect(data.screen).toEqual([]);
    // sanity: the shared attr reader resolves nothing from an empty node.
    expect(createAttrReader(node).string("surface")).toBeUndefined();
  });
});
