import { describe, expect, it } from "vitest";

import { isJsonStringComplete, parsePartialJson } from "./partial-json";

// oracle-change(templates/slides/app/lib/streaming-slide-html.test.ts): Slides' add-slide parser moved into core as parsePartialJson; its cases live here.
describe("parsePartialJson", () => {
  it("recovers escaped slide HTML while the argument is incomplete", () => {
    const parsed = parsePartialJson(
      '{"deckId":"deck-1","content":"<div class=\\"fmd-slide\\"><h1>Live',
    );
    expect(parsed.value).toEqual({
      deckId: "deck-1",
      content: '<div class="fmd-slide"><h1>Live',
    });
    expect(isJsonStringComplete(parsed, ["deckId"])).toBe(true);
  });

  it("returns a complete document as is", () => {
    const parsed = parsePartialJson('{"a":1,"b":["x"]}');
    expect(parsed).toEqual({
      value: { a: 1, b: ["x"] },
      complete: true,
      openStringPath: null,
      invalid: false,
    });
  });

  it("keeps the arrived part of a string still being written", () => {
    const parsed = parsePartialJson(
      '{"designId":"d1","files":[{"filename":"index.html","content":"<main><h1>Hel',
    );
    expect(parsed.value).toEqual({
      designId: "d1",
      files: [{ filename: "index.html", content: "<main><h1>Hel" }],
    });
    expect(parsed.openStringPath).toEqual(["files", 0, "content"]);
    expect(isJsonStringComplete(parsed, ["designId"])).toBe(true);
    expect(isJsonStringComplete(parsed, ["files", 0, "content"])).toBe(false);
  });

  it("decodes escapes and stops before a cut-off one", () => {
    expect(parsePartialJson('{"c":"a\\"b\\nc\\u00e9').value).toEqual({
      c: 'a"b\ncé',
    });
    expect(parsePartialJson('{"c":"ab\\u00').value).toEqual({ c: "ab" });
    expect(parsePartialJson('{"c":"ab\\').value).toEqual({ c: "ab" });
  });

  it("omits a key whose name or value hasn't arrived", () => {
    expect(parsePartialJson('{"a":"x","con').value).toEqual({ a: "x" });
    expect(parsePartialJson('{"a":"x","content":').value).toEqual({ a: "x" });
  });

  it("drops a number that may still be growing", () => {
    expect(parsePartialJson('{"x":12').value).toEqual({});
    expect(parsePartialJson('{"x":12,"y":tr').value).toEqual({ x: 12 });
  });

  it("marks text that can never become JSON as invalid, not empty", () => {
    const parsed = parsePartialJson("{]");
    expect(parsed.invalid).toBe(true);
    expect(parsePartialJson("").invalid).toBe(false);
  });
});
