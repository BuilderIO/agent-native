import { describe, expect, it } from "vitest";

import {
  ExpressionError,
  MAX_PATH_LENGTH,
  collectPaths,
  evaluatePath,
  evaluateTemplate,
  parsePath,
  parseTemplate,
  renderTemplate,
  validatePath,
  validateResponsePath,
  type Scope,
} from "./expressions.js";

const scope: Scope = {
  item: {
    title: "Export button does nothing",
    count: 0,
    flag: false,
    empty: "",
    nothing: null,
    payload: {
      items: [{ name: "first" }, { name: "second" }],
      matrix: [[1, 2]],
    },
    list: [1, 2, 3],
  },
  nodes: { assess: { risk: "low", clearBug: true } },
  settings: { triageOwnerEmail: "owner@example.test", extras: { limit: 40 } },
  run: { windowStart: "2026-10-18T00:00:00Z" },
  loop: { iteration: 2 },
};

function parseError(text: string): ExpressionError {
  try {
    parseTemplate(text);
  } catch (error) {
    if (error instanceof ExpressionError) return error;
    throw error;
  }
  throw new Error(`expected ${JSON.stringify(text)} to be rejected`);
}

function pathError(path: string): ExpressionError {
  const check = validatePath(path);
  if (check.ok)
    throw new Error(`expected ${JSON.stringify(path)} to be rejected`);
  return check.error;
}

describe("paths", () => {
  it("accepts every root with identifiers and integer indexes", () => {
    for (const path of [
      "item",
      "item.title",
      "item.payload.items[0].name",
      "item.payload.matrix[0][1]",
      "nodes.assess.risk",
      "settings.extras.limit",
      "run.windowStart",
      "loop.iteration",
      "item._private",
      "item.a1",
    ]) {
      expect(validatePath(path).ok, path).toBe(true);
    }
  });

  it("parses a path into its root and segments", () => {
    expect(parsePath("item.payload.items[10].name")).toEqual({
      root: "item",
      segments: ["payload", "items", 10, "name"],
    });
  });

  it.each([
    ["a call", "item.upper()", "unexpected_token"],
    ["a call on a root", "item()", "unexpected_token"],
    ["a plus", "item.a + item.b", "unexpected_token"],
    ["a template literal", "`item`", "unexpected_token"],
    ["a quoted key", 'item["title"]', "bad_index"],
    ["a negative index", "item.list[-1]", "bad_index"],
    ["a computed index", "item.list[item.count]", "bad_index"],
    ["an index with a sum", "item.list[1+1]", "bad_index"],
    ["a leading-zero index", "item.list[01]", "bad_index"],
    ["an unclosed bracket", "item.list[0", "bad_index"],
    ["a fractional index", "item.list[1.5]", "bad_index"],
    ["a digit-first field", "item.0", "unexpected_token"],
    ["a trailing dot", "item.", "unexpected_token"],
    ["a double dot", "item..title", "unexpected_token"],
    ["a space in the path", "item .title", "unexpected_token"],
    ["a hyphenated field", "item.first-name", "unexpected_token"],
    ["a unicode field", "item.nombreé", "unexpected_token"],
    ["an empty path", "", "empty_expression"],
    ["padding around the path", " item.title", "unexpected_token"],
    ["a digit-first root", "1item", "unexpected_token"],
  ])("rejects %s", (_name, path, code) => {
    expect(pathError(path).code).toBe(code);
  });

  it.each([
    "env.SECRET",
    "globalThis.process",
    "window.location",
    "this.item",
    "items.title",
    "Item.title",
    "itemx.title",
    "node.assess.risk",
  ])("rejects the unknown root in %s", (path) => {
    const error = pathError(path);
    expect(error.code).toBe("unknown_root");
    expect(error.position).toBe(0);
  });

  it.each([
    "item.__proto__",
    "item.constructor",
    "item.prototype",
    "item.payload.constructor.name",
    "nodes.__proto__",
    "settings.extras.__proto__.polluted",
  ])("rejects the prototype-looking segment in %s", (path) => {
    expect(pathError(path).code).toBe("forbidden_segment");
  });

  it("allows a field that merely contains a reserved word", () => {
    expect(validatePath("item.constructors").ok).toBe(true);
    expect(validatePath("item.prototype_name").ok).toBe(true);
    expect(validatePath("item.__proto").ok).toBe(true);
  });

  it("points at where the path went wrong", () => {
    expect(pathError("item.a + 1").position).toBe(6);
    expect(pathError("item.list[x]").position).toBe(10);
    expect(pathError("item.__proto__").position).toBe(5);
  });

  it("bounds the length of a path", () => {
    const long = `item.${"a".repeat(MAX_PATH_LENGTH)}`;
    expect(pathError(long).code).toBe("path_too_long");
    expect(validatePath(`item.${"a".repeat(MAX_PATH_LENGTH - 5)}`).ok).toBe(
      true,
    );
  });

  it("throws the same typed error from parsePath", () => {
    expect(() => parsePath("item.a()")).toThrow(ExpressionError);
  });
});

