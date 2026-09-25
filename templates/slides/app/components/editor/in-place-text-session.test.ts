// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ZERO_WIDTH_SPACE as ZWSP } from "./bullet-editing";
import {
  type InPlaceTextSession,
  startInPlaceTextSession,
} from "./in-place-text-session";

let session: InPlaceTextSession | null = null;

afterEach(() => {
  session?.end();
  session = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function textNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    texts.push(node as Text);
  }
  return texts;
}

/**
 * happy-dom has no Selection.modify; this moves one character across text
 * nodes inside the editing host, which is what Chrome does for Backspace.
 */
beforeAll(() => {
  const proto = Object.getPrototypeOf(window.getSelection()!) as Selection;
  proto.modify = function modify(
    this: Selection,
    _alter?: string,
    direction?: string,
  ) {
    const range = this.getRangeAt(0);
    const host = (
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement
    )!.closest('[contenteditable="true"]')!;
    const texts = textNodes(host);
    const backward = direction === "backward";
    const node = backward ? range.startContainer : range.endContainer;
    const offset = backward ? range.startOffset : range.endOffset;
    let index = texts.indexOf(node as Text);
    let next = offset;
    if (backward) {
      if (next > 0) next -= 1;
      else if (index > 0) next = texts[--index].length;
    } else if (next < texts[index].length) next += 1;
    else if (index < texts.length - 1) {
      index += 1;
      next = 0;
    }
    const moved = document.createRange();
    if (backward) {
      moved.setStart(texts[index], next);
      moved.setEnd(range.endContainer, range.endOffset);
    } else {
      moved.setStart(range.startContainer, range.startOffset);
      moved.setEnd(texts[index], next);
    }
    this.removeAllRanges();
    this.addRange(moved);
  };
});

function mount(html: string, selector = "#t") {
  document.body.innerHTML = `<div class="slide-content"><div class="fmd-slide">${html}</div></div>`;
  return document.querySelector<HTMLElement>(selector)!;
}

function caret(node: Node, offset: number) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

