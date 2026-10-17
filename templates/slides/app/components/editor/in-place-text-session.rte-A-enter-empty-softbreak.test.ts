// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  type InPlaceTextSession,
  startInPlaceTextSession,
} from "./in-place-text-session";
import {
  ZWSP,
  caret,
  installSelectionModify,
  mount,
  press,
  restoreGlobals,
  select,
  show,
  textNodes,
  type,
} from "./rte-test-utils";

let session: InPlaceTextSession | null = null;

/**
 * The shared fake cannot start from an element boundary, which is where Chrome
 * puts the caret in an empty item; there a backward step lands at the end of
 * the text before it.
 */
beforeAll(() => {
  installSelectionModify();
  const proto = Object.getPrototypeOf(window.getSelection()!) as Selection;
  const modify = proto.modify;
  proto.modify = function (this: Selection, alter, direction, granularity) {
    const range = this.getRangeAt(0);
    const host = (range.startContainer as Element).closest?.(
      '[contenteditable="true"]',
    );
    if (
      direction !== "backward" ||
      !host ||
      range.startContainer instanceof Text
    ) {
      return modify.call(this, alter, direction, granularity);
    }
    const before = textNodes(host).filter(
      (text) => range.comparePoint(text, text.length) < 0,
    );
    const previous = before[before.length - 1];
    const moved = document.createRange();
    moved.setStart(previous, previous.length);
    moved.setEnd(range.endContainer, range.endOffset);
    this.removeAllRanges();
    this.addRange(moved);
  };
});

afterEach(() => {
  session?.end();
  session = null;
  document.body.innerHTML = "";
  restoreGlobals();
});

/** Mounts `html` in a text block and places the caret at the first `|`. */
function edit(html: string) {
  const el = mount(`<div id="t">${html.replace("|", "")}</div>`);
  session = startInPlaceTextSession(el, {});
  let remaining = html.replace(/<[^>]*>/g, "").indexOf("|");
  for (const node of textNodes(el)) {
    if (remaining <= node.length) {
      caret(node, remaining);
      return session.element;
    }
    remaining -= node.length;
  }
  throw new Error(`no caret position in ${html}`);
}

/** Same, with the caret in an element that has no text node. */
function editEmpty(html: string, selector: string) {
  const el = mount(`<div id="t">${html}</div>`);
  session = startInPlaceTextSession(el, {});
  caret(el.querySelector(selector)!, 0);
  return session.element;
}

/** Placeholders sitting beside the blocks read as an extra empty line. */
function looseText(el: HTMLElement) {
  return Array.from(el.childNodes).filter((node) => node instanceof Text);
}

function keys(el: HTMLElement, steps: string[]) {
  for (const step of steps) {
    if (step.startsWith("type:")) type(el, step.slice(5));
    else press(el, step);
  }
}

/** The saved document: what the session writes back, placeholders gone. */
function saved(el: HTMLElement) {
  return plain(session!.cloneWithoutPlaceholders(el).innerHTML);
}

/** Block margins the session adds are styling, not structure. */
function plain(markup: string) {
  return markup.replaceAll(' style="margin: 0px;"', "");
}

describe("Enter in a sole empty block", () => {
  it("splits an empty paragraph into exactly two blocks", () => {
    const el = editEmpty("<p></p>", "p");
    keys(el, ["Enter", "type:x"]);
    expect(plain(show(el))).toBe("<p></p><p>x|</p>");
    expect(looseText(el)).toEqual([]);
    // A lone break keeps the empty paragraph from collapsing, as it will once saved.
    expect(saved(el)).toBe("<p><br></p><p>x</p>");
  });

  it("keeps the count across repeated Enter", () => {
    const el = editEmpty("<p></p>", "p");
    keys(el, ["Enter", "Enter", "Enter", "type:x"]);
    expect(plain(show(el))).toBe("<p></p><p></p><p></p><p>x|</p>");
    expect(looseText(el)).toEqual([]);
  });

  it("exits an empty heading into a paragraph with no stray block", () => {
    const el = editEmpty("<h2></h2>", "h2");
    keys(el, ["Enter", "type:abc"]);
    expect(plain(show(el))).toBe("<h2></h2><p>abc|</p>");
    expect(looseText(el)).toEqual([]);
  });
});

describe("Enter on an empty nested list item", () => {
  it("outdents and keeps the caret in the outdented item", () => {
    const el = editEmpty(
      "<ul><li>A<ul><li></li><li>B</li></ul></li></ul>",
      "ul ul li",
    );
    keys(el, ["Enter", "type:x"]);
    expect(plain(show(el))).toBe(
      "<ul><li>A</li><li>x|<ul><li>B</li></ul></li></ul>",
    );
  });

  it("exits the list on the second Enter", () => {
    const el = editEmpty("<ul><li>A<ul><li></li></ul></li></ul>", "ul ul li");
    keys(el, ["Enter", "Enter", "type:x"]);
    expect(plain(show(el))).toBe("<ul><li>A</li></ul><p>x|</p>");
  });

  it("outdents the only nested item", () => {
    const el = editEmpty("<ul><li>a<ul><li></li></ul></li></ul>", "ul ul li");
    keys(el, ["Enter", "type:x"]);
    expect(plain(show(el))).toBe("<ul><li>a</li><li>x|</li></ul>");
  });

  it("puts the caret back in the outdented item after redo", () => {
    const el = editEmpty("<ul><li>a<ul><li></li></ul></li></ul>", "ul ul li");
    keys(el, ["Enter"]);
    press(el, "Meta+z");
    press(el, "Meta+Shift+z");
    keys(el, ["type:x"]);
    expect(plain(show(el))).toBe("<ul><li>a</li><li>x|</li></ul>");
  });

  it("exits the list on Backspace after the outdent", () => {
    const el = editEmpty("<ul><li>a<ul><li></li></ul></li></ul>", "ul ul li");
    keys(el, ["Enter", "Backspace", "type:x"]);
    expect(plain(show(el))).toBe("<ul><li>a</li></ul><p>x|</p>");
  });
});

