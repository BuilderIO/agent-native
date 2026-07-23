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
