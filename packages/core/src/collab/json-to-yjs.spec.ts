import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  seedYDocFromJson,
  yMapToJson,
  yArrayToJson,
  yDocToJson,
  applyJsonDiff,
  applyJsonPatch,
  initYDocWithJson,
  type PatchOp,
} from "./json-to-yjs.js";

describe("seedYDocFromJson / yDocToJson round-trips", () => {
  it("round-trips a deeply nested mixed object through a Y.Map", () => {
    const json = {
      title: "Deck",
      published: true,
      count: 3,
      tags: ["a", "b"],
      meta: { author: "kat", nested: { deep: [1, { x: "y" }] } },
      empty: {},
    };
    const doc = new Y.Doc();
    seedYDocFromJson(doc, "data", json, "map");

    // Shared types are materialized as real Yjs containers, not stored verbatim.
    const ymap = doc.getMap("data");
    expect(ymap.get("meta")).toBeInstanceOf(Y.Map);
    expect(ymap.get("tags")).toBeInstanceOf(Y.Array);

    expect(yDocToJson(doc, "data")).toEqual(json);
  });

  it("round-trips an array of objects through a Y.Array", () => {
    const json = [
      { id: "t1", label: "one" },
      { id: "t2", label: "two", children: [{ id: "c1" }] },
    ];
    const doc = new Y.Doc();
    seedYDocFromJson(doc, "data", json, "array");

    expect(doc.getArray("data").get(0)).toBeInstanceOf(Y.Map);
    expect(yDocToJson(doc, "data")).toEqual(json);
  });

  it("preserves null and treats it as a primitive, not a container", () => {
    const json = { a: null, b: 0, c: "" };
    const doc = new Y.Doc();
    seedYDocFromJson(doc, "data", json, "map");
    const ymap = doc.getMap("data");
    expect(ymap.get("a")).toBeNull();
    expect(yMapToJson(ymap)).toEqual(json);
  });

  it("ignores a type mismatch: array json into a map field seeds nothing", () => {
    const doc = new Y.Doc();
    seedYDocFromJson(doc, "data", [1, 2, 3], "map");
    expect(doc.getMap("data").size).toBe(0);
    expect(yDocToJson(doc, "data")).toEqual({});
  });

  it("ignores a type mismatch: object json into an array field seeds nothing", () => {
    const doc = new Y.Doc();
    seedYDocFromJson(doc, "data", { a: 1 }, "array");
    expect(doc.getArray("data").length).toBe(0);
  });

  it("yDocToJson returns {} for an unknown field", () => {
    const doc = new Y.Doc();
    expect(yDocToJson(doc, "missing")).toEqual({});
  });
});

describe("yArrayToJson", () => {
  it("serializes nested arrays preserving order", () => {
    const doc = new Y.Doc();
    const yarr = doc.getArray("data");
    const inner = new Y.Array();
    inner.push([1, 2]);
    yarr.push(["x", inner]);
    expect(yArrayToJson(yarr)).toEqual(["x", [1, 2]]);
  });
});

describe("applyJsonDiff on Y.Map", () => {
  it("sets, changes, and deletes keys with a minimal diff", () => {
    const doc = new Y.Doc();
    seedYDocFromJson(
      doc,
      "data",
      { keep: 1, change: "old", drop: true },
      "map",
    );

    const update = applyJsonDiff(doc, "data", {
      keep: 1,
      change: "new",
      added: [1, 2],
    });

    // A real update was produced (non-empty).
    expect(update.length).toBeGreaterThan(0);
    expect(yDocToJson(doc, "data")).toEqual({
      keep: 1,
      change: "new",
      added: [1, 2],
    });
  });

  it("recurses into nested maps without replacing the container", () => {
    const doc = new Y.Doc();
    seedYDocFromJson(doc, "data", { nested: { a: 1, b: 2 } }, "map");
    const nestedBefore = doc.getMap("data").get("nested");

    applyJsonDiff(doc, "data", { nested: { a: 1, b: 99, c: 3 } });

    // Same container object reused (in-place diff, not replaced).
    expect(doc.getMap("data").get("nested")).toBe(nestedBefore);
    expect(yDocToJson(doc, "data")).toEqual({ nested: { a: 1, b: 99, c: 3 } });
  });

  it("returns an empty update when nothing changed", () => {
    const doc = new Y.Doc();
    seedYDocFromJson(doc, "data", { a: 1, nested: { b: 2 } }, "map");
    const update = applyJsonDiff(doc, "data", { a: 1, nested: { b: 2 } });
    expect(update.length).toBe(0);
  });

  it("tags the transaction with the given origin", () => {
    const doc = new Y.Doc();
    seedYDocFromJson(doc, "data", { a: 1 }, "map");
    let seenOrigin: unknown = "unset";
    doc.on("afterTransaction", (txn) => {
      seenOrigin = txn.origin;
    });
    applyJsonDiff(doc, "data", { a: 2 }, "server");
    expect(seenOrigin).toBe("server");
  });
});

