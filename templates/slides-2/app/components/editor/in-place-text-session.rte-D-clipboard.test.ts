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
  paste,
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

/**
 * Mounts `html` in a text block and places the selection at its `|` caret or
 * `[ ]` range (markers count as zero-width, like the harness canonicalizer).
 */
function edit(html: string) {
  const markers = html.replace(/<[^>]*>/g, "");
  const plain = html.replace(/[|[\]]/g, "");
  const el = mount(`<div id="t">${plain}</div>`);
  session = startInPlaceTextSession(el, {});
  const at = (offset: number): [Text, number] => {
    let remaining = offset;
    for (const node of textNodes(el)) {
      if (remaining <= node.length) return [node, remaining];
      remaining -= node.length;
    }
    throw new Error(`no position ${offset} in ${html}`);
  };
  if (markers.includes("|")) {
    caret(...at(markers.indexOf("|")));
  } else {
    const start = markers.indexOf("[");
    const end = markers.indexOf("]") - 1;
    select(...at(start), ...at(end));
  }
  return session.element;
}

/** Same as the harness: html paste carries its text content as text/plain. */
function pasteHtml(el: HTMLElement, html: string) {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  paste(el, { "text/html": html, "text/plain": holder.textContent ?? "" });
}

/** Caret in the empty paragraph between two siblings. */
function editBetween() {
  const el = mount('<div id="t"><p>x</p><p></p><p>y</p></div>');
  session = startInPlaceTextSession(el, {});
  caret(el.querySelectorAll("p")[1], 0);
  return session.element;
}

/** The edited element is the block itself, not a wrapper around it. */
function editRoot(html: string) {
  const markers = html.replace(/<[^>]*>/g, "");
  const el = mount(html.replace("|", ""));
  session = startInPlaceTextSession(el, {});
  const offset = markers.indexOf("|");
  caret(textNodes(el)[0], offset);
  return session.element;
}

function pasteText(el: HTMLElement, text: string) {
  paste(el, { "text/plain": text });
}

/** The saved document: what the session writes back, placeholders gone. */
function saved(el: HTMLElement) {
  return plain(session!.cloneWithoutPlaceholders(el).innerHTML);
}

/** Block margins and list styling the session adds are not structure. */
function plain(markup: string) {
  return markup
    .replaceAll(' style="margin: 0px;"', "")
    .replace(/ style="margin:0;padding-left:1\.25em;[^"]*"/g, "");
}

describe("pasted foreign HTML keeps bold and italic", () => {
  it("maps span font-weight and a Docs wrapper to b", () => {
    const el = edit("<p>a|b</p>");
    pasteHtml(
      el,
      '<b style="font-weight:normal" id="docs-internal-guid-1"><span style="font-weight:700">Hi</span> there</b>',
    );
    expect(plain(show(el))).toBe("<p>a<b>Hi</b> there|b</p>");
    expect(saved(el)).toBe("<p>a<b>Hi</b> thereb</p>");
    expect(el.querySelector("span")).toBeNull();
  });

  it("maps font-weight bold and numeric weights from 600", () => {
    const el = edit("<p>a|b</p>");
    pasteHtml(
      el,
      '<span style="font-weight:bold">X</span><span style="font-weight:600">Y</span><span style="font-weight:400">Z</span>',
    );
    expect(saved(el)).toBe("<p>a<b>X</b><b>Y</b><span>Z</span>b</p>");
  });

  it("maps font-style italic to i", () => {
    const el = edit("<p>a|b</p>");
    pasteHtml(el, '<span style="font-style:italic">Q</span>');
    expect(saved(el)).toBe("<p>a<i>Q</i>b</p>");
  });

  it("still strips foreign font family, size and color", () => {
    const el = edit("<p>a|b</p>");
    pasteHtml(
      el,
      '<span style="font-family:Arial;font-size:30px;color:red">Q</span>',
    );
    expect(saved(el)).toBe("<p>a<span>Q</span>b</p>");
  });
});

