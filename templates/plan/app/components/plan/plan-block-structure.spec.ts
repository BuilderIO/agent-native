import type { PlanBlock } from "@shared/plan-content";
import { describe, expect, it } from "vitest";

import {
  findPlanBlock,
  hasPlanBlockStructureChange,
  isWideLayoutBlock,
  nestedPlanBlockLists,
  updatePlanBlocks,
  visitPlanBlocks,
} from "./plan-block-structure";

const currentBlocks = [
  {
    id: "tabs-1",
    type: "tabs",
    data: {
      tabs: [{ id: "tab-1", label: "Overview", blocks: [] }],
    },
  },
] as unknown as PlanBlock[];

describe("hasPlanBlockStructureChange", () => {
  it("detects valid nested structure changes", () => {
    const nextBlocks = [
      {
        ...currentBlocks[0],
        data: {
          tabs: [
            {
              id: "tab-1",
              label: "Overview",
              blocks: [{ id: "callout-1", type: "callout", data: {} }],
            },
          ],
        },
      },
    ] as unknown as PlanBlock[];

    expect(hasPlanBlockStructureChange(currentBlocks, nextBlocks)).toBe(true);
  });

  it.each([
    {
      id: "tabs-1",
      type: "tabs",
      data: {},
    },
    {
      id: "columns-1",
      type: "columns",
      data: { columns: [{ id: "column-1" }] },
    },
  ])("treats an incomplete nested block as a structure change: %o", (block) => {
    expect(() =>
      hasPlanBlockStructureChange(currentBlocks, [block] as PlanBlock[]),
    ).not.toThrow();
    expect(
      hasPlanBlockStructureChange(currentBlocks, [block] as PlanBlock[]),
    ).toBe(true);
  });

  it("visits valid descendants while skipping malformed regions", () => {
    const seen: string[] = [];
    const blocks = [
      {
        id: "tabs-2",
        type: "tabs",
        data: {
          tabs: [
            {
              id: "tab-1",
              blocks: [{ id: "note-1", type: "note", data: {} }],
            },
            null,
          ],
        },
      },
    ];

    expect(() =>
      visitPlanBlocks(blocks, (block) => seen.push(block.id)),
    ).not.toThrow();
    expect(seen).toEqual(["tabs-2", "note-1"]);
    expect(nestedPlanBlockLists(blocks[0])).toHaveLength(1);
  });
});

describe("guarded Plan block traversal", () => {
  const note = {
    id: "note-target",
    type: "note",
    data: { body: "before" },
  } as unknown as PlanBlock;
  const blocks = [
    { id: "bad-tabs", type: "tabs", data: { tabs: null } },
    {
      id: "columns-1",
      type: "columns",
      data: {
        columns: [{ id: "column-1", blocks: [note] }, null],
      },
    },
  ] as unknown as PlanBlock[];

  it("finds a later nested block after malformed tabs", () => {
    expect(findPlanBlock(blocks, "note-target")).toEqual(note);
  });

  it("updates a later nested block and preserves malformed siblings", () => {
    const updated = updatePlanBlocks(
      blocks,
      "note-target",
      (block) =>
        ({
          ...block,
          data: { body: "after" },
        }) as PlanBlock,
    );
    const columns = updated[1] as Extract<PlanBlock, { type: "columns" }>;

    expect(updated[0]).toBe(blocks[0]);
    expect(columns.data.columns[0]?.blocks[0]?.data).toEqual({ body: "after" });
    expect((columns.data.columns as unknown[])[1]).toBeNull();
  });
});

describe("isWideLayoutBlock", () => {
  it("keeps columns at the default width even when they contain a diff", () => {
    const columns = {
      id: "columns-1",
      type: "columns",
      data: {
        columns: [
          {
            id: "column-1",
            blocks: [{ id: "diff-1", type: "diff", data: {} }],
          },
        ],
      },
    } as unknown as PlanBlock;

    expect(isWideLayoutBlock(columns)).toBe(false);
  });

  it("keeps direct and tab-nested diff blocks wide", () => {
    const diff = { id: "diff-1", type: "diff", data: {} } as PlanBlock;
    const tabs = {
      id: "tabs-1",
      type: "tabs",
      data: {
        orientation: "horizontal",
        tabs: [{ id: "tab-1", blocks: [diff] }],
      },
    } as unknown as PlanBlock;

    expect(isWideLayoutBlock(diff)).toBe(true);
    expect(isWideLayoutBlock(tabs)).toBe(true);
  });
});
