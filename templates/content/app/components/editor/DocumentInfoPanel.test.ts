import type { DocumentProperty } from "@shared/api";
import { describe, expect, it } from "vitest";

import { documentInfoBlockFields } from "./DocumentInfoPanel";

function blocksProperty(args: {
  id: string;
  name: string;
  position: number;
  primary?: boolean;
  value: string;
}): DocumentProperty {
  return {
    definition: {
      id: args.id,
      databaseId: "database",
      systemRole: null,
      name: args.name,
      type: "blocks",
      description: "",
      visibility: "always_show",
      options: { blocks: { primary: args.primary === true } },
      position: args.position,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    value: args.value,
    editable: true,
  };
}

describe("documentInfoBlockFields", () => {
  it("describes a standalone Page as one primary Content field", () => {
    expect(
      documentInfoBlockFields({
        documentContent: "Current local body",
        properties: null,
      }),
    ).toEqual([
      {
        propertyId: null,
        name: "Content",
        content: "Current local body",
      },
    ]);
  });

  it("orders database Blocks fields and keeps their contents isolated", () => {
    const fields = documentInfoBlockFields({
      documentContent: "Current primary body",
      properties: [
        blocksProperty({
          id: "notes",
          name: "Research notes",
          position: 2,
          value: "Stored notes",
        }),
        blocksProperty({
          id: "content",
          name: "Content",
          position: 1,
          primary: true,
          value: "Stale primary body",
        }),
      ],
      additionalBlockContents: { notes: "Unsaved local notes" },
    });

    expect(fields).toEqual([
      {
        propertyId: "content",
        name: "Content",
        content: "Current primary body",
      },
      {
        propertyId: "notes",
        name: "Research notes",
        content: "Unsaved local notes",
      },
    ]);
  });
});