describe("block paste replaces an empty block", () => {
  it("heading and paragraph into an empty paragraph, then undo", () => {
    const el = edit("<p>|</p>");
    pasteHtml(el, "<h2>T</h2><p>b</p>");
    expect(plain(show(el))).toBe("<h2>T</h2><p>b|</p>");
    expect(saved(el)).toBe("<h2>T</h2><p>b</p>");
    session!.undo();
    expect(plain(show(session!.element))).toBe("<p>|</p>");
    expect(session!.element.querySelectorAll("p").length).toBe(1);
  });

  it("markdown numbered line in an empty paragraph becomes only the list", () => {
    const el = edit("<p>|</p>");
    pasteText(el, "1. a");
    expect(plain(show(el))).toBe("<ol><li>a|</li></ol>");
    expect(saved(el)).toBe("<ol><li>a</li></ol>");
  });

  it("markdown heading in an empty paragraph keeps its siblings", () => {
    const el = editBetween();
    pasteText(el, "# T");
    expect(saved(el)).toBe("<p>x</p><h1>T</h1><p>y</p>");
  });

  it("markdown bullet in an empty paragraph between siblings", () => {
    const el = editBetween();
    pasteText(el, "- a");
    expect(saved(el)).toBe("<p>x</p><ul><li>a</li></ul><p>y</p>");
  });

  it("replaces a paragraph authored as a lone line break", () => {
    const el = mount('<div id="t"><p>x</p><p><br></p><p>y</p></div>');
    session = startInPlaceTextSession(el, {});
    caret(el.querySelectorAll("p")[1], 0);
    pasteHtml(session.element, "<h2>T</h2><p>b</p>");
    expect(saved(session.element)).toBe("<p>x</p><h2>T</h2><p>b</p><p>y</p>");
  });

  it("still splits a paragraph with text", () => {
    const el = edit("<p>ab|cd</p>");
    pasteHtml(el, "<h2>T</h2>");
    expect(saved(el)).toBe("<p>ab</p><h2>T</h2><p>cd</p>");
  });
});

describe("a pasted list stays a list in a paragraph", () => {
  it("splits the paragraph around the list", () => {
    const el = edit("<p>Hel|lo</p>");
    pasteHtml(el, "<ul><li>a</li><li>b</li></ul>");
    expect(plain(show(el))).toBe(
      "<p>Hel</p><ul><li>a</li><li>b</li></ul><p>|lo</p>",
    );
    type(el, "z");
    expect(plain(show(el))).toBe(
      "<p>Hel</p><ul><li>a</li><li>b</li></ul><p>z|lo</p>",
    );
    session!.undo();
    expect(plain(show(session!.element))).toBe(
      "<p>Hel</p><ul><li>a</li><li>b</li></ul><p>|lo</p>",
    );
  });

  it("into an empty paragraph replaces it with the list", () => {
    const el = edit("<p>|</p>");
    pasteHtml(el, "<ul><li>a</li><li>b</li></ul>");
    expect(plain(show(el))).toBe("<ul><li>a</li><li>b|</li></ul>");
    expect(saved(el)).toBe("<ul><li>a</li><li>b</li></ul>");
  });

  it("at the end of a paragraph leaves no empty continuation", () => {
    const el = edit("<p>Hel|</p>");
    pasteHtml(el, "<ul><li>a</li><li>b</li></ul>");
    expect(saved(el)).toBe("<p>Hel</p><ul><li>a</li><li>b</li></ul>");
  });

  it("at the start of a paragraph leaves no empty head", () => {
    const el = edit("<p>|lo</p>");
    pasteHtml(el, "<ol><li>a</li><li>b</li></ol>");
    expect(saved(el)).toBe("<ol><li>a</li><li>b</li></ol><p>lo</p>");
  });

  it("into a heading splits the heading", () => {
    const el = edit("<h2>Ti|tle</h2>");
    pasteHtml(el, "<ul><li>a</li><li>b</li></ul>");
    expect(saved(el).replace(/ style="[^"]*"/g, "")).toBe(
      "<h2>Ti</h2><ul><li>a</li><li>b</li></ul><h2>tle</h2>",
    );
  });

  it("keeps a single pasted item a list", () => {
    const el = edit("<p>Hel|lo</p>");
    pasteHtml(el, "<ul><li>a</li></ul>");
    expect(saved(el)).toBe("<p>Hel</p><ul><li>a</li></ul><p>lo</p>");
  });

  it("keeps the lines of one pasted item inside the item", () => {
    const el = edit("<p>Hel|lo</p>");
    pasteHtml(el, "<ul><li><div>a</div><div>b</div></li></ul>");
    expect(saved(el)).toBe("<p>Hel</p><ul><li>a<br>b</li></ul><p>lo</p>");
  });

  it("keeps the block's class and alignment on both halves", () => {
    const el = edit('<p class="big" style="text-align:center">Hel|lo</p>');
    pasteHtml(el, "<ul><li>a</li><li>b</li></ul>");
    const [head, tail] = Array.from(el.querySelectorAll("p"));
    for (const half of [head, tail]) {
      expect(half.className).toBe("big");
      expect(half.style.textAlign).toBe("center");
    }
    expect(tail.textContent).toBe("lo");
  });

  it("keeps the caret's mark on both halves", () => {
    const el = edit("<p><b>Hel|lo</b></p>");
    pasteHtml(el, "<ul><li>a</li><li>b</li></ul>");
    expect(saved(el)).toBe(
      "<p><b>Hel</b></p><ul><li>a</li><li>b</li></ul><p><b>lo</b></p>",
    );
  });

  it("splits a paragraph that is the edited element, with undo and redo", () => {
    const el = editRoot('<p id="t">Hel|lo</p>');
    pasteHtml(el, "<ul><li>a</li><li>b</li></ul>");
    const pasted = plain(show(session!.element));
    expect(pasted).toBe("<p>Hel</p><ul><li>a</li><li>b</li></ul><p>|lo</p>");
    session!.undo();
    expect(session!.element.tagName).toBe("P");
    expect(plain(show(session!.element))).toBe("Hel|lo");
    session!.redo();
    expect(plain(show(session!.element))).toBe(pasted);
  });
});

