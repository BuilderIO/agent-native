// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import {
  convertMarkdownPrefixToBullet,
  exitEmptyBulletAtCaret,
  findEnclosingList,
  insertBulletAfterCaret,
  isBulletList,
  isBulletRow,
  removeEmptyBulletAtCaret,
  ZERO_WIDTH_SPACE,
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

  it("resolves a native list item to its UL or OL", () => {
    // Editing the LI in isolation traps Enter inside that one item, so the
    // list itself has to become the edit host.
    const root = document.createElement("div");
    root.innerHTML = "<ul><li>One</li><li>Two</li></ul><ol><li>First</li></ol>";
    document.body.append(root);

    const unordered = root.querySelector("ul") as HTMLElement;
    const ordered = root.querySelector("ol") as HTMLElement;

    expect(findEnclosingList(unordered.children[1] as HTMLElement, root)).toBe(
      unordered,
    );
    expect(findEnclosingList(ordered.children[0] as HTMLElement, root)).toBe(
      ordered,
    );
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

  it("removes a fresh empty bullet on the first Backspace", () => {
    const { list } = setup();
    const thirdText = list.children[2].children[1] as HTMLElement;
    const textNode = thirdText.firstChild as Text;
    placeCaret(textNode, textNode.length);

    expect(insertBulletAfterCaret(list)).toBe(true);
    const result = removeEmptyBulletAtCaret(list);

    expect(result).toEqual({ handled: true, editingElement: null });
    expect(list.children.length).toBe(3);
    const selection = window.getSelection();
    expect(selection?.anchorNode).toBe(thirdText.firstChild);
    expect(selection?.anchorOffset).toBe(textNode.length);
  });

  it("turns an empty bullet Enter into a root-level line", () => {
    const { root, list } = setup();
    const thirdText = list.children[2].children[1] as HTMLElement;
    const textNode = thirdText.firstChild as Text;
    placeCaret(textNode, textNode.length);

    expect(insertBulletAfterCaret(list)).toBe(true);
    const line = exitEmptyBulletAtCaret(list);

    expect(line).not.toBeNull();
    expect(list.children.length).toBe(3);
    expect(line?.parentElement).toBe(
      root.querySelector("[data-fmd-autofit-content]"),
    );
    expect(line?.previousElementSibling).toBe(list);
    expect(isBulletRow(line as HTMLElement)).toBe(false);
    expect(line?.textContent).toBe(ZERO_WIDTH_SPACE);
    expect(line?.contains(window.getSelection()?.anchorNode ?? null)).toBe(
      true,
    );
  });

  it("keeps later bullets after an exited middle bullet", () => {
    const { root, list } = setup();
    const firstText = list.children[0].children[1] as HTMLElement;
    const textNode = firstText.firstChild as Text;
    placeCaret(textNode, textNode.length);

    expect(insertBulletAfterCaret(list)).toBe(true);
    const line = exitEmptyBulletAtCaret(list);
    const content = root.querySelector(
      "[data-fmd-autofit-content]",
    ) as HTMLElement;
    const trailingList = line?.nextElementSibling as HTMLElement;

    expect(line).not.toBeNull();
    expect(Array.from(content.children)).toEqual([list, line, trailingList]);
    expect(list.children[0].textContent).toContain("First point");
    expect(isBulletList(trailingList)).toBe(true);
    expect(trailingList.children[0].textContent).toContain("Second point");
    expect(trailingList.children[1].textContent).toContain("Third point");
  });

  it.each(["ul", "ol"] as const)(
    "preserves native %s list structure after exiting an empty item",
    (tag) => {
      const startAttribute = tag === "ol" ? ' start="4"' : "";
      document.body.innerHTML =
        `<div class="slide-content"><${tag}${startAttribute}><li>First</li>` +
        `<li>${ZERO_WIDTH_SPACE}</li><li>Third</li></${tag}></div>`;
      const root = document.querySelector(".slide-content") as HTMLElement;
      const list = root.firstElementChild as HTMLElement;
      const emptyText = list.children[1].firstChild as Text;
      placeCaret(emptyText, emptyText.length);

      const line = exitEmptyBulletAtCaret(list);
      const children = Array.from(root.children);

      expect(line).not.toBeNull();
      expect(children.map((child) => child.tagName)).toEqual([
        tag.toUpperCase(),
        "DIV",
        tag.toUpperCase(),
      ]);
      expect(children[0].children[0].textContent).toBe("First");
      expect(children[2].children[0].textContent).toBe("Third");
      if (tag === "ol") {
        expect(children[2].getAttribute("start")).toBe("6");
      }
    },
  );

  it.each([
    ["default", " reversed", "3", "1"],
    ["explicit", ' reversed start="8"', "8", "6"],
  ] as const)(
    "preserves %s reversed ordered-list numbering after exiting an empty item",
    (_name, attributes, leadingStart, trailingStart) => {
      document.body.innerHTML =
        `<div class="slide-content"><ol${attributes}><li>First</li>` +
        `<li>${ZERO_WIDTH_SPACE}</li><li>Third</li></ol></div>`;
      const root = document.querySelector(".slide-content") as HTMLElement;
      const list = root.firstElementChild as HTMLElement;
      const emptyText = list.children[1].firstChild as Text;
      placeCaret(emptyText, emptyText.length);

      const line = exitEmptyBulletAtCaret(list);
      const children = Array.from(root.children);

      expect(line).not.toBeNull();
      expect(children[0].getAttribute("start")).toBe(leadingStart);
      expect(children[2].getAttribute("start")).toBe(trailingStart);
    },
  );

  it("preserves a tolerated child when Enter exits its only bullet", () => {
    document.body.innerHTML =
      '<div class="slide-content"><div class="bullets">' +
      `<div><span>\u25CF</span><span>${ZERO_WIDTH_SPACE}</span></div>` +
      '<div class="kept">Keep me</div>' +
      "</div></div>";
    const root = document.querySelector(".slide-content") as HTMLElement;
    const list = root.querySelector(".bullets") as HTMLElement;
    const textNode = list.children[0].children[1].firstChild as Text;
    placeCaret(textNode, textNode.length);

    const line = exitEmptyBulletAtCaret(list);

    expect(line).not.toBeNull();
    expect(root.querySelector(".bullets")).toBeNull();
    expect(root.querySelector(".kept")?.textContent).toBe("Keep me");
    expect(line?.nextElementSibling?.className).toBe("kept");
  });

  it("preserves a tolerated child when Backspace removes its only bullet", () => {
    document.body.innerHTML =
      '<div class="slide-content"><div class="bullets">' +
      `<div><span>\u25CF</span><span>${ZERO_WIDTH_SPACE}</span></div>` +
      '<div class="kept">Keep me</div>' +
      "</div></div>";
    const root = document.querySelector(".slide-content") as HTMLElement;
    const list = root.querySelector(".bullets") as HTMLElement;
    const textNode = list.children[0].children[1].firstChild as Text;
    placeCaret(textNode, textNode.length);

    expect(removeEmptyBulletAtCaret(list)).toEqual({
      handled: true,
      editingElement: null,
    });
    expect(root.querySelector(".kept")?.textContent).toBe("Keep me");
    expect(list.children.length).toBe(1);
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

describe("markdown prefix autoformat", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("converts a leading '- ' into a bullet row nested inside the block", () => {
    document.body.innerHTML =
      '<div class="slide-content"><div style="font-size: 28px;">- </div></div>';
    const root = document.querySelector(".slide-content") as HTMLElement;
    const el = root.firstElementChild as HTMLElement;
    const textNode = el.firstChild as Text;
    placeCaret(textNode, textNode.length);

    expect(convertMarkdownPrefixToBullet(el)).toBe(true);
    expect(el.style.display).toBe("flex");
    expect(el.style.flexDirection).toBe("column");
    expect(el.children.length).toBe(1);

    const row = el.children[0] as HTMLElement;
    expect(isBulletRow(row)).toBe(true);
    expect(isBulletList(el)).toBe(true);
    expect(row.children[0].textContent).toBe("\u25CF");
    expect((row.children[1].textContent ?? "").replace(/\u200B/g, "")).toBe("");

    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    const landedInTextSpan =
      anchor === row.children[1] || anchor?.parentElement === row.children[1];
    const landedInMarker =
      anchor === row.children[0] || anchor?.parentElement === row.children[0];
    expect(landedInTextSpan).toBe(true);
    expect(landedInMarker).toBe(false);
  });

  it("lets Enter extend a list created from a markdown prefix", () => {
    document.body.innerHTML =
      '<div class="slide-content"><div style="font-size: 28px;">- hi</div></div>';
    const root = document.querySelector(".slide-content") as HTMLElement;
    const el = root.firstElementChild as HTMLElement;
    const textNode = el.firstChild as Text;
    placeCaret(textNode, "- ".length);

    expect(convertMarkdownPrefixToBullet(el)).toBe(true);
    const row = el.children[0] as HTMLElement;
    expect(row.children[1].textContent).toBe("hi");

    const textNodeAfterConvert = row.children[1].firstChild as Text;
    placeCaret(textNodeAfterConvert, textNodeAfterConvert.length);
    expect(findEnclosingList(row.children[1] as HTMLElement, root)).toBe(el);
    expect(insertBulletAfterCaret(el)).toBe(true);
    expect(el.children.length).toBe(2);
    expect(isBulletRow(el.children[1] as HTMLElement)).toBe(true);
  });

  it("replaces a one-item markdown bullet with a root-level line on Enter", () => {
    document.body.innerHTML =
      '<div class="slide-content"><div style="font-size: 28px;">- </div></div>';
    const root = document.querySelector(".slide-content") as HTMLElement;
    const el = root.firstElementChild as HTMLElement;
    const textNode = el.firstChild as Text;
    placeCaret(textNode, textNode.length);

    expect(convertMarkdownPrefixToBullet(el)).toBe(true);
    const line = exitEmptyBulletAtCaret(el);

    expect(line).not.toBeNull();
    expect(root.firstElementChild).toBe(line);
    expect(isBulletRow(line as HTMLElement)).toBe(false);
    expect(line?.style.fontSize).toBe("28px");
    expect(line?.textContent).toBe(ZERO_WIDTH_SPACE);
  });

  it("does not convert once the block is already a bullet row", () => {
    document.body.innerHTML =
      '<div class="slide-content"><div><span>\u25CF</span><span>- text</span></div></div>';
    const root = document.querySelector(".slide-content") as HTMLElement;
    const row = root.firstElementChild as HTMLElement;
    const textSpan = row.children[1] as HTMLElement;
    const textNode = textSpan.firstChild as Text;
    placeCaret(textNode, textNode.length);

    expect(convertMarkdownPrefixToBullet(row)).toBe(false);
  });

  it("does not convert when there is no markdown prefix", () => {
    document.body.innerHTML =
      '<div class="slide-content"><div>Just text</div></div>';
    const root = document.querySelector(".slide-content") as HTMLElement;
    const el = root.firstElementChild as HTMLElement;
    const textNode = el.firstChild as Text;
    placeCaret(textNode, textNode.length);

    expect(convertMarkdownPrefixToBullet(el)).toBe(false);
    expect(el.children.length).toBe(0);
  });

  it("converts a leading dash typed in a fresh ZWS-seeded text box", () => {
    document.body.innerHTML =
      '<div class="slide-content"><div style="font-size: 28px;"></div></div>';
    const root = document.querySelector(".slide-content") as HTMLElement;
    const el = root.firstElementChild as HTMLElement;
    const textNode = document.createTextNode(ZERO_WIDTH_SPACE + "- ");
    el.appendChild(textNode);
    placeCaret(textNode, textNode.length);

    expect(convertMarkdownPrefixToBullet(el)).toBe(true);
    expect(isBulletList(el)).toBe(true);
    const row = el.children[0] as HTMLElement;
    expect(isBulletRow(row)).toBe(true);
    expect(row.children[0].textContent).toBe("\u25CF");
  });
});