describe("response paths", () => {
  it("accepts a rootless path with fields and indexes", () => {
    expect(validateResponsePath("data.items[0].name")).toEqual({
      ok: true,
      path: { segments: ["data", "items", 0, "name"] },
    });
    expect(validateResponsePath("[0].id").ok).toBe(true);
    expect(validateResponsePath("id").ok).toBe(true);
  });

  it("applies the same closed grammar", () => {
    for (const path of [
      "data.fn()",
      "data[x]",
      "data.__proto__",
      "__proto__.x",
      "constructor",
      "",
      "data.a b",
      ".data",
    ]) {
      expect(validateResponsePath(path).ok, path).toBe(false);
    }
  });
});

describe("parseTemplate", () => {
  it("returns plain text as one literal part", () => {
    const template = parseTemplate("No holes here.");
    expect(template.parts).toEqual([{ type: "text", text: "No holes here." }]);
    expect(template.wholeValue).toBe(false);
    expect(collectPaths(template)).toEqual([]);
  });

  it("splits text and holes in order, with offsets", () => {
    const template = parseTemplate(
      "Hi {{ item.title }}, risk {{nodes.assess.risk}}.",
    );
    expect(template.parts.map((part) => part.type)).toEqual([
      "text",
      "hole",
      "text",
      "hole",
      "text",
    ]);
    const [first, second] = collectPaths(template);
    expect(first).toMatchObject({ path: "item.title", start: 3, end: 19 });
    expect(second).toMatchObject({ path: "nodes.assess.risk", root: "nodes" });
  });

  it("recognises a whole-value hole only when nothing surrounds it", () => {
    expect(parseTemplate("{{ item.count }}").wholeValue).toBe(true);
    expect(parseTemplate(" {{ item.count }}").wholeValue).toBe(false);
    expect(parseTemplate("{{ item.a }}{{ item.b }}").wholeValue).toBe(false);
    expect(parseTemplate("").wholeValue).toBe(false);
  });

  it("accepts an empty string", () => {
    expect(parseTemplate("").parts).toEqual([]);
  });

  it.each([
    ["an unclosed hole", "Hello {{ item.title", "unclosed_hole", 6],
    ["an empty hole", "Hello {{ }}", "empty_expression", 9],
    ["a call", "{{ item.title.toUpperCase() }}", "unexpected_token", 25],
    ["an unknown root", "x {{ env.KEY }}", "unknown_root", 5],
    ["a prototype segment", "{{ item.__proto__ }}", "forbidden_segment", 8],
    [
      "a constructor segment",
      "{{ item.constructor.name }}",
      "forbidden_segment",
      8,
    ],
    ["a nested hole", "{{ {{ item.a }} }}", "unexpected_token", 3],
    ["a triple brace", "{{{ item.a }}}", "unexpected_token", 2],
    ["a filter pipe", "{{ item.title | upper }}", "unexpected_token", 13],
  ])("rejects %s", (_name, text, code, position) => {
    const error = parseError(text);
    expect(error.code).toBe(code);
    expect(error.position).toBe(position);
  });

  it("treats a lone brace or a stray closing pair as literal text", () => {
    expect(parseTemplate("a { b } c }}").parts).toEqual([
      { type: "text", text: "a { b } c }}" },
    ]);
  });
});

