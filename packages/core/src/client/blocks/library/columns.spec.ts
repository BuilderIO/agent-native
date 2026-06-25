import { describe, expect, it } from "vitest";

import type { ColumnsData } from "./columns.config.js";
import { columnsBlock } from "./columns.js";

const sample: ColumnsData = {
  columns: [
    {
      id: "col-before",
      label: "Before",
      blocks: [{ id: "old", type: "rich-text", data: { markdown: "Old" } }],
    },
    {
      id: "col-after",
      label: "After",
      blocks: [{ id: "new", type: "rich-text", data: { markdown: "New" } }],
    },
  ],
};

describe("columns block container contract", () => {
  it("exposes columns as editable block regions without requiring labels", () => {
    expect(columnsBlock.editSurface).toBe("container");
    expect(columnsBlock.container?.regions(sample)).toEqual(sample.columns);
    expect(columnsBlock.empty?.()).toMatchObject({
      columns: [{ blocks: [] }, { blocks: [] }],
    });
    expect(columnsBlock.empty?.().columns.some((column) => column.label)).toBe(
      false,
    );
  });

  it("updates one column region without rewriting sibling blocks", () => {
    const nextBlocks = [
      { id: "middle", type: "callout", data: { body: "Moved", tone: "info" } },
    ];

    const next = columnsBlock.container?.updateRegion(
      sample,
      "col-after",
      nextBlocks,
    );

    expect(next?.columns[0]?.blocks).toBe(sample.columns[0]?.blocks);
    expect(next?.columns[1]?.blocks).toEqual(nextBlocks);
  });

  it("removes a column when its last child block is deleted", () => {
    const next = columnsBlock.container?.updateRegion(sample, "col-after", []);

    expect(next?.columns.map((column) => column.id)).toEqual(["col-before"]);
  });

  it("removes a column when deleting leaves only a blank rich-text placeholder", () => {
    const next = columnsBlock.container?.updateRegion(sample, "col-after", [
      { id: "blank", type: "rich-text", data: { markdown: "   " } },
    ]);

    expect(next?.columns.map((column) => column.id)).toEqual(["col-before"]);
  });

  it("adds and removes unlabeled regions within schema bounds", () => {
    const added = columnsBlock.container?.addRegion?.(sample, "col-before");
    expect(added?.columns).toHaveLength(3);
    expect(added?.columns[1]?.label).toBeUndefined();
    expect(added?.columns[1]?.blocks).toEqual([]);

    const removed = columnsBlock.container?.removeRegion?.(
      added!,
      added!.columns[1]!.id,
    );
    expect(removed?.columns.map((column) => column.id)).toEqual([
      "col-before",
      "col-after",
    ]);
  });
});
