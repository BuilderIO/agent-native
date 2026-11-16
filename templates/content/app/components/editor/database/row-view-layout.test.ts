import type { DocumentProperty } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  databaseRowPropertyLayout,
  databaseRowPropertyOrder,
} from "./row-view-layout";

function property(id: string): DocumentProperty {
  return { definition: { id } } as DocumentProperty;
}

function ids(properties: DocumentProperty[]) {
  return properties.map((candidate) => candidate.definition.id);
}

const page = ["a", "b", "c", "d"].map(property);

describe("databaseRowPropertyLayout", () => {
  it("lists every Property in the page's own order without a view", () => {
    for (const view of [null, undefined]) {
      const layout = databaseRowPropertyLayout(page, view);
      expect(ids(layout.listed)).toEqual(["a", "b", "c", "d"]);
      expect(layout.hiddenInView).toEqual([]);
    }
  });

  it("follows a table's columns left to right", () => {
    const layout = databaseRowPropertyLayout(page, {
      type: "table",
      tableColumnOrderIds: ["c", "name", "a", "d", "b"],
    });
    expect(ids(layout.listed)).toEqual(["c", "a", "d", "b"]);
  });

  it("puts a column the table hasn't placed where the table draws it", () => {
    const layout = databaseRowPropertyLayout(page, {
      type: "table",
      propertyOrderIds: ["d"],
      tableColumnOrderIds: ["b"],
    });
    expect(ids(layout.listed)).toEqual(["b", "d", "a", "c"]);
  });

  it.each(["board", "list", "gallery", "calendar", "timeline"] as const)(
    "follows a %s view's property order, not a table order",
    (type) => {
      const layout = databaseRowPropertyLayout(page, {
        type,
        propertyOrderIds: ["c", "a"],
        tableColumnOrderIds: ["d", "b"],
      });
      expect(ids(layout.listed)).toEqual(["c", "a", "b", "d"]);
    },
  );

  it("holds out the Properties the view hides, in the view's order", () => {
    const layout = databaseRowPropertyLayout(page, {
      type: "table",
      tableColumnOrderIds: ["d", "c", "b", "a"],
      hiddenPropertyIds: ["a", "c"],
    });
    expect(ids(layout.listed)).toEqual(["d", "b"]);
    expect(ids(layout.hiddenInView)).toEqual(["c", "a"]);
  });

  it("ignores ids that name no Property", () => {
    const layout = databaseRowPropertyLayout(page, {
      type: "board",
      propertyOrderIds: ["gone", "b", "b"],
      hiddenPropertyIds: ["also-gone"],
    });
    expect(ids(layout.listed)).toEqual(["b", "a", "c", "d"]);
    expect(layout.hiddenInView).toEqual([]);
  });
});

describe("databaseRowPropertyOrder", () => {
  it("keeps listed Properties ahead of the ones the view hides", () => {
    expect(
      ids(
        databaseRowPropertyOrder(page, {
          type: "board",
          propertyOrderIds: ["d", "c", "b", "a"],
          hiddenPropertyIds: ["c"],
        }),
      ),
    ).toEqual(["d", "b", "a", "c"]);
  });
});
