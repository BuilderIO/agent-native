// @vitest-environment happy-dom

import { tableCollectionSeedSchema } from "@shared/table-collection-seed";
import { getSchema } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import {
  findUnchangedTable,
  tableCollectionSeed,
  tableFitsCollection,
} from "./table-collection";
import { createVisualEditorExtensions } from "./VisualEditor";

const schema = getSchema(createVisualEditorExtensions());

// "h:Name" is a header cell, "Name" a plain one.
function cell(spec: string, attrs: Record<string, unknown> = {}) {
  const header = spec.startsWith("h:");
  const text = header ? spec.slice(2) : spec;
  return schema.node(
    header ? "tableHeader" : "tableCell",
    attrs,
    schema.node("paragraph", null, text ? schema.text(text) : undefined),
  );
}

function table(rows: (string | ProseMirrorNode)[][]) {
  return schema.node(
    "table",
    null,
    rows.map((row) =>
      schema.node(
        "tableRow",
        null,
        row.map((spec) => (typeof spec === "string" ? cell(spec) : spec)),
      ),
    ),
  );
}

describe("tableCollectionSeed", () => {
  it("titles rows by the first column and names properties by the header row", () => {
    const seed = tableCollectionSeed(
      table([
        ["h:Task", "h:Owner", "h:Due"],
        ["Write brief", "Ana", "Monday"],
        ["Review", "", "Friday"],
      ]),
    );
    expect(seed).toEqual({
      properties: ["Owner", "Due"],
      rows: [
        ["Write brief", "Ana", "Monday"],
        ["Review", "", "Friday"],
      ],
    });
    expect(tableCollectionSeedSchema.parse(seed)).toEqual(seed);
  });

  it("keeps every row and names properties by column without a header row", () => {
    const seed = tableCollectionSeed(
      table([
        ["Alpha", "1"],
        ["Beta", "2"],
      ]),
    );
    expect(seed).toEqual({
      properties: ["Column 2"],
      rows: [
        ["Alpha", "1"],
        ["Beta", "2"],
      ],
    });
  });

  it("names a blank header for its column and tells repeated names apart", () => {
    const seed = tableCollectionSeed(
      table([
        ["h:Name", "h:", "h:Notes", "h:notes"],
        ["One", "a", "b", "c"],
      ]),
    );
    expect(seed.properties).toEqual(["Column 2", "Notes", "notes 2"]);
  });

  it("keeps a cell's lines, and puts a title on one line", () => {
    const multiline = schema.node("tableCell", null, [
      schema.node("paragraph", null, [
        schema.text("First"),
        schema.node("hardBreak"),
        schema.text("second"),
      ]),
      schema.node("paragraph", null, schema.text("Third")),
    ]);
    const seed = tableCollectionSeed(table([[multiline, multiline]]));
    expect(seed.rows).toEqual([["First second Third", "First\nsecond\nThird"]]);
  });

  it("puts a merged cell's text in its first row and column only", () => {
    const seed = tableCollectionSeed(
      table([
        ["h:Item", "h:Q1", "h:Q2"],
        ["Rent", cell("Same", { colspan: 2 })],
        [cell("Shared", { rowspan: 2 }), "1", "2"],
        ["3", "4"],
      ]),
    );
    expect(seed.rows).toEqual([
      ["Rent", "Same", ""],
      ["Shared", "1", "2"],
      ["", "3", "4"],
    ]);
  });

  it("gives a header-only table no rows", () => {
    expect(tableCollectionSeed(table([["h:Name", "h:Status"]]))).toEqual({
      properties: ["Status"],
      rows: [],
    });
  });
});

describe("tableFitsCollection", () => {
  it("takes up to 500 rows under a header and 50 columns", () => {
    const rows = (count: number, width = 2) =>
      Array.from({ length: count }, (_, row) =>
        Array.from({ length: width }, (_, column) => `${row}-${column}`),
      );
    expect(tableFitsCollection(table([["h:A", "h:B"], ...rows(500)]))).toBe(
      true,
    );
    expect(tableFitsCollection(table(rows(501)))).toBe(false);
    expect(tableFitsCollection(table(rows(1, 50)))).toBe(true);
    expect(tableFitsCollection(table(rows(1, 51)))).toBe(false);
  });
});

describe("findUnchangedTable", () => {
  const original = table([
    ["h:Name", "h:Status"],
    ["One", "Done"],
  ]);
  const paragraph = (text: string) =>
    schema.node("paragraph", null, schema.text(text));

  it("finds the table after text above it moved it", () => {
    const before = schema.node("doc", null, [paragraph("Hi"), original]);
    const after = schema.node("doc", null, [
      paragraph("Hello there"),
      original,
    ]);
    const pos = before.child(0).nodeSize;
    expect(findUnchangedTable(after, { node: original, pos })).toEqual({
      node: original,
      pos: after.child(0).nodeSize,
    });
  });

  it("lets go of a table someone changed", () => {
    const edited = table([
      ["h:Name", "h:Status"],
      ["One", "Done!"],
    ]);
    const doc = schema.node("doc", null, [paragraph("Hi"), edited]);
    expect(
      findUnchangedTable(doc, { node: original, pos: doc.child(0).nodeSize }),
    ).toBeNull();
  });

  it("picks the copy nearest where the table was", () => {
    const doc = schema.node("doc", null, [
      original,
      paragraph("Between"),
      original,
    ]);
    const second = original.nodeSize + doc.child(1).nodeSize;
    expect(
      findUnchangedTable(doc, { node: original, pos: second - 2 }),
    ).toEqual({ node: original, pos: second });
  });
});
