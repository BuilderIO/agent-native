import { describe, expect, it } from "vitest";

import type { NodeDataStoredItem } from "../../../../server/workflow-host/read-models.js";
import {
  EXTRAS_FIELD_ID,
  schemaLines,
  schemaOf,
  tableColumnsOf,
} from "./node-data-model";

function stored(
  overrides: Partial<NodeDataStoredItem> = {},
): NodeDataStoredItem {
  return {
    itemId: "item-1",
    synthetic: false,
    title: "Hello",
    text: null,
    url: null,
    author: null,
    occurredAt: "2026-10-20T10:00:00.000Z",
    thread: null,
    extras: {},
    truncated: false,
    ...overrides,
  };
}

describe("schemaOf", () => {
  it("merges fields across items, and the first value that is not null wins", () => {
    const schema = schemaOf([
      stored({ text: null, extras: { price: 1 } }),
      stored({
        text: "from the second item",
        extras: { price: 2, tags: ["a", "b"] },
      }),
    ]);
    const text = schema.find((field) => field.label === "text");
    expect(text?.sample).toBe("from the second item");

    const extras = schema.find((field) => field.id === EXTRAS_FIELD_ID);
    expect(extras?.children.map((child) => child.label)).toEqual([
      "price",
      "tags",
    ]);
    expect(extras?.children[0].sample).toBe("1");
    const tags = extras?.children[1];
    expect(tags?.kind).toBe("list");
    expect(tags?.children.map((child) => child.label)).toEqual([
      "tags[0]",
      "tags[1]",
    ]);
    expect(tags?.children[1].segments).toEqual(["extras", "tags", 1]);
  });

  it("lists twenty array elements and counts the rest", () => {
    const tags = Array.from({ length: 25 }, (_, index) => `t${index}`);
    const schema = schemaOf([stored({ extras: { tags } })]);
    const list = schema.find((field) => field.id === EXTRAS_FIELD_ID)
      ?.children[0];
    expect(list?.children).toHaveLength(20);
    expect(list?.more).toBe(5);
  });
});

describe("tableColumnsOf", () => {
  it("lists the fixed fields, then each extras key in the order items first show it", () => {
    const { shown, hidden } = tableColumnsOf([
      stored({ extras: { price: 1 } }),
      stored({ extras: { channel: "x", price: 2 } }),
    ]);
    expect(shown.map((column) => column.label)).toEqual([
      "title",
      "text",
      "url",
      "author",
      "occurredAt",
      "thread",
      "extras.price",
      "extras.channel",
    ]);
    expect(hidden).toBe(0);
  });

  it("shows at most forty columns and counts the rest", () => {
    const extras = Object.fromEntries(
      Array.from({ length: 45 }, (_, index) => [`k${index}`, index]),
    );
    const { shown, hidden } = tableColumnsOf([stored({ extras })]);
    expect(shown).toHaveLength(40);
    expect(hidden).toBe(11);
  });
});

describe("schemaLines", () => {
  it("keeps the branches a search matches, open, and drops the rest", () => {
    const schema = schemaOf([
      stored({ extras: { price: 42, owner: { name: "Ada" } } }),
    ]);
    const lines = schemaLines(schema, new Set(), "ada");
    const labels = lines.flatMap((line) =>
      line.kind === "field" ? [line.field.label] : [],
    );
    expect(labels).toEqual(["extras", "owner", "name"]);
    const extras = lines[0];
    expect(extras.kind === "field" && extras.open).toBe(true);
  });
});
