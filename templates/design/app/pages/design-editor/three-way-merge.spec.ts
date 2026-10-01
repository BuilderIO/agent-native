import { describe, expect, it } from "vitest";

import { threeWayMergeContent } from "./three-way-merge";

const BASE = [
  "<!doctype html>",
  '<html><body style="margin:0">',
  '  <button data-agent-native-node-id="alpha" style="border-radius:10px;background:#6366f1;color:#fff">Alpha</button>',
  '  <button data-agent-native-node-id="beta" style="border-radius:10px;background:#22c55e;color:#06240f">Beta</button>',
  "</body></html>",
].join("\n");

describe("threeWayMergeContent", () => {
  it("keeps both edits when they touch different elements", () => {
    const mine = BASE.replace("#6366f1", "#ff0000");
    const theirs = BASE.replace(
      'beta" style="border-radius:10px',
      'beta" style="border-radius:30px',
    );
    expect(threeWayMergeContent({ base: BASE, mine, theirs })).toBe(
      BASE.replace("#6366f1", "#ff0000").replace(
        'beta" style="border-radius:10px',
        'beta" style="border-radius:30px',
      ),
    );
  });

  it("keeps both edits to different properties of one element", () => {
    const mine = BASE.replace("#6366f1", "#ff0000");
    const theirs = BASE.replace(
      'alpha" style="border-radius:10px',
      'alpha" style="border-radius:30px',
    );
    const merged = threeWayMergeContent({ base: BASE, mine, theirs });
    expect(merged).toContain("border-radius:30px;background:#ff0000");
  });

  it("keeps insertions at different points and is symmetric", () => {
    const mine = BASE.replace("<body", '<div id="top"></div><body');
    const theirs = BASE.replace("</body>", '<p id="end"></p></body>');
    const merged = threeWayMergeContent({ base: BASE, mine, theirs });
    expect(merged).toContain('<div id="top"></div><body');
    expect(merged).toContain('<p id="end"></p></body>');
    expect(
      threeWayMergeContent({ base: BASE, mine: theirs, theirs: mine }),
    ).toBe(merged);
  });

  it("refuses two different edits of the same value", () => {
    const mine = BASE.replace("#6366f1", "#ff0000");
    const theirs = BASE.replace("#6366f1", "#00ff00");
    expect(threeWayMergeContent({ base: BASE, mine, theirs })).toBeNull();
  });

  it("refuses two different insertions at the same point", () => {
    const mine = BASE.replace("</body>", "<i>mine</i></body>");
    const theirs = BASE.replace("</body>", "<b>theirs</b></body>");
    expect(threeWayMergeContent({ base: BASE, mine, theirs })).toBeNull();
  });

  it("keeps both insertions at one point only when asked, theirs first", () => {
    const mine = BASE.replace("</body>", "<i>mine</i></body>");
    const theirs = BASE.replace("</body>", "<b>theirs</b></body>");
    expect(
      threeWayMergeContent({
        base: BASE,
        mine,
        theirs,
        keepBothInsertionsAtSamePoint: true,
      }),
    ).toBe(BASE.replace("</body>", "<b>theirs</b><i>mine</i></body>"));
  });

  it("refuses an edit inside a region the other side deleted", () => {
    const mine = BASE.replace("#22c55e", "#000000");
    const theirs = BASE.replace(/ {2}<button[^\n]*beta[^\n]*\n/, "");
    expect(threeWayMergeContent({ base: BASE, mine, theirs })).toBeNull();
  });

  it("collapses an identical edit made on both sides", () => {
    const both = BASE.replace("#6366f1", "#ff0000");
    expect(
      threeWayMergeContent({
        base: BASE,
        mine: both,
        theirs: both.replace("#22c55e", "#111111"),
      }),
    ).toBe(both.replace("#22c55e", "#111111"));
  });

  it("returns the changed side when the other side did not change", () => {
    const edited = BASE.replace("#6366f1", "#ff0000");
    expect(
      threeWayMergeContent({ base: BASE, mine: edited, theirs: BASE }),
    ).toBe(edited);
    expect(
      threeWayMergeContent({ base: BASE, mine: BASE, theirs: edited }),
    ).toBe(edited);
    expect(
      threeWayMergeContent({ base: BASE, mine: edited, theirs: edited }),
    ).toBe(edited);
  });
});
