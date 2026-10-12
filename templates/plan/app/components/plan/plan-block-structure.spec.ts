import type { PlanBlock } from "@shared/plan-content";
import { describe, expect, it } from "vitest";

import { hasPlanBlockStructureChange } from "./plan-block-structure";

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
  ])("rejects an incomplete nested block without throwing: %o", (block) => {
    expect(() =>
      hasPlanBlockStructureChange(currentBlocks, [block] as PlanBlock[]),
    ).not.toThrow();
    expect(
      hasPlanBlockStructureChange(currentBlocks, [block] as PlanBlock[]),
    ).toBe(false);
  });
});