describe("evaluatePath", () => {
  it("returns the value it finds", () => {
    expect(evaluatePath("item.title", scope)).toEqual({
      found: true,
      value: "Export button does nothing",
    });
    expect(evaluatePath("item.payload.items[1].name", scope)).toEqual({
      found: true,
      value: "second",
    });
    expect(evaluatePath("item.payload.matrix[0][1]", scope)).toEqual({
      found: true,
      value: 2,
    });
    expect(evaluatePath("nodes.assess.risk", scope)).toEqual({
      found: true,
      value: "low",
    });
    expect(evaluatePath("settings.extras.limit", scope)).toEqual({
      found: true,
      value: 40,
    });
    expect(evaluatePath("loop.iteration", scope)).toEqual({
      found: true,
      value: 2,
    });
  });

  it("tells a stored null, empty string, zero and false apart from missing", () => {
    expect(evaluatePath("item.nothing", scope)).toEqual({
      found: true,
      value: null,
    });
    expect(evaluatePath("item.empty", scope)).toEqual({
      found: true,
      value: "",
    });
    expect(evaluatePath("item.count", scope)).toEqual({
      found: true,
      value: 0,
    });
    expect(evaluatePath("item.flag", scope)).toEqual({
      found: true,
      value: false,
    });
    expect(evaluatePath("item.absent", scope)).toEqual({ found: false });
  });

  it("never turns a missing value into null or an empty string", () => {
    const missing = evaluatePath("item.absent", scope);
    expect(missing).toEqual({ found: false });
    expect("value" in missing).toBe(false);
  });

  it("reports missing for every way a walk can fall off the data", () => {
    for (const path of [
      "item.payload.nope.deeper",
      "item.nothing.field",
      "item.title.length",
      "item.list[3]",
      "item.title[0]",
      "nodes.ghost.risk",
      "loop.nothingYet",
      "run.windowEnd",
    ]) {
      expect(evaluatePath(path, scope), path).toEqual({ found: false });
    }
  });

  it("reads only own properties", () => {
    expect(evaluatePath("item.toString", scope)).toEqual({ found: false });
    expect(evaluatePath("item.hasOwnProperty", scope)).toEqual({
      found: false,
    });
    expect(evaluatePath("item.list.length", scope)).toEqual({ found: false });
    expect(evaluatePath("item.list.map", scope)).toEqual({ found: false });
  });

  it("reports an absent root as missing", () => {
    expect(evaluatePath("item.title", { ...scope, item: undefined })).toEqual({
      found: false,
    });
    expect(evaluatePath("loop.iteration", { ...scope, loop: {} })).toEqual({
      found: false,
    });
  });

  it("returns a root whole when the path is just the root", () => {
    expect(evaluatePath("settings", scope)).toEqual({
      found: true,
      value: scope.settings,
    });
  });

  it("treats an explicit undefined as missing, since JSON cannot hold it", () => {
    expect(
      evaluatePath("item.a", { ...scope, item: { a: undefined } }),
    ).toEqual({ found: false });
  });

  it("throws on a malformed path instead of calling it missing", () => {
    expect(() => evaluatePath("item.a()", scope)).toThrow(ExpressionError);
    expect(() => evaluatePath("item.__proto__", scope)).toThrow(
      ExpressionError,
    );
  });

  it("does not read through a prototype even for data that has the key", () => {
    const polluted = JSON.parse('{"__proto__": {"admin": true}}') as unknown;
    expect(() =>
      evaluatePath("item.__proto__.admin", { ...scope, item: polluted }),
    ).toThrow(ExpressionError);
    expect(evaluatePath("item.admin", { ...scope, item: polluted })).toEqual({
      found: false,
    });
  });
});

