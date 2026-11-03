import { describe, expect, it } from "vitest";

import { parseFieldsToKeep } from "../../../server/workflow/fields-to-keep.js";
import {
  MAX_KEEP_PATHS,
  addPaths,
  checkFieldsToKeep,
  chipsOf,
  firstKeepProblem,
  isKeepablePath,
  leafPathsOf,
  pathReason,
  providerBodyOf,
  removePathAt,
  splitPaths,
  togglePath,
  wrappedValueOf,
} from "./fields-to-keep";

describe("the rules a list of fields is refused by", () => {
  it("accepts dotted paths of up to 8 segments of up to 64 characters", () => {
    expect(
      checkFieldsToKeep(["number", "user.login", "a.b.c.d.e.f.g.h"]),
    ).toEqual({ paths: [] });
    expect(pathReason(`${"x".repeat(64)}.y`)).toBe(undefined);
  });

  it("refuses an empty list and a value that is not a list of text", () => {
    expect(checkFieldsToKeep([])).toEqual({ list: "empty", paths: [] });
    for (const value of ["user.login", { a: 1 }, [1, 2], ["a", null], null]) {
      expect(checkFieldsToKeep(value)).toEqual({ list: "shape", paths: [] });
    }
  });

  it("refuses more than 50 paths", () => {
    const many = Array.from({ length: MAX_KEEP_PATHS + 1 }, (_, i) => `f${i}`);
    expect(checkFieldsToKeep(many).list).toBe("count");
    expect(checkFieldsToKeep(many.slice(0, MAX_KEEP_PATHS)).list).toBe(
      undefined,
    );
  });

  it("names why a path is refused", () => {
    const reasons = Object.fromEntries(
      [
        "a..b",
        ".a",
        "a.",
        " ",
        "a.__proto__",
        "constructor",
        "prototype.x",
        "a.b.c.d.e.f.g.h.i",
        `${"x".repeat(65)}`,
      ].map((path) => [path, pathReason(path)]),
    );
    expect(reasons).toEqual({
      "a..b": "segment",
      ".a": "segment",
      "a.": "segment",
      " ": "segment",
      "a.__proto__": "reserved",
      constructor: "reserved",
      "prototype.x": "reserved",
      "a.b.c.d.e.f.g.h.i": "deep",
      [`${"x".repeat(65)}`]: "long",
    });
    expect(isKeepablePath("user.login")).toBe(true);
    expect(isKeepablePath("a..b")).toBe(false);
  });

  it("flags each refused path by its place and a path listed twice, after its first", () => {
    expect(
      checkFieldsToKeep(["a", "bad..path", "a", " a ", "ok"]).paths,
    ).toEqual([
      { index: 1, path: "bad..path", reason: "segment" },
      { index: 2, path: "a", reason: "duplicate" },
      { index: 3, path: " a ", reason: "duplicate" },
    ]);
  });

  it("names a control character, which no part of a path may hold", () => {
    expect(pathReason("a\u0007b")).toBe("control");
    expect(pathReason("a\u0085b.c")).toBe("control");
    expect(pathReason("a\tb")).toBe("control");
    expect(pathReason("name with spaces.and $signs.ünï")).toBe(undefined);
  });

  it("gives the reason the server would, since it checks in the same order", () => {
    // An empty part comes before a depth or length problem, and depth before length.
    expect(pathReason("a..b.c.d.e.f.g.h.i")).toBe("segment");
    expect(pathReason(`${"x".repeat(65)}.b.c.d.e.f.g.h.i`)).toBe("deep");
    expect(pathReason(`${"x".repeat(65)}.__proto__`)).toBe("long");
  });

  // The server's own reader is the rule; this one only has to give the same yes or no.
  it("agrees with the server's reader about every list", () => {
    const eight = Array.from({ length: 8 }, () => "s").join(".");
    const lists: unknown[] = [
      ["a"],
      ["a.b", "c"],
      [""],
      [" "],
      ["a..b"],
      [".a"],
      ["a."],
      ["a\u0007"],
      ["a\u0085b"],
      ["a\tb"],
      ["x".repeat(64)],
      ["x".repeat(65)],
      [eight],
      [`${eight}.s`],
      ["__proto__"],
      ["a.constructor"],
      ["prototype.x"],
      ["a", "a"],
      ["a", " a "],
      ["a b", "$ref", "ünï.côde"],
      Array.from({ length: 50 }, (_, i) => `f${i}`),
      Array.from({ length: 51 }, (_, i) => `f${i}`),
      [],
      "a",
      [1],
      ["a", 1],
      null,
    ];
    for (const list of lists) {
      const check = checkFieldsToKeep(list);
      const clean = check.list === undefined && check.paths.length === 0;
      expect(clean, JSON.stringify(list)?.slice(0, 80)).toBe(
        parseFieldsToKeep(list).ok,
      );
    }
  });

  it("offers paths the server's reader accepts", () => {
    const { paths } = leafPathsOf(
      [
        {
          number: 1,
          "first name": "a",
          $ref: "x",
          user: { login: "ada", "e-mail": "x" },
          nested: {
            a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } },
          },
        },
      ],
      { maxPaths: 50 },
    );
    expect(paths.length).toBeGreaterThan(5);
    expect(parseFieldsToKeep(paths).ok).toBe(true);
  });

  it("reports one problem for a card or a list of problems, the list's own first", () => {
    expect(firstKeepProblem(["a", "b"])).toBe(undefined);
    expect(firstKeepProblem([])).toEqual({ reason: "empty" });
    expect(firstKeepProblem(["a", "b..c"])).toEqual({
      reason: "segment",
      path: "b..c",
    });
  });
});