describe("pasted URLs are linked like typed ones", () => {
  it("links a URL inside pasted text over a selection", () => {
    const el = edit("<p>[click]</p>");
    pasteText(el, "see https://a.co");
    expect(plain(show(el))).toBe(
      '<p>see <a href="https://a.co">https://a.co</a>|</p>',
    );
  });

  it("keeps the saved markup free of placeholders", () => {
    const el = edit("<p>[click]</p>");
    pasteText(el, "see https://a.co");
    expect(saved(el)).toBe(
      '<p>see <a href="https://a.co">https://a.co</a></p>',
    );
  });

  it("links a bare URL pasted at a collapsed caret", () => {
    const el = edit("<p>see |here</p>");
    pasteText(el, "https://a.co");
    expect(plain(show(el))).toBe(
      '<p>see <a href="https://a.co">https://a.co</a>|here</p>',
    );
  });

  it("links a bare URL in pasted HTML text", () => {
    const el = edit("<p>a|b</p>");
    pasteHtml(el, "see https://a.co now");
    expect(plain(show(el))).toBe(
      '<p>asee <a href="https://a.co">https://a.co</a> now|b</p>',
    );
  });

  it("leaves trailing punctuation outside the link", () => {
    const el = edit("<p>|</p>");
    pasteText(el, "go to https://a.co/x, then (https://b.co).");
    expect(saved(el)).toBe(
      '<p>go to <a href="https://a.co/x">https://a.co/x</a>, then (<a href="https://b.co">https://b.co</a>).</p>',
    );
  });

  it("does not link inside a pasted anchor", () => {
    const el = edit("<p>|</p>");
    pasteHtml(el, '<a href="https://x.co">https://a.co</a>');
    expect(saved(el)).toBe('<p><a href="https://x.co">https://a.co</a></p>');
  });

  it("does not nest a link when pasting a URL inside a link", () => {
    const el = edit('<p><a href="https://x.co">g|o</a></p>');
    pasteText(el, "https://a.co");
    expect(el.querySelectorAll("a a").length).toBe(0);
    expect(saved(el)).toBe('<p><a href="https://x.co">ghttps://a.coo</a></p>');
  });
});

describe("a lone www or email pasted over a selection links it", () => {
  it("links the selection with an http href for a www domain", () => {
    const el = edit("<p>[docs]</p>");
    pasteText(el, "www.example.com");
    expect(saved(el)).toBe('<p><a href="http://www.example.com">docs</a></p>');
  });

  it("links the selection with a mailto href for an email", () => {
    const el = edit("<p>[mail]</p>");
    pasteText(el, "me@example.com");
    expect(saved(el)).toBe('<p><a href="mailto:me@example.com">mail</a></p>');
  });

  it("replaces the selection for text that is not a single address", () => {
    const el = edit("<p>[docs]</p>");
    pasteText(el, "not a link.com");
    expect(saved(el)).toBe("<p>not a link.com</p>");
  });
});

