// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import {
  findEnclosingList,
  insertBulletAfterCaret,
  isBulletList,
  isBulletRow,
} from "@/components/editor/bullet-editing";

const row = (text: string) =>
  `<div style="display: flex; align-items: baseline; gap: 20px; font-size: 22px;"><span style="font-size: 8px;">&#x25CF;</span><span>${text}</span></div>`;

const LIST_HTML = `<div class="slide-content"><div data-fmd-autofit-content="true"><div class="bullets" style="display: flex; flex-direction: column; gap: 16px;">
  ${row("First point")}
  ${row("Second point")}
  ${row("Third point")}
</div></div></div>`;

function setup() {
  document.body.innerHTML = LIST_HTML;
  const root = document.querySelector(".slide-content") as HTMLElement;
  const list = document.querySelector(".bullets") as HTMLElement;
  return { root, list };
}

function placeCaret(node: Node, offset: number) {
  const sel = window.getSelection();
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(range);
}

describe("styled bullet editing", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("recognizes styled bullet rows and lists", () => {
    const { list } = setup();
    expect(isBulletList(list)).toBe(true);
    for (const r of Array.from(list.children)) {
      expect(isBulletRow(r as HTMLElement)).toBe(true);
    }
  });

  it("resolves a bullet text span to its list container", () => {
    const { root, list } = setup();
    const thirdText = list.children[2].children[1] as HTMLElement;
    expect(findEnclosingList(thirdText, root)).toBe(list);
  });

  it("adds a new row when Enter is pressed at the end of a bullet", () => {
    const { list } = setup();
    const thirdText = list.children[2].children[1] as HTMLElement;
    const textNode = thirdText.firstChild as Text;
    placeCaret(textNode, textNode.length);

    expect(list.children.length).toBe(3);
    expect(insertBulletAfterCaret(list)).toBe(true);
    expect(list.children.length).toBe(4);

    const newRow = list.children[3] as HTMLElement;
    expect(newRow.children[0].textContent).toBe("\u25CF");
    expect((newRow.children[1].textContent ?? "").replace(/\u200B/g, "")).toBe(
      "",
    );
    expect((newRow as HTMLElement).style.fontSize).toBe("22px");
  });

  it("seeds the new bullet's text span with a real zero-width-space character, not an empty tail node", () => {
    // Regression test: Range.extractContents() on a collapsed range (caret at
    // the very end of the text, the common case) still clones the boundary
    // text node with empty data instead of returning a childless fragment.
    // If that empty node is mistaken for a real "tail" to move over, the new
    // row's text span ends up with a contentless text node instead of the
    // zero-width-space placeholder, and the caret has nothing to anchor its
    // font to.
    const { list } = setup();
    const thirdText = list.children[2].children[1] as HTMLElement;
    const textNode = thirdText.firstChild as Text;
    placeCaret(textNode, textNode.length);

    expect(insertBulletAfterCaret(list)).toBe(true);
    const newTextSpan = list.children[3].children[1] as HTMLElement;
    expect(newTextSpan.childNodes.length).toBe(1);
    expect(newTextSpan.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect((newTextSpan.firstChild as Text).data).toBe("\u200B");
  });

  it("splits text after the caret into the new bullet", () => {
    const { list } = setup();
    const secondText = list.children[1].children[1] as HTMLElement;
    const textNode = secondText.firstChild as Text;
    placeCaret(textNode, "Second".length);

    insertBulletAfterCaret(list);
    expect(list.children.length).toBe(4);
    expect(secondText.textContent).toBe("Second");
    const newRow = list.children[2] as HTMLElement;
    expect(newRow.children[1].textContent).toBe(" point");
  });

  it("preserves inline formatting when the tail moves to the new bullet", () => {
    document.body.innerHTML =
      '<div class="slide-content"><div class="bullets" style="display:flex;flex-direction:column;">' +
      '<div style="font-size:22px;"><span style="font-size:8px;">\u25CF</span><span>Hello <strong>bold tail</strong></span></div>' +
      '<div style="font-size:22px;"><span style="font-size:8px;">\u25CF</span><span>Second</span></div>' +
      "</div></div>";
    const list = document.querySelector(".bullets") as HTMLElement;
    const textSpan = list.children[0].children[1] as HTMLElement;
    const leadingText = textSpan.firstChild as Text;
    placeCaret(leadingText, leadingText.length);

    expect(insertBulletAfterCaret(list)).toBe(true);
    expect(list.children.length).toBe(3);

    expect(textSpan.textContent).toBe("Hello ");
    const newRow = list.children[1] as HTMLElement;
    const newText = newRow.children[1] as HTMLElement;
    expect(newText.querySelector("strong")).not.toBeNull();
    expect(newText.querySelector("strong")?.textContent).toBe("bold tail");
  });

  it("preserves formatting when splitting inside a formatted run", () => {
    document.body.innerHTML =
      '<div class="slide-content"><div class="bullets" style="display:flex;flex-direction:column;">' +
      '<div style="font-size:22px;"><span style="font-size:8px;">\u25CF</span><span><strong>bold tail</strong></span></div>' +
      "</div></div>";
    const list = document.querySelector(".bullets") as HTMLElement;
    const strong = list.children[0].children[1].firstChild as HTMLElement;
    const strongText = strong.firstChild as Text;
    placeCaret(strongText, "bold".length);

    expect(insertBulletAfterCaret(list)).toBe(true);
    expect(list.children.length).toBe(2);

    const headStrong = list.children[0].children[1].querySelector("strong");
    expect(headStrong?.textContent).toBe("bold");
    const tailStrong = list.children[1].children[1].querySelector("strong");
    expect(tailStrong?.textContent).toBe(" tail");
  });

  it("does not blank the marker when the caret is inside the marker glyph", () => {
    const { list } = setup();
    const firstRow = list.children[0] as HTMLElement;
    const markerText = firstRow.children[0].firstChild as Text;
    placeCaret(markerText, 0);

    expect(insertBulletAfterCaret(list)).toBe(true);
    expect(list.children.length).toBe(4);

    expect(firstRow.children[0].textContent).toBe("\u25CF");
    expect(firstRow.children[1].textContent).toBe("First point");
    expect(isBulletRow(firstRow)).toBe(true);

    const newRow = list.children[1] as HTMLElement;
    expect(isBulletRow(newRow)).toBe(true);
    expect((newRow.children[1].textContent ?? "").replace(/\u200B/g, "")).toBe(
      "",
    );
  });

  it("recognizes a list when a row's text is a bare text node", () => {
    document.body.innerHTML =
      '<div class="slide-content"><div class="bullets" style="display:flex;flex-direction:column;">' +
      '<div style="font-size:22px;"><span>\u25CF</span><span>First point</span></div>' +
      '<div style="font-size:22px;"><span>\u25CF</span>Second point</div>' +
      "</div></div>";
    const root = document.querySelector(".slide-content") as HTMLElement;
    const list = document.querySelector(".bullets") as HTMLElement;
    expect(isBulletList(list)).toBe(true);

    const second = list.children[1] as HTMLElement;
    const bareText = second.childNodes[1] as Text;
    expect(findEnclosingList(second, root)).toBe(list);

    placeCaret(bareText, bareText.length);
    expect(insertBulletAfterCaret(list)).toBe(true);
    expect(list.children.length).toBe(3);
    const newRow = list.children[2] as HTMLElement;
    expect(newRow.textContent?.includes("\u25CF")).toBe(true);
  });

  it("tolerates one stray non-bullet child in the list", () => {
    document.body.innerHTML =
      '<div class="slide-content"><div class="bullets">' +
      "<div><span>\u25CF</span><span>First point</span></div>" +
      "<div><span>\u25CF</span><span>Second point</span></div>" +
      "<br>" +
      "</div></div>";
    const list = document.querySelector(".bullets") as HTMLElement;
    expect(isBulletList(list)).toBe(true);
  });
});
