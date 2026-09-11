import {
  BlockRegistry,
  serializeSpecBlock,
  introspect,
  prop,
  tabsSchema,
  tabsMdx,
} from "@agent-native/core/blocks/server";
import { describe, expect, it } from "vitest";

import { registerPlanBlocks } from "../shared/plan-block-registry.js";
import { planContentSchema, type PlanContent } from "../shared/plan-content.js";
import {
  exportPlanContentToMdxFolder,
  parsePlanMdxFolder,
} from "./plan-mdx.js";

/**
 * Proves the standard `tabs` block (moved to `@agent-native/core/blocks`)
 * round-trips through the registry MDX path BYTE-IDENTICALLY to the legacy
 * `<TabsBlock … tabs={[…]} />` encoding — including nested child blocks encoded
 * as a single JSON `tabs` prop (NOT nested MDX). This is the backward-compat
 * contract: stored plans with the old encoding must keep parsing, and converting
 * the block must not change source output.
 */

const TABS_DATA = {
  tabs: [
    {
      id: "tab-overview",
      label: "Overview",
      blocks: [
        {
          id: "tab-overview-text",
          type: "rich-text",
          data: { markdown: "Overview body." },
        },
      ],
    },
    {
      id: "tab-details",
      label: "Details",
      blocks: [
        {
          id: "tab-details-callout",
          type: "callout",
          data: { tone: "info", body: "A nested callout." },
        },
      ],
    },
  ],
};

const VERTICAL_TABS_DATA = {
  ...TABS_DATA,
  orientation: "vertical" as const,
};

function tabsContent(): PlanContent {
  return planContentSchema.parse({
    version: 2,
    title: "Registry tabs",
    brief: "Proving the block registry round-trips horizontal tabs.",
    blocks: [
      {
        id: "tabs-1",
        type: "tabs",
        data: TABS_DATA,
      },
    ],
  });
}

describe("plan block registry — tabs", () => {
  it("registers the standard tabs block on the shared registry", () => {
    const registry = new BlockRegistry();
    registerPlanBlocks(registry);
    const spec = registry.get("tabs");
    expect(spec).toBeDefined();
    expect(spec!.mdx.tag).toBe("TabsBlock");
    // The same shared config object the client registry uses.
    expect(spec!.mdx).toBe(tabsMdx);
    expect(spec!.schema).toBe(tabsSchema);
    // Registered MDX tag drives parse-side dispatch.
    expect(registry.hasTag("TabsBlock")).toBe(true);
  });

  it("serializes tabs through the registry in the EXACT legacy MDX form", () => {
    const registry = new BlockRegistry();
    registerPlanBlocks(registry);
    const spec = registry.get("tabs")!;

    const fromRegistry = serializeSpecBlock(spec, {
      id: "tabs-1",
      data: TABS_DATA,
    });

    // Byte-reconstruct the legacy `serializeBlock` tabs branch (plan-mdx.ts):
    //   `<TabsBlock${id}${title}${summary}${editable} tabs={[…]} />`
    // with `tabs` JSON-encoded by the shared `prop()` encoder. title/summary/
    // editable are omitted here, matching the legacy `prop()` drop behavior.
    const legacy = `<TabsBlock${prop("id", "tabs-1")}${prop(
      "tabs",
      TABS_DATA.tabs,
    )} />`;

    expect(fromRegistry).toBe(legacy);
    // Self-closing, single JSON `tabs` prop, children NOT nested MDX.
    expect(fromRegistry.startsWith('<TabsBlock id="tabs-1" tabs={[')).toBe(
      true,
    );
    expect(fromRegistry.endsWith("} />")).toBe(true);
  });

  it("round-trips tabs (with nested children) through export → parse", async () => {
    const source = tabsContent();
    const folder = await exportPlanContentToMdxFolder({
      content: source,
      title: source.title,
      brief: source.brief,
    });

    // The exported plan.mdx contains a real self-closing `<TabsBlock>` element
    // whose `tabs` prop carries the labels AND nested child blocks (the export
    // step formats the embedded expression with Prettier, so object keys are
    // unquoted JS-object style — the same formatting every other JSON-prop block
    // gets, and what stored plans contain).
    expect(folder["plan.mdx"]).toContain("<TabsBlock");
    expect(folder["plan.mdx"]).toContain('label: "Overview"');
    expect(folder["plan.mdx"]).toContain('type: "callout"');

    const parsed = await parsePlanMdxFolder(folder);
    const tabs = parsed.blocks.find((block) => block.type === "tabs");
    expect(tabs).toBeDefined();
    if (tabs && tabs.type === "tabs") {
      expect(tabs.id).toBe("tabs-1");
      expect(tabs.data.tabs).toHaveLength(2);
      expect(tabs.data.tabs[0]?.label).toBe("Overview");
      expect(tabs.data.tabs[0]?.blocks[0]?.type).toBe("rich-text");
      const nestedCallout = tabs.data.tabs[1]?.blocks[0];
      expect(nestedCallout?.type).toBe("callout");
      if (nestedCallout?.type === "callout") {
        expect(nestedCallout.data.tone).toBe("info");
        expect(nestedCallout.data.body).toContain("nested callout");
      }
    }
  });

  it("round-trips optional vertical orientation through MDX", async () => {
    const source = planContentSchema.parse({
      version: 2,
      title: "Registry vertical tabs",
      brief: "Proving the side-rail tab option round-trips.",
      blocks: [
        {
          id: "tabs-vertical",
          type: "tabs",
          data: VERTICAL_TABS_DATA,
        },
      ],
    });

    const folder = await exportPlanContentToMdxFolder({
      content: source,
      title: source.title,
      brief: source.brief,
    });

    expect(folder["plan.mdx"]).toContain('orientation="vertical"');

    const parsed = await parsePlanMdxFolder(folder);
    const tabs = parsed.blocks.find((block) => block.type === "tabs");
    expect(tabs).toBeDefined();
    if (tabs?.type === "tabs") {
      expect(tabs.data.orientation).toBe("vertical");
      expect(tabs.data.tabs[1]?.blocks[0]?.type).toBe("callout");
    }
  });

  it("introspects tabs as an array field (needs the custom Edit, not the auto-editor)", () => {
    const fields = introspect(tabsSchema);
    const byKey = Object.fromEntries(fields.map((field) => [field.key, field]));
    // `tabs` is an array of objects → classified "array"; the spec supplies a
    // custom `Edit` (add/remove/rename) rather than the schema auto-editor.
    expect(byKey.tabs?.kind).toBe("array");
  });
});
