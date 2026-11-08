import { describe, expect, it } from "vitest";

import {
  MAX_MISSING_REPORT_CHARS,
  keepFields,
  parseFieldsToKeep,
  reportMissing,
  type FieldsToKeep,
} from "./fields-to-keep.js";

function keep(...paths: string[]): FieldsToKeep {
  const parsed = parseFieldsToKeep(paths);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

function refusal(value: unknown): string {
  const parsed = parseFieldsToKeep(value);
  if (parsed.ok) throw new Error("expected a refusal");
  return parsed.message;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

describe("parseFieldsToKeep", () => {
  it("accepts dotted paths and trims each one", () => {
    const parsed = parseFieldsToKeep(["number", "  user.login  ", "a.b.c"]);
    expect(parsed).toEqual({
      ok: true,
      value: {
        paths: ["number", "user.login", "a.b.c"],
        segments: [["number"], ["user", "login"], ["a", "b", "c"]],
      },
    });
  });

  it("accepts spaces, dollar signs and unicode inside a segment", () => {
    const parsed = parseFieldsToKeep([
      "first name",
      "$ref.$id",
      "naïve.日本語",
    ]);
    expect(parsed.ok).toBe(true);
  });

  it("accepts the limits themselves: 50 paths, 8 parts, 64 characters", () => {
    const fifty = Array.from({ length: 50 }, (_unused, index) => `p${index}`);
    expect(parseFieldsToKeep(fifty).ok).toBe(true);
    expect(parseFieldsToKeep(["a.b.c.d.e.f.g.h"]).ok).toBe(true);
    expect(parseFieldsToKeep(["x".repeat(64)]).ok).toBe(true);
  });

  it("refuses a value that is not a list", () => {
    const message = `"fieldsToKeep" must be a list of dotted paths, such as ["number", "user.login"].`;
    expect(refusal("number,title")).toBe(message);
    expect(refusal({ number: true })).toBe(message);
    expect(refusal(null)).toBe(message);
    expect(refusal(undefined)).toBe(message);
    expect(refusal(7)).toBe(message);
  });

  it("refuses an empty list, which should be left out instead", () => {
    expect(refusal([])).toBe(
      `"fieldsToKeep" is empty. Leave it out to keep the whole answer.`,
    );
  });

  it("refuses more than 50 paths", () => {
    const many = Array.from({ length: 51 }, (_unused, index) => `p${index}`);
    expect(refusal(many)).toBe(`"fieldsToKeep" has more than 50 paths.`);
  });

  it("refuses an entry that is not text", () => {
    expect(refusal(["number", 5])).toBe(
      `"fieldsToKeep" has an entry that is not text.`,
    );
    expect(refusal([null])).toBe(
      `"fieldsToKeep" has an entry that is not text.`,
    );
    expect(refusal([["a"]])).toBe(
      `"fieldsToKeep" has an entry that is not text.`,
    );
  });

  it("refuses an empty path or an empty part, naming the path", () => {
    expect(refusal([""])).toBe(`The path "" has an empty part.`);
    expect(refusal(["   "])).toBe(`The path "" has an empty part.`);
    expect(refusal(["a..b"])).toBe(`The path "a..b" has an empty part.`);
    expect(refusal([".a"])).toBe(`The path ".a" has an empty part.`);
    expect(refusal(["a."])).toBe(`The path "a." has an empty part.`);
  });

  it("refuses a part longer than 64 characters", () => {
    const long = "x".repeat(65);
    expect(refusal([`a.${long}`])).toBe(
      `The path "a.${long}" has a part longer than 64 characters.`,
    );
  });

  it("refuses a control character, shown as a question mark", () => {
    expect(refusal(["a\u0000b"])).toBe(
      `The path "a?b" has a control character.`,
    );
    expect(refusal(["a.b\u007f"])).toBe(
      `The path "a.b?" has a control character.`,
    );
    expect(refusal(["a\u0085b"])).toBe(
      `The path "a?b" has a control character.`,
    );
    expect(refusal(["a\tb"])).toBe(`The path "a?b" has a control character.`);
  });

  it("refuses more than 8 parts", () => {
    expect(refusal(["a.b.c.d.e.f.g.h.i"])).toBe(
      `The path "a.b.c.d.e.f.g.h.i" has more than 8 parts.`,
    );
  });

  it.each(["__proto__", "constructor", "prototype"])(
    "refuses %s as a whole path or as any part of one",
    (name) => {
      const message = (path: string) =>
        `The path "${path}" uses a name that cannot be kept (__proto__, constructor or prototype).`;
      expect(refusal([name])).toBe(message(name));
      expect(refusal([`a.${name}`])).toBe(message(`a.${name}`));
      expect(refusal([`${name}.b`])).toBe(message(`${name}.b`));
    },
  );

  it("allows a name that only contains a forbidden one", () => {
    expect(
      parseFieldsToKeep(["my__proto__", "constructors", "Prototype"]).ok,
    ).toBe(true);
  });

  it("refuses the same path twice, after trimming", () => {
    expect(refusal(["a.b", "c", " a.b "])).toBe(
      `The path "a.b" is listed twice.`,
    );
  });

  it("cuts a long path to 80 characters when it names it", () => {
    expect(refusal(["x".repeat(100)])).toBe(
      `The path "${"x".repeat(80)}…" has a part longer than 64 characters.`,
    );
  });
});

describe("keepFields", () => {
  it("keeps the nested shape of a dotted path", () => {
    const kept = keepFields(
      { number: 7, title: "Fix", user: { login: "ada", id: 1 }, body: "long" },
      keep("number", "user.login"),
    );
    expect(kept.body).toEqual({ number: 7, user: { login: "ada" } });
    expect(kept.missing).toEqual([]);
  });

  it("keeps a whole object, list or scalar when a path ends at it", () => {
    const body = {
      labels: [{ name: "bug", color: "red" }],
      assignee: null,
      draft: false,
      count: 0,
      title: "",
    };
    const kept = keepFields(
      body,
      keep("labels", "assignee", "draft", "count", "title"),
    );
    expect(kept.body).toEqual(body);
    expect(kept.missing).toEqual([]);
  });

  it("treats a top-level list the same way, element by element", () => {
    const kept = keepFields(
      [
        { number: 1, title: "a", user: { login: "x", id: 1 } },
        { number: 2, title: "b", user: { login: "y", id: 2 } },
      ],
      keep("number", "user.login"),
    );
    expect(kept.body).toEqual([
      { number: 1, user: { login: "x" } },
      { number: 2, user: { login: "y" } },
    ]);
    expect(kept.missing).toEqual([]);
  });

  it("maps a segment that meets a list over every element", () => {
    const kept = keepFields(
      {
        items: [
          { id: 1, name: "a", noise: "x" },
          { id: 2, name: "b", noise: "y" },
        ],
        total: 2,
      },
      keep("items.name"),
    );
    expect(kept.body).toEqual({ items: [{ name: "a" }, { name: "b" }] });
  });

  it("maps through lists inside lists", () => {
    const kept = keepFields(
      {
        grid: [[{ v: 1, w: 2 }, { v: 3 }], [{ v: 4, w: 9 }]],
        other: 1,
      },
      keep("grid.v"),
    );
    expect(kept.body).toEqual({ grid: [[{ v: 1 }, { v: 3 }], [{ v: 4 }]] });
    expect(kept.missing).toEqual([]);
  });

  it("maps a list inside an object inside a list, keeping each entry in place", () => {
    const kept = keepFields(
      [
        {
          repo: {
            id: 1,
            labels: [
              { name: "a", color: "r" },
              { name: "b", color: "g" },
            ],
          },
        },
        { repo: { id: 2, labels: [] } },
        { repo: { id: 3, labels: [{ name: "c", color: "b" }] } },
      ],
      keep("repo.labels.name"),
    );
    expect(kept.body).toEqual([
      { repo: { labels: [{ name: "a" }, { name: "b" }] } },
      {},
      { repo: { labels: [{ name: "c" }] } },
    ]);
    expect(kept.missing).toEqual([]);
  });

  it("drops a scalar where an object was expected, without an error", () => {
    const kept = keepFields(
      [{ user: "ada", n: 1 }, { user: { login: "bob" }, n: 2 }, { n: 3 }],
      keep("user.login", "n"),
    );
    expect(kept.body).toEqual([
      { n: 1 },
      { user: { login: "bob" }, n: 2 },
      { n: 3 },
    ]);
    expect(kept.missing).toEqual([]);
  });

  it("drops a scalar inside a list that was meant to hold objects", () => {
    const kept = keepFields([1, { a: 2, b: 3 }, "x", null], keep("a"));
    expect(kept.body).toEqual([{ a: 2 }]);
  });

  it("names a path that matched nothing anywhere", () => {
    const kept = keepFields(
      { number: 1, user: { login: "ada" } },
      keep("number", "usr.login", "user.name"),
    );
    expect(kept.body).toEqual({ number: 1 });
    expect(kept.missing).toEqual(["usr.login", "user.name"]);
  });

  it("counts a path as matched when it matched in some entries only", () => {
    const kept = keepFields([{ a: 1 }, { b: 2 }], keep("a", "b", "c"));
    expect(kept.body).toEqual([{ a: 1 }, { b: 2 }]);
    expect(kept.missing).toEqual(["c"]);
  });

  it("returns a list that matched nothing as a list, and every path as missing", () => {
    const kept = keepFields([{ a: 1 }, { a: 2 }], keep("x", "y.z"));
    expect(kept.body).toEqual([{}, {}]);
    expect(kept.missing).toEqual(["x", "y.z"]);
  });

  it("returns an object that matched nothing as an empty object", () => {
    const kept = keepFields({ a: 1 }, keep("x"));
    expect(kept.body).toEqual({});
    expect(kept.missing).toEqual(["x"]);
  });

  it("lets the broader of two overlapping paths win, in either order", () => {
    const body = { user: { login: "ada", id: 1, plan: { name: "pro" } }, n: 1 };
    for (const order of [
      ["user", "user.login"],
      ["user.login", "user"],
      ["user.plan.name", "user.login", "user"],
    ]) {
      const kept = keepFields(body, keep(...order));
      expect(kept.body).toEqual({ user: body.user });
      expect(kept.missing).toEqual([]);
    }
  });

  it("counts a narrower path inside a broader one as matched, and both as missing when the broader is absent", () => {
    const withUser = keepFields(
      { user: { login: "ada" } },
      keep("user", "user.logn"),
    );
    expect(withUser.missing).toEqual([]);
    const withoutUser = keepFields({ n: 1 }, keep("user", "user.login"));
    expect(withoutUser.missing).toEqual(["user", "user.login"]);
  });

  it("keeps keys with spaces, dollar signs and unicode", () => {
    const body = {
      "first name": 1,
      $ref: 2,
      naïve: 3,
      日本: { 語: 4, 他: 5 },
      pad: { " lead": 6, "trail ": 7 },
    };
    const kept = keepFields(
      body,
      keep("first name", "$ref", "naïve", "日本.語", "pad. lead"),
    );
    expect(kept.body).toEqual({
      "first name": 1,
      $ref: 2,
      naïve: 3,
      日本: { 語: 4 },
      pad: { " lead": 6 },
    });
    expect(kept.missing).toEqual([]);
  });

  it("keeps the provider's key order, not the order of the paths", () => {
    const kept = keepFields({ a: 1, b: 2, c: 3 }, keep("c", "a"));
    expect(Object.keys(kept.body as object)).toEqual(["a", "c"]);
  });

  it("reads only a body's own keys, never an inherited one", () => {
    const kept = keepFields({ a: 1 }, keep("toString", "hasOwnProperty", "a"));
    expect(kept.body).toEqual({ a: 1 });
    expect(kept.missing).toEqual(["toString", "hasOwnProperty"]);
  });

  it("returns a body that is neither an object nor a list as it was, with every path missing", () => {
    for (const body of ["text", 5, true, null, undefined]) {
      const kept = keepFields(body, keep("a", "b.c"));
      expect(kept.body).toBe(body);
      expect(kept.missing).toEqual(["a", "b.c"]);
    }
  });

  it("never changes its input", () => {
    const body = deepFreeze({
      number: 1,
      user: { login: "ada", id: 1 },
      items: [{ name: "a", extra: 1 }, [{ name: "b" }]],
    });
    const before = JSON.stringify(body);
    const kept = keepFields(body, keep("number", "user", "items.name", "nope"));
    expect(JSON.stringify(body)).toBe(before);
    expect(kept.body).toEqual({
      number: 1,
      user: { login: "ada", id: 1 },
      items: [{ name: "a" }, [{ name: "b" }]],
    });
    expect(kept.missing).toEqual(["nope"]);
  });

  it("adds no key the paths did not name, and builds plain objects", () => {
    const polluted = JSON.parse(
      '{"__proto__": {"polluted": true}, "a": 1, "b": {"__proto__": {"x": 1}, "c": 2}}',
    ) as Record<string, unknown>;
    const kept = keepFields(polluted, keep("a", "b.c"));
    expect(kept.body).toEqual({ a: 1, b: { c: 2 } });
    const out = kept.body as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.keys(out)).toEqual(["a", "b"]);
    expect(Object.getPrototypeOf(out.b)).toBe(Object.prototype);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("copies the value of a whole-kept key by reference, including its own odd keys", () => {
    const inner = JSON.parse('{"__proto__": {"x": 1}, "y": 2}') as object;
    const kept = keepFields({ inner }, keep("inner"));
    expect((kept.body as { inner: unknown }).inner).toBe(inner);
  });

  it("answers 50 paths over a 2 MiB body quickly", () => {
    const entry = (index: number) => ({
      id: index,
      title: `title ${index}`,
      user: { login: `user${index}`, id: index, bio: "b".repeat(300) },
      labels: [{ name: "bug", color: "red", description: "d".repeat(200) }],
      body: "z".repeat(500),
      extra: { a: 1, b: [1, 2, 3], c: "c".repeat(100) },
    });
    const body = Array.from({ length: 1_700 }, (_unused, index) =>
      entry(index),
    );
    expect(JSON.stringify(body).length).toBeGreaterThan(1.9 * 1024 * 1024);
    const paths = [
      "id",
      "title",
      "user.login",
      "user.id",
      "labels.name",
      ...Array.from(
        { length: 45 },
        (_unused, index) => `missing${index}.deep.path`,
      ),
    ];
    const started = performance.now();
    const kept = keepFields(body, keep(...paths));
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(1_000);
    expect(kept.missing).toHaveLength(45);
    const list = kept.body as { id: number; user: { login: string } }[];
    expect(list).toHaveLength(1_700);
    expect(list[list.length - 1]).toEqual({
      id: 1_699,
      title: "title 1699",
      user: { login: "user1699", id: 1_699 },
      labels: [{ name: "bug" }],
    });
  });

  it("walks 1,000 levels of nested lists without recursing", () => {
    let body: unknown = { v: 1, w: 2 };
    for (let level = 0; level < 1_000; level += 1) body = [body];
    const kept = keepFields({ deep: body }, keep("deep.v"));
    let cursor: unknown = (kept.body as { deep: unknown }).deep;
    let levels = 0;
    while (Array.isArray(cursor)) {
      cursor = cursor[0];
      levels += 1;
    }
    expect(levels).toBe(1_000);
    expect(cursor).toEqual({ v: 1 });
    expect(kept.missing).toEqual([]);
  });

  it("walks 200,000 levels of nested lists without overflowing the call stack", () => {
    let body: unknown = { v: 1 };
    for (let level = 0; level < 200_000; level += 1) body = [body];
    const kept = keepFields(body, keep("v"));
    let cursor: unknown = kept.body;
    let levels = 0;
    while (Array.isArray(cursor)) {
      cursor = cursor[0];
      levels += 1;
    }
    expect(levels).toBe(200_000);
    expect(cursor).toEqual({ v: 1 });
  });
});

describe("reportMissing", () => {
  it("says nothing when every path matched", () => {
    expect(reportMissing([])).toBeUndefined();
  });

  it("lists the paths as typed when they fit", () => {
    expect(reportMissing(["a.b", "c"])).toEqual({
      fieldsMissing: ["a.b", "c"],
    });
  });

  it("stops at the report's size and counts the rest", () => {
    const long = (index: number) =>
      `${String(index).padStart(2, "0")}${"p".repeat(60)}.${"q".repeat(60)}`;
    const missing = Array.from({ length: 50 }, (_unused, index) => long(index));
    const report = reportMissing(missing);
    if (!report) throw new Error("expected a report");
    expect(report.fieldsMissing.length).toBeGreaterThan(0);
    expect(report.fieldsMissing).toEqual(
      missing.slice(0, report.fieldsMissing.length),
    );
    expect(JSON.stringify(report.fieldsMissing).length).toBeLessThanOrEqual(
      MAX_MISSING_REPORT_CHARS,
    );
    expect(report.fieldsMissingMore).toBe(50 - report.fieldsMissing.length);
  });

  it("always lists at least the first path, however long it is", () => {
    const widest = Array.from({ length: 8 }, () => '"'.repeat(64)).join(".");
    const report = reportMissing([widest, "b"]);
    expect(report?.fieldsMissing[0]).toBe(widest);
  });
});
