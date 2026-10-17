// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  type InPlaceTextSession,
  startInPlaceTextSession,
} from "./in-place-text-session";
import {
  caret,
  installSelectionModify,
  mount,
  press,
  restoreGlobals,
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

describe("history: structural Backspace is its own undo step", () => {
  it("undoes a list break-out without resurrecting the deleted character", () => {
    const el = edit("<ul><li>|ab</li></ul>");
    type(el, "x");
    press(el, "Backspace");
    press(el, "Backspace");
    session!.undo();
    expect(show(el)).toBe("<ul><li>|ab</li></ul>");
  });

  it("undoes a quote break-out without resurrecting the deleted character", () => {
    const el = edit("<blockquote><p>|ab</p></blockquote>");
    type(el, "x");
    press(el, "Backspace");
    press(el, "Backspace");
    session!.undo();
    expect(show(el)).toBe("<blockquote><p>|ab</p></blockquote>");
  });

  it("keeps the character deleted by the run before the break-out", () => {
    const el = edit("<ul><li>a|b</li></ul>");
    press(el, "Backspace");
    press(el, "Backspace");
    session!.undo();
    expect(show(el)).toBe("<ul><li>|b</li></ul>");
  });
});

describe("history: delete runs across inline boundaries", () => {
  it("undoes a Backspace run crossing an inline wrapper in one step", () => {
    const el = edit("<p>abc<b>d|</b></p>");
    press(el, "Backspace");
    press(el, "Backspace");
    press(el, "Backspace");
    session!.undo();
    expect(show(el)).toBe("<p>abc<b>d|</b></p>");
  });

  it("undoes a Backspace run leaving an inline wrapper in one step", () => {
    const el = edit("<p>ab<b>|cd</b>e</p>");
    press(el, "Backspace");
    press(el, "Backspace");
    press(el, "Backspace");
    session!.undo();
    expect(show(el)).toBe("<p>ab<b>|cd</b>e</p>");
  });
});

describe("history: undo returns the caret to an empty block", () => {
  it("restores the caret in the empty list item after a list exit", () => {
    const el = edit("<ol><li>ab</li><li>|</li></ol>");
    press(el, "Enter");
    session!.undo();
    expect(show(el)).toBe("<ol><li>ab</li><li>|</li></ol>");
  });

  it("restores the caret in the right one of several empty blocks", () => {
    const el = edit("<p>x</p><p></p><p>|</p><p></p>");
    type(el, "hello");
    session!.undo();
    expect(show(el)).toBe("<p>x</p><p></p><p>|</p><p></p>");
  });

  it("restores the caret in an empty paragraph after typing in it", () => {
    const el = edit("<p>x</p><p>|</p>");
    type(el, "hello");
    session!.undo();
    expect(show(el)).toBe("<p>x</p><p>|</p>");
  });
});

describe("select all", () => {
  it("selects every block on the first Mod+A and typing replaces them", () => {
    const el = edit("<p>al|pha</p><p>beta</p>");
    press(el, "Meta+a");
    type(el, "X");
    expect(show(el)).toBe("<p>X|</p>");
  });

  it("leaves one empty heading when Backspace follows Mod+A", () => {
    const el = edit("<h1>|Title</h1><p>body</p>");
    press(el, "Meta+a");
    press(el, "Backspace");
    expect(show(el)).toBe("<h1>|</h1>");
  });

  it("keeps the list when typing replaces a Mod+A selection in a list", () => {
    const el = edit("<ul><li>o|ne</li><li>two</li></ul><p>para</p>");
    press(el, "Meta+a");
    type(el, "Q");
    expect(show(el)).toBe("<ul><li>Q|</li></ul>");
  });
});