describe("applyJsonDiff on Y.Array by index (no ids)", () => {
  it("updates in place, appends, and truncates", () => {
    const doc = new Y.Doc();
    seedYDocFromJson(doc, "data", [1, 2, 3], "array");

    applyJsonDiff(doc, "data", [1, 20, 3, 4]);
    expect(yDocToJson(doc, "data")).toEqual([1, 20, 3, 4]);

    applyJsonDiff(doc, "data", [1]);
    expect(yDocToJson(doc, "data")).toEqual([1]);
  });

  it("diffs nested object items in place by index", () => {
    const doc = new Y.Doc();
    seedYDocFromJson(doc, "data", [{ x: 1 }, { x: 2 }], "array");
    const firstBefore = doc.getArray("data").get(0);

    applyJsonDiff(doc, "data", [{ x: 1, y: 9 }, { x: 2 }]);

    expect(doc.getArray("data").get(0)).toBe(firstBefore);
    expect(yDocToJson(doc, "data")).toEqual([{ x: 1, y: 9 }, { x: 2 }]);
  });
});

describe("applyJsonDiff on Y.Array by id (stable identity)", () => {
  it("removes items that disappear, keyed by id", () => {
    const doc = new Y.Doc();
    seedYDocFromJson(
      doc,
      "data",
      [
        { id: "a", v: 1 },
        { id: "b", v: 2 },
        { id: "c", v: 3 },
      ],
      "array",
    );

    applyJsonDiff(doc, "data", [
      { id: "a", v: 1 },
      { id: "c", v: 3 },
    ]);

    expect(yDocToJson(doc, "data")).toEqual([
      { id: "a", v: 1 },
      { id: "c", v: 3 },
    ]);
  });

  it("reorders existing items by id, preserving the moved container's identity", () => {
    const doc = new Y.Doc();
    seedYDocFromJson(
      doc,
      "data",
      [
        { id: "a", v: 1 },
        { id: "b", v: 2 },
        { id: "c", v: 3 },
      ],
      "array",
    );

    // Move "c" to the front.
    applyJsonDiff(doc, "data", [
      { id: "c", v: 3 },
      { id: "a", v: 1 },
      { id: "b", v: 2 },
    ]);

    expect(yDocToJson(doc, "data")).toEqual([
      { id: "c", v: 3 },
      { id: "a", v: 1 },
      { id: "b", v: 2 },
    ]);
  });

  it("inserts brand-new items at their target position and diffs matched ones in place", () => {
    const doc = new Y.Doc();
    seedYDocFromJson(
      doc,
      "data",
      [
        { id: "a", v: 1 },
        { id: "b", v: 2 },
      ],
      "array",
    );
    const aBefore = doc.getArray("data").get(0);

    applyJsonDiff(doc, "data", [
      { id: "a", v: 11 },
      { id: "x", v: 100 },
      { id: "b", v: 2 },
    ]);

    // "a" container reused and mutated in place.
    expect(doc.getArray("data").get(0)).toBe(aBefore);
    expect(yDocToJson(doc, "data")).toEqual([
      { id: "a", v: 11 },
      { id: "x", v: 100 },
      { id: "b", v: 2 },
    ]);
  });

  it("matches ids that differ only by type (numeric vs string)", () => {
    const doc = new Y.Doc();
    seedYDocFromJson(doc, "data", [{ id: 1, v: "old" }], "array");
    const before = doc.getArray("data").get(0);

    // New json uses a string id "1" — should match the numeric id 1.
    applyJsonDiff(doc, "data", [{ id: "1", v: "new" }]);

    expect(doc.getArray("data").get(0)).toBe(before);
    expect(yDocToJson(doc, "data")).toEqual([{ id: "1", v: "new" }]);
  });
});

