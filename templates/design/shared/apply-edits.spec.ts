import { describe, it, expect } from "vitest";

import { applyEdits, applyOneEdit } from "./apply-edits";

describe("applyEdits", () => {
  it("replaces a unique exact match", () => {
    const html = `<h1 class="text-4xl">Hello</h1>`;
    const { content, applied } = applyEdits(html, [
      { search: `text-4xl">Hello`, replace: `text-5xl">Hello there` },
    ]);
    expect(content).toBe(`<h1 class="text-5xl">Hello there</h1>`);
    expect(applied).toBe(1);
  });

  it("wraps an element by adding a wrapper in the replacement", () => {
    const html = `<button>Buy</button>`;
    const { content } = applyEdits(html, [
      {
        search: `<button>Buy</button>`,
        replace: `<div class="p-4"><button>Buy</button></div>`,
      },
    ]);
    expect(content).toBe(`<div class="p-4"><button>Buy</button></div>`);
  });

  it("throws on an ambiguous (multi-match) search", () => {
    const html = `<span>x</span><span>x</span>`;
    expect(() =>
      applyEdits(html, [{ search: `<span>x</span>`, replace: `y` }]),
    ).toThrow(/matched 2 places/);
  });

  it("throws with guidance when search is not found", () => {
    expect(() =>
      applyEdits(`<p>hi</p>`, [{ search: `<p>nope</p>`, replace: `x` }]),
    ).toThrow(/not found/);
  });

  it("matches whitespace-flexibly when exact fails", () => {
    const html = `<div>\n    <span>label</span>\n</div>`;
    const { content } = applyEdits(html, [
      {
        search: `<div> <span>label</span> </div>`,
        replace: `<div><b>label</b></div>`,
      },
    ]);
    expect(content).toBe(`<div><b>label</b></div>`);
  });

  it("treats $ in the replacement literally (no regex group expansion)", () => {
    const html = `<p>price</p>`;
    const { content } = applyEdits(html, [
      { search: `price`, replace: `$1,000 & up` },
    ]);
    expect(content).toBe(`<p>$1,000 & up</p>`);
  });

  it("applies edits sequentially", () => {
    const html = `a b c`;
    const { content } = applyEdits(html, [
      { search: `a`, replace: `A` },
      { search: `c`, replace: `C` },
    ]);
    expect(content).toBe(`A b C`);
  });

  it("rejects an empty search", () => {
    expect(() => applyOneEdit(`x`, { search: ``, replace: `y` })).toThrow(
      /non-empty/,
    );
  });

  it("treats self-overlapping matches as ambiguous", () => {
    expect(() => applyEdits(`aaa`, [{ search: `aa`, replace: `b` }])).toThrow(
      /matched 2 places/,
    );
  });
});