describe("renderTemplate", () => {
  it("fills holes with strings, numbers and booleans", () => {
    expect(
      renderTemplate(
        "{{ item.title }}: {{ item.count }} / {{ item.flag }} / {{ nodes.assess.risk }}",
        scope,
      ),
    ).toEqual({
      ok: true,
      value: "Export button does nothing: 0 / false / low",
    });
  });

  it("renders an empty string that was really stored", () => {
    expect(renderTemplate("[{{ item.empty }}]", scope)).toEqual({
      ok: true,
      value: "[]",
    });
  });

  it("returns text with no holes unchanged", () => {
    expect(renderTemplate("plain", scope)).toEqual({
      ok: true,
      value: "plain",
    });
  });

  it("returns a typed error naming the path when a hole is missing", () => {
    const result = renderTemplate("Hello {{ item.absent }}!", scope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(ExpressionError);
      expect(result.error.code).toBe("missing_value");
      expect(result.error.path).toBe("item.absent");
      expect(result.error.position).toBe(6);
    }
  });

  it("fails on the first missing hole even when others are present", () => {
    const result = renderTemplate(
      "{{ item.title }} {{ nodes.ghost.x }}",
      scope,
    );
    expect(result.ok).toBe(false);
  });

  it("refuses to render null, a list or an object into text", () => {
    for (const path of ["item.nothing", "item.list", "item.payload"]) {
      const result = renderTemplate(`value: {{ ${path} }}`, scope);
      expect(result.ok, path).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("not_renderable");
    }
  });

  it("returns a parse failure as a typed error, not an exception", () => {
    const result = renderTemplate("{{ item.fn() }}", scope);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unexpected_token");
  });

  it("accepts an already parsed template", () => {
    expect(
      renderTemplate(parseTemplate("{{ loop.iteration }}"), scope),
    ).toEqual({
      ok: true,
      value: "2",
    });
  });
});

describe("evaluateTemplate", () => {
  it("keeps the type of a whole-value hole", () => {
    expect(evaluateTemplate("{{ item.count }}", scope)).toEqual({
      ok: true,
      value: 0,
    });
    expect(evaluateTemplate("{{ item.list }}", scope)).toEqual({
      ok: true,
      value: [1, 2, 3],
    });
    expect(evaluateTemplate("{{ item.nothing }}", scope)).toEqual({
      ok: true,
      value: null,
    });
    expect(evaluateTemplate("{{ settings.extras.limit }}", scope)).toEqual({
      ok: true,
      value: 40,
    });
  });

  it("renders to a string when text surrounds the hole", () => {
    expect(evaluateTemplate("n={{ item.count }}", scope)).toEqual({
      ok: true,
      value: "n=0",
    });
  });

  it("reports a missing whole-value hole", () => {
    const result = evaluateTemplate("{{ item.absent }}", scope);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("missing_value");
  });

  it("returns literal text as it is", () => {
    expect(evaluateTemplate("no holes", scope)).toEqual({
      ok: true,
      value: "no holes",
    });
  });
});

describe("collectPaths", () => {
  it("lists every hole for validation and the field picker", () => {
    expect(
      collectPaths(
        "{{ item.title }} {{ nodes.assess.risk }} {{ item.title }}",
      ).map((hole) => hole.path),
    ).toEqual(["item.title", "nodes.assess.risk", "item.title"]);
  });

  it("parses text that is not yet a template, and throws on a bad one", () => {
    expect(collectPaths("no holes")).toEqual([]);
    expect(() => collectPaths("{{ item.x ")).toThrow(ExpressionError);
  });
});