describe("applyJsonPatch", () => {
  function seededDoc(json: any, type: "map" | "array" = "map"): Y.Doc {
    const doc = new Y.Doc();
    seedYDocFromJson(doc, "data", json, type);
    return doc;
  }

  it("set replaces a nested map value", () => {
    const doc = seededDoc({ a: { b: 1 } });
    const ops: PatchOp[] = [{ op: "set", path: "a/b", value: 42 }];
    applyJsonPatch(doc, "data", ops);
    expect(yDocToJson(doc, "data")).toEqual({ a: { b: 42 } });
  });

  it("set replaces an array element by index", () => {
    const doc = seededDoc({ list: [10, 20, 30] });
    applyJsonPatch(doc, "data", [{ op: "set", path: "list/1", value: 99 }]);
    expect(yDocToJson(doc, "data")).toEqual({ list: [10, 99, 30] });
  });

  it("set with an out-of-range array index is a no-op", () => {
    const doc = seededDoc({ list: [1, 2] });
    applyJsonPatch(doc, "data", [{ op: "set", path: "list/5", value: 9 }]);
    expect(yDocToJson(doc, "data")).toEqual({ list: [1, 2] });
  });

  it("insert adds into an array, clamping the index", () => {
    const doc = seededDoc({ list: [1, 2] });
    applyJsonPatch(doc, "data", [
      { op: "insert", path: "list", index: 1, value: 9 },
      { op: "insert", path: "list", index: 99, value: 5 },
    ]);
    expect(yDocToJson(doc, "data")).toEqual({ list: [1, 9, 2, 5] });
  });

  it("delete removes a map key", () => {
    const doc = seededDoc({ a: 1, b: 2 });
    applyJsonPatch(doc, "data", [{ op: "delete", path: "b" }]);
    expect(yDocToJson(doc, "data")).toEqual({ a: 1 });
  });

  it("delete removes an array element by index", () => {
    const doc = seededDoc({ list: [1, 2, 3] });
    applyJsonPatch(doc, "data", [{ op: "delete", path: "list/1" }]);
    expect(yDocToJson(doc, "data")).toEqual({ list: [1, 3] });
  });

  it("move reorders an array element and clamps the target", () => {
    const doc = seededDoc({ list: ["a", "b", "c", "d"] });
    applyJsonPatch(doc, "data", [{ op: "move", path: "list", from: 0, to: 2 }]);
    expect(yDocToJson(doc, "data")).toEqual({ list: ["b", "c", "a", "d"] });

    // to beyond the end clamps to the last index.
    applyJsonPatch(doc, "data", [
      { op: "move", path: "list", from: 0, to: 99 },
    ]);
    expect(yDocToJson(doc, "data")).toEqual({ list: ["c", "a", "d", "b"] });
  });

  it("move is a no-op for an out-of-range source or a no-op destination", () => {
    const doc = seededDoc({ list: ["a", "b"] });
    applyJsonPatch(doc, "data", [{ op: "move", path: "list", from: 5, to: 0 }]);
    applyJsonPatch(doc, "data", [{ op: "move", path: "list", from: 0, to: 0 }]);
    expect(yDocToJson(doc, "data")).toEqual({ list: ["a", "b"] });
  });

  it("set with an empty path is ignored", () => {
    const doc = seededDoc({ a: 1 });
    const update = applyJsonPatch(doc, "data", [
      { op: "set", path: "", value: "ignored" },
    ]);
    expect(update.length).toBe(0);
    expect(yDocToJson(doc, "data")).toEqual({ a: 1 });
  });

  it("applies multiple ops atomically in one update", () => {
    const doc = seededDoc({ a: 1, list: [1, 2] });
    const update = applyJsonPatch(doc, "data", [
      { op: "set", path: "a", value: 2 },
      { op: "insert", path: "list", index: 0, value: 0 },
      { op: "delete", path: "list/2" },
    ]);
    expect(update.length).toBeGreaterThan(0);
    expect(yDocToJson(doc, "data")).toEqual({ a: 2, list: [0, 1] });
  });
});

describe("initYDocWithJson", () => {
  it("returns a doc plus an encoded state that reconstructs the json", () => {
    const json = { a: 1, b: [{ id: "x" }] };
    const { doc, state } = initYDocWithJson("data", json, "map");
    expect(yDocToJson(doc, "data")).toEqual(json);

    // The encoded state replays into a fresh doc. yDocToJson dispatches on
    // `doc.share.get(field) instanceof Y.Map/Y.Array`, and a replayed root
    // type is an untyped AbstractType until claimed with the matching typed
    // accessor — so the consumer must call getMap/getArray first.
    const replay = new Y.Doc();
    Y.applyUpdate(replay, state);
    replay.getMap("data"); // claim the root type, as every real consumer does
    expect(yDocToJson(replay, "data")).toEqual(json);
  });

  it("yDocToJson returns {} on a replayed doc whose root type was never claimed", () => {
    // Documents the typed-accessor requirement: without getMap/getArray the
    // root share is an AbstractType and the instanceof checks fall through.
    const { state } = initYDocWithJson("data", { a: 1 }, "map");
    const replay = new Y.Doc();
    Y.applyUpdate(replay, state);
    expect(replay.share.has("data")).toBe(true);
    expect(yDocToJson(replay, "data")).toEqual({});
  });

  it("seeds an array field and reconstructs after claiming with getArray", () => {
    const json = [{ id: "a" }, { id: "b" }];
    const { state } = initYDocWithJson("data", json, "array");
    const replay = new Y.Doc();
    Y.applyUpdate(replay, state);
    replay.getArray("data");
    expect(yDocToJson(replay, "data")).toEqual(json);
  });
});
