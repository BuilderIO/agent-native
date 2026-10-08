// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { diffUndoRevealTargets, undoRevealForOps } from "./undo-reveal";

const slide = (...children: string[]) =>
  `<div class="fmd-slide">${children.join("")}</div>`;
const box = (id: string | null, style: string, text = "") =>
  `<div${id ? ` data-slide-object-id="${id}"` : ""} style="${style}">${text}</div>`;

describe("diffUndoRevealTargets", () => {
  const A = box("a", "left: 10px", "A");
  const B = box("b", "left: 100px", "B");

  it("selects the object whose style changed (gs-truth U1, U2)", () => {
    const moved = box("a", "left: 40px", "A");
    for (const direction of ["undo", "redo"] as const) {
      expect(
        diffUndoRevealTargets(slide(A, B), slide(moved, B), direction),
      ).toEqual([{ objectId: "a", path: [0] }]);
    }
  });

  it("finds an object that got its id in the same edit as its first move", () => {
    const before = slide(box(null, "left: 10px", "A"), B);
    const after = slide(box("a", "left: 40px", "A"), B);
    expect(diffUndoRevealTargets(after, before, "undo")).toEqual([
      { objectId: null, path: [0] },
    ]);
    expect(diffUndoRevealTargets(before, after, "redo")).toEqual([
      { objectId: "a", path: [0] },
    ]);
  });

  it("selects every object of a multi-object edit (U10) and nothing for a no-op", () => {
    const after = slide(
      box("a", "left: 40px", "A"),
      box("b", "left: 130px", "B"),
    );
    expect(diffUndoRevealTargets(slide(A, B), after, "undo")).toEqual([
      { objectId: "a", path: [0] },
      { objectId: "b", path: [1] },
    ]);
    expect(diffUndoRevealTargets(slide(A, B), slide(A, B), "undo")).toEqual([]);
  });

  it("rolls an edit inside inline markup up to the owning paragraph (U4)", () => {
    const before = slide('<p data-slide-object-id="t">Hello</p>');
    const after = slide(
      '<p data-slide-object-id="t">Hello <strong>world</strong></p>',
    );
    expect(diffUndoRevealTargets(after, before, "undo")).toEqual([
      { objectId: "t", path: [0] },
    ]);
  });

  it("selects an object restored by undoing a delete, and nothing on redo (U5)", () => {
    expect(diffUndoRevealTargets(slide(B), slide(A, B), "undo")).toEqual([
      { objectId: "a", path: [0] },
    ]);
    expect(diffUndoRevealTargets(slide(A, B), slide(B), "redo")).toEqual([]);
  });

  it("selects the copy on redo and the original on undo of a paste or duplicate (U6, U7)", () => {
    const copy = box("a2", "left: 26px", "A");
    const withCopy = slide(A, B, copy);
    expect(diffUndoRevealTargets(slide(A, B), withCopy, "redo")).toEqual([
      { objectId: "a2", path: [2] },
    ]);
    expect(diffUndoRevealTargets(withCopy, slide(A, B), "undo")).toEqual([
      { objectId: "a", path: [0] },
    ]);
  });

  it("picks the source the duplicate followed when look-alikes exist", () => {
    const x1 = box("x1", "left: 0px", "X");
    const x2 = box("x2", "left: 50px", "X");
    const dup = box("x3", "left: 68px", "X");
    expect(
      diffUndoRevealTargets(slide(x1, x2, dup, B), slide(x1, x2, B), "undo"),
    ).toEqual([{ objectId: "x2", path: [1] }]);
    expect(
      diffUndoRevealTargets(slide(x1, dup, x2, B), slide(x1, x2, B), "undo"),
    ).toEqual([{ objectId: "x1", path: [0] }]);
  });

  it("pairs look-alike copies appended after the tail with distinct sources", () => {
    const x1 = box("x1", "left: 0px", "X");
    const x2 = box("x2", "left: 50px", "X");
    const dup1 = box("x3", "left: 18px", "X");
    const dup2 = box("x4", "left: 68px", "X");
    expect(
      diffUndoRevealTargets(
        slide(x1, x2, B, dup1, dup2),
        slide(x1, x2, B),
        "undo",
      ),
    ).toEqual(
      expect.arrayContaining([
        { objectId: "x1", path: [0] },
        { objectId: "x2", path: [1] },
      ]),
    );
  });

  it("selects nothing when undoing the creation of an object with no source (U12)", () => {
    const created = box("n", "left: 5px", "New");
    expect(diffUndoRevealTargets(slide(A, created), slide(A), "undo")).toEqual(
      [],
    );
  });

  it("selects the child, not its wrapper, when a nested object is deleted or inserted", () => {
    const wrap = (...children: string[]) =>
      `<div data-slide-object-id="w">${children.join("")}</div>`;
    const p = (id: string, text: string) =>
      `<p data-slide-object-id="${id}">${text}</p>`;
    const one = slide(wrap(p("a", "A")));
    const two = slide(wrap(p("a", "A"), p("b", "B")));
    expect(diffUndoRevealTargets(one, two, "undo")).toEqual([
      { objectId: "b", path: [0, 1] },
    ]);
    expect(diffUndoRevealTargets(one, two, "redo")).toEqual([
      { objectId: "b", path: [0, 1] },
    ]);
    expect(diffUndoRevealTargets(two, one, "redo")).toEqual([]);
    const bare = (...children: string[]) =>
      slide(`<div>${children.join("")}</div>`);
    expect(
      diffUndoRevealTargets(
        bare("<p>A</p>"),
        bare("<p>A</p>", "<p>B</p>"),
        "undo",
      ),
    ).toEqual([{ objectId: null, path: [0, 1] }]);
  });

  it("does not take a look-alike image or empty shape for the source of an undone insert", () => {
    const img = (id: string) =>
      `<img data-slide-object-id="${id}" class="fmd-img" src="/a.png" style="left: 10px">`;
    const rect = (id: string) =>
      `<div data-slide-object-id="${id}" class="rect" style="left: 10px"></div>`;
    const other = `<img data-slide-object-id="o" class="fmd-img" src="/b.png" style="left: 90px">`;
    expect(
      diffUndoRevealTargets(
        slide(img("i1"), other, img("i2")),
        slide(img("i1"), other),
        "undo",
      ),
    ).toEqual([{ objectId: "i1", path: [0] }]);
    expect(
      diffUndoRevealTargets(slide(other, img("i2")), slide(other), "undo"),
    ).toEqual([]);
    expect(
      diffUndoRevealTargets(
        slide(rect("r1"), rect("r2")),
        slide(rect("r1")),
        "undo",
      ),
    ).toEqual([]);
  });

  it("ignores layout spacers and slide-level edits", () => {
    const spacer =
      '<div class="fmd-layout-spacer" data-slide-layout-spacer-for="a"></div>';
    expect(
      diffUndoRevealTargets(slide(A, B), slide(spacer, A, B), "undo"),
    ).toEqual([]);
    expect(
      diffUndoRevealTargets(
        slide(A, B),
        `<div class="fmd-slide" style="background: red">${A}${B}</div>`,
        "undo",
      ),
    ).toEqual([]);
  });

  it("reports an uncomparable step as null, not as an empty selection", () => {
    expect(diffUndoRevealTargets("# markdown", slide(A), "undo")).toBeNull();
  });
});