describe("the chips", () => {
  it("reads a saved list, and nothing from a value that is not one", () => {
    expect(chipsOf(["a", "b"])).toEqual(["a", "b"]);
    expect(chipsOf([])).toEqual([]);
    expect(chipsOf(["a", 1])).toBe(undefined);
    expect(chipsOf("a")).toBe(undefined);
  });

  it("splits typed or pasted text at commas and line breaks", () => {
    expect(splitPaths("number, title\nuser.login,,\r\n  state  ")).toEqual([
      "number",
      "title",
      "user.login",
      "state",
    ]);
    expect(splitPaths("  ,\n ")).toEqual([]);
  });

  it("adds many pasted paths at once, in order, and trims them", () => {
    expect(
      addPaths(["number"], splitPaths("title, user.login ,state")),
    ).toEqual(["number", "title", "user.login", "state"]);
  });

  it("does not add a path the list holds already, however it was spaced", () => {
    expect(
      addPaths(["number", "title"], ["title", " number ", "state"]),
    ).toEqual(["number", "title", "state"]);
    expect(addPaths(["a"], ["a", "a"])).toEqual(["a"]);
  });

  it("keeps a path the server would refuse as a chip, so it is flagged and not lost", () => {
    const next = addPaths([], ["a..b", "__proto__"]);
    expect(next).toEqual(["a..b", "__proto__"]);
    expect(
      checkFieldsToKeep(next).paths.map((problem) => problem.reason),
    ).toEqual(["segment", "reserved"]);
  });

  it("removes a chip by its place, and toggles a picked path", () => {
    expect(removePathAt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    expect(removePathAt(["a"], 0)).toEqual([]);
    expect(togglePath(["a"], "b")).toEqual(["a", "b"]);
    expect(togglePath(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("the paths a response offers", () => {
  const pulls = [
    {
      number: 1,
      title: "First",
      user: { login: "ada", id: 7 },
      labels: [{ name: "bug" }],
      draft: false,
      merged_at: null,
    },
    {
      number: 2,
      title: "Second",
      user: { login: "grace", id: 8 },
      labels: [],
      body: "text",
    },
  ];

  it("flattens a list into the paths of its entries", () => {
    const { paths, capped } = leafPathsOf(pulls);
    expect(paths).toEqual([
      "number",
      "title",
      "user.login",
      "user.id",
      "labels.name",
      "draft",
      "merged_at",
      "labels",
      "body",
    ]);
    expect(capped).toBe(false);
  });

  it("offers an object's nested keys and a list of text as one path", () => {
    expect(
      leafPathsOf({ id: 1, owner: { login: "a" }, topics: ["x", "y"] }).paths,
    ).toEqual(["id", "owner.login", "topics"]);
  });

  it("offers an empty object or list as a path of its own, and nothing for a bare value", () => {
    expect(leafPathsOf({ labels: [], meta: {} }).paths).toEqual([
      "labels",
      "meta",
    ]);
    expect(leafPathsOf("hello").paths).toEqual([]);
    expect(leafPathsOf(null).paths).toEqual([]);
    expect(leafPathsOf([]).paths).toEqual([]);
  });

  it("skips a key with a dot in it, a key the server reserves, and a key with stray spaces", () => {
    // JSON.parse makes `__proto__` an own key; in an object literal it would set the prototype.
    const answer: unknown = JSON.parse(
      '{"a.b":1,"__proto__":2,"constructor":{"x":1},"  padded":3,"ok":{"in.ner":1,"fine":2}}',
    );
    expect(leafPathsOf(answer).paths).toEqual(["ok.fine"]);
  });

  it("never goes past the depth a path may have, offering the object at that depth instead", () => {
    const deep = {
      a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } },
    };
    expect(leafPathsOf(deep).paths).toEqual(["a.b.c.d.e.f.g.h"]);
    expect(leafPathsOf(deep, { maxDepth: 2 }).paths).toEqual(["a.b"]);
  });

  it("stops at the most paths it was asked for and says it did", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`k${i}`, i]),
    );
    expect(leafPathsOf(wide, { maxPaths: 4 })).toEqual({
      paths: ["k0", "k1", "k2", "k3"],
      capped: true,
    });
    expect(leafPathsOf(wide, { maxPaths: 10 }).capped).toBe(false);
  });

  it("only ever offers paths the server accepts", () => {
    const awkward = {
      "": 1,
      ["x".repeat(70)]: 2,
      ok: { "": 3, ["y".repeat(65)]: 4, fine: 5 },
      list: [{ "bad.key": 1, good: 2 }],
    };
    const { paths } = leafPathsOf(awkward);
    expect(paths).toEqual(["ok.fine", "list.good"]);
    for (const path of paths) expect(isKeepablePath(path)).toBe(true);
  });
});

describe("the provider's answer inside what a step hands on", () => {
  it("is the body of a report with status and headers, when they are asked for", () => {
    const report = { status: 200, headers: {}, body: [{ id: 1 }] };
    expect(providerBodyOf(report, { includeStatus: true })).toEqual([
      { id: 1 },
    ]);
    expect(providerBodyOf(report, { includeStatus: false })).toBe(report);
  });

  it("is the kept entries of a list the step cut", () => {
    expect(
      providerBodyOf(
        {
          truncated: true,
          count: 2,
          totalAvailable: 30,
          cuts: [{ path: "value", kept: 2, of: 30 }],
          value: [{ id: 1 }, { id: 2 }],
        },
        { includeStatus: false },
      ),
    ).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("is an object without the keys the step added to it", () => {
    expect(
      providerBodyOf(
        {
          truncated: true,
          cuts: [{ path: "body", keptChars: 10, ofChars: 90 }],
          cutsOmitted: 2,
          fieldsMissing: ["nope"],
          id: 1,
        },
        { includeStatus: false },
      ),
    ).toEqual({ id: 1 });
    expect(
      providerBodyOf(
        { fieldsMissing: ["nope"], id: 1 },
        { includeStatus: false },
      ),
    ).toEqual({ id: 1 });
  });

  it("is the value a step wrapped a list in to say which fields it did not find", () => {
    expect(
      providerBodyOf(
        { fieldsMissing: ["nope"], value: [{ id: 1 }] },
        { includeStatus: false },
      ),
    ).toEqual([{ id: 1 }]);
    expect(
      wrappedValueOf({
        truncated: true,
        fieldsMissing: ["a"],
        fieldsMissingMore: 3,
        count: 1,
        totalAvailable: 5,
        cuts: [],
        cutsOmitted: 0,
        value: [1],
      }),
    ).toEqual({ value: [1] });
  });

  it("is not a wrapper when an object only has a `value` of its own, or has other keys beside it", () => {
    expect(wrappedValueOf({ value: [1] })).toBe(undefined);
    expect(wrappedValueOf({ id: 1, value: [1], fieldsMissing: ["a"] })).toBe(
      undefined,
    );
    expect(
      providerBodyOf(
        { fieldsMissing: ["a"], id: 1, value: 2 },
        { includeStatus: false },
      ),
    ).toEqual({ id: 1, value: 2 });
  });

  it("is the entries of a paged answer, which the paths are written against", () => {
    expect(
      providerBodyOf(
        {
          fieldsMissing: ["x"],
          pagesRead: 2,
          moreAvailable: true,
          nextCursor: "c",
          items: [{ id: 1 }, { id: 2 }],
        },
        { includeStatus: false },
      ),
    ).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("leaves out the count of missing fields the step could not list", () => {
    expect(
      providerBodyOf(
        { fieldsMissing: ["a"], fieldsMissingMore: 4, id: 1 },
        { includeStatus: false },
      ),
    ).toEqual({ id: 1 });
  });

  it("keeps a `truncated` field that is the provider's own", () => {
    expect(
      providerBodyOf({ truncated: true, id: 1 }, { includeStatus: false }),
    ).toEqual({ truncated: true, id: 1 });
  });
});
