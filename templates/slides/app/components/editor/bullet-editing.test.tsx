// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import {
  findEnclosingList,
  insertBulletAfterCaret,
  isBulletList,
  isBulletRow,
} from "@/components/editor/SlideEditor";

const LIST_HTML = `<div class="slide-content"><div data-fmd-autofit-content="true"><div class="bullets" style="display: flex; flex-direction: column; gap: 16px;">
  <div style="display: flex; align-items: baseline; gap: 20px; font-size: 22px;"><span style="font-size: 8px;">&#x25CF;</span><span>First point</span></div>
  <div style="display: flex; align-items: baseline; gap: 20px; font-size: 22px;"><span style="font-size: 8px;">&#x25CF;</span><span>Second point</span></div>
  <div style="display: flex; align-items: baseline; gap: 20px; font-size: 22px;"><span style="font-size: 8px;">&#x25CF;</span><span>Third point</span></div>
</div></div></div>`;

function setup() {
  document.body.innerHTML = LIST_HTML;
  const root = document.querySelector(".slide-content") as HTMLElement;
  const list = document.querySelector(".bullets") as HTMLElement;
  return { root, list };
}

function caretAtEndOf(textSpan: HTMLElement) {
  const textNode = textSpan.firstChild as Text;
  const sel = window.getSelection();
  const range = document.createRange();
  range.setStart(textNode, textNode.length);
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
    for (const row of Array.from(list.children)) {
      expect(isBulletRow(row as HTMLElement)).toBe(true);
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
    caretAtEndOf(thirdText);

    expect(list.children.length).toBe(3);
    const created = insertBulletAfterCaret(list);
    expect(created).toBe(true);
    expect(list.children.length).toBe(4);

    const newRow = list.children[3] as HTMLElement;
    // Marker preserved, text emptied (zero-width space placeholder only).
    expect(newRow.children[0].textContent).toBe("\u25CF");
    expect((newRow.children[1].textContent ?? "").replace(/\u200B/g, "")).toBe(
      "",
    );
    // New row keeps the 22px font styling so typed text matches siblings.
    expect((newRow as HTMLElement).style.fontSize).toBe("22px");
  });

  it("splits text after the caret into the new bullet", () => {
    const { list } = setup();
    const secondText = list.children[1].children[1] as HTMLElement;
    const textNode = secondText.firstChild as Text;
    // Caret after "Second" (before " point").
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, "Second".length);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);

    insertBulletAfterCaret(list);
    expect(list.children.length).toBe(4);
    expect(secondText.textContent).toBe("Second");
    const newRow = list.children[2] as HTMLElement;
    expect(newRow.children[1].textContent).toBe(" point");
  });
});
