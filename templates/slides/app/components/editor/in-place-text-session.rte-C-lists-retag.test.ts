// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  type InPlaceTextSession,
  startInPlaceTextSession,
} from "./in-place-text-session";
import {
  caret,
  installSelectionModify,
  keydown,
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

function editEmpty(html: string, selector: string) {
  const el = mount(`<div id="t">${html}</div>`);
  session = startInPlaceTextSession(el, {});
  caret(el.querySelector(selector)!, 0);
  return session.element;
}

function chord(el: HTMLElement, init: KeyboardEventInit) {
  keydown(el, { metaKey: true, ...init });
}

const bullets = (el: HTMLElement) =>
  chord(el, { key: "8", code: "Digit8", shiftKey: true });
const numbers = (el: HTMLElement) =>
  chord(el, { key: "7", code: "Digit7", shiftKey: true });

/** The saved document: what the session writes back, placeholders gone. */
function saved(el: HTMLElement) {
  return session!
    .cloneWithoutPlaceholders(el)
    .innerHTML.replace(/ style="[^"]*"/g, "")
    .replace(/ start="1"/g, "");
}

/** The live markup with list/block styling the session adds stripped. */
function plain(el: HTMLElement) {
  return show(el)
    .replace(/ style="[^"]*"/g, "")
    .replace(/ data-slide-authoring-format="quote"/g, "");
}

describe("list toggle in a nested item", () => {
  it("retags only the innermost list for a different kind", () => {
    const el = edit("<ol><li>a<ul><li>|b</li></ul></li></ol>");
    numbers(el);
    type(el, "x");
    expect(plain(el)).toBe("<ol><li>a<ol><li>x|b</li></ol></li></ol>");
  });

  it("keeps the parent bullet when toggling the same kind off", () => {
    const el = edit("<ul><li>a<ul><li>|b</li></ul></li></ul>");
    bullets(el);
    type(el, "x");
    expect(saved(el)).toBe("<ul><li>a<p>xb</p></li></ul>");
    expect(el.querySelector("li > ul")).toBeNull();
    expect(el.querySelectorAll("li")).toHaveLength(1);
  });

  it("leaves a nested sibling bulleted", () => {
    const el = edit("<ul><li>a<ul><li>|b</li><li>c</li></ul></li></ul>");
    bullets(el);
    expect(saved(el)).toContain("<li>c</li>");
    expect(el.querySelectorAll("li")).toHaveLength(2);
  });
});

describe("a block becoming a list item joins adjacent lists", () => {
  it("joins the preceding same-type list", () => {
    const el = edit("<ul><li>a</li></ul><p>|b</p>");
    bullets(el);
    expect(plain(el)).toBe("<ul><li>a</li><li>|b</li></ul>");
  });

  it("undoes back to the separate paragraph", () => {
    const el = edit("<ul><li>a</li></ul><p>|b</p>");
    bullets(el);
    type(el, "x");
    session!.undo();
    session!.undo();
    expect(saved(el)).toBe("<ul><li>a</li></ul><p>b</p>");
  });

  it("bridges two lists of the same type", () => {
    const el = edit("<ul><li>a</li></ul><p>|b</p><ul><li>c</li></ul>");
    bullets(el);
    expect(plain(el)).toBe("<ul><li>a</li><li>|b</li><li>c</li></ul>");
  });

  it("joins only the following list across types", () => {
    const el = edit("<ol><li>a</li></ol><p>|b</p><ul><li>c</li></ul>");
    bullets(el);
    expect(plain(el)).toBe("<ol><li>a</li></ol><ul><li>|b</li><li>c</li></ul>");
  });

  it("nests under the previous item with Tab in adjacent lists", () => {
    const el = edit("<ul><li>a</li></ul><ul><li>|b</li></ul>");
    press(el, "Tab");
    expect(plain(el)).toBe("<ul><li>a<ul><li>|b</li></ul></li></ul>");
  });

  it("keeps the styling of a list that was already separate", () => {
    const el = edit(
      '<ul style="list-style-type:square"><li>a</li></ul><p>|b</p><ul style="list-style-type:circle"><li>c</li></ul>',
    );
    bullets(el);
    const lists = el.querySelectorAll("ul");
    expect(lists).toHaveLength(2);
    expect(lists[0].textContent).toBe("ab");
    expect(lists[1].getAttribute("style")).toContain("circle");
    expect(lists[1].textContent).toBe("c");
  });

  it("undoes a Tab across adjacent lists", () => {
    const el = edit("<ul><li>a</li></ul><ul><li>|b</li></ul>");
    press(el, "Tab");
    session!.undo();
    expect(saved(el)).toBe("<ul><li>a</li></ul><ul><li>b</li></ul>");
  });

  it("leaves the following list alone when Tab cannot nest", () => {
    const el = edit("<ul><li>|a</li></ul><ul><li>b</li></ul>");
    press(el, "Tab");
    expect(saved(el)).toBe("<ul><li>a</li></ul><ul><li>b</li></ul>");
  });

  it("indents the item produced by a toggle", () => {
    const el = edit("<ul><li>a</li></ul><p>|b</p>");
    bullets(el);
    press(el, "Tab");
    expect(plain(el)).toBe("<ul><li>a<ul><li>|b</li></ul></li></ul>");
  });
});

describe("ordered markdown shortcut", () => {
  it("joins the list above when the number continues it", () => {
    const el = editEmpty("<ol><li>a</li></ol><p></p>", "p");
    type(el, "2. x");
    expect(plain(el)).toBe("<ol><li>a</li><li>x|</li></ol>");
  });

  it("starts a new list when the number does not continue it", () => {
    const el = editEmpty("<ol><li>a</li></ol><p></p>", "p");
    type(el, "5. x");
    expect(el.querySelectorAll("ol")).toHaveLength(2);
    expect(el.querySelectorAll("ol")[1].getAttribute("start")).toBe("5");
  });
});

describe("heading shortcuts in a list item", () => {
  it("keeps the caret inside the new heading", () => {
    const el = edit("<ul><li>Ti|tle</li></ul>");
    chord(el, { key: "1", code: "Digit1", altKey: true });
    type(el, "X");
    expect(plain(el)).toBe("<ul><li><h1>TiX|tle</h1></li></ul>");
  });

  it("keeps an element-level caret in an empty item inside the heading", () => {
    const el = editEmpty("<ul><li>a</li><li></li></ul>", "li:nth-child(2)");
    chord(el, { key: "1", code: "Digit1", altKey: true });
    type(el, "X");
    expect(saved(el)).toBe("<ul><li>a</li><li><h1>X</h1></li></ul>");
  });

  it("puts typed text in the heading of an empty item", () => {
    const el = editEmpty("<ul><li></li></ul>", "li");
    type(el, "# ");
    type(el, "x");
    expect(saved(el)).toBe("<ul><li><h1>x</h1></li></ul>");
  });
});

describe("quote command", () => {
  const quote = (el: HTMLElement) =>
    chord(el, { key: "b", code: "KeyB", shiftKey: true });

  it("toggles a paragraph inside a quote off without nesting", () => {
    const el = edit("<blockquote><p>a|</p></blockquote>");
    quote(el);
    expect(plain(el)).toBe("<p>a|</p>");
  });

  it("lifts only the caret paragraph out of a multi-paragraph quote", () => {
    const el = edit("<blockquote><p>a</p><p>b|</p><p>c</p></blockquote>");
    quote(el);
    expect(plain(el)).toBe(
      "<blockquote><p>a</p></blockquote><p>b|</p><blockquote><p>c</p></blockquote>",
    );
  });

  it("never nests a quote over a partly quoted range", () => {
    const el = editEmpty("<blockquote><p>a</p></blockquote><p>b</p>", "p");
    const texts = textNodes(el);
    select(texts[0], 0, texts[1], 1);
    quote(el);
    expect(el.querySelector("blockquote blockquote")).toBeNull();
    expect(el.querySelectorAll("blockquote")).toHaveLength(2);
  });

  it("leaves no empty quote after lifting the last of pretty-printed children", () => {
    const el = edit("<blockquote>\n<p>a</p>\n<p>b|</p>\n</blockquote>");
    quote(el);
    expect(el.querySelectorAll("blockquote")).toHaveLength(1);
    expect(saved(el).replace(/\s/g, "")).toBe(
      "<blockquote><p>a</p></blockquote><p>b</p>",
    );
  });

  it("keeps the quote identity on the side that holds the rest", () => {
    const el = edit('<blockquote id="q"><p>a|</p><p>b</p></blockquote>');
    quote(el);
    expect(saved(el)).toBe('<p>a</p><blockquote id="q"><p>b</p></blockquote>');
  });

  it("still quotes a plain paragraph", () => {
    const el = edit("<p>a|</p>");
    quote(el);
    expect(el.querySelectorAll("blockquote")).toHaveLength(1);
  });
});