describe("undoRevealForOps", () => {
  const before = slide(box("a", "left: 10px", "A"));
  const after = slide(box("a", "left: 40px", "A"));
  const deck = {
    slides: [
      { id: "s1", content: before },
      { id: "s2", content: slide() },
    ],
  };

  it("compares each rewritten slide against its current content (U11)", () => {
    const reveal = undoRevealForOps(
      deck,
      "d1",
      [
        { op: "patch-deck-fields", fields: { title: "x" } },
        { op: "patch-slide", slideId: "s1", fields: { content: after } },
        { op: "patch-slide", slideId: "s2", fields: { notes: "n" } },
      ],
      "redo",
    );
    expect(reveal).toEqual({
      deckId: "d1",
      direction: "redo",
      slides: [{ slideId: "s1", targets: [{ objectId: "a", path: [0] }] }],
    });
  });

  it("chains several rewrites of one slide from its original content", () => {
    const reveal = undoRevealForOps(
      deck,
      "d1",
      [
        { op: "patch-slide", slideId: "s1", fields: { content: after } },
        { op: "patch-slide", slideId: "s1", fields: { content: before } },
      ],
      "undo",
    );
    expect(reveal?.slides).toEqual([{ slideId: "s1", targets: [] }]);
  });

  it("returns null when no slide HTML is rewritten", () => {
    expect(
      undoRevealForOps(
        deck,
        "d1",
        [{ op: "patch-slide", slideId: "s1", fields: { notes: "n" } }],
        "undo",
      ),
    ).toBeNull();
    expect(undoRevealForOps(undefined, "d1", [], "undo")).toBeNull();
  });
});
