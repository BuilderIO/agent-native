import { describe, expect, it } from "vitest";

import {
  canDrop,
  canDropOnTemplate,
  itemPath,
  mappedValue,
  nodePath,
} from "./drop-paths";
import { validatePath } from "./engine.js";

describe("itemPath", () => {
  it("writes dots for names and brackets for indexes, as deep as the value goes", () => {
    expect(itemPath(["title"])).toBe("item.title");
    expect(itemPath(["thread", "number"])).toBe("item.thread.number");
    expect(itemPath(["extras", "price"])).toBe("item.extras.price");
    expect(itemPath(["extras", "tags", 0])).toBe("item.extras.tags[0]");
    expect(itemPath(["extras", "rows", 2, "name"])).toBe(
      "item.extras.rows[2].name",
    );
  });

  it("returns null for a key the path grammar cannot spell", () => {
    expect(itemPath(["extras", "first name"])).toBeNull();
    expect(itemPath(["extras", "it's"])).toBeNull();
    expect(itemPath(["extras", "a.b"])).toBeNull();
    expect(itemPath(["extras", "1st"])).toBeNull();
    expect(itemPath(["extras", "constructor"])).toBeNull();
  });

  it("returns null for a path past the length limit, and every path it returns reads", () => {
    expect(itemPath(["extras", "k".repeat(200)])).toBeNull();
    const path = itemPath(["extras", "rows", 0, "name"]);
    expect(path && validatePath(path).ok).toBe(true);
  });
});

describe("nodePath", () => {
  it("reads another node's result by its identifier", () => {
    expect(nodePath("fetch", ["extras", "price"])).toBe(
      "nodes.fetch.extras.price",
    );
  });

  it("returns null for an identifier the path grammar cannot spell", () => {
    expect(nodePath("Fetch step", ["title"])).toBeNull();
    expect(nodePath("a.b", ["title"])).toBeNull();
  });
});

describe("mappedValue", () => {
  it("replaces a path field with the path", () => {
    expect(mappedValue("path", "item.title", "item.author")).toBe(
      "item.author",
    );
  });

  it("writes a hole into an empty template, with no leading space", () => {
    expect(mappedValue("template", "", "item.author")).toBe(
      "{{ item.author }}",
    );
  });

  it("appends a hole after a space to a template that has text", () => {
    expect(mappedValue("template", "New reply from", "item.author")).toBe(
      "New reply from {{ item.author }}",
    );
    expect(mappedValue("template", "{{ item.author }}", "item.title")).toBe(
      "{{ item.author }} {{ item.title }}",
    );
  });

  it("does not double a space the template already ends with", () => {
    expect(mappedValue("template", "Hi ", "item.author")).toBe(
      "Hi {{ item.author }}",
    );
  });
});

describe("canDropOnTemplate", () => {
  it("takes text, numbers, true or false, and a preview value no run has produced", () => {
    expect(canDropOnTemplate("text")).toBe(true);
    expect(canDropOnTemplate("number")).toBe(true);
    expect(canDropOnTemplate("boolean")).toBe(true);
    expect(canDropOnTemplate("unknown")).toBe(true);
  });

  it("refuses a list, an object, and a null, which a template cannot render", () => {
    expect(canDropOnTemplate("list")).toBe(false);
    expect(canDropOnTemplate("object")).toBe(false);
    expect(canDropOnTemplate("empty")).toBe(false);
  });
});

describe("canDrop", () => {
  it("lets a path field take a value of every kind", () => {
    for (const kind of [
      "text",
      "number",
      "boolean",
      "list",
      "object",
      "empty",
      "unknown",
    ] as const) {
      expect(canDrop("path", kind)).toBe(true);
    }
  });

  it("applies the template rule to a template field", () => {
    expect(canDrop("template", "object")).toBe(false);
    expect(canDrop("template", "text")).toBe(true);
  });
});
