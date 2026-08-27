import { describe, expect, it } from "vitest";

import { selectDesignContextUsage } from "./get-design-context-usage.js";

const baseRecord = {
  id: "ccgr_1",
  appId: "design",
  artifactType: "design",
  artifactId: "design_1",
  contextMode: "auto" as const,
  contextPackId: "pack_1",
  createdAt: "2024-01-01T00:00:00.000Z",
};

describe("selectDesignContextUsage", () => {
  it("is unavailable when no generation record exists yet", () => {
    expect(selectDesignContextUsage(null, new Set(["file_1"]))).toEqual({
      available: false,
      usedContext: false,
      items: [],
    });
  });

  it("confirms no context was used when the matched entries are all net-new", () => {
    const result = selectDesignContextUsage(
      {
        ...baseRecord,
        elementProvenance: [
          { elementId: "file_1", influence: "generated", label: "index.html" },
        ],
      },
      new Set(["file_1"]),
    );
    expect(result.available).toBe(true);
    expect(result.usedContext).toBe(false);
    expect(result.items).toEqual([]);
  });

  it("returns exactly the items recorded for the matched element, not other files' entries", () => {
    const result = selectDesignContextUsage(
      {
        ...baseRecord,
        elementProvenance: [
          {
            elementId: "file_1",
            influence: "reference-conditioned",
            itemId: "item_a",
            itemVersionId: "v1",
            label: "Brand DNA",
          },
          {
            elementId: "file_2",
            influence: "reused",
            itemId: "item_b",
            itemVersionId: "v2",
            label: "Q3 style guide",
          },
        ],
      },
      new Set(["file_1"]),
    );
    expect(result.available).toBe(true);
    expect(result.usedContext).toBe(true);
    expect(result.contextPackId).toBe("pack_1");
    expect(result.items).toEqual([
      {
        itemId: "item_a",
        itemVersionId: "v1",
        label: "Brand DNA",
        influence: "reference-conditioned",
      },
    ]);
  });

  it("matches on either the file id or a currently-known frame id, not both blindly merged", () => {
    const result = selectDesignContextUsage(
      {
        ...baseRecord,
        elementProvenance: [
          {
            elementId: "frame_9",
            influence: "adapted",
            itemId: "item_c",
            itemVersionId: "v3",
            label: "2 reference designs",
          },
        ],
      },
      new Set(["file_1", "frame_9"]),
    );
    expect(result.usedContext).toBe(true);
    expect(result.items[0]?.itemId).toBe("item_c");
  });

  it("falls back to the raw itemId when a label was never recorded", () => {
    const result = selectDesignContextUsage(
      {
        ...baseRecord,
        elementProvenance: [
          {
            elementId: "file_1",
            influence: "reused",
            itemId: "item_d",
            itemVersionId: "v4",
          },
        ],
      },
      new Set(["file_1"]),
    );
    expect(result.items[0]?.label).toBe("item_d");
  });
});