function select(
  start: Node,
  startOffset: number,
  end: Node,
  endOffset: number,
) {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

function textOf(element: Element, text: string): Text {
  const found = textNodes(element).find((node) => node.data.includes(text));
  if (!found) throw new Error(`no text node with ${text}`);
  return found;
}

function beforeInput(target: Element, inputType: string, init: object = {}) {
  const event = new InputEvent("beforeinput", {
    inputType,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

/** Types like a browser: the controller may take the input, or let it through. */
function type(target: Element, text: string) {
  for (const data of text) {
    const event = beforeInput(target, "insertText", { data });
    if (event.defaultPrevented) continue;
    const range = window.getSelection()!.getRangeAt(0);
    const node = range.startContainer as Text;
    node.insertData(range.startOffset, data);
    caret(node, range.startOffset + data.length);
    target.dispatchEvent(
      new InputEvent("input", { inputType: "insertText", data, bubbles: true }),
    );
  }
}

function key(target: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function paste(target: Element, data: Record<string, string>) {
  const clipboardData = new DataTransfer();
  for (const [format, value] of Object.entries(data)) {
    clipboardData.setData(format, value);
  }
  const event = new ClipboardEvent("paste", {
    clipboardData,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe("in-place text session: entering and ending", () => {
  const shapes = [
    '<h2 id="t" style="font-size: 34px; letter-spacing: -0.03em;">Plan for <span style="color: var(--deck-accent)">next quarter</span></h2>',
    '<ul id="t" style="font-size: 20px"><li id="a">Confirm scope</li><li>Book the <b>review</b></li></ul>',
    '<div id="t" style="display: flex; gap: 12px"><span style="width: 8px; height: 8px; border-radius: 50%; background: red"></span><span>Status is on track</span></div>',
    `<p id="t" class="muted">Owner:&nbsp;<b>Team A</b> &amp; ${ZWSP}partners &mdash; due</p>`,
    '<div id="t" data-editing-block="false" class="card"><div class="tag">ARR</div><div class="value">$1.2M</div></div>',
  ];

  it.each(shapes)(
    "changes only its two attributes and ends byte-identical: %s",
    (html) => {
      const el = mount(html);
      const before = el.outerHTML;
      session = startInPlaceTextSession(el);

      expect(el.getAttribute("contenteditable")).toBe("true");
      expect(el.getAttribute("data-editing-block")).toBe("true");
      const during = el.cloneNode(true) as HTMLElement;
      during.removeAttribute("contenteditable");
      const originalEditingBlock = /data-editing-block="([^"]*)"/.exec(before);
      if (originalEditingBlock) {
        during.setAttribute("data-editing-block", originalEditingBlock[1]);
      } else {
        during.removeAttribute("data-editing-block");
      }
      expect(during.outerHTML).toBe(before);

      session.end();
      expect(el.outerHTML).toBe(before);
      expect(session.isActive).toBe(false);
    },
  );

  it("ends byte-identical after typing and deleting the same text", () => {
    const el = mount(
      '<p id="t">Alpha <span style="color: red">beta</span></p>',
    );
    const before = el.outerHTML;
    session = startInPlaceTextSession(el);
    const beta = textOf(el, "beta");
    caret(beta, 4);
    type(el, "x");
    expect(beforeInput(el, "deleteContentBackward").defaultPrevented).toBe(
      false,
    );
    beta.deleteData(4, 1);
    session.end();
    expect(el.outerHTML).toBe(before);
  });

  it("recreates edited text nodes so Chrome reshapes them, without changing markup", () => {
    const el = mount('<h2 id="t">مراجعة ربع</h2>');
    const before = el.outerHTML;
    const original = el.firstChild as Text;
    session = startInPlaceTextSession(el);
    caret(original, 1);
    type(el, "x");
    original.deleteData(1, 1);
    original.splitText(3);
    session.end();
    expect(el.childNodes).toHaveLength(1);
    expect(el.firstChild).not.toBe(original);
    expect(el.outerHTML).toBe(before);
  });

  it("restores the start bytes when typing and deleting only lost indentation", () => {
    // happy-dom's innerText keeps collapsed whitespace; a browser's does not.
    vi.spyOn(HTMLElement.prototype, "innerText", "get").mockImplementation(
      function (this: HTMLElement) {
        return (this.textContent ?? "").replace(/\s+/g, " ").trim();
      },
    );
    const el = mount('<h2 id="t">\n    Speakers\n  </h2>');
    const before = el.outerHTML;
    session = startInPlaceTextSession(el);
    const text = el.firstChild as Text;
    caret(text, 5);
    type(el, "x");
    // Chrome drops collapsed whitespace next to the caret while typing.
    text.data = "Speakers\n  ";
    session.end();
    expect(el.outerHTML).toBe(before);
  });

  it("keeps an author zero-width space when Chrome replaced its text node", () => {
    const el = mount(`<div id="t" class="box">${ZWSP}</div>`);
    const before = el.outerHTML;
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 1);
    type(el, "x");
    el.firstChild!.replaceWith(ZWSP);
    session.end();
    expect(el.outerHTML).toBe(before);
  });

  it("types and deletes next to an author zero-width space without adding one", () => {
    const el = mount(`<div id="t" class="box">${ZWSP}</div>`);
    const before = el.outerHTML;
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 0);
    type(el, "x");
    expect(beforeInput(el, "deleteContentBackward").defaultPrevented).toBe(
      true,
    );
    expect(el.textContent).toBe(ZWSP);
    session.end();
    expect(el.outerHTML).toBe(before);
  });

  it("does not merge style spans the slide already had", () => {
    const spans =
      '<span data-slide-inline-style="true" style="color: red;">a</span><span data-slide-inline-style="true" style="color: red;">b</span>';
    const el = mount(`<p id="t">${spans}</p>`);
    session = startInPlaceTextSession(el);
    caret(textOf(el, "b"), 1);
    beforeInput(el, "insertLineBreak");
    session.end();
    expect(el.innerHTML).toBe(spans.replace("b</span>", "b<br><br></span>"));
  });

  it("keeps an overflow:hidden ancestor from scrolling to reveal the caret", () => {
    document.body.innerHTML =
      '<div id="clip" style="overflow: hidden; height: 40px"><p id="t">Line</p></div>';
    const clip = document.getElementById("clip")!;
    const el = document.getElementById("t")!;
    session = startInPlaceTextSession(el);
    clip.scrollTop = 30;
    clip.dispatchEvent(new Event("scroll"));
    expect(clip.scrollTop).toBe(0);
    clip.scrollTop = 30;
    session.end();
    expect(clip.scrollTop).toBe(0);
  });

  it("leaves text nodes alone when nothing was edited", () => {
    const el = mount('<h2 id="t">Plain</h2>');
    const original = el.firstChild;
    session = startInPlaceTextSession(el);
    session.end();
    expect(el.firstChild).toBe(original);
  });

  it("keeps a selection that is already inside the element", () => {
    const el = mount('<p id="t">Alpha beta</p>');
    const text = el.firstChild as Text;
    select(text, 6, text, 10);
    session = startInPlaceTextSession(el);
    expect(window.getSelection()!.toString()).toBe("beta");
  });

  it("refuses an element that is already editable", () => {
    const el = mount('<p id="t" contenteditable="true">x</p>');
    expect(() => startInPlaceTextSession(el)).toThrow(/already editable/);
  });

  it("stops handling input and commands after end()", () => {
    const el = mount('<p id="t">Alpha</p>');
    session = startInPlaceTextSession(el);
    session.end();
    caret(el.firstChild!, 5);
    expect(beforeInput(el, "insertParagraph").defaultPrevented).toBe(false);
    expect(session.commands.bold()).toBe(false);
    expect(session.undo()).toBe(false);
  });
});

describe("in-place text session: typing", () => {
  it("leaves collapsed typing inside a text node to the browser, keeping its span", () => {
    const el = mount(
      '<h2 id="t">Plan for <span style="color: red">next</span></h2>',
    );
    const onInput = vi.fn();
    session = startInPlaceTextSession(el, { onInput });
    caret(textOf(el, "next"), 4);
    const event = beforeInput(el, "insertText", { data: "!" });
    expect(event.defaultPrevented).toBe(false);
    type(el, " up");
    expect(el.innerHTML).toBe(
      'Plan for <span style="color: red">next up</span>',
    );
    expect(onInput).toHaveBeenCalled();
  });

  it("replaces a range selection itself, keeping the span it starts in", () => {
    const el = mount('<p id="t">ab<span style="color: red">cd</span>ef</p>');
    session = startInPlaceTextSession(el);
    select(textOf(el, "ab"), 1, textOf(el, "cd"), 1);
    const event = beforeInput(el, "insertText", { data: "X" });
    expect(event.defaultPrevented).toBe(true);
    session.end();
    expect(el.innerHTML).toBe('aX<span style="color: red">d</span>ef');
  });

  it("types over a selection across blocks into the first block", () => {
    const el = mount(
      '<div id="t"><p style="color: blue">Alpha</p><p style="color: red">Beta</p></div>',
    );
    session = startInPlaceTextSession(el);
    select(textOf(el, "Alpha"), 2, textOf(el, "Beta"), 2);
    type(el, "X");
    session.end();
    expect(el.innerHTML).toBe('<p style="color: blue">AlXta</p>');
  });

  it("inserts typing at an element position into a text node", () => {
    const el = mount('<p id="t"><span style="color: red"></span></p>');
    session = startInPlaceTextSession(el);
    caret(el.querySelector("span")!, 0);
    expect(beforeInput(el, "insertText", { data: "Z" }).defaultPrevented).toBe(
      true,
    );
    session.end();
    expect(el.innerHTML).toBe('<span style="color: red">Z</span>');
  });
});

describe("in-place text session: Enter", () => {
  it("adds <br> plus a placeholder in a leaf and keeps the element's own tag and style", () => {
    const el = mount(
      '<h2 id="t" class="title" style="font-size: 34px">Heading</h2>',
    );
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 7);

    expect(beforeInput(el, "insertParagraph").defaultPrevented).toBe(true);
    expect(el.innerHTML).toBe(`Heading<br>${ZWSP}`);
    const range = window.getSelection()!.getRangeAt(0);
    expect((range.startContainer as Text).data).toBe(ZWSP);
    expect(range.startOffset).toBe(1);

    session.end();
    expect(el.outerHTML).toBe(
      '<h2 id="t" class="title" style="font-size: 34px">Heading<br><br></h2>',
    );
  });

  it("keeps typing after Enter and drops the placeholder, three Enters deep", () => {
    const el = mount('<p id="t">Text</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 4);
    for (let i = 0; i < 3; i++) beforeInput(el, "insertParagraph");
    type(el, "new line");
    session.end();
    expect(el.innerHTML).toBe("Text<br><br><br>new line");
  });

  it("breaks the line mid-text without a placeholder", () => {
    const el = mount('<p id="t">Heading</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 4);
    beforeInput(el, "insertParagraph");
    expect(el.innerHTML).toBe("Head<br>ing");
    type(el, "X");
    session.end();
    expect(el.innerHTML).toBe("Head<br>Xing");
  });

  it("splits a list item into a same-attribute sibling", () => {
    const el = mount(
      '<ul id="t"><li class="item" data-src-i="n:2" data-builder-id="b1" style="color: red">One two</li><li>Three</li></ul>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "One"), 3);
    beforeInput(el, "insertParagraph");
    const items = el.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toBe("One");
    expect(items[1].textContent).toBe(" two");
    expect(items[1].getAttribute("class")).toBe("item");
    expect(items[1].getAttribute("style")).toBe("color: red");
    expect(items[1].getAttribute("data-src-i")).toBe("n:2");
    expect(items[1].hasAttribute("data-builder-id")).toBe(false);
    expect(el.tagName).toBe("UL");
  });

  it("types into the new item and removes an empty last item on a second Enter", () => {
    const el = mount('<ul id="t"><li>One</li></ul>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "One"), 3);
    beforeInput(el, "insertParagraph");
    type(el, "Two");
    beforeInput(el, "insertParagraph");
    expect(el.querySelectorAll("li")).toHaveLength(3);
    beforeInput(el, "insertParagraph");
    expect(el.querySelectorAll("li")).toHaveLength(2);
    session.end();
    expect(el.innerHTML).toBe("<li>One</li><li>Two</li>");
  });

  it("steps an empty nested last item out a level", () => {
    const el = mount(
      '<ul id="t"><li>One<ul><li>Sub</li><li></li></ul></li></ul>',
    );
    session = startInPlaceTextSession(el);
    const empty = el.querySelectorAll("li")[2];
    caret(empty, 0);
    beforeInput(el, "insertParagraph");
    expect(el.children).toHaveLength(2);
    expect(el.children[1]).toBe(empty);
  });

  it("splits a child block of a container into a same-attribute sibling", () => {
    const el = mount(
      '<div id="t"><p class="lead" style="color: blue">First para</p><p>Second</p></div>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "First"), 5);
    beforeInput(el, "insertParagraph");
    const paragraphs = el.querySelectorAll("p");
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[1].outerHTML).toBe(
      '<p class="lead" style="color: blue"> para</p>',
    );
  });

  it("keeps one empty line per Enter in a child block", () => {
    const el = mount('<div id="t"><p style="margin: 0">A</p></div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "A"), 1);
    beforeInput(el, "insertParagraph");
    beforeInput(el, "insertParagraph");
    session.end();
    expect(el.innerHTML).toBe(
      '<p style="margin: 0">A</p><p style="margin: 0"><br></p><p style="margin: 0"><br></p>',
    );
  });

  it("opens a new line at the end of a flex item with text after it", () => {
    // Flex items are blockified: the next item's text is not on this line.
    const el = mount(
      '<div id="t" style="display: flex"><span style="display: block">x</span><span style="display: block">Points</span></div>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "x"), 1);
    beforeInput(el, "insertParagraph");
    expect(el.firstElementChild!.innerHTML).toBe(`x<br>${ZWSP}`);
    session.end();
    expect(el.innerHTML).toBe(
      '<span style="display: block">x<br><br></span><span style="display: block">Points</span>',
    );
  });

  it("adds a styled bullet row after the caret's legacy row", () => {
    const row = (text: string) =>
      `<div style="display: flex; gap: 12px"><span style="font-size: 8px">●</span><span>${text}</span></div>`;
    const el = mount(
      `<div id="t" style="display: flex; flex-direction: column">${row("Alpha")}${row("Beta")}</div>`,
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Beta"), 4);
    beforeInput(el, "insertParagraph");
    expect(el.children).toHaveLength(3);
    expect(el.children[2].firstElementChild!.textContent).toBe("●");
    type(el, "Gamma");
    beforeInput(el, "insertParagraph");
    expect(el.children).toHaveLength(4);
    beforeInput(el, "insertParagraph");
    expect(el.children).toHaveLength(3);
    session.end();
    expect(Array.from(el.children, (child) => child.textContent)).toEqual([
      "●Alpha",
      "●Beta",
      "●Gamma",
    ]);
  });

  it("inserts a line break for Shift+Enter even in a list item", () => {
    const el = mount('<ul id="t"><li>One two</li></ul>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "One"), 3);
    beforeInput(el, "insertLineBreak");
    session.end();
    expect(el.innerHTML).toBe("<li>One<br> two</li>");
  });

  it("indents and outdents a list item with Tab and Shift+Tab", () => {
    const el = mount('<ul id="t"><li>One</li><li>Two</li></ul>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Two"), 1);
    expect(key(el, { key: "Tab" }).defaultPrevented).toBe(true);
    expect(el.children).toHaveLength(1);
    expect(el.querySelector("li > ul > li")!.textContent).toBe("Two");
    expect(window.getSelection()!.getRangeAt(0).startOffset).toBe(1);
    key(el, { key: "Tab", shiftKey: true });
    expect(el.innerHTML).toBe("<li>One</li><li>Two</li>");
  });

  it("nests a legacy bullet row by padding and keeps Tab in the text", () => {
    const row = (text: string) =>
      `<div style="display: flex; gap: 12px"><span style="font-size: 8px">●</span><span>${text}</span></div>`;
    const el = mount(`<div id="t">${row("Alpha")}${row("Beta")}</div>`);
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Beta"), 2);
    expect(key(el, { key: "Tab" }).defaultPrevented).toBe(true);
    const beta = el.children[1] as HTMLElement;
    expect(beta.style.paddingLeft).toBe("24px");
    key(el, { key: "Tab", shiftKey: true });
    expect(beta.style.paddingLeft).toBe("0px");
    session.undo();
    expect((el.children[1] as HTMLElement).style.paddingLeft).toBe("24px");

    const leaf = mount('<p id="leaf">Plain</p>', "#leaf");
    session.end();
    session = startInPlaceTextSession(leaf);
    caret(leaf.firstChild!, 2);
    expect(key(leaf, { key: "Tab" }).defaultPrevented).toBe(true);
    expect(leaf.outerHTML).toBe(
      '<p id="leaf" contenteditable="true" data-editing-block="true">Plain</p>',
    );
  });
});

describe("in-place text session: deleting", () => {
  it("leaves a delete inside one text node to the browser", () => {
    const el = mount('<p id="t">Alpha</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 3);
    expect(beforeInput(el, "deleteContentBackward").defaultPrevented).toBe(
      false,
    );
    select(el.firstChild!, 1, el.firstChild!, 3);
    expect(beforeInput(el, "deleteContentBackward").defaultPrevented).toBe(
      false,
    );
  });

  it("keeps the caret in a span whose last character is deleted", () => {
    const el = mount('<p id="t">a<span style="color: red">b</span></p>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "b"), 1);
    expect(beforeInput(el, "deleteContentBackward").defaultPrevented).toBe(
      true,
    );
    expect(el.querySelector("span")!.textContent).toBe(ZWSP);
    type(el, "c");
    session.end();
    expect(el.innerHTML).toBe('a<span style="color: red">c</span>');
  });

  it("merges blocks on Backspace across them with no injected style span", () => {
    const el = mount(
      '<div id="t"><p style="color: blue; font-size: 30px">Alpha</p><p style="color: red">Beta</p></div>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Beta"), 0);
    expect(beforeInput(el, "deleteContentBackward").defaultPrevented).toBe(
      true,
    );
    session.end();
    expect(el.innerHTML).toBe(
      '<p style="color: blue; font-size: 30px">AlphaBeta</p>',
    );
  });

  it("deletes a selection across list items and joins them", () => {
    const el = mount(
      '<ul id="t"><li>Alpha</li><li>Beta</li><li>Gamma</li></ul>',
    );
    session = startInPlaceTextSession(el);
    select(textOf(el, "Alpha"), 2, textOf(el, "Gamma"), 2);
    beforeInput(el, "deleteContentBackward");
    session.end();
    expect(el.innerHTML).toBe("<li>Almma</li>");
  });

  it("joins a legacy row into the previous row and never deletes a marker", () => {
    const row = (text: string) =>
      `<div style="display: flex"><span>●</span><span>${text}</span></div>`;
    const el = mount(`<div id="t">${row("Alpha")}${row("Beta")}</div>`);
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Alpha"), 0);
    beforeInput(el, "deleteContentBackward");
    expect(el.innerHTML).toBe(`${row("Alpha")}${row("Beta")}`);
    caret(textOf(el, "Beta"), 0);
    beforeInput(el, "deleteContentBackward");
    session.end();
    expect(el.innerHTML).toBe(row("AlphaBeta"));
  });

  it("deletes through an Enter placeholder together with its <br>", () => {
    const el = mount('<p id="t">Text</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 4);
    beforeInput(el, "insertParagraph");
    beforeInput(el, "deleteContentBackward");
    session.end();
    expect(el.innerHTML).toBe("Text");
  });
});

describe("in-place text session: undo", () => {
  it("restores the HTML and the caret offsets, then redoes", () => {
    const el = mount('<p id="t">Heading</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 4);
    beforeInput(el, "insertParagraph");
    const afterEnter = el.innerHTML;
    expect(session.undo()).toBe(true);
    expect(el.innerHTML).toBe("Heading");
    const range = window.getSelection()!.getRangeAt(0);
    expect([range.startContainer, range.startOffset]).toEqual([
      el.firstChild,
      4,
    ]);
    expect(session.redo()).toBe(true);
    expect(el.innerHTML).toBe(afterEnter);
  });

  it("groups a typing run into one step and answers Mod-Z and historyUndo", () => {
    const el = mount('<p id="t">Head</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 4);
    type(el, "ing");
    expect(el.innerHTML).toBe("Heading");
    expect(key(el, { key: "z", metaKey: true }).defaultPrevented).toBe(true);
    expect(el.innerHTML).toBe("Head");
    key(el, { key: "z", metaKey: true, shiftKey: true });
    expect(el.innerHTML).toBe("Heading");
    expect(beforeInput(el, "historyUndo").defaultPrevented).toBe(true);
    expect(el.innerHTML).toBe("Head");
    beforeInput(el, "historyRedo");
    expect(el.innerHTML).toBe("Heading");
  });

  it("keeps at most 100 steps", () => {
    const el = mount('<p id="t">x</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 1);
    const aligns = ["left", "right"] as const;
    for (let i = 0; i < 105; i++) session.commands.align(aligns[i % 2]);
    let undone = 0;
    while (session.undo()) undone++;
    expect(undone).toBe(100);
  });
});

describe("in-place text session: paste", () => {
  it("keeps only inline formatting from rich HTML, one line per block", () => {
    const el = mount('<p id="t">Start </p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 6);
    const event = paste(el, {
      "text/html":
        '<p class="x" data-y="1" style="position: absolute; color: red"><b>Bold</b> <span style="color: blue">blue</span> <a href="javascript:alert(1)">bad</a> <a href="https://example.com">ok</a><img src="https://example.com/a.png"><script>alert(1)</script></p><div>second</div>',
      "text/plain": "Bold blue bad ok\nsecond",
    });
    expect(event.defaultPrevented).toBe(true);
    session.end();
    expect(el.innerHTML).toBe(
      'Start <b>Bold</b> <span style="color: blue;">blue</span> <a>bad</a> <a href="https://example.com">ok</a><br>second',
    );
  });

  it("pastes plain text lines through the Enter policy", () => {
    const el = mount('<ul id="t"><li>One</li></ul>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "One"), 3);
    paste(el, { "text/plain": " a\nTwo\nThree" });
    session.end();
    expect(el.innerHTML).toBe("<li>One a</li><li>Two</li><li>Three</li>");
  });
});

describe("in-place text session: composition", () => {
  it("never intercepts composition and ignores Enter while composing", () => {
    const el = mount('<p id="t">Text</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 4);
    expect(
      beforeInput(el, "insertCompositionText", { data: "k" }).defaultPrevented,
    ).toBe(false);
    expect(
      beforeInput(el, "insertText", { data: "k", isComposing: true })
        .defaultPrevented,
    ).toBe(false);
    expect(
      key(el, { key: "Enter", isComposing: true } as KeyboardEventInit)
        .defaultPrevented,
    ).toBe(false);
    expect(
      beforeInput(el, "insertParagraph", { isComposing: true })
        .defaultPrevented,
    ).toBe(true);
    expect(el.innerHTML).toBe("Text");
  });
});

describe("in-place text session: commands", () => {
  it("formats a selection with a style span and refuses browser formatting", () => {
    const el = mount('<p id="t">Hello world</p>');
    session = startInPlaceTextSession(el);
    select(el.firstChild!, 6, el.firstChild!, 11);
    expect(beforeInput(el, "formatBold").defaultPrevented).toBe(true);
    expect(el.innerHTML).toBe(
      'Hello <span data-slide-inline-style="true" style="font-weight: 700;">world</span>',
    );
    expect(beforeInput(el, "insertUnorderedList").defaultPrevented).toBe(true);
    expect(el.querySelector("ul")).toBeNull();
  });

  it("gives a collapsed caret a pending style run and drops it when unused", () => {
    const el = mount('<p id="t">Hello</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 5);
    expect(session.commands.color("rgb(255, 0, 0)")).toBe(true);
    type(el, " red");
    caret(el.firstChild!, 2);
    session.commands.italic();
    session.end();
    expect(el.innerHTML).toBe(
      'Hello<span data-slide-inline-style="true" style="color: rgb(255, 0, 0);"> red</span>',
    );
  });

  it("aligns and toggles a list on the edited element", () => {
    const el = mount('<div id="t">Alpha<br>Beta</div>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 2);
    expect(session.commands.align("center")).toBe(true);
    expect(el.style.textAlign).toBe("center");
    expect(session.commands.toggleList("bullet")).toBe(true);
    expect(session.element).toBe(el);
    expect(
      Array.from(el.querySelectorAll("li"), (li) => li.textContent),
    ).toEqual(["Alpha", "Beta"]);
    session.undo();
    session.undo();
    expect(el.innerHTML).toBe("Alpha<br>Beta");
    expect(el.style.textAlign).toBe("");
  });

  it("selects the element's text for Mod-A", () => {
    const el = mount('<p id="t">One <b>two</b></p><p>outside</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 1);
    expect(key(el, { key: "a", metaKey: true }).defaultPrevented).toBe(true);
    expect(window.getSelection()!.toString()).toBe("One two");
  });

  it("turns '- ' at the start of a leaf into a styled bullet row", () => {
    const el = mount('<div id="t">Point</div>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 0);
    type(el, "- ");
    expect(el.firstElementChild!.firstElementChild!.textContent).toBe("●");
    expect(el.textContent).toBe("●Point");
  });

  it("turns '1. ' at the start of a leaf into an ordered list", () => {
    const el = mount('<div id="t"></div>');
    session = startInPlaceTextSession(el);
    caret(el, 0);
    beforeInput(el, "insertText", { data: "1" });
    type(el, ". ");
    type(el, "First");
    session.end();
    expect(el.querySelector("ol")!.textContent).toBe("First");
  });
});

function caretIn(): [Node, number] {
  const range = window.getSelection()!.getRangeAt(0);
  return [range.startContainer, range.startOffset];
}

function clipboardEvent(target: Element, type: "copy" | "cut") {
  const clipboardData = new DataTransfer();
  const event = new ClipboardEvent(type, {
    clipboardData,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return { event, clipboardData };
}

describe("in-place text session: select all", () => {
  it("types over Mod-A keeping the first run's style", () => {
    const el = mount(
      '<p id="t"><span style="color: white; font-weight: 700">Title</span> rest</p>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Title"), 2);
    key(el, { key: "a", metaKey: true });
    type(el, "New");
    session.end();
    expect(el.innerHTML).toBe(
      '<span style="color: white; font-weight: 700">New</span>',
    );
  });

  it("keeps the first list item when Backspace and typing replace Mod-A", () => {
    const el = mount('<ul id="t"><li>Alpha</li><li>Beta</li></ul>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Beta"), 1);
    key(el, { key: "a", metaKey: true });
    beforeInput(el, "deleteContentBackward");
    type(el, "Only");
    session.end();
    expect(el.innerHTML).toBe("<li>Only</li>");
  });

  it("still deletes a line break selected at element boundaries", () => {
    const el = mount('<p id="t">One<br>Two</p>');
    session = startInPlaceTextSession(el);
    select(el, 1, el, 2);
    beforeInput(el, "deleteContentBackward");
    session.end();
    expect(el.innerHTML).toBe("OneTwo");
  });
});

describe("in-place text session: caret after structural changes", () => {
  it("keeps the caret at the end of a text node through undo", () => {
    const el = mount('<ul id="t"><li>Item one</li><li>Item two</li></ul>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Item one"), 8);
    type(el, "abc");
    key(el, { key: "z", metaKey: true });
    type(el, "Z");
    session.end();
    expect(el.innerHTML).toBe("<li>Item oneZ</li><li>Item two</li>");
  });

  it("keeps the caret before a <br> through undo, and after one", () => {
    const el = mount('<p id="t">Line one<br>Line two</p>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Line one"), 8);
    type(el, "abc");
    session.undo();
    type(el, "Z");
    session.end();
    expect(el.innerHTML).toBe("Line oneZ<br>Line two");

    const next = mount('<p id="u">Line one<br>Line two</p>', "#u");
    session = startInPlaceTextSession(next);
    caret(textOf(next, "Line two"), 0);
    type(next, "abc");
    session.undo();
    type(next, "Z");
    session.end();
    expect(next.innerHTML).toBe("Line one<br>ZLine two");
  });

  it("types into the new bullet after Enter then Tab at the end of an item", () => {
    const el = mount('<ul id="t"><li>Item one</li><li>Parent</li></ul>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Item one"), 8);
    beforeInput(el, "insertParagraph");
    key(el, { key: "Tab" });
    type(el, "sub");
    session.end();
    expect(el.innerHTML).toMatch(
      /^<li>Item one<ul[^>]*><li>sub<\/li><\/ul><\/li><li>Parent<\/li>$/,
    );
  });

  it("keeps the caret in the item Shift+Tab outdents", () => {
    const el = mount(
      '<ul id="t"><li>One<ul><li>Child</li></ul></li><li>Three</li></ul>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Child"), 5);
    key(el, { key: "Tab", shiftKey: true });
    type(el, "!");
    session.end();
    expect(el.innerHTML).toBe("<li>One</li><li>Child!</li><li>Three</li>");
  });

  it("gives Enter at the end of an item with a nested list its own line", () => {
    const el = mount(
      '<ul id="t"><li>Parent item<ul><li>Child one</li></ul></li></ul>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Parent item"), 11);
    beforeInput(el, "insertParagraph");
    type(el, "X");
    session.end();
    expect(el.innerHTML).toBe(
      "<li>Parent item</li><li>X<ul><li>Child one</li></ul></li>",
    );
  });

  it("keeps that line open when nothing is typed on it", () => {
    const el = mount(
      '<ul id="t"><li>Parent item<ul><li>Child one</li></ul></li></ul>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Parent item"), 11);
    beforeInput(el, "insertParagraph");
    session.end();
    expect(el.innerHTML).toBe(
      "<li>Parent item</li><li><br><ul><li>Child one</li></ul></li>",
    );
  });
});

describe("in-place text session: clipboard and drag", () => {
  it("copies only the slide's own markup and plain text", () => {
    const el = mount('<p id="t">start <b>bold</b> end</p>');
    session = startInPlaceTextSession(el);
    select(textOf(el, "start"), 2, textOf(el, "end"), 2);
    const { event, clipboardData } = clipboardEvent(el, "copy");
    expect(event.defaultPrevented).toBe(true);
    expect(clipboardData.getData("text/html")).toBe("<p>art <b>bold</b> e</p>");
    expect(clipboardData.getData("text/plain")).toBe("art bold e");
    expect(el.innerHTML).toBe("start <b>bold</b> end");
  });

  it("cuts as one undo step", () => {
    const el = mount('<p id="t">start <b>bold</b> end</p>');
    session = startInPlaceTextSession(el);
    select(textOf(el, "start"), 2, textOf(el, "end"), 2);
    const { clipboardData } = clipboardEvent(el, "cut");
    expect(clipboardData.getData("text/plain")).toBe("art bold e");
    expect(el.textContent).toBe("stnd");
    session.undo();
    expect(el.innerHTML).toBe("start <b>bold</b> end");
  });

  it("pastes formatting but not a source page's layout or paint", () => {
    const el = mount('<p id="t">A</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 1);
    paste(el, {
      "text/html":
        '<span style="color: red; font-size: 20px; background-color: rgb(255, 255, 255); display: inline !important; --tw-font-weight: 700; orphans: 2">x</span>',
      "text/plain": "x",
    });
    session.end();
    expect(el.innerHTML).toBe(
      'A<span style="color: red; font-size: 20px;">x</span>',
    );
  });

  it("unwraps a pasted link inside a link", () => {
    const el = mount('<p id="t"><a href="https://y.test">linked</a></p>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "linked"), 3);
    paste(el, {
      "text/html": '<a href="https://z.test">other</a>',
      "text/plain": "other",
    });
    session.end();
    expect(el.innerHTML).toBe('<a href="https://y.test">linotherked</a>');
  });

  it("moves dragged text as one undo step", () => {
    const el = mount('<p id="t">alpha beta gamma</p>');
    session = startInPlaceTextSession(el);
    const text = el.firstChild as Text;
    select(text, 6, text, 11);
    // Inside one text node Chrome's own delete runs (it drops a doubled space).
    expect(beforeInput(el, "deleteByDrag").defaultPrevented).toBe(false);
    text.deleteData(6, 5);
    caret(text, 11);
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", "beta ");
    beforeInput(el, "insertFromDrop", { dataTransfer });
    expect(el.textContent).toBe("alpha gammabeta ");
    session.undo();
    expect(el.innerHTML).toBe("alpha beta gamma");
  });

  it("deletes a drag across runs itself, joined with its drop", () => {
    const el = mount('<p id="t">alpha <b>beta</b> gamma</p>');
    session = startInPlaceTextSession(el);
    select(textOf(el, "alpha"), 3, textOf(el, "beta"), 2);
    expect(beforeInput(el, "deleteByDrag").defaultPrevented).toBe(true);
    expect(el.textContent).toBe("alpta gamma");
    caret(textOf(el, "gamma"), 6);
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", "ha be");
    beforeInput(el, "insertFromDrop", { dataTransfer });
    expect(el.textContent).toBe("alpta gammaha be");
    session.undo();
    expect(el.innerHTML).toBe("alpha <b>beta</b> gamma");
  });
});

describe("in-place text session: composition over a selection", () => {
  it("deletes a selection across blocks itself before composing", () => {
    const el = mount('<ul id="t"><li>Item one</li><li>Parent item</li></ul>');
    session = startInPlaceTextSession(el);
    select(textOf(el, "Item one"), 4, textOf(el, "Parent"), 3);
    el.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
    expect(el.innerHTML).toBe("<li>Itement item</li>");
    expect(caretIn()).toEqual([textOf(el, "Item"), 4]);
  });
});

describe("in-place text session: an empty element", () => {
  it("seeds a caret line so a new text box takes typing, and writes nothing unused", () => {
    const el = mount('<div id="t" class="fmd-text-box"></div>');
    session = startInPlaceTextSession(el);
    expect(el.textContent).toBe(ZWSP);
    expect(session.changed).toBe(false);
    session.end();
    expect(el.innerHTML).toBe("");

    const box = mount('<div id="u" class="fmd-text-box"></div>', "#u");
    session = startInPlaceTextSession(box);
    type(box, "Typed");
    session.end();
    expect(box.innerHTML).toBe("Typed");
  });
});

describe("in-place text session: lists on a paragraph", () => {
  const reparse = (html: string) => {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host.innerHTML;
  };

  it("turns a <p> into a <div> before '- ' nests a row in it", () => {
    const el = mount('<p id="t" style="font-size: 30px">Alpha</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 0);
    type(el, "- ");
    type(session.element, "Z");
    const root = session.element;
    session.end();
    expect(root.tagName).toBe("DIV");
    expect(root.id).toBe("t");
    expect(root.style.fontSize).toBe("30px");
    expect(root.textContent).toBe("●ZAlpha");
    expect(reparse(root.outerHTML)).toBe(root.outerHTML);
  });

  it("turns a <p> into a <div> for '1. ' and the list command", () => {
    const el = mount('<p id="t" style="color: red">Alpha</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 0);
    type(el, "1. ");
    let root = session.element;
    expect(root.tagName).toBe("DIV");
    expect(root.querySelector("ol")!.textContent).toBe("Alpha");
    session.undo();
    root = session.element;
    expect(root.tagName).toBe("P");
    caret(textOf(root, "Alpha"), 0);
    expect(session.commands.toggleList("bullet")).toBe(true);
    root = session.element;
    session.end();
    expect(root.tagName).toBe("DIV");
    expect(reparse(root.outerHTML)).toBe(root.outerHTML);
  });
});

describe("in-place text session: dock changes", () => {
  it("makes a change to the element its own undo step", () => {
    const el = mount('<p id="t">First</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 5);
    type(el, " abc");
    expect(
      session.apply(() => el.style.setProperty("text-align", "center")),
    ).toBe(true);
    session.undo();
    expect(el.style.textAlign).toBe("");
    expect(el.textContent).toBe("First abc");
  });

  it("writes nothing for a pending style that was never typed into", () => {
    const el = mount('<p id="t">Plain words</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 11);
    session.commands.bold();
    expect(session.changed).toBe(false);
  });

  it("leaves no markup after toggling a format on and off", () => {
    const el = mount('<p id="t">Plain words</p>');
    session = startInPlaceTextSession(el);
    select(el.firstChild!, 6, el.firstChild!, 11);
    session.commands.bold();
    session.commands.bold();
    session.commands.italic();
    session.commands.italic();
    expect(session.changed).toBe(false);
    session.end();
    expect(el.innerHTML).toBe("Plain words");
  });

  it("keeps strike and list shortcuts", () => {
    const el = mount('<div id="t">Alpha<br>Beta</div>');
    session = startInPlaceTextSession(el);
    select(textOf(el, "Alpha"), 0, textOf(el, "Alpha"), 5);
    expect(
      key(el, { key: "s", metaKey: true, shiftKey: true }).defaultPrevented,
    ).toBe(true);
    expect(el.querySelector("span")!.style.textDecorationLine).toBe(
      "line-through",
    );
    key(el, { key: "8", code: "Digit8", metaKey: true, shiftKey: true });
    expect(el.querySelector("ul")).not.toBeNull();
    key(el, { key: "7", code: "Digit7", metaKey: true, shiftKey: true });
    expect(el.querySelector("ol")).not.toBeNull();
  });
});

describe("in-place text session: review fixes", () => {
  it("keeps an author zero-width space through undo and a later edit", () => {
    const el = mount(`<p id="t">A${ZWSP}B</p>`);
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 3);
    type(el, "x");
    session.undo();
    caret(el.firstChild!, 3);
    type(el, "y");
    session.end();
    expect(el.innerHTML).toBe(`A${ZWSP}By`);
  });

  it("copies the slide without its placeholders but with the author's zero-width spaces", () => {
    const el = mount(`<p id="t">A${ZWSP}B</p>`);
    const root = document.querySelector<HTMLElement>(".slide-content")!;
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 3);
    beforeInput(el, "insertParagraph");
    expect(el.innerHTML).toBe(`A${ZWSP}B<br>${ZWSP}`);
    const copy = session.cloneWithoutPlaceholders(root);
    expect(copy.querySelector("#t")!.innerHTML).toBe(`A${ZWSP}B<br>`);
    expect(el.innerHTML).toBe(`A${ZWSP}B<br>${ZWSP}`);
  });

  it("restores a caret on an empty line between two <br>s through undo", () => {
    const el = mount('<p id="t">A<br><br>B</p>');
    session = startInPlaceTextSession(el);
    caret(el, 2);
    type(el, "x");
    expect(el.innerHTML).toBe("A<br>x<br>B");
    session.undo();
    type(el, "Z");
    session.end();
    expect(el.innerHTML).toBe("A<br>Z<br>B");
  });

  it("gives a split block's new sibling its look but not its identity", () => {
    const el = mount(
      '<div id="t"><p id="intro" data-slide-object-id="obj-1" data-src-i="n:4" class="lead" style="color: red;">Hello world</p></div>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Hello"), 5);
    beforeInput(el, "insertParagraph");
    session.end();
    expect(el.innerHTML).toBe(
      '<p id="intro" data-slide-object-id="obj-1" data-src-i="n:4" class="lead" style="color: red;">Hello</p><p data-src-i="n:4" class="lead" style="color: red;"> world</p>',
    );
  });

  it("gives a new legacy bullet row none of the row's identity", () => {
    const el = mount(
      '<div id="t"><div id="row-1" data-slide-object-id="r1" style="display: flex; gap: 12px;"><span style="color: red;">•</span><span id="txt-1">First</span></div><div style="display: flex; gap: 12px;"><span style="color: red;">•</span><span>Second</span></div></div>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "First"), 5);
    beforeInput(el, "insertParagraph");
    session.end();
    expect(el.querySelectorAll("#row-1")).toHaveLength(1);
    expect(el.querySelectorAll("#txt-1")).toHaveLength(1);
    expect(el.querySelectorAll('[data-slide-object-id="r1"]')).toHaveLength(1);
    expect(el.children).toHaveLength(3);
  });

  it("unlinks only the selected part of a link", () => {
    const el = mount('<p id="t"><a href="https://x.test">linked text</a></p>');
    session = startInPlaceTextSession(el);
    const text = textOf(el, "linked");
    select(text, 0, text, 6);
    expect(session.commands.link(null)).toBe(true);
    session.end();
    expect(el.innerHTML).toBe('linked<a href="https://x.test"> text</a>');
  });

  it("pastes a nested list into a list item as items at their depth", () => {
    const el = mount('<ul id="t"><li>One</li></ul>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "One"), 3);
    paste(el, {
      "text/html":
        '<ul style="color: red"><li>Two<ul><li>Sub</li></ul></li><li>Three</li></ul>',
      "text/plain": "Two\nSub\nThree",
    });
    session.end();
    expect(el.innerHTML).toMatch(
      /^<li>OneTwo<ul[^>]*><li>Sub<\/li><\/ul><\/li><li>Three<\/li>$/,
    );
  });

  it("pastes a list into a text container as a list", () => {
    const el = mount('<div id="t">Intro</div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Intro"), 5);
    paste(el, {
      "text/html":
        '<ol class="x" style="position: absolute"><li><b>First</b></li><li>Second<ol><li>Deep</li></ol></li></ol>',
      "text/plain": "First\nSecond\nDeep",
    });
    session.end();
    expect(el.innerHTML).toMatch(
      /^Intro<ol style="[^"]*list-style-type:\s*decimal[^"]*"><li><b>First<\/b><\/li><li>Second<ol style="[^"]*"><li>Deep<\/li><\/ol><\/li><\/ol>$/,
    );
  });

  it("pastes a list into a paragraph as lines, since a paragraph cannot hold one", () => {
    const el = mount('<p id="t">Intro</p>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Intro"), 5);
    paste(el, {
      "text/html": "<ul><li>One</li><li>Two</li></ul>",
      "text/plain": "One\nTwo",
    });
    session.end();
    expect(el.innerHTML).toBe("IntroOne<br>Two");
  });
});

describe("in-place text session: review round 2", () => {
  it("keeps the identity of an inline element split by Enter on its original only", () => {
    const el = mount(
      '<div id="t"><p>Hello <span id="s" data-slide-object-id="o1" style="color: red;">big world</span></p></div>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "big world"), 3);
    beforeInput(el, "insertParagraph");
    session.end();
    expect(el.innerHTML).toBe(
      '<p>Hello <span id="s" data-slide-object-id="o1" style="color: red;">big</span></p><p><span style="color: red;"> world</span></p>',
    );
  });

  it("keeps an inline element's identity off a new legacy bullet row", () => {
    const el = mount(
      '<div id="t"><div style="display: flex; gap: 12px;"><span>•</span><span><b id="b1" data-slide-object-id="o2">First line</b></span></div><div style="display: flex; gap: 12px;"><span>•</span><span>Second</span></div></div>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "First line"), 5);
    beforeInput(el, "insertParagraph");
    session.end();
    expect(el.children).toHaveLength(3);
    expect(el.querySelectorAll("#b1")).toHaveLength(1);
    expect(el.querySelectorAll('[data-slide-object-id="o2"]')).toHaveLength(1);
    expect(el.children[1].querySelector("b")!.textContent).toBe(" line");
  });

  it("keeps an inline element's identity on one copy when part of a link is unlinked", () => {
    const el = mount(
      '<p id="t"><a href="https://x.test"><span id="s" data-slide-object-id="o3" style="color: red;">linked text</span></a></p>',
    );
    session = startInPlaceTextSession(el);
    const text = textOf(el, "linked");
    select(text, 7, text, 11);
    expect(session.commands.link(null)).toBe(true);
    session.end();
    expect(el.querySelectorAll("#s")).toHaveLength(1);
    expect(el.querySelectorAll('[data-slide-object-id="o3"]')).toHaveLength(1);
    expect(el.textContent).toBe("linked text");
  });

  it("copies the author's zero-width spaces but not the session's placeholders", () => {
    const el = mount(`<p id="t">A${ZWSP}B</p>`);
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 3);
    beforeInput(el, "insertParagraph");
    expect(el.innerHTML).toBe(`A${ZWSP}B<br>${ZWSP}`);
    select(el.firstChild!, 0, el, el.childNodes.length);
    const { clipboardData } = clipboardEvent(el, "copy");
    expect(clipboardData.getData("text/html")).toContain(`A${ZWSP}B`);
    expect(clipboardData.getData("text/html").split(ZWSP)).toHaveLength(2);
    expect(clipboardData.getData("text/plain")).toBe(`A${ZWSP}B`);
  });

  it("starts a new undo step when typing resumes somewhere else", () => {
    const el = mount('<p id="t">Head</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 4);
    type(el, "ab");
    caret(el.firstChild!, 0);
    type(el, "x");
    expect(el.innerHTML).toBe("xHeadab");
    session.undo();
    expect(el.innerHTML).toBe("Headab");
    session.undo();
    expect(el.innerHTML).toBe("Head");
  });

  it("does not coalesce typing on different lines at the same text offset", () => {
    const el = mount('<p id="t">A<br>B</p>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "A"), 1);
    type(el, "X");
    caret(textOf(el, "B"), 0);
    type(el, "Y");
    session.undo();
    expect(el.innerHTML).toBe("AX<br>B");
  });
});

describe("in-place text session: review round 3", () => {
  it("pastes an ordered list followed by a bullet list as two lists", () => {
    const el = mount('<div id="t">Intro</div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Intro"), 5);
    paste(el, {
      "text/html": "<ol><li>One</li><li>Two</li></ol><ul><li>Dot</li></ul>",
      "text/plain": "One\nTwo\nDot",
    });
    session.end();
    expect(el.innerHTML).toMatch(
      /^Intro<ol[^>]*><li>One<\/li><li>Two<\/li><\/ol><ul[^>]*><li>Dot<\/li><\/ul>$/,
    );
  });

  it.each([
    [
      "an image the clipboard allowlist drops",
      '<img src="https://x.test/a.png">',
    ],
    ["an embedded image", '<img src="data:image/png;base64,AAAA">'],
  ])(
    "leaves the selection alone when a paste of %s has nothing to insert",
    (_label, html) => {
      const el = mount('<p id="t">Hello world</p>');
      session = startInPlaceTextSession(el);
      select(el.firstChild!, 0, el.firstChild!, 5);
      const event = paste(el, { "text/html": html, "text/plain": "" });
      expect(event.defaultPrevented).toBe(true);
      expect(el.innerHTML).toBe("Hello world");
      expect(session.undo()).toBe(false);
    },
  );

  it("keeps a pasted ordered list's start, type, and direction", () => {
    const el = mount('<div id="t">Intro</div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Intro"), 5);
    paste(el, {
      "text/html": '<ol start="3" type="a" reversed><li>C</li><li>D</li></ol>',
      "text/plain": "C\nD",
    });
    session.end();
    const list = el.querySelector("ol")!;
    expect(list.getAttribute("start")).toBe("3");
    expect(list.hasAttribute("reversed")).toBe(true);
    expect(list.style.listStyleType).toBe("lower-alpha");
  });

  it("keeps a pasted ordered sub-list ordered inside a bullet item", () => {
    const el = mount('<ul id="t"><li>One</li></ul>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "One"), 3);
    paste(el, {
      "text/html": '<ul><li>Two<ol start="4"><li>Sub</li></ol></li></ul>',
      "text/plain": "Two\nSub",
    });
    session.end();
    expect(el.innerHTML).toMatch(
      /^<li>OneTwo<ol [^>]*><li>Sub<\/li><\/ol><\/li>$/,
    );
    const sub = el.querySelector("ol")!;
    expect(sub.getAttribute("start")).toBe("4");
    expect(sub.style.listStyleType).toBe("decimal");
  });

  it("copies items across an ordered list as that list, numbered from the first copied item", () => {
    const el = mount(
      '<ol id="t" start="2" style="list-style-type: decimal;"><li>One</li><li>Two</li><li>Three</li></ol>',
    );
    session = startInPlaceTextSession(el);
    select(textOf(el, "Two"), 1, textOf(el, "Three"), 2);
    const { clipboardData } = clipboardEvent(el, "copy");
    expect(clipboardData.getData("text/html")).toBe(
      '<ol start="3" style="list-style-type: decimal;"><li>wo</li><li>Th</li></ol>',
    );
  });

  it("puts no element identity on the clipboard", () => {
    const el = mount(
      '<p id="t">Hi <span id="s" data-slide-object-id="o1" class="k" style="color: red;">big world</span></p>',
    );
    session = startInPlaceTextSession(el);
    select(textOf(el, "Hi"), 0, textOf(el, "big"), 3);
    const { clipboardData } = clipboardEvent(el, "copy");
    const html = clipboardData.getData("text/html");
    expect(html).not.toMatch(/\sid=|data-slide-object-id/);
    expect(html).toContain('class="k"');
    expect(html).toContain("color: red;");
  });

  it("keeps an author zero-width space in a text node Shift+Enter splits", () => {
    const el = mount(`<p id="t">A${ZWSP}B</p>`);
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 1);
    beforeInput(el, "insertLineBreak");
    session.end();
    expect(el.innerHTML).toBe(`A<br>${ZWSP}B`);
  });

  it("keeps an author zero-width space in a text node a format splits", () => {
    const el = mount(`<p id="t">A${ZWSP}B</p>`);
    session = startInPlaceTextSession(el);
    select(el.firstChild!, 0, el.firstChild!, 1);
    expect(session.commands.bold()).toBe(true);
    session.end();
    expect(el.textContent).toBe(`A${ZWSP}B`);
  });

  it("keeps an author zero-width space through a list toggle", () => {
    const el = mount(`<div id="t">A${ZWSP}B</div>`);
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 3);
    expect(session.commands.toggleList("bullet")).toBe(true);
    session.end();
    expect(el.textContent).toBe(`A${ZWSP}B`);
  });

  it("keeps an author zero-width space when native typing replaced its text node", () => {
    const el = mount(`<p id="t">A${ZWSP}B</p>`);
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 3);
    const event = beforeInput(el, "insertText", { data: "x" });
    expect(event.defaultPrevented).toBe(false);
    const replacement = document.createTextNode(`A${ZWSP}Bx`);
    el.firstChild!.replaceWith(replacement);
    caret(replacement, 4);
    el.dispatchEvent(
      new InputEvent("input", {
        inputType: "insertText",
        data: "x",
        bubbles: true,
      }),
    );
    session.end();
    expect(el.innerHTML).toBe(`A${ZWSP}Bx`);
  });

  it("keeps an author zero-width space next to an autocorrected word", () => {
    const el = mount(`<p id="t">teh${ZWSP}end</p>`);
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 7);
    const target = document.createRange();
    target.setStart(el.firstChild!, 0);
    target.setEnd(el.firstChild!, 3);
    const event = new InputEvent("beforeinput", {
      inputType: "insertReplacementText",
      data: "the",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "getTargetRanges", {
      value: () => [target],
    });
    el.dispatchEvent(event);
    session.end();
    expect(el.innerHTML).toBe(`the${ZWSP}end`);
  });
});
