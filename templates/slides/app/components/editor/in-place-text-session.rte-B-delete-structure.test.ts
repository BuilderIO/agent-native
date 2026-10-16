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

beforeAll(() => {
  installSelectionModify();
});

afterEach(() => {
  session?.end();
  session = null;
  document.body.innerHTML = "";
  restoreGlobals();
});

/** Mounts `html` in a text block and places the caret at the `|` marker. */
function edit(html: string) {
  const el = mount(`<div id="t">${html}</div>`);
  session = startInPlaceTextSession(el, {});
  const marked = textNodes(el).find((node) => node.data.includes("|"));
  if (!marked) throw new Error(`no caret marker in ${html}`);
  const at = marked.data.indexOf("|");
  marked.deleteData(at, 1);
  caret(marked, at);
  return session.element;
}

/** Mounts `html` with no selection, for tests that set their own range. */
function editRange(html: string) {
  const el = mount(`<div id="t">${html}</div>`);
  session = startInPlaceTextSession(el, {});
  return session.element;
}

/** Same, with the caret at offset 0 of an element that holds no text. */
function editEmpty(html: string, selector: string) {
  const el = mount(`<div id="t">${html}</div>`);
  session = startInPlaceTextSession(el, {});
  caret(el.querySelector(selector)!, 0);
  return session.element;
}

