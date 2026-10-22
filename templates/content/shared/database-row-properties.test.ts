import { describe, expect, it } from "vitest";

import type {
  ContentDatabaseItem,
  DocumentProperty,
  DocumentPropertyDefinition,
} from "./api";
import {
  compactContentDatabaseItems,
  compactContentDatabaseResponse,
  contentDatabaseRowsNeedDefinitions,
  hydrateContentDatabaseItems,
  hydrateContentDatabaseResponse,
} from "./database-row-properties";

function definition(
  id: string,
  type: DocumentPropertyDefinition["type"],
  options: DocumentPropertyDefinition["options"] = {},
): DocumentPropertyDefinition {
  return {
    id,
    databaseId: "database-1",
    name: id,
    type,
    visibility: "always_show",
    options,
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const statusDefinition = definition("status", "select", {
  options: [
    { id: "draft", name: "Draft", color: "gray" },
    { id: "live", name: "Live", color: "green" },
  ],
});
const dateDefinition = definition("date", "date");

const schema: DocumentProperty[] = [
  { definition: statusDefinition, value: null, editable: true },
  { definition: dateDefinition, value: null, editable: true },
];

function item(
  id: string,
  status: string,
  options: { editable?: boolean } = {},
): ContentDatabaseItem {
  return {
    id: `item-${id}`,
    databaseId: "database-1",
    position: 0,
    document: {
      id,
      parentId: "database-page",
      title: id,
      content: "",
      icon: null,
      position: 0,
      isFavorite: false,
      hideFromSearch: false,
      visibility: "private",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    properties: [
      {
        definition: { ...statusDefinition },
        value: status,
        editable: options.editable ?? true,
      },
      {
        definition: { ...dateDefinition },
        value: { start: "2026-02-01", includeTime: false },
        editable: true,
      },
    ],
  };
}

describe("content database row properties", () => {
  it("sends each row's values without their definitions", () => {
    const [row] = compactContentDatabaseItems([item("one", "draft")]);

    expect(row!.properties).toEqual([
      { propertyId: "status", value: "draft", editable: true },
      {
        propertyId: "date",
        value: { start: "2026-02-01", includeTime: false },
        editable: true,
      },
    ]);
    expect(JSON.stringify(row)).not.toContain("Draft");
  });

  it("gives every row the read's one definition per Property", () => {
    const rows = [item("one", "draft"), item("two", "live")];

    const hydrated = hydrateContentDatabaseItems(
      compactContentDatabaseItems(rows),
      schema,
    );

    expect(hydrated).toEqual(rows);
    expect(hydrated[0]!.properties[0]!.definition).toBe(statusDefinition);
    expect(hydrated[1]!.properties[0]!.definition).toBe(statusDefinition);
  });

  it("keeps values that vary by row, such as whether a cell is editable", () => {
    const [hydrated] = hydrateContentDatabaseItems(
      compactContentDatabaseItems([item("one", "draft", { editable: false })]),
      schema,
    );

    expect(hydrated!.properties[0]).toEqual({
      definition: statusDefinition,
      value: "draft",
      editable: false,
    });
  });

  it("passes through rows that already carry their definitions", () => {
    const row = item("one", "draft");

    expect(hydrateContentDatabaseItems([row], schema)[0]).toBe(row);
  });

  it("leaves out a value whose Property the read does not describe", () => {
    const [hydrated] = hydrateContentDatabaseItems(
      compactContentDatabaseItems([item("one", "draft")]),
      [schema[1]!],
    );

    expect(
      hydrated!.properties.map((property) => property.definition.id),
    ).toEqual(["date"]);
  });

  it("hydrates the created and duplicated rows a write returns", () => {
    const created = item("created", "draft");
    const duplicated = item("copy", "live");

    const response = hydrateContentDatabaseResponse({
      items: compactContentDatabaseItems([created, duplicated]),
      properties: schema,
      createdItem: compactContentDatabaseItems([created])[0],
      duplicatedItems: compactContentDatabaseItems([duplicated]),
    });

    expect(response.items).toEqual([created, duplicated]);
    expect(response.createdItem).toEqual(created);
    expect(response.duplicatedItems).toEqual([duplicated]);
  });

  it("compacts every row a write returns and keeps its other fields", () => {
    const created = item("created", "draft");
    const duplicated = item("copy", "live");
    const write = {
      items: [created, duplicated],
      properties: schema,
      createdItem: created,
      duplicatedItems: [duplicated],
      duplicatedItemId: duplicated.id,
    };

    const compacted = compactContentDatabaseResponse(write);

    expect(
      contentDatabaseRowsNeedDefinitions([
        ...compacted.items,
        compacted.createdItem,
        ...(compacted.duplicatedItems ?? []),
      ]),
    ).toBe(true);
    expect(JSON.stringify(compacted.items)).not.toContain('"definition"');
    expect(compacted.duplicatedItemId).toBe(duplicated.id);
    expect(compacted.properties).toBe(schema);
    expect(hydrateContentDatabaseResponse(compacted)).toEqual(write);
  });

  it("tells compact rows from rows that need nothing", () => {
    const row = item("one", "draft");

    expect(
      contentDatabaseRowsNeedDefinitions(compactContentDatabaseItems([row])),
    ).toBe(true);
    expect(contentDatabaseRowsNeedDefinitions([row])).toBe(false);
    expect(
      contentDatabaseRowsNeedDefinitions([null, {}, { properties: [null] }]),
    ).toBe(false);
  });
});