describe("Shift+Enter at the end of a link", () => {
  it("types plain text after the break", () => {
    const el = edit('<p><a href="x">ab|</a></p>');
    keys(el, ["Shift+Enter", "type:c"]);
    expect(saved(el)).toBe('<p><a href="x">ab</a><br>c</p>');
    expect(plain(show(el))).toBe('<p><a href="x">ab</a><br>c|</p>');
  });

  it("keeps the break inside the paragraph of a block-level link", () => {
    const el = edit('<a href="x"><h3>T</h3><p>Desc|</p></a><p>after</p>');
    keys(el, ["Shift+Enter", "type:c"]);
    expect(saved(el)).toBe(
      '<a href="x"><h3>T</h3><p>Desc<br>c</p></a><p>after</p>',
    );
  });

  it("keeps trailing text outside the link too", () => {
    const el = edit('<p><a href="x">ab|</a>cd</p>');
    keys(el, ["Shift+Enter", "type:c"]);
    expect(saved(el)).toBe('<p><a href="x">ab</a><br>ccd</p>');
  });
});

describe("Enter over a fully selected list item", () => {
  it("leaves an empty bullet and a new bullet", () => {
    const el = mount(
      '<div id="t"><ul><li>apple</li><li>banana</li></ul></div>',
    );
    const text = textNodes(el)[0];
    session = startInPlaceTextSession(el, {});
    select(text, 0, text, 5);
    keys(session.element, ["Enter", "type:Z"]);
    expect(plain(show(session.element))).toBe(
      "<ul><li></li><li>Z|</li><li>banana</li></ul>",
    );
  });

  it("exits the list when Enter replaces only the placeholder", () => {
    const el = edit("<ul><li>a|</li></ul>");
    keys(el, ["Enter"]);
    const placeholder = textNodes(el).find((node) => node.data === ZWSP)!;
    select(placeholder, 0, placeholder, 1);
    keys(el, ["Enter", "type:x"]);
    expect(plain(show(el))).toBe("<ul><li>a</li></ul><p>x|</p>");
  });

  it("leaves an empty row and a new row for a selected legacy bullet", () => {
    const el = mount(
      '<div id="t"><div style="display: flex"><span>●</span><span>one</span></div><div style="display: flex"><span>●</span><span>two</span></div></div>',
    );
    session = startInPlaceTextSession(el, {});
    const text = textNodes(el).find((node) => node.data === "two")!;
    select(text, 0, text, 3);
    keys(session.element, ["Enter", "type:x"]);
    expect(session.element.children).toHaveLength(3);
    expect(session.element.lastElementChild!.textContent).toContain("x");
    expect(session.element.lastElementChild!.textContent).toContain("●");
  });

  it("still exits for an already-empty legacy row selected from its marker", () => {
    const el = mount(
      '<div id="t"><div style="display: flex"><span>●</span><span>one</span></div><div style="display: flex"><span>●</span><span></span></div></div>',
    );
    session = startInPlaceTextSession(el, {});
    const row = el.children[1];
    select(textNodes(row)[0], 0, row.children[1], 0);
    keys(session.element, ["Enter", "type:x"]);
    expect(session.element.children).toHaveLength(2);
    expect(
      session.element.lastElementChild!.textContent!.replaceAll(ZWSP, ""),
    ).toBe("x");
  });

  it("still exits the list for an already-empty item", () => {
    const el = editEmpty("<ul><li>a</li><li></li></ul>", "li:last-child");
    keys(el, ["Enter", "type:x"]);
    expect(plain(show(el))).toBe("<ul><li>a</li></ul><p>x|</p>");
  });
});

describe("Enter in a whitespace-only quote paragraph", () => {
  it("splits inside the quote and keeps the space", () => {
    const el = editEmpty("<blockquote><p></p></blockquote>", "p");
    keys(el, ["type: ", "Enter", "type:x"]);
    expect(plain(show(el))).toBe(
      "<blockquote><p>&nbsp;</p><p>x|</p></blockquote>",
    );
    expect(saved(el)).toBe("<blockquote><p>&nbsp;</p><p>x</p></blockquote>");
  });

  it("splits a list item holding only a typed space", () => {
    const el = editEmpty("<ul><li>a</li><li></li></ul>", "li:last-child");
    keys(el, ["type: ", "Enter", "type:x"]);
    expect(plain(show(el))).toBe(
      "<ul><li>a</li><li>&nbsp;</li><li>x|</li></ul>",
    );
  });

  it("exits the quote from a truly empty paragraph", () => {
    const el = editEmpty("<blockquote><p></p></blockquote>", "p");
    keys(el, ["Enter", "type:x"]);
    expect(plain(show(el))).toBe("<p>x|</p>");
  });
});