describe("paste at the end of a link", () => {
  it("lands after the anchor, as typing does", () => {
    const el = edit('<p><a href="https://x.co">go|</a></p>');
    pasteText(el, "Z");
    type(el, "q");
    expect(plain(show(el))).toBe('<p><a href="https://x.co">go</a>Zq|</p>');
  });

  it("keeps a fully replaced link's text inside the link", () => {
    const el = edit('<p><a href="https://x.co">[foo]</a></p>');
    pasteText(el, "bar");
    expect(saved(el)).toBe('<p><a href="https://x.co">bar</a></p>');
  });

  it("stays inside the anchor mid-link", () => {
    const el = edit('<p><a href="https://x.co">g|o</a></p>');
    pasteText(el, "Z");
    expect(saved(el)).toBe('<p><a href="https://x.co">gZo</a></p>');
  });
});

describe("caret after a pasted inline mark", () => {
  it("typing continues inside the last pasted mark", () => {
    const el = edit("<p>a|b</p>");
    pasteHtml(el, "<b>X</b><i>Y</i>");
    type(el, "z");
    expect(plain(show(el))).toBe("<p>a<b>X</b><i>Yz|</i>b</p>");
    expect(saved(el)).toBe("<p>a<b>X</b><i>Yz</i>b</p>");
  });

  it("a paste ending in an anchor does not extend the link", () => {
    const el = edit("<p>a|b</p>");
    pasteHtml(el, 'x<a href="https://x.co">L</a>');
    type(el, "z");
    expect(saved(el)).toBe('<p>ax<a href="https://x.co">L</a>zb</p>');
  });
});

describe("ZWSP stays out of saved paste output", () => {
  it("has no placeholder after block and list pastes", () => {
    const el = edit("<p>|</p>");
    pasteText(el, "- a\n- b");
    expect(saved(el)).not.toContain(ZWSP);
  });
});

describe("review follow-ups", () => {
  it("keeps pasted text inside a link whose selected tail it replaces", () => {
    const el = edit('<p><a href="https://x.co">go[od]</a></p>');
    pasteText(el, "Z");
    expect(saved(el)).toBe('<p><a href="https://x.co">goZ</a></p>');
  });

  it("makes a single pasted item a list in an empty paragraph", () => {
    const el = editBetween();
    pasteHtml(el, "<ul><li>z</li></ul>");
    expect(saved(el)).toBe("<p>x</p><ul><li>z</li></ul><p>y</p>");
  });

  it("does not link a URL in the slide's own clipboard", () => {
    const el = edit("<p>|</p>");
    paste(el, {
      "text/html": "see https://a.co",
      "text/plain": "see https://a.co",
      "application/x-agent-native-slide-text": "1",
    });
    expect(saved(el)).toBe("<p>see https://a.co</p>");
  });

  it("leaves quotes around a pasted URL outside the link", () => {
    const el = edit("<p>|</p>");
    pasteText(el, '"https://a.co"');
    expect(saved(el)).toBe('<p>"<a href="https://a.co">https://a.co</a>"</p>');
  });

  it("does not read a scheme with an @ as an email", () => {
    const el = edit("<p>[docs]</p>");
    pasteText(el, "ftp://u@h.co");
    expect(saved(el)).toBe("<p>ftp://u@h.co</p>");
  });

  it("does not nest bold for a bold span inside bold", () => {
    const wrapped = edit("<p>a|b</p>");
    pasteHtml(wrapped, '<b><span style="font-weight:700">X</span></b>');
    expect(saved(wrapped)).toBe("<p>a<b>X</b>b</p>");
    const inside = edit("<p><b>a|b</b></p>");
    pasteHtml(inside, '<span style="font-weight:700">X</span>');
    expect(saved(inside)).toBe("<p><b>aXb</b></p>");
  });

  it("keeps the block's id on the text a block paste lands before", () => {
    const el = edit('<p id="keep">|Hello</p>');
    pasteHtml(el, "<h2>T</h2><p>b</p>");
    expect(saved(el)).toBe('<h2>T</h2><p>b</p><p id="keep">Hello</p>');
    expect(plain(show(el))).toBe('<h2>T</h2><p>b</p><p id="keep">|Hello</p>');
  });

  it("keeps a pasted link intact when a block paste splits a link", () => {
    const el = edit('<p><a href="https://x.co">go|od</a></p>');
    pasteHtml(el, '<h2>T</h2><p><a href="https://y.co">L</a></p>');
    expect(saved(el)).toBe(
      '<p><a href="https://x.co">go</a></p><h2>T</h2><p><a href="https://y.co">L</a></p><p><a href="https://x.co">od</a></p>',
    );
  });

  it("keeps a pasted bold run when a block paste lands in a bold host", () => {
    const el = edit("<p><b>Hel|lo</b></p>");
    pasteHtml(el, "<h2>Head</h2><p>some <b>Bold</b> x</p>");
    expect(saved(el)).toBe(
      "<p><b>Hel</b></p><h2>Head</h2><p>some <b>Bold</b> x</p><p><b>lo</b></p>",
    );
  });

  it("keeps pasted bold in markdown pasted into a bold host", () => {
    const el = edit("<p><b>Hel|lo</b></p>");
    pasteText(el, "# T\n**bold** x");
    expect(saved(el)).toContain("<strong>bold</strong> x");
  });

  it("puts a pasted link after the link the caret ended, without nesting", () => {
    const el = edit('<p><a href="https://x.co">go|</a></p>');
    pasteHtml(el, '<a href="https://y.co">L</a>');
    expect(el.querySelectorAll("a a").length).toBe(0);
    expect(saved(el)).toBe(
      '<p><a href="https://x.co">go</a><a href="https://y.co">L</a></p>',
    );
  });
});

