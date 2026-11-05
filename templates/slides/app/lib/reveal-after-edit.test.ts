// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { assertSlideAnimationsResolve } from "../../server/lib/validate-slide-animations";
import { revealsAfterEdit } from "./reveal-after-edit";

const slide = (...children: string[]) =>
  `<div class="fmd-slide">${children.join("")}</div>`;

const reveal = (id: string, path: number[]) => ({
  id,
  elementIndex: path[path.length - 1],
  elementPath: path,
});

const paths = (animations: { elementPath?: number[] }[]) =>
  animations.map((animation) => animation.elementPath);

// The save must accept what the editor sends, or the edit is rolled back.
function expectSaves(
  before: string,
  after: string,
  animations: ReturnType<typeof reveal>[],
) {
  const moved = revealsAfterEdit(before, after, animations);
  expect(() =>
    assertSlideAnimationsResolve({
      slideId: "s1",
      content: after,
      animations: moved,
      baseline: { content: before, animations },
    }),
  ).not.toThrow();
  return moved;
}

describe("revealsAfterEdit", () => {
  const before = slide("<h1>T</h1>", "<p>A</p>", "<p>B</p>");

  it("moves a reveal past a copy pasted before its target", () => {
    const moved = expectSaves(
      before,
      slide("<h1>T</h1>", "<p>A</p>", "<p>A</p>", "<p>B</p>"),
      [reveal("b", [2])],
    );
    expect(paths(moved)).toEqual([[3]]);
  });

  it("follows a target that is grouped with a sibling", () => {
    const moved = expectSaves(
      before,
      slide("<h1>T</h1>", '<div class="group"><p>A</p><p>B</p></div>'),
      [reveal("b", [2]), reveal("t", [0])],
    );
    expect(paths(moved)).toEqual([[1, 1], [0]]);
  });

  it("follows a target that is reordered", () => {
    const moved = expectSaves(
      before,
      slide("<h1>T</h1>", "<p>B</p>", "<p>A</p>"),
      [reveal("b", [2])],
    );
    expect(paths(moved)).toEqual([[1]]);
  });

  it("keeps a reveal on a target whose tag changes in place", () => {
    const animations = [reveal("b", [2])];
    const moved = expectSaves(
      before,
      slide("<h1>T</h1>", "<p>A</p>", "<h2>B</h2>"),
      animations,
    );
    expect(moved[0]).toBe(animations[0]);
  });

  it("moves a reveal after a table row is inserted above its target", () => {
    const table = (rows: string) =>
      slide(`<table><tbody>${rows}</tbody></table>`);
    const moved = expectSaves(
      table("<tr><td>1</td></tr><tr><td>2</td></tr>"),
      table("<tr><td>1</td></tr><tr><td></td></tr><tr><td>2</td></tr>"),
      [reveal("row", [0, 0, 1])],
    );
    expect(paths(moved)).toEqual([[0, 0, 2]]);
  });

  it("writes a path for a legacy reveal whose container an append moves", () => {
    const legacy = slide('<div class="list"><p>A</p><p>B</p></div>');
    const moved = revealsAfterEdit(
      legacy,
      slide(
        '<div class="list"><p>A</p><p>B</p></div>',
        '<div class="g"><p>x</p><p>y</p></div>',
      ),
      [{ id: "a", elementIndex: 0 }],
    );
    expect(moved).toEqual([{ id: "a", elementIndex: 0, elementPath: [0, 0] }]);
  });

  it("leaves a reveal whose target has no counterpart, so the save refuses it", () => {
    const animations = [reveal("a", [1])];
    const moved = revealsAfterEdit(
      slide("<p>X</p>", "<p>A</p>"),
      slide("<p>Y</p>"),
      animations,
    );
    expect(moved[0]).toBe(animations[0]);
  });
});
