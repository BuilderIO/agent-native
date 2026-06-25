import { describe, expect, it } from "vitest";

import {
  describeIncompatibleBlocks,
  getIncompatibleBlockCounts,
  isNotionCompatibleBlockType,
  NOTION_COMPATIBLE_BLOCK_TYPES,
} from "../shared/notion-compat.js";
import {
  applyPlanContentPatches,
  planContentSchema,
  type PlanContent,
} from "../shared/plan-content.js";
import {
  exportPlanContentToMdxFolder,
  parsePlanMdxFolder,
} from "./plan-mdx.js";

/**
 * Coverage for the per-plan "Sync to Notion" setting: the compatibility
 * helpers, the `set-notion-sync` patch op, schema survival, and MDX round-trip.
 */

function planWith(blocks: PlanContent["blocks"]): PlanContent {
  return planContentSchema.parse({ version: 2, title: "P", blocks });
}

describe("notion-compat helpers", () => {
  it("classifies block types against the NFM-representable allowlist", () => {
    for (const type of NOTION_COMPATIBLE_BLOCK_TYPES) {
      expect(isNotionCompatibleBlockType(type)).toBe(true);
    }
    expect(isNotionCompatibleBlockType("rich-text")).toBe(true);
    expect(isNotionCompatibleBlockType("callout")).toBe(true);
    expect(isNotionCompatibleBlockType("checklist")).toBe(true);
    expect(isNotionCompatibleBlockType("table")).toBe(true);
    expect(isNotionCompatibleBlockType("wireframe")).toBe(false);
    expect(isNotionCompatibleBlockType("diagram")).toBe(false);
    expect(isNotionCompatibleBlockType("tabs")).toBe(false);
  });

  it("tallies incompatible blocks, including blocks nested in tabs", () => {
    const content = planWith([
      { id: "r1", type: "rich-text", data: { markdown: "Hello" } },
      {
        id: "wf1",
        type: "wireframe",
        data: {
          surface: "desktop",
          screen: [{ id: "t", el: "title", text: "x" }],
        },
      },
      {
        id: "wf2",
        type: "wireframe",
        data: {
          surface: "desktop",
          screen: [{ id: "t2", el: "title", text: "y" }],
        },
      },
      {
        id: "tabs1",
        type: "tabs",
        data: {
          tabs: [
            {
              id: "tab-a",
              label: "A",
              blocks: [
                {
                  id: "d1",
                  type: "diagram",
                  data: {
                    nodes: [{ id: "a", label: "A" }],
                    edges: [],
                  },
                },
              ],
            },
          ],
        },
      },
    ]);

    const counts = getIncompatibleBlockCounts(content.blocks);
    const byType = Object.fromEntries(counts.map((c) => [c.type, c.count]));
    // 2 wireframes + the tabs block itself + the nested diagram.
    expect(byType.wireframe).toBe(2);
    expect(byType.tabs).toBe(1);
    expect(byType.diagram).toBe(1);

    const summary = describeIncompatibleBlocks(content.blocks);
    expect(summary).toContain("2 wireframe");
    expect(summary).toContain("1 tabs");
    expect(summary).toContain("1 diagram");
  });

  it("returns null when every block is Notion-compatible", () => {
    const content = planWith([
      { id: "r1", type: "rich-text", data: { markdown: "Hello" } },
      { id: "c1", type: "callout", data: { tone: "info", body: "Note" } },
    ]);
    expect(getIncompatibleBlockCounts(content.blocks)).toHaveLength(0);
    expect(describeIncompatibleBlocks(content.blocks)).toBeNull();
  });
});

describe("set-notion-sync patch op", () => {
  const base = (): PlanContent =>
    planWith([{ id: "r1", type: "rich-text", data: { markdown: "Hi" } }]);

  it("enabling sets notionSync: true", () => {
    const next = applyPlanContentPatches(base(), [
      { op: "set-notion-sync", value: true },
    ]);
    expect(next.notionSync).toBe(true);
  });

  it("disabling removes the field entirely (stays byte-identical to off)", () => {
    const enabled = applyPlanContentPatches(base(), [
      { op: "set-notion-sync", value: true },
    ]);
    const disabled = applyPlanContentPatches(enabled, [
      { op: "set-notion-sync", value: false },
    ]);
    expect(disabled.notionSync).toBeUndefined();
    expect("notionSync" in disabled).toBe(false);
  });

  it("survives the schema parse (additive optional field is not stripped)", () => {
    const parsed = planContentSchema.parse({
      version: 2,
      notionSync: true,
      blocks: [],
    });
    expect(parsed.notionSync).toBe(true);
  });
});

describe("notionSync MDX source-sync round-trip", () => {
  it("preserves notionSync: true through export → parse", async () => {
    const content = planContentSchema.parse({
      version: 2,
      title: "Synced plan",
      notionSync: true,
      blocks: [{ id: "r1", type: "rich-text", data: { markdown: "Body" } }],
    });
    const folder = await exportPlanContentToMdxFolder({
      content,
      title: "Synced plan",
    });
    expect(folder["plan.mdx"]).toContain("notionSync");
    const back = await parsePlanMdxFolder(folder);
    expect(back.notionSync).toBe(true);
  });

  it("omits notionSync from frontmatter when off", async () => {
    const content = planContentSchema.parse({
      version: 2,
      title: "Plain plan",
      blocks: [{ id: "r1", type: "rich-text", data: { markdown: "Body" } }],
    });
    const folder = await exportPlanContentToMdxFolder({
      content,
      title: "Plain plan",
    });
    expect(folder["plan.mdx"]).not.toContain("notionSync");
    const back = await parsePlanMdxFolder(folder);
    expect(back.notionSync).toBeUndefined();
  });
});