describe("second review round", () => {
  it("keeps an authored empty line before a block paste", () => {
    const el = edit("<p><br>|text</p>");
    pasteHtml(el, "<h2>T</h2>");
    expect(saved(el)).toBe("<p><br></p><h2>T</h2><p>text</p>");
  });

  it("stores a normalized href and ignores a filename-like address", () => {
    const upper = edit("<p>[go]</p>");
    pasteText(upper, "HTTPS://A.CO");
    expect(saved(upper)).toBe('<p><a href="https://a.co/">go</a></p>');
    const file = edit("<p>[x]</p>");
    pasteText(file, "icon@2x");
    expect(saved(file)).toBe("<p>icon@2x</p>");
  });

  it("keeps a balanced closing parenthesis in a pasted URL", () => {
    const el = edit("<p>|</p>");
    pasteText(
      el,
      "see https://en.wikipedia.org/wiki/Foo_(bar) now (https://a.co)",
    );
    expect(saved(el)).toBe(
      '<p>see <a href="https://en.wikipedia.org/wiki/Foo_(bar)">https://en.wikipedia.org/wiki/Foo_(bar)</a> now (<a href="https://a.co">https://a.co</a>)</p>',
    );
  });
});

describe("third review round", () => {
  it("puts no break after a block an item already holds", () => {
    const el = edit("<p>x|y</p>");
    pasteHtml(el, "<ul><li><p>a</p>b</li></ul>");
    expect(saved(el)).toBe("<p>x</p><ul><li><p>a</p>b</li></ul><p>y</p>");
  });

  it("splits a list out of a nested block like any other block", () => {
    const root = mount('<div id="t"><div><br></div></div>');
    session = startInPlaceTextSession(root, {});
    caret(root.firstElementChild!, 0);
    const el = session.element;
    pasteHtml(el, "<ul><li>a</li><li>b</li></ul>");
    expect(saved(el)).toBe("<ul><li>a</li><li>b</li></ul>");
  });

  it("retags a paragraph root instead of nesting blocks when pasting at a link's end", () => {
    const root = mount('<p id="t">see <a href="https://x.co">go</a></p>');
    session = startInPlaceTextSession(root, {});
    const text = textNodes(root).find((node) => node.data === "go")!;
    caret(text, 2);
    pasteHtml(session.element, "<h2>T</h2><p>b</p>");
    const el = session.element;
    expect(el.tagName).toBe("DIV");
    expect(el.querySelector("p p, p h2")).toBeNull();
    expect(saved(el)).toBe(
      '<p>see <a href="https://x.co">go</a></p><h2>T</h2><p>b</p>',
    );
  });

  it("ignores an image filename as an address", () => {
    const el = edit("<p>[x]</p>");
    pasteText(el, "icon@2x.png");
    expect(saved(el)).toBe("<p>icon@2x.png</p>");
  });

  it("keeps an apostrophe inside a pasted URL", () => {
    const el = edit("<p>|</p>");
    pasteText(el, "https://en.wikipedia.org/wiki/Rock_'n'_Roll");
    expect(saved(el)).toBe(
      "<p><a href=\"https://en.wikipedia.org/wiki/Rock_'n'_Roll\">https://en.wikipedia.org/wiki/Rock_'n'_Roll</a></p>",
    );
  });
});
