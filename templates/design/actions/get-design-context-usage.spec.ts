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

  it("confirms no context was used when the matched entry is net-new", () => {
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

  it("is unknown, not confirmed-empty, when the record has no entry for this file", () => {
    const result = selectDesignContextUsage(
      {
        ...baseRecord,
        elementProvenance: [
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
    expect(result).toEqual({
      available: false,
      usedContext: false,
      items: [],
    });
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
});
