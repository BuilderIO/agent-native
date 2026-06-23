import { describe, expect, it } from "vitest";
import { blockFieldsFromProperties } from "./DocumentBlockFields";
import type { DocumentProperty } from "@shared/api";

function property(
  partial: Partial<DocumentProperty["definition"]> & {
    id: string;
    type: DocumentProperty["definition"]["type"];
  },
): DocumentProperty {
  return {
    definition: {
      databaseId: "db-1",
      name: partial.name ?? partial.id,
      visibility: "always_show",
      options: partial.options ?? {},
      position: partial.position ?? 0,
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: "2026-06-08T00:00:00.000Z",
      ...partial,
    },
    value: "",
    editable: true,
  };
}

describe("blockFieldsFromProperties", () => {
  it("keeps only Blocks fields, sorted by position", () => {
    const properties = [
      property({ id: "title", type: "text", position: 0 }),
      property({
        id: "outline",
        type: "blocks",
        position: 2,
        options: { blocks: { primary: false } },
      }),
      property({ id: "status", type: "status", position: 1 }),
      property({
        id: "content",
        type: "blocks",
        position: 1,
        options: { blocks: { primary: true } },
      }),
    ];

    const blockFields = blockFieldsFromProperties(properties);
    expect(blockFields.map((field) => field.definition.id)).toEqual([
      "content",
      "outline",
    ]);
  });

  it("returns an empty list when there are no Blocks fields", () => {
    const properties = [
      property({ id: "title", type: "text", position: 0 }),
      property({ id: "status", type: "status", position: 1 }),
    ];
    expect(blockFieldsFromProperties(properties)).toEqual([]);
  });
});