function cut(el: HTMLElement) {
  el.dispatchEvent(
    new ClipboardEvent("cut", {
      clipboardData: new DataTransfer(),
      bubbles: true,
      cancelable: true,
    }),
  );
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

describe("Backspace at the start of a heading", () => {
  it("removes an empty paragraph before it and keeps the heading level", () => {
    const el = edit("<p>x</p><p></p><h2>|Head</h2>");
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<p>x</p><h2>Head</h2>");
    expect(plain(show(el))).toBe("<p>x</p><h2>|Head</h2>");
  });

  it("keeps the heading when the empty paragraph is first", () => {
    const el = edit("<p></p><h2>|Head</h2>");
    keys(el, ["Backspace", "type:Z"]);
    expect(saved(el)).toBe("<h2>ZHead</h2>");
  });

  it("keeps a decorative empty box and demotes the heading", () => {
    const el = edit(
      '<p>x</p><div style="height: 4px; background: red"></div><h2>|Head</h2>',
    );
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe(
      '<p>x</p><div style="height: 4px; background: red"></div><p>Head</p>',
    );
  });

  it("still demotes a heading that follows text", () => {
    const el = edit("<p>a</p><h2>|b</h2>");
    keys(el, ["Backspace"]);
    expect(plain(show(el))).toBe("<p>a</p><p>|b</p>");
  });
});

describe("Forward Delete at the end of a block", () => {
  it("removes an empty paragraph before a heading without eating text", () => {
    const el = editEmpty("<p></p><h2>Head</h2>", "p");
    keys(el, ["Delete"]);
    expect(saved(el)).toBe("<h2>Head</h2>");
    expect(plain(show(el))).toBe("<h2>|Head</h2>");
  });

  it("removes an empty paragraph before a list", () => {
    const el = editEmpty("<p></p><ul><li>a</li></ul>", "p");
    keys(el, ["Delete"]);
    expect(saved(el)).toBe("<ul><li>a</li></ul>");
    expect(plain(show(el))).toBe("<ul><li>|a</li></ul>");
  });

  it("removes an empty paragraph before a quote", () => {
    const el = editEmpty("<p></p><blockquote><p>q</p></blockquote>", "p");
    keys(el, ["Delete"]);
    expect(saved(el)).toBe("<blockquote><p>q</p></blockquote>");
  });

  it("joins a paragraph after a heading into it", () => {
    const el = edit("<h2>Title|</h2><p>Body</p>");
    keys(el, ["Delete"]);
    expect(saved(el)).toBe("<h2>TitleBody</h2>");
    expect(plain(show(el))).toBe("<h2>Title|Body</h2>");
  });

  it("joins a heading after a heading, keeping the first type", () => {
    const el = edit("<h2>a|</h2><h3>b</h3>");
    keys(el, ["Delete"]);
    expect(saved(el)).toBe("<h2>ab</h2>");
  });

  it("joins a paragraph with the heading after it", () => {
    const el = edit("<p>a|</p><h2>b</h2>");
    keys(el, ["Delete"]);
    expect(saved(el)).toBe("<p>ab</p>");
  });

  it("joins a paragraph with the quote after it", () => {
    const el = edit("<p>a|</p><blockquote><p>b</p></blockquote>");
    keys(el, ["Delete"]);
    expect(saved(el)).toBe("<p>ab</p>");
  });

  it("joins a paragraph with the first item of a following list", () => {
    const el = edit("<p>A|</p><ul><li>B</li><li>C</li></ul>");
    keys(el, ["Delete", "type:x"]);
    expect(saved(el)).toBe("<p>AxB</p><ul><li>C</li></ul>");
  });

  it("keeps a whitespace-only paragraph as line content", () => {
    const el = edit("<p>&nbsp;|</p><h2>Head</h2>");
    keys(el, ["Delete"]);
    expect(saved(el)).toBe("<p>&nbsp;Head</p>");
  });

  it("leaves the nested list to the item when its only line is empty", () => {
    const el = edit("<ul><li><p>|</p><ul><li>a</li></ul></li></ul>");
    keys(el, ["Delete"]);
    expect(saved(el)).toBe("<ul><li><p>a</p></li></ul>");
    expect(plain(show(el))).toBe("<ul><li><p>|a</p></li></ul>");
  });

  it("joins an item with its nested list's first item", () => {
    const el = edit("<ul><li>A|<ul><li>B</li></ul></li></ul>");
    keys(el, ["Delete", "type:x"]);
    expect(saved(el)).toBe("<ul><li>AxB</li></ul>");
  });

  it("leaves the caret on the line of a break-held paragraph that follows", () => {
    const el = editEmpty("<p></p><p><br></p><p>c</p>", "p");
    keys(el, ["Delete"]);
    expect(plain(show(el))).toBe("<p>|<br></p><p>c</p>");
  });

  it("leaves the caret on the line of a break-held heading that follows", () => {
    const el = editEmpty("<p></p><h2><br></h2><p>c</p>", "p");
    keys(el, ["Delete"]);
    expect(plain(show(el))).toBe("<h2>|<br></h2><p>c</p>");
  });

  it("leaves the caret on a break-held first item of a following list", () => {
    const el = editEmpty("<p></p><ul><li><br></li><li>b</li></ul>", "p");
    keys(el, ["Delete"]);
    expect(plain(show(el))).toBe("<ul><li>|<br></li><li>b</li></ul>");
  });

  it("leaves the caret before an image that starts the next block", () => {
    const el = editEmpty('<p></p><div><img src="x.png"></div>', "p");
    keys(el, ["Delete"]);
    expect(plain(show(el))).toBe('<div>|<img src="x.png"></div>');
  });

  it("removes a break-held paragraph before a quote and keeps the caret in it", () => {
    const el = editEmpty("<p></p><blockquote><p><br></p></blockquote>", "p");
    keys(el, ["Delete"]);
    expect(plain(show(el))).toBe("<blockquote><p>|<br></p></blockquote>");
  });

  it("joins the nested list's first item into an empty paragraph, keeping the rest nested", () => {
    const el = edit("<ul><li><p>|</p><ul><li>a</li><li>b</li></ul></li></ul>");
    keys(el, ["Delete", "type:x"]);
    expect(saved(el)).toBe("<ul><li><p>xa</p><ul><li>b</li></ul></li></ul>");
  });
});

describe("Backspace at the start of a nested list item", () => {
  it("outdents it one level as a sibling of its parent", () => {
    const el = edit("<ul><li>a<ul><li>|b</li></ul></li></ul>");
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(plain(show(el))).toBe("<ul><li>a</li><li>|b</li></ul>");
  });

  it("outdents one level at depth three", () => {
    const el = edit(
      "<ul><li>a<ul><li>b<ul><li>|c</li></ul></li></ul></li></ul>",
    );
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<ul><li>a<ul><li>b</li><li>c</li></ul></li></ul>");
  });

  it("exits the list from the top level afterwards", () => {
    const el = edit("<ul><li>a<ul><li>|b</li></ul></li></ul>");
    keys(el, ["Backspace", "Backspace"]);
    expect(saved(el)).toBe("<ul><li>a</li></ul><p>b</p>");
  });

  it("drops the wrapper item it leaves empty", () => {
    const el = edit("<ul><li><ul><li>|x</li><li>y</li></ul></li></ul>");
    keys(el, ["Backspace", "type:Z"]);
    expect(saved(el)).toBe("<ul><li>Zx<ul><li>y</li></ul></li></ul>");
  });

  it("drops the wrapper item after a sibling", () => {
    const el = edit("<ul><li>a</li><li><ul><li>|x</li></ul></li></ul>");
    keys(el, ["Backspace", "type:Z"]);
    expect(saved(el)).toBe("<ul><li>a</li><li>Zx</li></ul>");
  });

  it("keeps a wrapper item that still holds earlier items", () => {
    const el = edit("<ul><li><ul><li>a</li><li>|x</li></ul></li></ul>");
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<ul><li><ul><li>a</li></ul></li><li>x</li></ul>");
  });

  it("undoes in one step", () => {
    const el = edit("<ul><li>a<ul><li>|b</li></ul></li></ul>");
    keys(el, ["Backspace", "type:x", "Meta+z"]);
    expect(saved(el)).toBe("<ul><li>a</li><li>b</li></ul>");
  });
});

describe("Backspace in an empty list item", () => {
  it("exits the list to an empty paragraph after the items", () => {
    const el = editEmpty("<ul><li>a</li><li></li></ul>", "li:last-child");
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<ul><li>a</li></ul><p><br></p>");
  });

  it("turns a sole empty item into a paragraph", () => {
    const el = editEmpty("<ul><li></li></ul>", "li");
    keys(el, ["Backspace", "type:x"]);
    expect(saved(el)).toBe("<p>x</p>");
  });

  it("splits the list when items follow", () => {
    const el = editEmpty(
      "<ul><li>a</li><li></li><li>c</li></ul>",
      "li:nth-child(2)",
    );
    keys(el, ["Backspace", "type:x"]);
    expect(saved(el)).toBe("<ul><li>a</li></ul><p>x</p><ul><li>c</li></ul>");
  });

  it("exits a sole item held open by a break", () => {
    const el = editEmpty("<ul><li><br></li></ul>", "li");
    keys(el, ["Backspace", "type:Z"]);
    expect(saved(el)).toBe("<p>Z</p>");
  });

  it("exits a break-held item in the middle of the list", () => {
    const el = editEmpty(
      "<ul><li>a</li><li><br></li><li>c</li></ul>",
      "li:nth-child(2)",
    );
    keys(el, ["Backspace", "type:Z"]);
    expect(saved(el)).toBe("<ul><li>a</li></ul><p>Z</p><ul><li>c</li></ul>");
  });

  it("outdents a nested break-held item and types into it", () => {
    const el = editEmpty(
      "<ul><li>a<ul><li><br></li><li>c</li></ul></li></ul>",
      "li li",
    );
    keys(el, ["Backspace", "type:Z"]);
    expect(saved(el)).toBe("<ul><li>a</li><li>Z<ul><li>c</li></ul></li></ul>");
  });

  it("outdents a sole nested break-held item and types into it", () => {
    const el = editEmpty("<ul><li>a<ul><li><br></li></ul></li></ul>", "li li");
    keys(el, ["Backspace", "type:Z"]);
    expect(saved(el)).toBe("<ul><li>a</li><li>Z</li></ul>");
  });

  it("undoes the exit in one step", () => {
    const el = editEmpty(
      "<ul><li>a</li><li></li><li>c</li></ul>",
      "li:nth-child(2)",
    );
    keys(el, ["Backspace", "Meta+z"]);
    expect(saved(el)).toBe("<ul><li>a</li><li></li><li>c</li></ul>");
  });

  it("does not delete text on the second Backspace after Enter", () => {
    const el = edit("<ul><li>a|</li></ul>");
    keys(el, ["Enter", "Backspace", "Backspace", "type:x"]);
    expect(saved(el)).toBe("<ul><li>ax</li></ul>");
  });
});

describe("Backspace at the start of a paragraph after a quote", () => {
  it("joins into the quote's last block", () => {
    const el = edit("<blockquote><p>a</p></blockquote><p>|b</p>");
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<blockquote><p>ab</p></blockquote>");
    expect(plain(show(el))).toBe("<blockquote><p>a|b</p></blockquote>");
  });

  it("joins into a bare quote's text", () => {
    const el = edit("<blockquote>a</blockquote><p>|b</p>");
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<blockquote>ab</blockquote>");
    expect(plain(show(el))).toBe("<blockquote>a|b</blockquote>");
  });

  it("joins into the last child of a multi-block quote", () => {
    const el = edit("<blockquote><p>a</p><p>b</p></blockquote><p>|c</p>");
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<blockquote><p>a</p><p>bc</p></blockquote>");
  });

  it("joins into the last block of a wrapped quote", () => {
    const el = edit(
      "<blockquote><div><p>a</p><p>b</p></div></blockquote><p>|c</p>",
    );
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe(
      "<blockquote><div><p>a</p><p>bc</p></div></blockquote>",
    );
  });

  it("joins into the last line of a quote of divs", () => {
    const el = edit(
      "<blockquote><div>a</div><div>b</div></blockquote><p>|c</p>",
    );
    keys(el, ["Backspace", "type:Z"]);
    expect(saved(el)).toBe(
      "<blockquote><div>a</div><div>bZc</div></blockquote>",
    );
  });

  it("joins into a heading inside the quote", () => {
    const el = edit("<blockquote><h2>a</h2></blockquote><p>|b</p>");
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<blockquote><h2>ab</h2></blockquote>");
    expect(plain(show(el))).toBe("<blockquote><h2>a|b</h2></blockquote>");
  });
});

describe("Backspace inside a quote", () => {
  it("keeps what follows a list-first quote block quoted", () => {
    const el = edit(
      "<p>x</p><blockquote><ul><li>|a</li></ul><p>c</p></blockquote>",
    );
    keys(el, ["Backspace"]);
    expect(saved(el)).toMatch(/<blockquote><p>c<\/p><\/blockquote>$/);
  });

  it("keeps what follows bare quote text quoted", () => {
    const el = edit("<p>x</p><blockquote>|a<p>c</p></blockquote>");
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<p>x</p><p>a</p><blockquote><p>c</p></blockquote>");
  });

  it("keeps what follows a wrapped quote block quoted", () => {
    const el = edit(
      "<p>x</p><blockquote><div><p>|b</p><p>c</p></div></blockquote>",
    );
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe(
      "<p>x</p><div><p>b</p></div><blockquote><div><p>c</p></div></blockquote>",
    );
  });

  it("lifts only the first block when the edited element is the quote", () => {
    const el = mount('<blockquote id="t"><p>b</p><p>c</p></blockquote>');
    session = startInPlaceTextSession(el, {});
    caret(textNodes(el)[0], 0);
    keys(session.element, ["Backspace"]);
    expect(session.element.tagName).toBe("DIV");
    expect(saved(session.element)).toBe(
      "<p>b</p><blockquote><p>c</p></blockquote>",
    );
    expect(plain(show(session.element))).toBe(
      "<p>|b</p><blockquote><p>c</p></blockquote>",
    );
  });

  it("lifts only the first block out of the quote", () => {
    const el = edit("<p>a</p><blockquote><p>|b</p><p>c</p></blockquote>");
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<p>a</p><p>b</p><blockquote><p>c</p></blockquote>");
    expect(plain(show(el))).toBe(
      "<p>a</p><p>|b</p><blockquote><p>c</p></blockquote>",
    );
  });

  it("lifts only the first line of a quote of lines", () => {
    const el = edit("<p>x</p><blockquote>|a<br>b<br>c</blockquote>");
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<p>x</p><p>a</p><blockquote>b<br>c</blockquote>");
  });

  it("lifts a styled first line whole", () => {
    const el = edit(
      '<p>x</p><blockquote><span style="color: red">|a</span><br>b</blockquote>',
    );
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe(
      '<p>x</p><p><span style="color: red">a</span></p><blockquote>b</blockquote>',
    );
  });

  it("lifts a first line of several runs", () => {
    const el = edit("<p>x</p><blockquote>|a<b>b</b><br>c</blockquote>");
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe(
      "<p>x</p><p>a<b>b</b></p><blockquote>c</blockquote>",
    );
  });

  it("keeps a blank line between lifted and kept lines", () => {
    const el = edit("<p>x</p><blockquote>|a<br><br>b</blockquote>");
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<p>x</p><p>a</p><blockquote><br>b</blockquote>");
  });

  it("keeps the edited element's frame off the quote it leaves behind", () => {
    const el = mount(
      '<blockquote id="t" style="position: absolute; left: 10px; width: 300px; color: red" data-slide-text-block="true"><p>a</p><p>b</p></blockquote>',
    );
    session = startInPlaceTextSession(el, {});
    caret(textNodes(el)[0], 0);
    keys(session.element, ["Backspace"]);
    const quote = session.element.querySelector("blockquote")!;
    expect(quote.getAttribute("data-slide-text-block")).toBeNull();
    expect(quote.style.position).toBe("");
    expect(quote.style.left).toBe("");
    expect(quote.style.color).toBe("red");
    expect(quote.textContent).toBe("b");
  });

  it("keeps the quote when its whole text is replaced", () => {
    const el = editRange(
      "<p>x</p><blockquote><p>a</p><p>b</p></blockquote><p>y</p>",
    );
    const [, a, b] = textNodes(el);
    select(a, 0, b, 1);
    keys(el, ["Backspace", "type:Z"]);
    expect(saved(el)).toBe("<p>x</p><blockquote><p>Z</p></blockquote><p>y</p>");
  });

  it("keeps the caret on the blank first line it lifts", () => {
    const el = editEmpty(
      "<blockquote><br>one<br>two</blockquote>",
      "blockquote",
    );
    keys(el, ["Backspace", "type:X"]);
    expect(saved(el)).toBe("<p>X</p><blockquote>one<br>two</blockquote>");
  });

  it("removes only one of several blank lines before a heading", () => {
    const el = edit("<p>a</p><p><br><br></p><h2>|H</h2>");
    keys(el, ["Backspace"]);
    expect(plain(show(el))).toBe("<p>a</p><p><br><br></p><p>|H</p>");
  });

  it("changes a heading in the middle of a quote instead of moving the caret", () => {
    const el = edit("<blockquote><p>a</p><h2>|b</h2><p>c</p></blockquote>");
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<blockquote><p>a</p><p>b</p><p>c</p></blockquote>");
    expect(plain(show(el))).toBe(
      "<blockquote><p>a</p><p>|b</p><p>c</p></blockquote>",
    );
  });
});

describe("Deleting a range that ends at an element boundary", () => {
  it("joins the following block's rest when the range ends at an item start", () => {
    const el = editRange("<p>intro</p><ul><li>item one</li><li>two</li></ul>");
    const li = el.querySelector("li")!;
    select(textNodes(el)[0], 2, li.nextElementSibling!, 0);
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<p>intwo</p>");
  });

  it("leaves no placeholder when deleting from block start into the next", () => {
    const el = editRange("<p>first</p><p>second</p>");
    const [a, b] = textNodes(el);
    select(a, 0, b, 3);
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<p>ond</p>");
    expect(plain(show(el))).toBe("<p>|ond</p>");
  });

  it("saves no placeholder when the first run is a styled span", () => {
    const el = editRange(
      '<p><span style="color: red">first</span></p><p>second</p>',
    );
    const [a, b] = textNodes(el);
    select(a, 0, b, 3);
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<p>ond</p>");
    session!.end();
    expect(el.innerHTML).toBe("<p>ond</p>");
  });

  it("leaves no placeholder when the end block is a heading", () => {
    const el = editRange("<p>first</p><h2>second</h2>");
    const [a, b] = textNodes(el);
    select(a, 0, b, 3);
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<p>ond</p>");
  });

  it("leaves no placeholder when the end block is a list item", () => {
    const el = editRange("<p>first</p><ul><li>second</li></ul>");
    const [a, b] = textNodes(el);
    select(a, 0, b, 3);
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<p>ond</p>");
  });

  it("removes the emptied list when the range ends at its end", () => {
    const el = editRange(
      "<p>intro</p><ul><li>a</li><li>b</li></ul><p>after</p>",
    );
    const list = el.querySelector("ul")!;
    select(textNodes(el)[0], 2, list, list.childNodes.length);
    keys(el, ["Backspace", "type:X"]);
    expect(saved(el)).toBe("<p>inX</p><p>after</p>");
  });

  it("leaves no trailing break when the range ends at a break-held paragraph", () => {
    const el = editRange("<p>xy</p><p><br></p>");
    select(textNodes(el)[0], 1, el.children[1], 0);
    keys(el, ["Backspace", "type:X"]);
    expect(saved(el)).toBe("<p>xX</p>");
  });

  it("keeps the paragraph after an empty one the range ends in", () => {
    const el = editRange("<p>ab</p><p></p><p>cd</p>");
    const [a, c] = textNodes(el);
    const empty = el.querySelectorAll("p")[1];
    select(a, 1, empty, 0);
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<p>a</p><p>cd</p>");
    expect(c.data).toBe("cd");
  });

  it("keeps the paragraph after a break-held one the range ends in", () => {
    const el = editRange("<p>ab</p><p><br></p><p>cd</p>");
    const [a] = textNodes(el);
    select(a, 1, el.querySelectorAll("p")[1], 0);
    keys(el, ["Backspace"]);
    expect(saved(el)).toMatch(/^<p>a(<br>)?<\/p><p>cd<\/p>$/);
  });

  it("keeps the placeholder in an item emptied of its own text", () => {
    const el = editRange("<ul><li>a<ul><li>b</li></ul></li></ul>");
    const li = el.querySelector("li")!;
    select(li, 0, li, 1);
    keys(el, ["Backspace"]);
    expect(li.firstChild?.textContent).toBe(ZWSP);
    keys(el, ["type:X"]);
    expect(saved(el)).toBe("<ul><li>X<ul><li>b</li></ul></li></ul>");
  });

  it("empties a block that is deleted whole with a single placeholder", () => {
    const el = editRange("<p>first</p><p>second</p>");
    const [a, b] = textNodes(el);
    select(a, 0, b, 6);
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<p><br></p>");
  });
});

describe("Word delete", () => {
  /** The shared fake only steps by character; a word step skips the word and the space after it. */
  function stepByWord() {
    const proto = Object.getPrototypeOf(window.getSelection()!) as Selection;
    const modify = proto.modify;
    proto.modify = function (this: Selection, alter, direction, granularity) {
      if (granularity !== "word" || direction !== "backward") {
        return modify.call(this, alter, direction, granularity);
      }
      const range = this.getRangeAt(0);
      const node = range.startContainer as Text;
      const before = node.data.slice(0, range.startOffset);
      const start = before.replace(/\S*\s*$/, "").length;
      const moved = document.createRange();
      moved.setStart(node, start);
      moved.setEnd(range.endContainer, range.endOffset);
      this.removeAllRanges();
      this.addRange(moved);
    };
  }

  it("keeps the separating space so the next character is not glued", () => {
    stepByWord();
    const el = edit("<p>hello world|</p>");
    keys(el, ["Alt+Backspace"]);
    expect(saved(el)).toBe("<p>hello&nbsp;</p>");
    keys(el, ["type:X"]);
    // The nbsp only held the space while it trailed; text follows now.
    expect(saved(el)).toBe("<p>hello X</p>");
  });

  it("keeps the space when the line ends in a break", () => {
    stepByWord();
    const el = edit("<p>hello world|<br></p>");
    keys(el, ["Alt+Backspace"]);
    expect(saved(el)).toBe("<p>hello&nbsp;<br></p>");
  });

  it("keeps the space left by cut", () => {
    const el = editRange("<p>hello world</p>");
    const text = textNodes(el)[0];
    select(text, 6, text, 11);
    cut(el);
    expect(saved(el)).toBe("<p>hello&nbsp;</p>");
  });

  it("keeps a space that a join leaves against another space", () => {
    const el = editRange("<p>one two</p><p>three four</p>");
    const [first, second] = textNodes(el);
    first.data = "one ";
    second.data = "three four";
    select(first, 4, second, 5);
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<p>one&nbsp; four</p>");
  });

  it("leaves an earlier line's trailing space alone", () => {
    const el = editRange("<p>one <br>t</p>");
    const text = textNodes(el)[1];
    select(text, 0, text, 1);
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<p>one <br></p>");
  });

  it("leaves a trailing space before an earlier break alone when a line is emptied after it", () => {
    const el = editRange("<p>one <br>two<br>x</p>");
    const text = textNodes(el)[1];
    select(text, 0, text, 3);
    keys(el, ["Backspace"]);
    expect(saved(el)).toBe("<p>one <br><br>x</p>");
  });

  it("keeps the space after the remaining word each time", () => {
    stepByWord();
    const el = edit("<p>one two three|</p>");
    keys(el, ["Alt+Backspace"]);
    expect(saved(el)).toBe("<p>one two&nbsp;</p>");
    keys(el, ["Alt+Backspace"]);
    expect(saved(el)).toBe("<p>one&nbsp;</p>");
  });
});
