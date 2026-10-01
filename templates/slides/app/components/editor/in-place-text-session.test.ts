// @vitest-environment happy-dom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ZERO_WIDTH_SPACE as ZWSP } from "./bullet-editing";
import {
  IN_PLACE_TEXT_UNDO_BYTE_LIMIT,
  IN_PLACE_TEXT_UNDO_LIMIT,
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

function selectBackward(
  start: Node,
  startOffset: number,
  end: Node,
  endOffset: number,
) {
  window.getSelection()!.setBaseAndExtent(end, endOffset, start, startOffset);
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
    textOf(el, "betax").deleteData(4, 1);
    session.end();
    expect(el.outerHTML).toBe(before);
  });

  it("counts a root style patch as a visible edit", () => {
    const el = mount('<p id="t">Alpha</p>');
    session = startInPlaceTextSession(el);

    expect(session.changed).toBe(false);
    expect(
      session.apply(() => el.style.setProperty("text-align", "center")),
    ).toBe(true);
    expect(session.changed).toBe(true);
    session.end();
    expect(el.style.textAlign).toBe("center");
    expect(session.changed).toBe(true);
  });

  it("restores the start bytes when editing normalizes a space to NBSP", () => {
    vi.spyOn(HTMLElement.prototype, "innerText", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.textContent ?? "";
      },
    );
    const el = mount('<p id="t">Alpha beta</p>');
    const before = el.outerHTML;
    session = startInPlaceTextSession(el);
    const text = el.firstChild as Text;
    caret(text, 6);
    type(el, "x");
    expect(beforeInput(el, "deleteContentBackward").defaultPrevented).toBe(
      false,
    );
    (el.firstChild as Text).deleteData(6, 1);
    (el.firstChild as Text).data = "Alpha\u00a0beta";
    expect(session.changed).toBe(false);
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
    // While editing too, or the live text is drawn unlike the saved text.
    const typed = el.firstChild as Text;
    expect(typed).not.toBe(original);
    const range = window.getSelection()!.getRangeAt(0);
    expect([range.startContainer, range.startOffset]).toEqual([typed, 2]);
    typed.deleteData(1, 1);
    typed.splitText(3);
    session.end();
    expect(el.childNodes).toHaveLength(1);
    expect(el.firstChild).not.toBe(typed);
    expect(el.outerHTML).toBe(before);
  });

  it("recreates an edited Latin node whose last glyph kerns with the next text node", () => {
    const el = mount(
      '<p id="t"><b style="font-weight: 700"><span style="font-weight: 700">Abc</span>:</b> rest</p>',
    );
    const before = el.outerHTML;
    const original = textOf(el, "Abc");
    session = startInPlaceTextSession(el);
    caret(original, 1);
    type(el, "x");
    const typed = el.querySelector("span")!.firstChild as Text;
    expect(typed).not.toBe(original);
    const range = window.getSelection()!.getRangeAt(0);
    expect([range.startContainer, range.startOffset]).toEqual([typed, 2]);
    typed.deleteData(1, 1);
    session.end();
    expect(el.outerHTML).toBe(before);
  });

  it("leaves an edited Latin node alone without an adjacent same-font text run", () => {
    const el = mount('<p id="t">Alpha</p>');
    const original = el.firstChild as Text;
    session = startInPlaceTextSession(el);
    caret(original, 2);
    type(el, "x");
    expect(el.firstChild).toBe(original);
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
    caret(el.firstChild!, 5);
    type(el, "x");
    // Chrome drops collapsed whitespace next to the caret while typing.
    (el.firstChild as Text).data = "Speakers\n  ";
    session.end();
    expect(el.outerHTML).toBe(before);
  });

  it("restores the start bytes when Chrome rewrites a space as a no-break space", () => {
    vi.spyOn(HTMLElement.prototype, "innerText", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.textContent ?? "";
      },
    );
    const el = mount('<p id="t">Alpha beta</p>');
    const before = el.outerHTML;
    session = startInPlaceTextSession(el);
    const original = textOf(el, "Alpha beta");
    caret(original, 6);
    type(el, "x");
    expect(beforeInput(el, "deleteContentBackward").defaultPrevented).toBe(
      false,
    );
    const typed = textOf(el, "Alpha xbeta");
    typed.deleteData(6, 1);
    typed.data = typed.data.replace(" ", "\u00a0");

    expect(session.changed).toBe(false);
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

  it("preserves an initial backward selection when entering edit mode", () => {
    const el = mount('<p id="t">Alpha beta</p>');
    const text = el.firstChild as Text;
    selectBackward(text, 1, text, 5);

    session = startInPlaceTextSession(el);

    const selection = window.getSelection()!;
    expect(selection.toString()).toBe("lpha");
    expect(selection.anchorNode).toBe(text);
    expect(selection.anchorOffset).toBe(5);
    expect(selection.focusNode).toBe(text);
    expect(selection.focusOffset).toBe(1);
  });

  it("restores backward selection direction after blur and focus", () => {
    const el = mount('<p id="t">Alpha beta</p>');
    const text = el.firstChild as Text;
    session = startInPlaceTextSession(el);
    selectBackward(text, 1, text, 5);
    const selection = window.getSelection()!;
    expect(selection.toString()).toBe("lpha");

    el.dispatchEvent(new FocusEvent("blur"));
    selection.removeAllRanges();
    el.dispatchEvent(new FocusEvent("focus"));

    expect(selection.anchorOffset).toBe(5);
    expect(selection.focusOffset).toBe(1);
    expect(selection.toString()).toBe("lpha");
  });

  it("keeps a pointer caret when refocusing after a backward selection", () => {
    const el = mount('<p id="t">Alpha beta</p>');
    const text = el.firstChild as Text;
    const outside = document.createElement("button");
    document.body.append(outside);
    session = startInPlaceTextSession(el);
    selectBackward(text, 1, text, 5);
    outside.focus();

    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    caret(text, 7);
    el.focus();
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

    const selection = window.getSelection()!;
    expect(document.activeElement).toBe(el);
    expect(selection.isCollapsed).toBe(true);
    expect([selection.anchorNode, selection.anchorOffset]).toEqual([text, 7]);
  });

  it("restores the saved selection when a pointer drag ends outside the editor", () => {
    const el = mount('<p id="t">Alpha beta</p>');
    const text = el.firstChild as Text;
    const outside = document.createElement("button");
    document.body.append(outside);
    session = startInPlaceTextSession(el);
    selectBackward(text, 1, text, 5);
    outside.focus();

    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    outside.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    window.getSelection()!.removeAllRanges();
    el.focus();

    const selection = window.getSelection()!;
    expect(selection.toString()).toBe("lpha");
    expect(selection.anchorOffset).toBe(5);
    expect(selection.focusOffset).toBe(1);
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

describe("in-place text session: the caret at the click point", () => {
  afterEach(() => {
    delete (document as { caretPositionFromPoint?: unknown })
      .caretPositionFromPoint;
  });

  /** happy-dom has no hit testing; the click point resolves to this position. */
  function hitAt(node: Node, offset: number) {
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({ offsetNode: node, offset }),
    });
  }

  it("puts a click on a bullet's marker at the start of that row's text", () => {
    const el = mount(
      `<div id="t">
        <div style="display: flex"><span>●</span><span>Alpha one</span>
        </div>
        <div style="display: flex"><span>●</span>Beta two
        </div>
      </div>`,
    );
    const [first, second] = Array.from(el.children);
    for (const [row, text] of [
      [first, "Alpha one"],
      [second, "Beta two"],
    ] as const) {
      window.getSelection()!.removeAllRanges();
      hitAt(row.firstElementChild!.firstChild!, 0);
      session = startInPlaceTextSession(el, { caretPoint: { x: 1, y: 1 } });
      const range = window.getSelection()!.getRangeAt(0);
      expect(range.collapsed).toBe(true);
      expect([range.startContainer, range.startOffset]).toEqual([
        textOf(row, text),
        0,
      ]);
      session.end();
    }
  });

  it("types into the row's text, not its glyph, and steps End off the glyph at a row's start", () => {
    const el = mount(
      '<div id="t"><p><span aria-hidden="true" style="display: inline-block">•</span><span>Alpha</span></p><p><span aria-hidden="true" style="display: inline-block">•</span><span>Beta</span></p></div>',
    );
    session = startInPlaceTextSession(el);
    const alpha = textOf(el, "Alpha");
    caret(alpha, 0);
    expect(key(el, { key: "End" }).defaultPrevented).toBe(false);
    const range = window.getSelection()!.getRangeAt(0);
    expect([range.startContainer, range.startOffset]).toEqual([alpha, 1]);
    caret(alpha, 0);
    expect(beforeInput(el, "insertText", { data: "x" }).defaultPrevented).toBe(
      true,
    );
    session.end();
    expect(el.children[0].innerHTML).toBe(
      '<span aria-hidden="true" style="display: inline-block">•</span><span>xAlpha</span>',
    );
  });

  it("keeps a double-clicked word that covers the click point", () => {
    const el = mount('<p id="t">Alpha beta gamma</p>');
    const text = el.firstChild as Text;
    select(text, 6, text, 10);
    hitAt(text, 8);
    session = startInPlaceTextSession(el, { caretPoint: { x: 1, y: 1 } });
    expect(window.getSelection()!.toString()).toBe("beta");
  });

  it("moves a stale selection elsewhere in the element to the click point", () => {
    const el = mount('<p id="t">Alpha beta gamma</p>');
    const text = el.firstChild as Text;
    select(text, 0, text, 5);
    hitAt(text, 12);
    session = startInPlaceTextSession(el, { caretPoint: { x: 1, y: 1 } });
    const range = window.getSelection()!.getRangeAt(0);
    expect(range.collapsed).toBe(true);
    expect([range.startContainer, range.startOffset]).toEqual([text, 12]);
  });

  it("selects the double-clicked word itself, even from its first letter", () => {
    const el = mount('<p id="t">Alpha beta gamma</p>');
    const text = el.firstChild as Text;
    for (const [offset, word] of [
      [6, "beta"],
      [8, "beta"],
      [0, "Alpha"],
      [16, "gamma"],
    ] as const) {
      window.getSelection()!.removeAllRanges();
      hitAt(text, offset);
      session = startInPlaceTextSession(el, {
        caretPoint: { x: 1, y: 1 },
        selectWord: true,
      });
      expect(window.getSelection()!.toString()).toBe(word);
      session.end();
    }
  });

  it("selects a double-clicked word across adjacent styled runs", () => {
    const el = mount('<p id="t"><span>trans</span><em>form</em>ation done</p>');
    const form = textOf(el, "form");
    hitAt(form, 2);
    session = startInPlaceTextSession(el, {
      caretPoint: { x: 1, y: 1 },
      selectWord: true,
    });
    expect(window.getSelection()!.toString()).toBe("transformation");
  });

  it.each([
    ["a br", '<p id="t">trans<br>form</p>'],
    ["adjacent blocks", '<div id="t"><p>trans</p><p>form</p></div>'],
  ])("keeps fallback word selection within %s", (_boundary, html) => {
    const el = mount(html);
    for (const [word, offset] of [
      ["trans", 1],
      ["form", 1],
    ] as const) {
      const text = textOf(el, word);
      hitAt(text, offset);
      session = startInPlaceTextSession(el, {
        caretPoint: { x: 1, y: 1 },
        selectWord: true,
      });
      expect(window.getSelection()!.toString()).toBe(word);
      session.end();
    }
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
  it("pressing Enter at a root heading's end creates a plain paragraph", () => {
    const el = mount(
      '<h2 id="t" class="title" style="font-size: 34px">Heading</h2>',
    );
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 7);

    expect(beforeInput(el, "insertParagraph").defaultPrevented).toBe(true);
    expect(session.element.querySelector("h2")?.textContent).toBe("Heading");
    expect(session.element.querySelector(":scope > p")?.textContent).toBe(ZWSP);
    const range = window.getSelection()!.getRangeAt(0);
    expect((range.startContainer as Text).data).toBe(ZWSP);
    expect(range.startOffset).toBe(1);

    session.end();
    expect(session.element.tagName).toBe("DIV");
    expect(session.element.querySelector("h2")?.textContent).toBe("Heading");
    expect(session.element.querySelector("p")?.innerHTML).toBe("<br>");
  });

  it("keeps typing after Enter and drops the placeholder, three Enters deep", () => {
    const el = mount('<p id="t">Text</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 4);
    for (let i = 0; i < 3; i++) beforeInput(el, "insertParagraph");
    type(el, "new line");
    expect(
      textNodes(el)
        .filter((node) => node.data)
        .at(-1)?.data,
    ).toBe("new line");
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

  it("does not copy an ordered list item's value when Enter splits it", () => {
    const el = mount('<ol id="t"><li value="5">A</li><li>B</li></ol>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "A"), 1);

    beforeInput(el, "insertParagraph");
    session.end();

    expect(
      Array.from(el.querySelectorAll("li"), (item) =>
        item.getAttribute("value"),
      ),
    ).toEqual(["5", null, null]);
  });

  it("types into the new item and exits a real list on a second Enter", () => {
    const el = mount('<ul id="t"><li>One</li></ul>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "One"), 3);
    beforeInput(el, "insertParagraph");
    type(el, "Two");
    beforeInput(el, "insertParagraph");
    expect(session.element.querySelectorAll("li")).toHaveLength(3);
    beforeInput(el, "insertParagraph");
    expect(session.element.querySelectorAll("li")).toHaveLength(2);
    expect(session.element.tagName).toBe("DIV");
    expect(session.element.querySelectorAll("ul > li")).toHaveLength(2);
    expect(session.element.querySelector("p")?.textContent).toBe(ZWSP);
    type(session.element, "Plain line");
    session.end();
    expect(session.element.querySelector("ul")?.textContent).toBe("OneTwo");
    expect(session.element.querySelector("p")?.textContent).toBe("Plain line");
  });

  it("keeps inline styling when the empty list item exits into a paragraph", () => {
    const el = mount(
      '<ul id="t"><li><span style="color: red"><strong>One</strong></span></li></ul>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "One"), 3);

    beforeInput(el, "insertParagraph");
    beforeInput(el, "insertParagraph");
    type(session.element, "Two");
    session.end();

    expect(session.element.querySelector("p")?.innerHTML).toBe(
      '<span style="color: red"><strong>Two</strong></span>',
    );
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

  it("ends a sole empty top-level list item in an editable blank line", () => {
    const el = mount('<ul id="t"><li></li></ul>');
    session = startInPlaceTextSession(el);
    caret(el.querySelector("li")!, 0);
    beforeInput(el, "insertParagraph");

    expect(session.element.tagName).toBe("DIV");
    expect(session.element.querySelectorAll("li")).toHaveLength(0);
    type(session.element, "New line");
    session.end();
    expect(session.element.querySelector("p")?.textContent).toBe("New line");
  });

  it("exits an empty middle list item and keeps ordered numbering", () => {
    const el = mount(
      '<ol id="t" start="40"><li><p>Forty</p></li><li><p>Forty one</p></li><li><p>Forty two</p></li></ol>',
    );
    session = startInPlaceTextSession(el);
    const middle = textOf(el, "Forty one");
    caret(middle, middle.length);
    beforeInput(el, "insertParagraph");
    type(session.element, "");
    beforeInput(el, "insertParagraph");

    expect(session.element.querySelectorAll(":scope > ol")).toHaveLength(2);
    expect(
      session.element.querySelector(":scope > ol")?.getAttribute("start"),
    ).toBe("40");
    expect(session.element.querySelector(":scope > ol + p")?.textContent).toBe(
      ZWSP,
    );
    expect(
      session.element.querySelector(":scope > p + ol")?.getAttribute("start"),
    ).toBe("42");
  });

  it("keeps numbering when exiting a pre-existing empty middle item", () => {
    const el = mount(
      '<ol id="t" start="40"><li><p>Forty</p></li><li><p></p></li><li><p>Forty two</p></li></ol>',
    );
    session = startInPlaceTextSession(el);
    const empty = el.querySelectorAll("li")[1]!;
    caret(empty, 0);
    beforeInput(el, "insertParagraph");

    expect(session.element.querySelector(":scope > ol + p")?.textContent).toBe(
      ZWSP,
    );
    expect(
      session.element.querySelector(":scope > p + ol")?.getAttribute("start"),
    ).toBe("42");
    expect(session.element.textContent).toContain("Forty two");
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

  /** Chrome reports a flex or grid child's computed display as blockified. */
  function blockify(...tags: string[]) {
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((node, pseudo) => {
      const style = computed(node, pseudo);
      if (!tags.includes(node.tagName)) return style;
      return new Proxy(style, {
        get: (target, prop) =>
          prop === "display" ? "block" : Reflect.get(target, prop, target),
      });
    });
  }

  it("saves one <br> per Enter in a flex text leaf", () => {
    // A <br> included, yet Chrome lays it out as a break inside the
    // anonymous item around the text.
    blockify("BR");
    const el = mount(
      '<div id="t" style="height: 160px; display: flex; flex-direction: column; justify-content: flex-end">Quarterly planning</div>',
    );
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 18);
    for (let i = 0; i < 3; i++) beforeInput(el, "insertParagraph");
    type(el, "new line");
    session.end();
    expect(el.innerHTML).toBe("Quarterly planning<br><br><br>new line");
  });

  it("keeps a new line open before a flex sibling item", () => {
    blockify("BR", "B");
    const el = mount(
      '<div id="t" style="display: flex; flex-direction: column">Revenue<b>up</b></div>',
    );
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 7);
    beforeInput(el, "insertParagraph");
    expect(el.innerHTML).toBe(`Revenue<br>${ZWSP}<b>up</b>`);
    session.end();
    expect(el.innerHTML).toBe("Revenue<br><br><b>up</b>");
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
    expect(el.children).toHaveLength(4);
    session.end();
    const savedRows = Array.from(el.children, (child) => child.textContent);
    expect(savedRows.slice(0, 3)).toEqual(["●Alpha", "●Beta", "●Gamma"]);
    expect(savedRows[3]).toBe("");
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

  it("indents and outdents every selected list item", () => {
    const el = mount('<ul id="t"><li>One</li><li>Two</li><li>Three</li></ul>');
    session = startInPlaceTextSession(el);
    select(textOf(el, "Two"), 0, textOf(el, "Three"), 5);

    key(el, { key: "Tab" });

    expect(
      Array.from(
        el.querySelectorAll(":scope > li > ul > li"),
        (item) => item.textContent,
      ),
    ).toEqual(["Two", "Three"]);
    expect(el.querySelectorAll(":scope > li")).toHaveLength(1);

    const nested = mount(
      '<ul id="t"><li>One<ul><li>Two</li><li>Three</li></ul></li></ul>',
    );
    session?.end();
    session = startInPlaceTextSession(nested);
    select(textOf(nested, "Two"), 0, textOf(nested, "Three"), 5);

    key(nested, { key: "Tab", shiftKey: true });

    expect(
      Array.from(nested.querySelectorAll(":scope > li"), (item) =>
        item.textContent?.replaceAll(ZWSP, ""),
      ),
    ).toEqual(["One", "Two", "Three"]);
    expect(nested.querySelector(":scope > li > ul")).toBeNull();
  });

  it("keeps document order when outdenting selected middle items", () => {
    const el = mount(
      '<ul id="t"><li>One<ul><li>Two</li><li>Three</li><li>Four</li></ul></li><li>Next</li></ul>',
    );
    session = startInPlaceTextSession(el);
    select(textOf(el, "Two"), 0, textOf(el, "Three"), 5);

    key(el, { key: "Tab", shiftKey: true });

    expect(textNodes(el).map((node) => node.data)).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
      "Next",
    ]);
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

  it("removes a divider before merging the paragraph that follows it", () => {
    const el = mount('<div id="t"><p>Before</p><hr><p>After</p></div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "After"), 0);

    expect(beforeInput(el, "deleteContentBackward").defaultPrevented).toBe(
      true,
    );
    expect(el.innerHTML).toBe("<p>Before</p><p>After</p>");
    expect(el.textContent).toBe("BeforeAfter");

    expect(beforeInput(el, "deleteContentBackward").defaultPrevented).toBe(
      true,
    );
    expect(el.innerHTML).toBe("<p>BeforeAfter</p>");
  });

  it("demotes headings and quotes before merging them on a second Backspace", () => {
    for (const [tag, text] of [
      ["h2", "Title"],
      ["blockquote", "Quoted"],
    ] as const) {
      const content = tag === "h2" ? text : `<p>${text}</p>`;
      const el = mount(
        `<div id="t"><p>Earlier</p><${tag}>${content}</${tag}></div>`,
      );
      session = startInPlaceTextSession(el);
      caret(textOf(el, text), 0);

      beforeInput(el, "deleteContentBackward");
      expect(el.querySelector(tag)).toBeNull();
      beforeInput(el, "deleteContentBackward");
      expect(el.firstElementChild?.textContent).toBe(`Earlier${text}`);
      session.end();
      session = null;
    }
  });

  it("makes a paragraph after a heading when Enter is at its end", () => {
    const el = mount('<div id="t"><h2>Heading</h2></div>');
    session = startInPlaceTextSession(el);
    const heading = el.querySelector("h2")!;
    caret(heading.firstChild!, heading.textContent!.length);

    beforeInput(el, "insertParagraph");

    expect(el.innerHTML).toBe(`<h2>Heading</h2><p>${ZWSP}</p>`);
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

  it("keeps nested lists structural when deleting from a paragraph into an item", () => {
    const el = mount(
      '<div id="t"><p>Para</p><ul><li>Item<ul><li>Sub</li></ul></li><li>Next</li></ul></div>',
    );
    session = startInPlaceTextSession(el);
    select(textOf(el, "Para"), 2, textOf(el, "Item"), 2);

    beforeInput(el, "deleteContentBackward");

    expect(el.querySelector("p ul, p ol, h1 ul, h2 ul")).toBeNull();
    expect(el.querySelector("ul > li")?.textContent).toBe("Sub");
    expect(el.textContent).toContain("Paem");
  });

  it("lifts the first top-level list item on Backspace", () => {
    const el = mount(
      '<ol id="t" start="2" class="pl-8 absolute left-10" style="font-size:1.25em;margin-top:40px;list-style-type:decimal"><li>One</li><li>Two</li></ol>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "One"), 0);

    const event = beforeInput(el, "deleteContentBackward");

    expect(event.defaultPrevented).toBe(true);
    expect(session.element.tagName).toBe("DIV");
    expect(session.element.firstElementChild?.outerHTML).toBe(
      '<p style="margin: 0px;">One</p>',
    );
    expect(session.element.className).toBe("pl-8 absolute left-10");
    expect(session.element.style.fontSize).toBe("1.25em");
    const remainingList = session.element.querySelector(
      ":scope > ol",
    ) as HTMLOListElement;
    expect(remainingList.querySelectorAll(":scope > li")).toHaveLength(1);
    expect(remainingList.querySelector(":scope > li")?.textContent).toBe("Two");
    expect(remainingList.hasAttribute("class")).toBe(false);
    expect(remainingList.style.fontSize).toBe("");
    expect(remainingList.style.marginTop).toBe("0px");
    expect(remainingList.style.position).toBe("");
    expect(remainingList.style.paddingLeft).toBe("1.25em");
  });

  it("lets Backspace fall through at an empty sole top-level list item", () => {
    const el = mount('<ul id="t"><li>\u200b</li></ul>');
    session = startInPlaceTextSession(el);
    const item = el.querySelector("li")!;
    const text = item.firstChild as Text;
    caret(text, text.length);
    const before = session.element.innerHTML;
    const modify = vi
      .spyOn(window.getSelection()!, "modify")
      .mockImplementation(() => {});

    beforeInput(session.element, "deleteContentBackward");

    expect(modify).toHaveBeenCalledWith("extend", "backward", "character");
    expect(session.element.innerHTML).toBe(before);
    expect(session.changed).toBe(false);
    expect(session.undo()).toBe(false);
  });

  it("preserves the ordinal after lifting the first ordered item", () => {
    const liftFirst = (el: HTMLElement) => {
      session = startInPlaceTextSession(el);
      caret(textOf(el, "One"), 0);
      beforeInput(session.element, "deleteContentBackward");
      const list = session.element.querySelector(":scope > ol");
      const start = list?.getAttribute("start") ?? null;
      const effectiveStart = Number(start ?? "1");
      session.end();
      session = null;
      return { start, effectiveStart };
    };

    const root = mount(
      '<ol id="t" start="2"><li>One</li><li>Two</li><li>Three</li></ol>',
    );
    const nested = mount(
      '<div id="t"><ol><li>One</li><li>Two</li><li>Three</li></ol></div>',
    );
    const rootStart = liftFirst(root);
    const nestedStart = liftFirst(nested);

    expect(rootStart).toEqual({ start: "3", effectiveStart: 3 });
    expect(nestedStart).toEqual({ start: "2", effectiveStart: 2 });
  });

  it("preserves ordinals when lifting a middle item from a non-default ordered list", () => {
    const el = mount(
      '<ol id="t" start="40"><li>Forty</li><li>Forty one</li><li>Forty two</li></ol>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Forty one"), 0);

    beforeInput(el, "deleteContentBackward");

    const lists = Array.from(
      session.element.querySelectorAll(":scope > ol"),
      (list) => ({
        start: list.getAttribute("start"),
        items: Array.from(list.querySelectorAll(":scope > li"), (item) =>
          item.textContent?.replaceAll(ZWSP, ""),
        ),
      }),
    );
    expect(lists).toEqual([
      { start: "40", items: ["Forty"] },
      { start: "42", items: ["Forty two"] },
    ]);
  });

  it("preserves an item value override after lifting the preceding item", () => {
    const el = mount(
      '<ol id="t" start="40"><li value="50">Fifty</li><li>Next</li></ol>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Fifty"), 0);

    beforeInput(el, "deleteContentBackward");

    expect(
      session.element.querySelector(":scope > ol")?.getAttribute("start"),
    ).toBe("51");
  });

  it("joins the block after the last list item on forward Delete", () => {
    const el = mount(
      '<div id="t"><ul><li><p>One</p></li></ul><p>Next</p></div>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "One"), 3);

    beforeInput(el, "deleteContentForward");

    expect(el.innerHTML).toBe("<ul><li><p>OneNext</p></li></ul>");
  });

  it("demotes a legacy row before joining it into the previous row", () => {
    const row = (text: string) =>
      `<div style="display: flex"><span>●</span><span>${text}</span></div>`;
    const el = mount(`<div id="t">${row("Alpha")}${row("Beta")}</div>`);
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Beta"), 0);
    beforeInput(el, "deleteContentBackward");
    expect(el.children[1].querySelector("span")?.textContent).not.toBe("●");
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

describe("in-place text session: rows that hold their runs as sibling spans", () => {
  const para = (runs: string) =>
    `<p style="padding-left: 22px"><span aria-hidden="true" style="display: inline-block; margin-left: -22px">•</span>${runs}</p>`;
  const gray = (text: string) => `<span style="color: gray">${text}</span>`;
  const bold = (text: string) =>
    `<span style="font-weight: 700">${text}</span>`;
  const LEAD = para(gray("Lead ") + bold("96%") + gray(", rest"));
  const NEXT = para(gray("Next ") + bold("bold") + gray(" end"));

  function rowTexts(el: HTMLElement) {
    return Array.from(el.children).map((row) =>
      row.textContent!.replaceAll(ZWSP, ""),
    );
  }

  it("joins a row split by Enter back whole on Backspace and on Delete", () => {
    for (const [runText, offset, direction] of [
      ["Lead", 2, "deleteContentBackward"],
      ["96%", 1, "deleteContentBackward"],
      ["Lead", 2, "deleteContentForward"],
    ] as const) {
      const el = mount(`<div id="t">${LEAD}${NEXT}</div>`);
      session = startInPlaceTextSession(el);
      caret(textOf(el, runText), offset);
      beforeInput(el, "insertParagraph");
      expect(el.children).toHaveLength(3);
      if (direction === "deleteContentForward") {
        const first = el.children[0].lastElementChild!.firstChild as Text;
        caret(first, first.length);
      }
      beforeInput(el, direction);
      if (direction === "deleteContentBackward") {
        beforeInput(el, direction);
      }
      type(el, "x");
      session.end();
      session = null;
      const joined = `•${runText === "Lead" ? "Lexad " : "Lead 9x6%"}`;
      expect(rowTexts(el)[0]).toBe(
        runText === "Lead" ? `${joined}96%, rest` : `${joined}, rest`,
      );
      expect(rowTexts(el)[1]).toBe("•Next bold end");
    }
  });

  it("deletes the next character, not the row break, at the end of a middle run", () => {
    const el = mount(`<div id="t">${LEAD}${NEXT}</div>`);
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Lead"), 5);
    beforeInput(el, "deleteContentForward");
    session.end();
    // The Selection.modify stand-in steps into the next run without taking a
    // character; what matters is that the next row stays where it is.
    expect(rowTexts(el)).toEqual(["•Lead 96%, rest", "•Next bold end"]);
  });

  it("keeps the end row's later runs when a selection across rows is deleted", () => {
    const el = mount(`<div id="t">${LEAD}${NEXT}</div>`);
    session = startInPlaceTextSession(el);
    select(textOf(el, "Lead"), 2, textOf(el, "bold"), 2);
    beforeInput(el, "deleteContentBackward");
    session.end();
    expect(rowTexts(el)).toEqual(["•Leld end"]);
  });

  it("returns the caret to the end of the row, not its first run, when an empty row is removed", () => {
    const el = mount(`<div id="t">${LEAD}${NEXT}</div>`);
    session = startInPlaceTextSession(el);
    caret(textOf(el, ", rest"), ", rest".length);
    beforeInput(el, "insertParagraph");
    beforeInput(el, "deleteContentBackward");
    type(el, "X");
    session.end();
    expect(rowTexts(el)).toEqual(["•Lead 96%, restX", "•Next bold end"]);
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

  it("keeps session redo history across a non-cancelable native historyRedo", () => {
    const el = mount('<p id="t">Head</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 4);
    type(el, "X");
    expect(session.undo()).toBe(true);

    const event = beforeInput(el, "historyRedo", { cancelable: false });

    expect(event.defaultPrevented).toBe(false);
    expect(session.redo()).toBe(true);
    expect(el.textContent).toBe("HeadX");
  });

  it("does not insert a no-op checkpoint for a non-cancelable native historyUndo", () => {
    const el = mount('<p id="t">Head</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 4);
    type(el, "X");

    const event = beforeInput(el, "historyUndo", { cancelable: false });

    expect(event.defaultPrevented).toBe(false);
    expect(session.undo()).toBe(true);
    expect(el.textContent).toBe("Head");
  });

  it("does not snapshot the full block for each character in a typing burst", () => {
    const el = mount('<p id="t">Head</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 4);
    const original = el.innerHTML;
    let reads = 0;
    let prototype: object | null = el;
    let descriptor: PropertyDescriptor | undefined;
    while (prototype && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(prototype, "innerHTML");
      prototype = Object.getPrototypeOf(prototype);
    }
    if (!descriptor?.get || !descriptor.set) {
      throw new Error("the DOM does not expose innerHTML accessors");
    }
    Object.defineProperty(el, "innerHTML", {
      configurable: true,
      get() {
        reads += 1;
        return descriptor!.get!.call(this);
      },
      set(value: string) {
        descriptor!.set!.call(this, value);
      },
    });

    type(el, "burst");

    expect(reads).toBe(1);
    expect(session.undo()).toBe(true);
    expect(el.innerHTML).toBe(original);
  });

  it("groups typing by word and restores a Markdown shortcut to literal text", () => {
    const el = mount('<div id="t">Alpha</div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Alpha"), 0);
    type(el, "beta gamma");
    expect(session.undo()).toBe(true);
    expect(el.textContent).toBe("beta Alpha");
    session.end();

    const shortcut = mount('<div id="t">Alpha</div>');
    session = startInPlaceTextSession(shortcut);
    caret(textOf(shortcut, "Alpha"), 0);
    type(shortcut, "# ");
    expect(session.element.tagName).toBe("H1");
    expect(session.undo()).toBe(true);
    expect(session.element.textContent).toBe("# Alpha");
  });

  it("keeps undo history within its configured bound", () => {
    const el = mount('<p id="t">x</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 1);
    const aligns = ["left", "right"] as const;
    for (let i = 0; i < IN_PLACE_TEXT_UNDO_LIMIT + 5; i++)
      session.commands.align(aligns[i % 2]);
    let undone = 0;
    while (session.undo()) undone++;
    expect(undone).toBe(IN_PLACE_TEXT_UNDO_LIMIT);
  });

  it("keeps redo available after a no-op Tab command", () => {
    const el = mount('<ul id="t"><li>One</li><li>Two</li></ul>');
    session = startInPlaceTextSession(el);
    const first = textOf(el, "One");
    caret(first, first.length);
    type(el, "X");
    expect(session.undo()).toBe(true);

    caret(textOf(el, "One"), 0);
    expect(key(el, { key: "Tab" }).defaultPrevented).toBe(true);
    expect(session.redo()).toBe(true);
    expect(textOf(el, "OneX").data).toBe("OneX");
  });

  it("keeps large snapshots within the serialized byte budget", () => {
    const large = "x".repeat(Math.floor(IN_PLACE_TEXT_UNDO_BYTE_LIMIT * 0.6));
    const el = mount(`<p id="t">${large}</p>`);
    session = startInPlaceTextSession(el);
    const aligns = ["left", "right"] as const;
    session.commands.align("center");
    session.commands.align(aligns[0]);
    expect(session.undo()).toBe(true);
    expect(session.undo()).toBe(false);
    expect(el.textContent).toBe(large);
  });
});

describe("in-place text session: paste", () => {
  it("uses plain input data for a yank when DataTransfer is unavailable", () => {
    const el = mount('<p id="t">Start </p>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Start "), "Start ".length);

    const event = beforeInput(el, "insertFromYank", {
      data: "<b>literal</b>",
    });

    expect(event.defaultPrevented).toBe(true);
    expect(session.element.textContent).toBe("Start <b>literal</b>");
    expect(session.element.querySelector("b")).toBeNull();
    expect(session.undo()).toBe(true);
    expect(session.element.textContent).toBe("Start ");
  });

  it("preserves pasted headings, quotes, and the text around them", () => {
    const el = mount('<div id="t"><p>Before after</p></div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Before after"), 7);

    paste(el, {
      "text/html": "<h2>Heading</h2><blockquote><p>Quoted</p></blockquote>",
      "text/plain": "Heading\nQuoted",
    });

    expect(session.element.children[0].outerHTML).toBe("<p>Before </p>");
    expect(session.element.children[1].outerHTML).toBe("<h2>Heading</h2>");
    expect(session.element.children[2].outerHTML).toBe(
      '<blockquote data-slide-authoring-format="quote"><p>Quoted</p></blockquote>',
    );
    expect(session.element.children[3].outerHTML).toBe("<p>after</p>");
  });

  it("preserves semantic dividers from rich pasted HTML", () => {
    const el = mount('<div id="t">Start </div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Start "), 6);

    paste(el, {
      "text/html": "<p>Before</p><hr><p>After</p>",
      "text/plain": "Before\nAfter",
    });

    const divider = session.element.querySelector(":scope > hr");
    expect(divider).not.toBeNull();
    expect(divider?.previousElementSibling?.textContent).toBe("Before");
    expect(divider?.nextElementSibling?.textContent).toBe("After");
  });

  it("preserves pasted H4 blocks", () => {
    const el = mount('<div id="t">Before after</div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Before after"), 7);

    paste(el, {
      "text/html": "<h4>Heading</h4>",
      "text/plain": "Heading",
    });

    expect(session.element.querySelector("h4")?.textContent).toBe("Heading");
  });

  it("keeps a rich H4 inside its pasted list item", () => {
    const el = mount('<div id="t">Before after</div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Before after"), 7);

    paste(el, {
      "text/html": "<ul><li><h4>Heading</h4></li></ul>",
      "text/plain": "Heading",
    });

    expect(session.element.querySelector("ul > li > h4")?.textContent).toBe(
      "Heading",
    );
  });

  it("pastes block content into an empty paragraph without nesting blocks", () => {
    const el = mount('<p id="t"></p>');
    session = startInPlaceTextSession(el);
    caret(el, 0);

    paste(el, {
      "text/html": "<h2>Heading</h2>",
      "text/plain": "Heading",
    });

    expect(session.element.tagName).toBe("DIV");
    expect(session.element.innerHTML).toBe("<h2>Heading</h2>");
    expect(session.element.querySelector("p h2")).toBeNull();
  });

  it("replaces a break-only paragraph with pasted blocks", () => {
    const el = mount('<p id="t"><br></p>');
    session = startInPlaceTextSession(el);
    caret(el, 0);

    paste(el, {
      "text/html": "<h2>Heading</h2>",
      "text/plain": "Heading",
    });

    expect(session.element.tagName).toBe("DIV");
    expect(session.element.querySelector(":scope > h2")?.textContent).toBe(
      "Heading",
    );
    expect(session.element.querySelector("p h2")).toBeNull();
  });

  it("preserves headings and quotes pasted inside a rich list item", () => {
    const el = mount('<ul id="t"><li><p>Before after</p></li></ul>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Before after"), 7);

    paste(el, {
      "text/html": "<h2>Heading</h2><blockquote><p>Quoted</p></blockquote>",
      "text/plain": "Heading\nQuoted",
    });

    expect(el.querySelector("li > h2")?.textContent).toBe("Heading");
    expect(el.querySelector("li > blockquote")?.textContent).toBe("Quoted");
    expect(el.querySelector("li p h2, li p blockquote")).toBeNull();
  });

  it("keeps headings and quotes in one pasted source list item", () => {
    const el = mount('<div id="t">Before after</div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Before after"), 7);

    paste(el, {
      "text/html":
        "<ul><li><h2>Heading</h2><blockquote><p>Quoted</p></blockquote></li></ul>",
      "text/plain": "Heading\nQuoted",
    });

    const item = session.element.querySelector("ul > li")!;
    expect(item.querySelector("h2")?.textContent).toBe("Heading");
    expect(item.querySelector("blockquote")?.textContent).toBe("Quoted");
    expect(session.element.querySelectorAll("ul > li")).toHaveLength(1);
  });

  it("preserves paragraph boundaries inside a pasted list item", () => {
    const el = mount('<div id="t"><p>Before after</p></div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Before after"), 7);

    paste(el, {
      "text/html":
        "<ul><li><p>First paragraph</p><p>Second paragraph</p></li></ul>",
      "text/plain": "First paragraph\nSecond paragraph",
    });

    const item = session.element.querySelector("ul > li")!;
    expect(Array.from(item.children, (child) => child.outerHTML)).toEqual([
      "<p>First paragraph</p>",
      "<p>Second paragraph</p>",
    ]);
  });

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
      'Start <b>Bold</b> <span>blue</span> <a>bad</a> <a href="https://example.com">ok</a><br>second',
    );
  });

  it("keeps remote image alt text as plain pasted text", () => {
    const el = mount('<p id="t">Before after</p>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Before after"), 7);

    paste(el, {
      "text/html":
        '<p>Chart <img src="https://example.com/chart.png" alt="of growth"> shown</p>',
      "text/plain": "Chart of growth shown",
    });

    expect(session.element.textContent).toBe(
      "Before Chart of growth shownafter",
    );
    expect(session.element.querySelector("img")).toBeNull();
  });

  it("pastes plain text lines through the Enter policy", () => {
    const el = mount('<ul id="t"><li>One</li></ul>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "One"), 3);
    paste(el, { "text/plain": " a\nTwo\nThree" });
    session.end();
    expect(el.innerHTML).toBe("<li>One a</li><li>Two</li><li>Three</li>");
  });

  it("pastes plain Markdown headings, nested lists, and quotes as blocks", () => {
    const el = mount('<div id="t"><p>Before after</p></div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Before after"), 7);

    paste(el, {
      "text/plain": "# Title\n- One\n  - Nested\n- Two\n> Quote",
    });

    expect(el.querySelector("h1")?.textContent).toBe("Title");
    expect(el.querySelectorAll(":scope > ul > li")).toHaveLength(2);
    expect(el.querySelector("ul > li ul > li")?.textContent).toBe("Nested");
    expect(el.querySelector("blockquote")?.textContent).toBe("Quote");
  });

  it("pastes inline Markdown inside plain-text blocks and undoes it", () => {
    const el = mount('<div id="t"><p>Before after</p></div>');
    session = startInPlaceTextSession(el);
    const original = el.innerHTML;
    caret(textOf(el, "Before after"), 7);

    paste(el, {
      "text/plain":
        "# **Title**\n- **bold** and __also bold__ with *star*, _under_, ~~strike~~, `code`, 2*3*4, <img src=x onerror=alert(1)>",
    });

    const heading = session.element.querySelector(":scope > h1")!;
    const item = session.element.querySelector(":scope > ul > li")!;
    expect(heading.querySelector("strong")?.textContent).toBe("Title");
    expect(item.querySelectorAll("strong")).toHaveLength(2);
    expect(item.querySelectorAll("em")).toHaveLength(2);
    expect(item.querySelector("s")?.textContent).toBe("strike");
    expect(item.querySelector("code")?.textContent).toBe("code");
    expect(item.textContent).toContain("2*3*4");
    expect(item.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(item.querySelector("img")).toBeNull();
    expect(
      Array.from(item.querySelectorAll("strong, em, s, code")).every(
        (mark) => !mark.hasAttribute("style"),
      ),
    ).toBe(true);

    const pasted = el.innerHTML;
    expect(session.undo()).toBe(true);
    expect(el.innerHTML).toBe(original);
    expect(session.redo()).toBe(true);
    expect(el.innerHTML).toBe(pasted);
  });

  it("preserves the first number of a pasted Markdown ordered list", () => {
    const el = mount('<div id="t">Before after</div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Before after"), 7);

    paste(el, { "text/plain": "42. One\n43. Two" });

    expect(
      session.element.querySelector(":scope > ol")?.getAttribute("start"),
    ).toBe("42");
    expect(
      Array.from(
        session.element.querySelectorAll(":scope > ol > li"),
        (item) => item.textContent,
      ),
    ).toEqual(["One", "Two"]);
  });

  it("pastes a safe URL onto selected text as a link", () => {
    const el = mount('<p id="t">Click here</p>');
    session = startInPlaceTextSession(el);
    const text = el.firstChild as Text;
    select(text, 6, text, 10);

    paste(el, { "text/plain": "https://example.com/path" });

    expect(el.innerHTML).toBe(
      'Click <a href="https://example.com/path">here</a>',
    );
  });

  it("auto-links a typed URL on the trailing space and undoes to plain text", () => {
    const el = mount('<p id="t">See </p>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "See "), 4);

    type(el, "https://example.com ");

    expect(el.innerHTML).toBe(
      'See <a href="https://example.com">https://example.com</a> ',
    );
    expect(session.undo()).toBe(true);
    expect(el.innerHTML).toBe("See https://example.com ");
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

  it("runs a markdown input rule after a composed closing delimiter", async () => {
    const el = mount('<p id="t">run `ls</p>');
    session = startInPlaceTextSession(el);
    const text = el.firstChild as Text;
    caret(text, text.length);

    el.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    beforeInput(el, "insertCompositionText", {
      data: "`",
      isComposing: true,
    });
    text.insertData(text.length, "`");
    caret(text, text.length);
    el.dispatchEvent(
      new InputEvent("input", {
        inputType: "insertCompositionText",
        data: "`",
        isComposing: true,
        bubbles: true,
      }),
    );
    el.dispatchEvent(
      new CompositionEvent("compositionend", { data: "`", bubbles: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(el.innerHTML).toBe(
      'run <code data-slide-authoring-format="code">ls</code>',
    );
  });

  it("keeps IME composition at a styled bullet row's text start out of its marker", () => {
    const el = mount(
      '<div id="t"><div style="display:flex;gap:12px"><span>●</span><span>Text</span></div></div>',
    );
    session = startInPlaceTextSession(el);
    const text = textOf(el, "Text");
    caret(text, 0);

    el.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
    const compositionText = window.getSelection()!.getRangeAt(0)
      .startContainer as Text;
    expect(compositionText.data).toBe(ZWSP);
    expect(el.querySelector("span")?.textContent).toBe("●");
    expect(
      key(el, { key: "ArrowRight", keyCode: 229, isComposing: true })
        .defaultPrevented,
    ).toBe(false);
    const composition = beforeInput(el, "insertCompositionText", {
      data: "あ",
      isComposing: true,
    });
    expect(composition.defaultPrevented).toBe(false);

    compositionText.insertData(1, "あ");
    caret(compositionText, 2);
    el.dispatchEvent(
      new InputEvent("input", {
        inputType: "insertCompositionText",
        data: "あ",
        isComposing: true,
        bubbles: true,
      }),
    );
    el.dispatchEvent(new CompositionEvent("compositionend", { data: "あ" }));

    session.end();
    const row = session.element.firstElementChild!;
    expect(row.children[0]?.textContent).toBe("●");
    expect(row.children[1]?.textContent).toBe("あText");
    expect(row.textContent).not.toContain(ZWSP);
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

  it("removes code formatting from a selection inside a styled span", () => {
    const el = mount(
      '<p id="t"><span data-slide-inline-style="true" style="color: red;"><code>before selected after</code></span></p>',
    );
    session = startInPlaceTextSession(el);
    const text = textOf(el, "selected");
    select(text, 7, text, 15);

    expect(session.commands.code()).toBe(true);

    expect(el.querySelectorAll("code")).toHaveLength(2);
    expect(
      Array.from(el.querySelectorAll("code"), (code) => code.textContent),
    ).toEqual(["before ", " after"]);
    expect(
      textOf(el, "selected").parentElement?.closest("span")?.style.color,
    ).toBe("red");
  });

  it("does not nest a list in a paragraph-backed nested list item", () => {
    const el = mount('<div id="t"><ul><li><p>Alpha</p></li></ul></div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Alpha"), 2);

    expect(session.commands.applyAuthoringCommand("orderedList")).toBe(true);

    expect(el.querySelector("p ul, p ol")).toBeNull();
    expect(el.querySelector(":scope > ol > li > p")?.textContent).toBe("Alpha");
  });

  it("excludes slash menu ARIA from root retag and undo snapshots", () => {
    const el = mount(
      '<p id="t" aria-haspopup="grid" aria-label="Details">Alpha</p>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Alpha"), 2);
    for (const [name, value] of Object.entries({
      "aria-haspopup": "listbox",
      "aria-autocomplete": "list",
      "aria-expanded": "true",
      "aria-controls": "slide-slash-command-list",
      "aria-activedescendant": "slide-slash-heading1",
    })) {
      el.setAttribute(name, value);
    }

    expect(session.commands.applyAuthoringCommand("heading1")).toBe(true);
    expect(session.element.tagName).toBe("H1");
    expect(session.element.getAttribute("aria-haspopup")).toBe("grid");
    expect(session.element.getAttribute("aria-label")).toBe("Details");
    for (const name of [
      "aria-autocomplete",
      "aria-expanded",
      "aria-controls",
      "aria-activedescendant",
    ]) {
      expect(session.element.hasAttribute(name)).toBe(false);
    }

    expect(session.undo()).toBe(true);
    expect(session.element.tagName).toBe("P");
    expect(session.element.getAttribute("aria-haspopup")).toBe("grid");
    expect(session.element.getAttribute("aria-label")).toBe("Details");
    for (const name of [
      "aria-autocomplete",
      "aria-expanded",
      "aria-controls",
      "aria-activedescendant",
    ]) {
      expect(session.element.hasAttribute(name)).toBe(false);
    }
    session.end();
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

  it("toggles bullets only on the selected styled row", () => {
    const el = mount(
      '<div id="t">' +
        "<div><span>●</span><span>First</span></div>" +
        "<div><span>●</span><span>Second</span></div>" +
        "<div><span>●</span><span>Third</span></div>" +
        "</div>",
    );
    session = startInPlaceTextSession(el);
    caret(el.children[1].children[1].firstChild!, 0);

    expect(session.commands.toggleList("bullet")).toBe(true);

    expect(el.children[0].firstElementChild?.textContent).toBe("●");
    expect(el.children[1].firstElementChild?.textContent).toBe("Second");
    expect(el.children[2].firstElementChild?.textContent).toBe("●");

    expect(session.commands.toggleList("bullet")).toBe(true);

    expect(el.children[0].firstElementChild?.textContent).toBe("●");
    expect(el.children[1].firstElementChild?.textContent).toBe("●");
    expect(el.children[2].firstElementChild?.textContent).toBe("●");
  });

  it("restores a bullet only on the selected styled row", () => {
    const el = mount(
      '<div id="t">' +
        "<div><span>●</span><span>First</span></div>" +
        "<div><span>●</span><span>Second</span></div>" +
        "<div><span>●</span><span>Third</span></div>" +
        "</div>",
    );
    session = startInPlaceTextSession(el);
    caret(el.children[1].children[1].firstChild!, 0);

    expect(session.commands.toggleList("bullet")).toBe(true);
    expect(el.children[1].firstElementChild?.textContent).toBe("Second");

    expect(session.commands.toggleList("bullet")).toBe(true);

    expect(el.children[0].firstElementChild?.textContent).toBe("●");
    expect(el.children[1].firstElementChild?.textContent).toBe("●");
    expect(el.children[2].firstElementChild?.textContent).toBe("●");
  });

  it("adds a bullet to a selected plain row across mixed block tags", () => {
    const el = mount(
      '<div id="t">' +
        "<div><span>●</span><span>First</span></div>" +
        "<p>Plain</p>" +
        "<div><span>●</span><span>Third</span></div>" +
        "</div>",
    );
    session = startInPlaceTextSession(el);
    caret(el.children[1].firstChild!, 0);

    expect(session.commands.toggleList("bullet")).toBe(true);

    expect(el.children[0].firstElementChild?.textContent).toBe("●");
    expect(el.children[1].tagName).toBe("P");
    expect(el.children[1].firstElementChild?.textContent).toBe("●");
    expect(el.children[2].firstElementChild?.textContent).toBe("●");
  });

  it("converts only the selected styled row to an ordered list", () => {
    const el = mount(
      '<div id="t">' +
        "<div><span>●</span><span>First</span></div>" +
        "<div><span>●</span><span>Second</span></div>" +
        "<div><span>●</span><span>Third</span></div>" +
        "</div>",
    );
    session = startInPlaceTextSession(el);
    caret(el.children[1].children[1].firstChild!, 0);

    expect(session.commands.toggleList("ordered")).toBe(true);

    expect(el.children[0].tagName).toBe("DIV");
    expect(el.children[0].firstElementChild?.textContent).toBe("●");
    expect(el.children[1].tagName).toBe("OL");
    expect(el.children[1].textContent).toBe("Second");
    expect(el.children[2].tagName).toBe("DIV");
    expect(el.children[2].firstElementChild?.textContent).toBe("●");
  });

  it("removes bullets from only the selected semantic list row", () => {
    const el = mount(
      '<div id="t"><ul><li>First</li><li>Second</li><li>Third</li></ul></div>',
    );
    session = startInPlaceTextSession(el);
    const text = textOf(el.querySelectorAll("li")[1]!, "Second");
    select(text, 0, text, text.length);

    expect(session.commands.toggleList("bullet")).toBe(true);

    expect(
      Array.from(el.querySelectorAll("ul > li"), (row) => row.textContent),
    ).toEqual(["First", "Third"]);
    expect(el.children[1]?.tagName).toBe("DIV");
    expect(el.children[1]?.textContent).toBe("Second");
  });

  it("toggles a fully selected nested list without changing sibling content", () => {
    const el = mount(
      '<div id="t"><p>Intro</p><ul><li>First</li><li>Second</li></ul><p>Outro</p></div>',
    );
    session = startInPlaceTextSession(el);
    const first = textOf(el, "First");
    const second = textOf(el, "Second");
    select(first, 0, second, second.length);

    expect(session.commands.toggleList("bullet")).toBe(true);

    expect(Array.from(el.children, (child) => child.tagName)).toEqual([
      "P",
      "DIV",
      "DIV",
      "P",
    ]);
    expect(Array.from(el.children, (child) => child.textContent)).toEqual([
      "Intro",
      "First",
      "Second",
      "Outro",
    ]);
  });

  it("toggles selected rows across both sibling semantic lists", () => {
    const el = mount(
      '<div id="t"><ul><li>First</li><li>Second</li></ul><ul><li>Third</li><li>Fourth</li></ul></div>',
    );
    session = startInPlaceTextSession(el);
    const second = textOf(el, "Second");
    const third = textOf(el, "Third");
    select(second, 0, third, third.length);

    expect(session.commands.toggleList("bullet")).toBe(true);

    expect(Array.from(el.children, (child) => child.tagName)).toEqual([
      "UL",
      "DIV",
      "DIV",
      "UL",
    ]);
    expect(
      Array.from(el.querySelectorAll("ul > li"), (row) => row.textContent),
    ).toEqual(["First", "Fourth"]);
    expect(Array.from(el.children, (child) => child.textContent)).toEqual([
      "First",
      "Second",
      "Third",
      "Fourth",
    ]);
  });

  it("selects the element's text for Mod-A", () => {
    const el = mount('<p id="t">One <b>two</b></p><p>outside</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 1);
    expect(key(el, { key: "a", metaKey: true }).defaultPrevented).toBe(true);
    expect(window.getSelection()!.toString()).toBe("One two");
  });

  it("selects the current block before the whole edit for Mod-A", () => {
    const el = mount('<div id="t"><p>One</p><p>Two</p></div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Two"), 1);

    key(el, { key: "a", metaKey: true });
    expect(window.getSelection()?.toString()).toBe("Two");
    key(el, { key: "a", metaKey: true });
    expect(window.getSelection()?.toString()).toBe("OneTwo");
  });

  it("turns '- ' at the start of a leaf into a styled bullet row", () => {
    const el = mount('<div id="t">Point</div>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 0);
    type(el, "- ");
    expect(el.firstElementChild!.firstElementChild!.textContent).toBe("●");
    expect(el.textContent).toBe("●Point");
  });

  it("turns '- ' after Enter into a bullet on that line", () => {
    const el = mount('<p id="t">First line</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, "First line".length);
    beforeInput(el, "insertParagraph");
    type(session.element, "- ");

    expect(session.element.lastElementChild?.textContent).toContain("●");
    const row = session.element.querySelector(
      ':scope > div[style*="display: flex"]',
    );
    expect(
      row?.lastElementChild?.contains(
        window.getSelection()?.anchorNode ?? null,
      ),
    ).toBe(true);
    type(session.element, "Tail");
    expect(session.element.textContent).toBe("First line●Tail");
  });

  it("turns '---' into a divider without requiring a trailing space", () => {
    const el = mount('<div id="t"><p>First line</p><p></p></div>');
    session = startInPlaceTextSession(el);
    caret(el.children[1], 0);

    type(el, "---");

    expect(el.querySelectorAll(":scope > hr")).toHaveLength(1);
    expect(el.children[0]?.tagName).toBe("P");
    expect(el.children[2]?.tagName).toBe("P");
    expect(el.children[2]?.textContent).not.toContain("---");
  });

  it("converts a bullet shortcut after a break without restyling earlier text", () => {
    const el = mount(
      '<div id="t"><span style="color: red">Before</span><br>*<br>After</div>',
    );
    session = startInPlaceTextSession(el);
    const markerLine = textOf(el, "*");
    caret(markerLine, markerLine.length);

    type(el, " ");

    expect(session.element.textContent).toBe("Before●After");
    expect(session.element.querySelectorAll(":scope > div")).toHaveLength(3);
    expect(session.element.children[0].querySelector("span")?.style.color).toBe(
      "red",
    );
    expect(
      session.element.children[1].querySelector('div[style*="display: flex"]'),
    ).not.toBeNull();
  });

  it("applies a heading shortcut after a break to only its current line", () => {
    const el = mount(
      '<div id="t"><span style="color: red">Before</span><br>#After</div>',
    );
    session = startInPlaceTextSession(el);
    const markerLine = textOf(el, "#After");
    caret(markerLine, 1);

    type(el, " ");

    expect(session.element.children[0].querySelector("span")?.style.color).toBe(
      "red",
    );
    expect(
      session.element
        .querySelector(":scope > h1")
        ?.textContent?.replaceAll(ZWSP, ""),
    ).toBe("After");
  });

  it("keeps the previous paragraph line unchanged after a soft-break shortcut", () => {
    const el = mount('<div id="t"><p style="color: red">Before</p></div>');
    session = startInPlaceTextSession(el);
    const before = textOf(el, "Before");
    caret(before, before.length);
    beforeInput(el, "insertLineBreak");

    type(el, "# After");

    expect(session.element.children[0]?.tagName).toBe("P");
    expect(session.element.children[0]?.textContent).toBe("Before");
    expect((session.element.children[0] as HTMLElement).style.color).toBe(
      "red",
    );
    expect(
      session.element
        .querySelector(":scope > h1")
        ?.textContent?.replaceAll(ZWSP, ""),
    ).toBe("After");
  });

  it("keeps the previous list line unchanged after a soft-break quote shortcut", () => {
    const el = mount('<ul id="t"><li style="color: red">Before</li></ul>');
    session = startInPlaceTextSession(el);
    const before = textOf(el, "Before");
    caret(before, before.length);
    beforeInput(el, "insertLineBreak");

    type(el, "> Quoted");

    const items = session.element.querySelectorAll(":scope > li");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toBe("Before");
    expect((items[0] as HTMLElement).style.color).toBe("red");
    expect(
      items[1]?.querySelector("blockquote")?.textContent?.replaceAll(ZWSP, ""),
    ).toBe("Quoted");
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

  it("keeps nested child order after outdent then Backspace", () => {
    const el = mount(
      '<ul id="t"><li>A<ul><li>B<ul><li>C</li></ul></li><li>D</li></ul></li></ul>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "B"), 0);

    key(el, { key: "Tab", shiftKey: true });
    beforeInput(el, "deleteContentBackward");

    expect(session.element.textContent).toBe("ABCD");
    expect(session.element.querySelectorAll("li > li")).toHaveLength(0);
    expect(session.element.querySelector(":scope > ul > li")?.textContent).toBe(
      "A",
    );
    expect(session.element.querySelector(":scope > p")?.textContent).toBe("B");
    expect(
      session.element.querySelector(":scope > ul + p + ul")?.textContent,
    ).toBe("CD");
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

  it("copies the inline ancestors of a selection without copying their identity", () => {
    const el = mount(
      '<p id="t"><a id="link" data-slide-object-id="a1" href="https://example.com"><strong id="bold"><span id="color" data-slide-object-id="s1" style="color: red;"><code id="code">marked</code></span></strong></a></p>',
    );
    session = startInPlaceTextSession(el);
    select(textOf(el, "marked"), 1, textOf(el, "marked"), 2);

    const { clipboardData } = clipboardEvent(el, "copy");
    const html = clipboardData.getData("text/html");
    const copied = document.createElement("div");
    copied.innerHTML = html;

    expect(copied.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com",
    );
    expect(copied.querySelector("strong, b")).not.toBeNull();
    expect(copied.querySelector("span")?.style.color).toBe("red");
    expect(copied.querySelector("code")?.textContent).toBe("a");
    expect(html).not.toMatch(/\sid=|data-slide-object-id/);
    expect(clipboardData.getData("text/plain")).toBe("a");
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

  it("strips foreign font and paint while preserving semantic formatting", () => {
    const el = mount('<p id="t">A</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 1);
    paste(el, {
      "text/html":
        '<b style="color: red; font-size: 20px; background-color: rgb(255, 255, 255); display: inline !important; --tw-font-weight: 700; orphans: 2">x<em style="color: blue; font-style: italic">y</em></b>',
      "text/plain": "xy",
    });
    session.end();
    expect(el.innerHTML).toBe("A<b>x<em>y</em></b>");
  });

  it("strips foreign spacing, transform, and shorthand font styles", () => {
    const el = mount('<p id="t">A</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 1);
    paste(el, {
      "text/html":
        '<span style="letter-spacing: 2px; word-spacing: 3px; text-transform: uppercase; font: italic 20px/1.5 serif">x</span>',
      "text/plain": "x",
    });

    const pasted = session.element.querySelector("span");
    expect(pasted?.textContent).toBe("x");
    expect(pasted?.getAttribute("style")).toBeNull();
  });

  it("preserves visual text style copied from another slide text selection", () => {
    const source = mount(
      '<p id="t"><span style="color: red; font-size: 20px; letter-spacing: 2px; word-spacing: 3px; text-transform: uppercase; font-style: italic; font-weight: 600">A</span></p>',
    );
    session = startInPlaceTextSession(source);
    select(textOf(source, "A"), 0, textOf(source, "A"), 1);
    const { clipboardData } = clipboardEvent(source, "copy");
    const localHtml = clipboardData.getData("text/html");
    const localMarker = clipboardData.getData(
      "application/x-agent-native-slide-text",
    );

    const destination = mount('<p id="u">B</p>', "#u");
    session.end();
    session = startInPlaceTextSession(destination);
    caret(textOf(destination, "B"), 1);
    paste(destination, {
      "text/html": localHtml,
      "text/plain": "A",
      "application/x-agent-native-slide-text": localMarker,
    });

    expect(session.element.innerHTML).toContain("color: red");
    expect(session.element.innerHTML).toContain("font-size: 20px");
    expect(session.element.innerHTML).toContain("letter-spacing: 2px");
    expect(session.element.innerHTML).toContain("word-spacing: 3px");
    expect(session.element.innerHTML).toContain("text-transform: uppercase");
    expect(session.element.innerHTML).toContain("font-style: italic");
    expect(session.element.innerHTML).toContain("font-weight: 600");
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
  // Chrome places the drop with a live Range made before the delete.
  function dropAt(el: HTMLElement, drop: Range, text: string) {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", text);
    const event = new InputEvent("beforeinput", {
      inputType: "insertFromDrop",
      bubbles: true,
      cancelable: true,
      dataTransfer,
    });
    Object.defineProperty(event, "getTargetRanges", {
      value: () => [drop],
    });
    el.dispatchEvent(event);
  }

  it("keeps Chrome's drop point through its own drag delete", () => {
    const el = mount('<p id="t">alpha beta gamma</p>');
    session = startInPlaceTextSession(el);
    const text = el.firstChild as Text;
    const drop = document.createRange();
    drop.setStart(text, 16);
    select(text, 6, text, 11);
    expect(beforeInput(el, "deleteByDrag").defaultPrevented).toBe(false);
    text.deleteData(6, 5);
    caret(text, 6);
    el.dispatchEvent(
      new InputEvent("input", { inputType: "deleteByDrag", bubbles: true }),
    );
    dropAt(el, drop, "beta ");
    expect(el.textContent).toBe("alpha gammabeta ");
  });

  it("keeps Chrome's drop point through a drag delete across runs", () => {
    const el = mount('<p id="t">alpha <b>beta</b> gamma</p>');
    session = startInPlaceTextSession(el);
    const drop = document.createRange();
    drop.setStart(textOf(el, "alpha"), 1);
    select(textOf(el, "alpha"), 3, textOf(el, "beta"), 2);
    expect(beforeInput(el, "deleteByDrag").defaultPrevented).toBe(true);
    dropAt(el, drop, "ha be");
    expect(el.textContent).toBe("aha belpta gamma");
  });

  it("reshapes the Arabic run a drag moved text out of, once the drop lands", () => {
    const el = mount('<p id="t">مراجعة ربع <b>beta</b> gamma</p>');
    session = startInPlaceTextSession(el);
    const source = textOf(el, "مراجعة");
    const drop = document.createRange();
    drop.setStart(textOf(el, "gamma"), 3);
    select(source, 7, textOf(el, "beta"), 2);
    expect(beforeInput(el, "deleteByDrag").defaultPrevented).toBe(true);
    dropAt(el, drop, "ربع be");
    expect(el.textContent).toBe("مراجعة ta gaربع bemma");
    // Chrome redraws the joins left behind only in a recreated node.
    expect(el.firstChild).not.toBe(source);
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

  it("keeps a leading space on an empty line between existing blocks", () => {
    const el = mount('<div id="t"><p>Before</p><p>After</p></div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Before"), 6);
    beforeInput(session.element, "insertParagraph");

    type(session.element, " ");

    expect(session.element.children).toHaveLength(3);
    expect(session.element.children[1]?.tagName).toBe("P");
    expect(session.element.children[1]?.textContent).toBe("\u00a0");
    expect(session.element.children[2]?.textContent).toBe("After");
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

  it("leaves macOS Control+A/E/Y to the browser while Command shortcuts work", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const el = mount('<p id="t">Hello world</p>');
    session = startInPlaceTextSession(el);
    const text = el.firstChild!;
    select(text, 6, text, 11);

    for (const shortcut of ["a", "e", "y"]) {
      expect(key(el, { key: shortcut, ctrlKey: true }).defaultPrevented).toBe(
        false,
      );
    }
    expect(el.innerHTML).toBe("Hello world");

    expect(key(el, { key: "b", metaKey: true }).defaultPrevented).toBe(true);
    expect(el.querySelector("span")?.textContent).toBe("world");
    expect(key(el, { key: "z", metaKey: true }).defaultPrevented).toBe(true);
    expect(el.innerHTML).toBe("Hello world");
    expect(
      key(el, { key: "z", metaKey: true, shiftKey: true }).defaultPrevented,
    ).toBe(true);
    expect(el.querySelector("span")?.textContent).toBe("world");
  });

  it.each([
    ["b", "metaKey", false, "font-weight"],
    ["b", "ctrlKey", false, "font-weight"],
    ["i", "metaKey", false, "font-style"],
    ["i", "ctrlKey", false, "font-style"],
    ["u", "metaKey", false, "text-decoration-line"],
    ["u", "ctrlKey", false, "text-decoration-line"],
    ["s", "metaKey", true, "text-decoration-line"],
    ["s", "ctrlKey", true, "text-decoration-line"],
  ] as const)(
    "routes Mod+%s through the style-safe command",
    (shortcut, modifier, shiftKey, style) => {
      const el = mount('<p id="t">Hello world</p>');
      session = startInPlaceTextSession(el);
      select(el.firstChild!, 6, el.firstChild!, 11);

      const event = key(el, {
        key: shortcut,
        [modifier]: true,
        shiftKey,
      });

      expect(event.defaultPrevented).toBe(true);
      expect(el.querySelector("span")?.textContent).toBe("world");
      expect(el.querySelector("span")?.style.getPropertyValue(style)).not.toBe(
        "",
      );
    },
  );

  it.each(["metaKey", "ctrlKey"] as const)(
    "routes Mod+E through the style-safe code command (%s)",
    (modifier) => {
      const el = mount('<p id="t">Hello world</p>');
      session = startInPlaceTextSession(el);
      select(el.firstChild!, 6, el.firstChild!, 11);

      const event = key(el, { key: "e", [modifier]: true });

      expect(event.defaultPrevented).toBe(true);
      expect(el.innerHTML).toBe(
        'Hello <code data-slide-authoring-format="code">world</code>',
      );
    },
  );

  it("requests the link input for a selected range and no-ops at a caret", () => {
    const el = mount('<p id="t">Hello world</p>');
    const onRequestLink = vi.fn();
    session = startInPlaceTextSession(el, { onRequestLink });
    const text = el.firstChild!;
    select(text, 6, text, 11);

    expect(key(el, { key: "k", metaKey: true }).defaultPrevented).toBe(true);
    expect(onRequestLink).toHaveBeenCalledOnce();
    expect(onRequestLink.mock.calls[0]?.[0].toString()).toBe("world");

    caret(text, 11);
    expect(key(el, { key: "k", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(onRequestLink).toHaveBeenCalledOnce();
  });

  it.each([
    ["Digit0", "0", "P"],
    ["Digit1", "1", "H1"],
    ["Digit2", "2", "H2"],
    ["Digit3", "3", "H3"],
    ["Digit4", "4", "H4"],
  ])("turns the current block into %s with Mod+Alt", (code, keyValue, tag) => {
    const el = mount('<p id="t">Alpha</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 2);

    const event = key(el, {
      key: keyValue,
      code,
      metaKey: true,
      altKey: true,
    });

    expect(event.defaultPrevented).toBe(true);
    expect(session.element.tagName).toBe(tag);
  });

  it("turns the current block into a quote with Mod+Shift+B", () => {
    const el = mount('<p id="t">Alpha</p>');
    session = startInPlaceTextSession(el);
    caret(el.firstChild!, 2);

    expect(
      key(el, { key: "b", metaKey: true, shiftKey: true }).defaultPrevented,
    ).toBe(true);
    expect(session.element.tagName).toBe("BLOCKQUOTE");
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

  it("keeps a Docs list after paragraphs when pasting rich blocks", () => {
    const el = mount('<div id="t"><p>Intro</p></div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Intro"), 5);
    paste(el, {
      "text/html":
        '<p>Docs paragraph</p><p>Second paragraph</p><ul><li><span style="color: rgb(255, 0, 0); font-size: 48px">Docs list item</span></li></ul>',
      "text/plain": "Docs paragraph\nSecond paragraph\nDocs list item",
    });
    session.end();

    expect(Array.from(el.querySelectorAll("p"), (p) => p.textContent)).toEqual([
      "Intro",
      "Docs paragraph",
      "Second paragraph",
    ]);
    expect(el.querySelector("ul > li")?.textContent).toBe("Docs list item");
    expect(el.querySelector("ul > li > span")?.getAttribute("style")).toBe(
      null,
    );
  });

  it("strips pasted links from mixed rich blocks inside an existing link", () => {
    const el = mount(
      '<div id="t"><p><a href="https://example.com/original">Intro</a></p></div>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Intro"), 5);
    paste(el, {
      "text/html":
        '<p>Docs paragraph</p><ul><li><a href="https://example.com/pasted">Docs list item</a></li></ul>',
      "text/plain": "Docs paragraph\nDocs list item",
    });
    session.end();

    expect(el.querySelectorAll("a")).toHaveLength(1);
    expect(el.querySelector("a")?.textContent).toBe("Intro");
    expect(el.querySelectorAll("a a")).toHaveLength(0);
    expect(el.textContent).toContain("Docs list item");
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

  it("keeps pasted ordered list item value overrides", () => {
    const el = mount('<div id="t">Intro</div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Intro"), 5);
    paste(el, {
      "text/html": '<ol start="3"><li value="8">Eight</li><li>Nine</li></ol>',
      "text/plain": "Eight\nNine",
    });
    session.end();
    const [first, second] = Array.from(el.querySelectorAll("li"));
    expect(el.querySelector("ol")?.getAttribute("start")).toBe("3");
    expect(first.getAttribute("value")).toBe("8");
    expect(second.hasAttribute("value")).toBe(false);
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

  it("turns '- ' at the start of a heading into a bullet row in a div", () => {
    const el = mount('<h2 id="t" style="color: red;">Head</h2>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Head"), 0);
    type(el, "- ");
    session.end();
    const next = document.getElementById("t")!;
    expect(next.tagName).toBe("DIV");
    expect(next.textContent).toContain("Head");
    expect(document.querySelector("h2")).toBeNull();
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

  it.each(["Revenue* and margin*", "a*b*c"])(
    "leaves mid-word asterisks literal: %s",
    (source) => {
      const el = mount('<p id="t"></p>');
      session = startInPlaceTextSession(el);
      caret(el, 0);

      type(el, source);

      expect(session.element.textContent?.replaceAll(ZWSP, "")).toBe(source);
      expect(
        session.element.querySelector('span[style*="font-style"]'),
      ).toBeNull();
    },
  );
});

describe("in-place text session: Content authoring parity", () => {
  it.each([
    ["- ", "bullet"],
    ["* ", "bullet"],
    ["+ ", "bullet"],
    ["1. ", "ordered"],
    ["# ", "H1"],
    ["## ", "H2"],
    ["### ", "H3"],
    ["#### ", "H4"],
    ["> ", "BLOCKQUOTE"],
    ["--- ", "HR"],
    ["**bold**", "bold"],
    ["__bold__", "bold"],
    ["*italic*", "italic"],
    ["_italic_", "italic"],
    ["~~strike~~", "strike"],
    ["`code`", "code"],
  ])("applies %j at the start of the edited block", (shortcut, result) => {
    const el = mount('<div id="t">Alpha</div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Alpha"), 0);

    type(el, shortcut);

    const root = session.element;
    if (result === "bullet") {
      expect(root.textContent).toBe("●Alpha");
    } else if (result === "ordered") {
      expect(root.querySelector("ol > li")?.textContent).toBe("Alpha");
    } else if (result === "bold") {
      expect(
        root.querySelector('span[style*="font-weight"]')?.textContent,
      ).toBe("bold");
    } else if (result === "italic") {
      expect(root.querySelector('span[style*="font-style"]')?.textContent).toBe(
        "italic",
      );
    } else if (result === "strike") {
      expect(
        root.querySelector('span[style*="text-decoration"]')?.textContent,
      ).toBe("strike");
    } else if (result === "code") {
      expect(root.querySelector("code")?.textContent).toBe("code");
    } else if (result === "HR") {
      expect(root.querySelector("hr")).not.toBeNull();
    } else {
      expect(root.tagName).toBe(result);
      expect(root.textContent).toBe("Alpha");
    }
  });

  it("applies the markdown bold shortcut to only the marked text", () => {
    const el = mount('<div id="t">Start </div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Start"), 6);

    type(el, "**bold**");

    expect(el.textContent).toBe("Start bold");
    expect(el.querySelector('span[style*="font-weight"]')?.textContent).toBe(
      "bold",
    );
  });

  it("keeps markdown bold on and following typing outside its mark in a styled list", () => {
    const el = mount(
      '<ol id="t"><li><strong style="font-weight: 700">Re-segment the book.</strong> <span style="color: #1684a7">Every account has a clear path.</span></li></ol>',
    );
    session = startInPlaceTextSession(el);
    const existingBold = textOf(el, "Re-segment the book.");
    caret(existingBold, 0);

    let caretAfterBold: { collapsed: boolean; prefix: string } | null = null;
    el.addEventListener(
      "beforeinput",
      (event) => {
        if ((event as InputEvent).data !== " ") return;
        const selection = window.getSelection()!;
        const range = document.createRange();
        range.selectNodeContents(el);
        range.setEnd(selection.anchorNode!, selection.anchorOffset);
        caretAfterBold = {
          collapsed: selection.isCollapsed,
          prefix: range.toString(),
        };
      },
      { capture: true },
    );

    type(el, "**bold** next");

    const marked = Array.from(el.querySelectorAll<HTMLElement>("span")).find(
      (span) => span.textContent === "bold",
    );
    expect(marked).toBeDefined();
    expect(marked!.style.fontWeight).toBe("700");
    expect(window.getComputedStyle(marked!).fontWeight).toBe("700");
    expect(caretAfterBold).toEqual({ collapsed: true, prefix: "bold" });

    expect(el.querySelector("li")?.textContent).toBe(
      "bold nextRe-segment the book. Every account has a clear path.",
    );
    expect(marked!.textContent).toBe("bold");
    expect(marked!.contains(textOf(el, "next"))).toBe(false);
    expect(window.getSelection()!.isCollapsed).toBe(true);
  });

  it.each([
    [500, "700"],
    [600, "600"],
    [900, "900"],
  ])(
    "keeps markdown bold at least 600 for inherited weight %i",
    (inheritedWeight, expectedWeight) => {
      const el = mount(
        `<h1 id="t" style="font-weight: ${inheritedWeight}">Title</h1>`,
      );
      session = startInPlaceTextSession(el);
      caret(textOf(el, "Title"), 0);

      type(el, "**bold**");

      const marked = Array.from(el.querySelectorAll<HTMLElement>("span")).find(
        (span) => span.textContent === "bold",
      );
      expect(marked?.style.fontWeight).toBe(expectedWeight.toString());
      expect(window.getComputedStyle(marked!).fontWeight).toBe(
        expectedWeight.toString(),
      );
    },
  );

  it.each([
    ["**bold**", 'span[style*="font-weight"]', "bold"],
    ["__bold__", 'span[style*="font-weight"]', "bold"],
    ["*italic*", 'span[style*="font-style"]', "italic"],
    ["_italic_", 'span[style*="font-style"]', "italic"],
    ["~~strike~~", 'span[style*="text-decoration"]', "strike"],
    ["`code`", "code", "code"],
  ])(
    "leaves text after %j outside its formatted run",
    (shortcut, selector, word) => {
      const el = mount('<div id="t">Start </div>');
      session = startInPlaceTextSession(el);
      caret(textOf(el, "Start "), 6);

      type(el, shortcut);

      const selection = window.getSelection()!;
      const formatted = el.querySelector(selector);
      expect(selection.isCollapsed).toBe(true);
      expect(formatted).not.toBeNull();
      expect(formatted!.contains(selection.anchorNode)).toBe(false);

      type(el, " next");

      expect(session.element.textContent).toBe(`Start ${word} next`);
      expect(session.element.querySelector(selector)?.textContent).toBe(word);
      expect(window.getSelection()!.isCollapsed).toBe(true);
    },
  );

  it("keeps multiplication asterisks literal while typing", () => {
    const el = mount('<p id="t">Start </p>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Start "), 6);

    type(el, "2*3*4");

    expect(session.element.textContent).toBe("Start 2*3*4");
    expect(
      session.element.querySelector('span[style*="font-style"]'),
    ).toBeNull();
  });

  it("keeps strong delimiters literal inside a word", () => {
    const el = mount('<p id="t">Start </p>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Start "), 6);

    type(el, "a**bold**");

    expect(session.element.textContent).toBe("Start a**bold**");
    expect(
      session.element.querySelector('span[style*="font-weight"]'),
    ).toBeNull();
  });

  it("preserves the typed number in an ordered-list shortcut", () => {
    const el = mount('<div id="t">Alpha</div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Alpha"), 0);

    type(el, "42. ");

    expect(session.element.querySelector("ol")?.getAttribute("start")).toBe(
      "42",
    );
    expect(session.element.querySelector("ol > li")?.textContent).toBe("Alpha");
  });

  it.each(["_var_", "__var__"])(
    "does not treat an underscore inside a word as italic markup: %s",
    (shortcut) => {
      const el = mount('<div id="t">some</div>');
      session = startInPlaceTextSession(el);
      caret(textOf(el, "some"), 4);

      type(el, shortcut);

      expect(session.element.textContent).toBe(`some${shortcut}`);
      expect(
        session.element.querySelector('span[style*="font-style"]'),
      ).toBeNull();
      expect(
        session.element.querySelector('span[style*="font-weight"]'),
      ).toBeNull();
    },
  );

  it("applies toolbar block formatting to a selected text run", () => {
    const el = mount('<p id="t">Title text</p>');
    session = startInPlaceTextSession(el);
    select(textOf(el, "Title"), 0, textOf(el, "text"), 10);

    expect(session.commands.applyAuthoringCommand("heading2")).toBe(true);
    expect(session.element.tagName).toBe("H2");
    expect(window.getSelection()!.toString()).toBe("Title text");
    expect(session.undo()).toBe(true);
    expect(session.element.outerHTML).toBe(
      '<p id="t" contenteditable="true" data-editing-block="true">Title text</p>',
    );
  });

  it("formats selected root text and child blocks as siblings", () => {
    const el = mount('<div id="t">Intro<p>Body</p></div>');
    session = startInPlaceTextSession(el);
    select(textOf(el, "Intro"), 0, textOf(el, "Body"), 4);

    expect(session.commands.applyAuthoringCommand("heading1")).toBe(true);

    expect(session.element.querySelectorAll(":scope > h1")).toHaveLength(2);
    expect(session.element.querySelector("h1 > h1")).toBeNull();
    expect(session.element.querySelector(":scope > h1")?.textContent).toBe(
      "Intro",
    );
  });

  it.each([
    ["heading1", "h1"],
    ["quote", "blockquote"],
  ] as const)(
    "does not nest %s around selected root text and child blocks",
    (kind, tag) => {
      const el = mount('<div id="t">Intro<p>Body</p></div>');
      session = startInPlaceTextSession(el);
      select(textOf(el, "Intro"), 0, textOf(el, "Body"), 4);

      expect(session.commands.applyAuthoringCommand(kind)).toBe(true);

      expect(el.querySelectorAll(`:scope > ${tag}`)).toHaveLength(2);
      expect(el.querySelector(`${tag} ${tag}, p ${tag}`)).toBeNull();
      expect(el.textContent).toBe("IntroBody");
    },
  );

  it("keeps a divider on a root heading and strips split-run identities", () => {
    const el = mount(
      '<h1 id="t"><span id="run" data-slide-element-id="s1">Title /tail</span></h1>',
    );
    session = startInPlaceTextSession(el);
    const source = textOf(el, "Title /tail");
    const slash = document.createRange();
    slash.setStart(source, 6);
    slash.setEnd(source, 7);
    caret(source, 7);

    expect(session.commands.applyAuthoringCommand("divider", slash)).toBe(true);

    expect(session.element.querySelector(":scope > h1")?.textContent).toBe(
      "Title ",
    );
    expect(session.element.querySelectorAll("#run")).toHaveLength(0);
    expect(
      session.element.querySelectorAll('[data-slide-element-id="s1"]'),
    ).toHaveLength(0);
  });

  it("keeps a nested list outside the paragraph created by a divider", () => {
    const el = mount(
      '<ul id="t"><li>Parent /<ul><li>Child</li></ul></li></ul>',
    );
    session = startInPlaceTextSession(el);
    const source = textOf(el, "Parent /");
    const slash = document.createRange();
    slash.setStart(source, 7);
    slash.setEnd(source, 8);
    caret(source, 8);

    expect(session.commands.applyAuthoringCommand("divider", slash)).toBe(true);

    const item = session.element.querySelector(":scope > li")!;
    expect(Array.from(item.children, (child) => child.tagName)).toEqual([
      "P",
      "HR",
      "P",
      "UL",
    ]);
    expect(item.querySelector("p ul")).toBeNull();
    expect(item.querySelector(":scope > ul > li")?.textContent).toBe("Child");
    const range = window.getSelection()!.getRangeAt(0);
    expect(item.children[2]?.contains(range.startContainer)).toBe(true);
    expect(range.startContainer.textContent).toBe(ZWSP);
  });

  it("replaces an empty paragraph with a divider and its following line", () => {
    const el = mount('<div id="t"><p>Alpha</p><p>/</p></div>');
    session = startInPlaceTextSession(el);
    const slashText = textOf(el, "/");
    const slash = document.createRange();
    slash.setStart(slashText, 0);
    slash.setEnd(slashText, 1);

    expect(session.commands.applyAuthoringCommand("divider", slash)).toBe(true);
    session.end();

    expect(Array.from(el.children, (child) => child.tagName)).toEqual([
      "P",
      "HR",
      "P",
    ]);
    expect(el.children[0]?.textContent).toBe("Alpha");
    expect(el.children[2]?.textContent).toBe("");
  });

  it("keeps slash commands scoped to one styled legacy bullet row", () => {
    const row = (text: string) =>
      `<div style="display:flex;gap:12px;font-size:28px"><span>●</span><span>${text}</span></div>`;
    const el = mount(
      `<div id="t">${row("One")}${row("Two/")}${row("Three")}</div>`,
    );
    session = startInPlaceTextSession(el);
    const source = textOf(el, "Two/");
    const slash = document.createRange();
    slash.setStart(source, 3);
    slash.setEnd(source, 4);
    caret(source, 4);

    expect(session.commands.applyAuthoringCommand("bulletList", slash)).toBe(
      true,
    );

    expect((session.element.textContent?.match(/●/g) ?? []).length).toBe(2);
  });

  it("applies a heading slash command to only its legacy bullet row", () => {
    const row = (text: string) =>
      `<div style="display:flex;gap:12px;font-size:28px"><span>●</span><span>${text}</span></div>`;
    const el = mount(
      `<div id="t">${row("One")}${row("Two/")}${row("Three")}</div>`,
    );
    session = startInPlaceTextSession(el);
    const source = textOf(el, "Two/");
    const slash = document.createRange();
    slash.setStart(source, 3);
    slash.setEnd(source, 4);
    caret(source, 4);

    expect(session.commands.applyAuthoringCommand("heading2", slash)).toBe(
      true,
    );

    expect(
      Array.from(session.element.children, (child) => child.tagName),
    ).toEqual(["DIV", "H2", "DIV"]);
    expect(session.element.children[1]?.textContent).toBe("Two");
    expect(
      session.element.children[1]?.querySelector("span")?.textContent,
    ).toBe("Two");
    expect((session.element.children[1] as HTMLElement).style.display).toBe("");
    expect((session.element.children[1] as HTMLElement).style.gap).toBe("");
    expect((session.element.textContent?.match(/●/g) ?? []).length).toBe(2);
  });

  it("keeps sibling hard-break lines unchanged after a slash heading command", () => {
    const el = mount(
      '<div id="t"><p style="color: red">Before<br>/After</p><p>Untouched</p></div>',
    );
    session = startInPlaceTextSession(el);
    const source = textOf(el, "/After");
    const slash = document.createRange();
    slash.setStart(source, 0);
    slash.setEnd(source, 1);
    caret(source, 1);

    expect(session.commands.applyAuthoringCommand("heading2", slash)).toBe(
      true,
    );

    expect(Array.from(el.children, (child) => child.tagName)).toEqual([
      "P",
      "H2",
      "P",
    ]);
    expect(el.children[0]?.textContent).toBe("Before");
    expect(el.children[1]?.textContent).toBe("After");
    expect((el.children[0] as HTMLElement).style.color).toBe("red");
    expect((el.children[1] as HTMLElement).style.color).toBe("red");
    expect(el.children[2]?.textContent).toBe("Untouched");
  });

  it("keeps sibling list items unchanged after a slash heading on a soft line", () => {
    const el = mount(
      '<div id="t"><ul><li style="color: red">Before<br>/After</li><li>Untouched</li></ul></div>',
    );
    session = startInPlaceTextSession(el);
    const source = textOf(el, "/After");
    const slash = document.createRange();
    slash.setStart(source, 0);
    slash.setEnd(source, 1);
    caret(source, 1);

    expect(session.commands.applyAuthoringCommand("heading2", slash)).toBe(
      true,
    );

    const items = el.querySelectorAll(":scope > ul > li");
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toBe("Before");
    expect(items[1]?.querySelector(":scope > h2")?.textContent).toBe("After");
    expect((items[0] as HTMLElement).style.color).toBe("red");
    expect((items[1] as HTMLElement).style.color).toBe("red");
    expect(items[2]?.textContent).toBe("Untouched");
  });

  it.each(["orderedList", "quote"] as const)(
    "keeps slash %s scoped to one styled legacy bullet row",
    (kind) => {
      const row = (text: string) =>
        `<div style="display:flex;gap:12px;font-size:28px"><span>●</span><span>${text}</span></div>`;
      const el = mount(
        `<div id="t">${row("One")}${row("Two/")}${row("Three")}</div>`,
      );
      session = startInPlaceTextSession(el);
      const source = textOf(el, "Two/");
      const slash = document.createRange();
      slash.setStart(source, 3);
      slash.setEnd(source, 4);
      caret(source, 4);

      expect(session.commands.applyAuthoringCommand(kind, slash)).toBe(true);

      expect((session.element.textContent?.match(/●/g) ?? []).length).toBe(2);
      if (kind === "orderedList") {
        expect(
          session.element.querySelector(":scope > ol > li")?.textContent,
        ).toBe("Two");
      } else {
        expect(session.element.children[1]?.tagName).toBe("BLOCKQUOTE");
        expect(session.element.children[1]?.textContent).toBe("Two");
      }
    },
  );

  it("applies the Text slash command to a list item without nesting a paragraph", () => {
    const el = mount(
      '<div id="t"><ul><li>One</li><li>/Text</li><li>Three</li></ul></div>',
    );
    session = startInPlaceTextSession(el);
    const source = textOf(el, "/Text");
    const slash = document.createRange();
    slash.setStart(source, 0);
    slash.setEnd(source, 1);
    caret(source, 1);

    expect(session.commands.applyAuthoringCommand("paragraph", slash)).toBe(
      true,
    );

    expect(
      Array.from(session.element.children, (child) => child.tagName),
    ).toEqual(["UL", "P", "UL"]);
    expect(session.element.children[1]?.textContent).toBe("Text");
    expect(session.element.querySelector("li p")).toBeNull();
  });

  it("converts a paragraph-backed list item with the Text slash command", () => {
    const el = mount(
      '<div id="t"><ul><li><p>One</p></li><li><p>/Text</p></li><li><p>Three</p></li></ul></div>',
    );
    session = startInPlaceTextSession(el);
    const source = textOf(el, "/Text");
    const slash = document.createRange();
    slash.setStart(source, 0);
    slash.setEnd(source, 1);
    caret(source, 1);

    expect(session.commands.applyAuthoringCommand("paragraph", slash)).toBe(
      true,
    );

    expect(
      Array.from(session.element.children, (child) => child.tagName),
    ).toEqual(["UL", "P", "UL"]);
    expect(session.element.children[1]?.textContent).toBe("Text");
    expect(
      Array.from(
        session.element.querySelectorAll(":scope > ul > li > p"),
        (paragraph) => paragraph.textContent,
      ),
    ).toEqual(["One", "Three"]);
  });

  it("converts a multi-paragraph list item without nesting paragraphs", () => {
    const el = mount(
      '<div id="t"><ul><li><p>First</p><p>Second</p></li><li><p>After</p></li></ul></div>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Second"), 0);

    expect(session.commands.applyAuthoringCommand("paragraph")).toBe(true);

    expect(session.element.querySelector("p p")).toBeNull();
    expect(
      Array.from(
        session.element.querySelectorAll(":scope > div > p"),
        (paragraph) => paragraph.textContent,
      ),
    ).toEqual(["First", "Second"]);
    expect(session.element.querySelector(":scope > ul li p")?.textContent).toBe(
      "After",
    );
    expect(session.element.textContent).toBe("FirstSecondAfter");
  });

  it("targets the caret paragraph in an inline multi-paragraph list item", () => {
    const el = mount(
      '<ul id="t"><li><p style="display:inline">First</p><p style="display:inline">Second</p></li></ul>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Second"), 2);

    expect(session.commands.applyAuthoringCommand("heading2")).toBe(true);

    expect(
      Array.from(
        el.querySelector(":scope > li")!.children,
        (child) => child.tagName,
      ),
    ).toEqual(["P", "H2"]);
    expect(el.querySelector(":scope > li > p")?.textContent).toBe("First");
    expect(el.querySelector(":scope > li > h2")?.textContent).toBe("Second");
  });

  it("keeps every direct nested list outside a retagged list item", () => {
    const el = mount(
      '<div id="t"><ul><li>Parent<ul><li>Bullet</li></ul><ol><li>Number</li></ol></li></ul></div>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Parent"), 0);

    expect(session.commands.applyAuthoringCommand("heading2")).toBe(true);

    const item = session.element.querySelector(":scope > ul > li")!;
    expect(Array.from(item.children, (child) => child.tagName)).toEqual([
      "H2",
      "UL",
      "OL",
    ]);
    expect(item.querySelector("h2 ul, h2 ol")).toBeNull();
    expect(item.textContent).toBe("ParentBulletNumber");
  });

  it("continues a numbered list when adjacent paragraphs are converted", () => {
    const el = mount('<div id="t"><p>One</p><p>Two</p></div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "One"), 1);

    expect(session.commands.toggleList("ordered")).toBe(true);
    caret(textOf(el, "Two"), 1);
    expect(session.commands.toggleList("ordered")).toBe(true);

    expect(el.querySelectorAll(":scope > ol")).toHaveLength(1);
    expect(
      Array.from(
        el.querySelectorAll(":scope > ol > li"),
        (item) => item.textContent,
      ),
    ).toEqual(["One", "Two"]);
  });

  it("toggles a paragraph into a list without changing its sibling heading", () => {
    const el = mount(
      '<div id="t"><h2>Title</h2><p style="color: red; font-size: 30px">Body</p></div>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Body"), 2);

    expect(session.commands.toggleList("bullet")).toBe(true);

    expect(session.element.querySelector(":scope > h2")?.textContent).toBe(
      "Title",
    );
    expect(session.element.querySelector(":scope > ul > li")?.textContent).toBe(
      "Body",
    );
    expect(session.element.querySelectorAll("li > li")).toHaveLength(0);
    expect(session.element.querySelector("li")?.style.color).toBe("red");
    expect(session.element.querySelector("li")?.style.fontSize).toBe("30px");
  });

  it("turns off one nested list item without unwrapping its styled sibling", () => {
    const el = mount(
      '<ul id="t"><li>Parent<ul><li style="color: red">A</li><li>B</li></ul></li></ul>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "B"), 1);

    expect(session.commands.applyAuthoringCommand("bulletList")).toBe(true);

    expect(el.querySelector("li > ul > li")?.textContent).toBe("A");
    expect(el.querySelector("li > ul > li")?.getAttribute("style")).toBe(
      "color: red",
    );
    expect(el.querySelector("li > p")?.textContent).toBe("B");
  });

  it("keeps paragraph typography and geometry when a bullet shortcut converts it", () => {
    const el = mount(
      '<div id="t"><p style="color:red;font-size:30px;line-height:1.4;margin:12px 0">Body</p><p>After</p></div>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Body"), 0);

    type(el, "- ");

    const converted = session.element.firstElementChild as HTMLElement;
    expect(converted.style.color).toBe("red");
    expect(converted.style.fontSize).toBe("30px");
    expect(converted.style.lineHeight).toBe("1.4");
    expect(converted.style.marginTop).toBe("12px");
    expect(session.element.lastElementChild?.textContent).toBe("After");
  });

  it("keeps a root paragraph stylesheet look when an ordered shortcut converts it", () => {
    const style = document.createElement("style");
    style.textContent =
      ".slide-content p { color: rgb(102, 112, 133); font-size: 20px; line-height: 1.625; margin-bottom: 16px; }";
    document.head.append(style);
    const el = mount('<p id="t">Ship the beta</p><p>Next</p>');
    const originalLook = window.getComputedStyle(el);
    expect(originalLook.fontSize).toBe("20px");
    expect(originalLook.marginBottom).toBe("16px");
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Ship"), 0);

    type(el, "1. ");

    const root = session.element;
    const item = root.querySelector("ol > li") as HTMLElement;
    expect(root.tagName).toBe("DIV");
    expect(root.style.color).toBe("rgb(102, 112, 133)");
    expect(root.style.fontSize).toBe("20px");
    expect(root.style.lineHeight).toBe("1.625");
    expect(root.style.marginBottom).toBe("16px");
    expect(window.getComputedStyle(item).fontSize).toBe("20px");
    expect(
      document.querySelector(".fmd-slide > p:last-child")?.textContent,
    ).toBe("Next");
    expect(
      window.getComputedStyle(
        document.querySelector(".fmd-slide > p:last-child")!,
      ).fontSize,
    ).toBe("20px");
    style.remove();
  });

  it("applies toolbar headings to selected text in a hard-break root", () => {
    const el = mount('<p id="t">Quarterly review<br>Next steps</p>');
    session = startInPlaceTextSession(el);
    select(textOf(el, "Next steps"), 0, textOf(el, "Next steps"), 4);

    expect(session.commands.applyAuthoringCommand("heading1")).toBe(true);

    expect(session.element.querySelector(":scope > p")?.textContent).toBe(
      "Quarterly review",
    );
    expect(session.element.querySelector(":scope > h1")?.textContent).toBe(
      "Next steps",
    );
  });

  it("formats selected root text and child blocks as siblings", () => {
    const el = mount('<div id="t">Intro<hr><p>Body</p></div>');
    session = startInPlaceTextSession(el);
    select(textOf(el, "Intro"), 0, textOf(el, "Body"), 4);

    expect(session.commands.applyAuthoringCommand("heading1")).toBe(true);

    expect(session.element.querySelectorAll(":scope > h1")).toHaveLength(2);
    expect(session.element.querySelector("h1 > h1")).toBeNull();
    expect(session.element.querySelector(":scope > h1")?.textContent).toBe(
      "Intro",
    );
  });

  it("keeps a divider on a root heading and strips split-run identities", () => {
    const el = mount(
      '<h1 id="t"><span id="run" data-slide-element-id="s1">Title /tail</span></h1>',
    );
    session = startInPlaceTextSession(el);
    const source = textOf(el, "Title /tail");
    const slash = document.createRange();
    slash.setStart(source, 6);
    slash.setEnd(source, 7);
    caret(source, 7);

    expect(session.commands.applyAuthoringCommand("divider", slash)).toBe(true);

    expect(session.element.querySelector(":scope > h1")?.textContent).toBe(
      "Title ",
    );
    expect(session.element.querySelector("p ul")).toBeNull();
    expect(session.element.querySelectorAll("#run")).toHaveLength(0);
    expect(
      session.element.querySelectorAll('[data-slide-element-id="s1"]'),
    ).toHaveLength(0);
  });

  it("keeps slash commands scoped to one styled legacy bullet row", () => {
    const row = (text: string) =>
      `<div style="display:flex;gap:12px;font-size:28px"><span>●</span><span>${text}</span></div>`;
    const el = mount(
      `<div id="t">${row("One")}${row("Two/")}${row("Three")}</div>`,
    );
    session = startInPlaceTextSession(el);
    const source = textOf(el, "Two/");
    const slash = document.createRange();
    slash.setStart(source, 3);
    slash.setEnd(source, 4);
    caret(source, 4);

    expect(session.commands.applyAuthoringCommand("bulletList", slash)).toBe(
      true,
    );

    expect((session.element.textContent?.match(/●/g) ?? []).length).toBe(2);
  });

  it("toggles a paragraph into a list without changing its sibling heading", () => {
    const el = mount(
      '<div id="t"><h2>Title</h2><p style="color: red; font-size: 30px">Body</p></div>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Body"), 2);

    expect(session.commands.toggleList("bullet")).toBe(true);

    expect(session.element.querySelector(":scope > h2")?.textContent).toBe(
      "Title",
    );
    expect(session.element.querySelector(":scope > ul > li")?.textContent).toBe(
      "Body",
    );
    expect(session.element.querySelectorAll("li > li")).toHaveLength(0);
    expect(session.element.querySelector("li")?.style.color).toBe("red");
    expect(session.element.querySelector("li")?.style.fontSize).toBe("30px");
  });

  it("keeps paragraph typography when a markdown bullet shortcut converts it", () => {
    const el = mount(
      '<p id="t" style="color:red;font-size:30px;line-height:1.4;margin:12px 0">Body</p>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Body"), 0);

    type(el, "- ");

    expect(session.element.style.color).toBe("red");
    expect(session.element.style.fontSize).toBe("30px");
    expect(session.element.style.lineHeight).toBe("1.4");
    expect(session.element.style.marginTop).toBe("12px");
  });

  it("splits a styled root ordered list without copying its layout onto slices", () => {
    const el = mount(
      '<ol id="t" class="pl-8 absolute left-10" start="42" style="position:absolute;font-size:28px;margin:12px 0;list-style-type:lower-alpha"><li>One</li><li>Two</li><li>Three</li></ol>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Two"), 0);

    type(el, "- ");

    const root = session.element;
    expect(root.tagName).toBe("DIV");
    expect(root.className).toBe("pl-8 absolute left-10");
    expect(root.style.position).toBe("absolute");
    expect(root.style.fontSize).toBe("28px");
    expect(root.style.marginTop).toBe("12px");
    expect(root.style.listStyleType).toBe("");
    expect(root.getAttribute("start")).toBeNull();
    expect(root.querySelectorAll(":scope > li")).toHaveLength(0);
    const lists = Array.from(root.children) as HTMLElement[];
    expect(lists.map((list) => list.tagName)).toEqual(["OL", "UL", "OL"]);
    expect(lists[0]?.getAttribute("start")).toBe("42");
    expect(lists[2]?.getAttribute("start")).toBe("44");
    expect(lists[1]?.querySelector(":scope > li")?.textContent).toBe("Two");
    for (const list of lists) {
      expect(list.className).toBe("");
      expect(list.style.position).toBe("");
      expect(list.style.fontSize).toBe("");
      expect(list.style.margin).toBe("0px");
      expect(list.querySelector("li > li")).toBeNull();
    }
  });

  it("applies toolbar headings to selected text in a hard-break root", () => {
    const el = mount('<p id="t">Quarterly review<br>Next steps</p>');
    session = startInPlaceTextSession(el);
    select(textOf(el, "Next steps"), 0, textOf(el, "Next steps"), 4);

    expect(session.commands.applyAuthoringCommand("heading1")).toBe(true);

    expect(session.element.querySelector(":scope > p")?.textContent).toBe(
      "Quarterly review",
    );
    expect(session.element.querySelector(":scope > h1")?.textContent).toBe(
      "Next steps",
    );
  });

  it("changes one heading hard-break line to a paragraph without restyling neighbors", () => {
    const el = mount(
      '<h1 id="t" style="margin-bottom:24px;font-size:48px">One<br>Two<br>Three</h1>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Two"), 1);

    expect(session.commands.applyAuthoringCommand("paragraph")).toBe(true);

    const root = session.element;
    const lines = Array.from(root.children) as HTMLElement[];
    expect(root.tagName).toBe("DIV");
    expect(root.style.marginBottom).toBe("24px");
    expect(lines.map((line) => line.tagName)).toEqual(["H1", "P", "H1"]);
    expect(lines.map((line) => line.textContent)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
    expect(lines[0]?.style.margin).toBe("0px");
    expect(lines[2]?.style.margin).toBe("0px");
    expect(lines[0]?.style.fontSize).toBe("48px");
    expect(lines[2]?.style.fontSize).toBe("48px");
    expect(lines[1]?.style.fontSize).toBe("");
  });

  it("does not copy computed typography onto hard-break lines", () => {
    document.body.innerHTML = `<style>.fmd-slide h1 { color: rgb(20, 30, 40); font-size: 48px }</style><div class="slide-content"><div class="fmd-slide"><h1 id="t">One<br>Two<br>Three</h1></div></div>`;
    const el = document.querySelector<HTMLElement>("#t")!;
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Two"), 1);

    expect(session.commands.applyAuthoringCommand("paragraph")).toBe(true);

    const lines = Array.from(session.element.children) as HTMLElement[];
    expect(lines[0]?.style.color).toBe("");
    expect(lines[0]?.style.fontSize).toBe("");
    expect(lines[2]?.style.color).toBe("");
    expect(lines[2]?.style.fontSize).toBe("");
    expect(getComputedStyle(lines[0]!).fontSize).toBe("48px");
    expect(getComputedStyle(lines[2]!).fontSize).toBe("48px");
  });

  it("keeps root list layout on the wrapper when an empty item exits", () => {
    const el = mount(
      '<ol id="t" class="absolute left-10" start="42" style="position:absolute;font-size:28px;padding-left:2em;list-style-type:lower-alpha"><li>One</li><li>Two</li><li>Three</li></ol>',
    );
    session = startInPlaceTextSession(el);
    const two = textOf(el, "Two");
    select(two, 0, two, two.length);
    beforeInput(el, "deleteContentForward");
    beforeInput(el, "insertParagraph");

    const root = session.element;
    const lists = Array.from(root.children).filter(
      (child): child is HTMLElement => child.tagName === "OL",
    );
    expect(root.tagName).toBe("DIV");
    expect(root.className).toBe("absolute left-10");
    expect(root.style.position).toBe("absolute");
    expect(root.style.paddingLeft).toBe("");
    expect(root.style.listStyleType).toBe("");
    expect(lists).toHaveLength(2);
    for (const list of lists) {
      expect(list.className).toBe("");
      expect(list.style.position).toBe("");
      expect(list.style.fontSize).toBe("");
      expect(list.style.paddingLeft).toBe("2em");
      expect(list.style.listStyleType).toBe("lower-alpha");
    }
  });

  it.each([
    ["- ", "bullet"],
    ["* ", "bullet"],
    ["+ ", "bullet"],
    ["1. ", "ordered"],
    ["# ", "H1"],
    ["## ", "H2"],
    ["### ", "H3"],
    ["#### ", "H4"],
    ["> ", "BLOCKQUOTE"],
    ["--- ", "HR"],
    ["**bold**", "bold"],
    ["__bold__", "bold"],
    ["*italic*", "italic"],
    ["_italic_", "italic"],
    ["~~strike~~", "strike"],
    ["`code`", "code"],
  ])("applies %j after Enter", (shortcut, result) => {
    const el = mount('<div id="t">Before</div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Before"), 6);
    beforeInput(el, "insertParagraph");

    type(session.element, shortcut);
    if (!["bold", "italic", "strike", "code"].includes(result)) {
      type(session.element, "Tail");
    }

    const root = session.element;
    if (result === "bullet") {
      expect(root.textContent).toContain("●Tail");
    } else if (result === "ordered") {
      expect(
        root.querySelector("ol > li")?.textContent?.replaceAll(ZWSP, ""),
      ).toBe("Tail");
    } else if (result === "bold") {
      expect(
        root.querySelector('span[style*="font-weight"]')?.textContent,
      ).toBe("bold");
    } else if (result === "italic") {
      expect(root.querySelector('span[style*="font-style"]')?.textContent).toBe(
        "italic",
      );
    } else if (result === "strike") {
      expect(
        root.querySelector('span[style*="text-decoration"]')?.textContent,
      ).toBe("strike");
    } else if (result === "code") {
      expect(root.querySelector("code")?.textContent).toBe("code");
    } else if (result === "HR") {
      expect(root.querySelector("hr")).not.toBeNull();
    } else {
      expect(
        root.querySelector(result)?.textContent?.replaceAll(ZWSP, ""),
      ).toBe("Tail");
    }
  });

  it("recognizes Chrome's trailing nonbreaking space after Enter", () => {
    const el = mount('<div id="t">Alpha<br>-&nbsp;</div>');
    session = startInPlaceTextSession(el);
    const tail = textOf(el, "-\u00a0");
    caret(tail, tail.length);
    el.dispatchEvent(
      new InputEvent("input", {
        inputType: "insertText",
        data: " ",
        bubbles: true,
      }),
    );

    expect(
      Array.from(session.element.querySelectorAll("span")).some(
        (span) => span.textContent === "●",
      ),
    ).toBe(true);
  });

  it("creates a plain paragraph when Enter is pressed at a heading end", () => {
    const el = mount('<div id="t"><h2>Title</h2><p>Body</p></div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Title"), 5);

    beforeInput(el, "insertParagraph");

    expect(
      Array.from(session.element.children, (child) => child.tagName),
    ).toEqual(["H2", "P", "P"]);
    expect(session.element.children[1].textContent).toBe(ZWSP);
    expect(session.element.children[2].textContent).toBe("Body");
  });

  it("exits an empty quote on Enter and inserts a soft break for Shift+Enter", () => {
    const el = mount('<div id="t"><blockquote><p><br></p></blockquote></div>');
    session = startInPlaceTextSession(el);
    caret(el.querySelector("blockquote p")!, 0);

    beforeInput(el, "insertParagraph");

    expect(session.element.querySelector("blockquote")).toBeNull();
    expect(session.element.querySelector(":scope > p")?.textContent).toBe(ZWSP);

    const line = mount('<p id="t">one two</p>');
    session?.end();
    session = startInPlaceTextSession(line);
    caret(textOf(line, "one two"), 3);
    beforeInput(line, "insertLineBreak");
    expect(line.innerHTML).toBe("one<br> two");
  });

  it("exits a quote after Enter creates an empty line", () => {
    const el = mount('<blockquote id="t"><p>Quoted</p></blockquote>');
    session = startInPlaceTextSession(el);
    const quoted = textOf(el, "Quoted");
    caret(quoted, quoted.length);

    beforeInput(el, "insertParagraph");
    beforeInput(el, "insertParagraph");
    type(session.element, "after");

    expect(session.element.tagName).toBe("DIV");
    expect(session.element.innerHTML).toBe(
      "<blockquote><p>Quoted</p></blockquote><p>after</p>",
    );
  });

  it("demotes heading and quote blocks before merging within the edit root", () => {
    const heading = mount('<div id="t"><p>Above</p><h2>Title</h2></div>');
    session = startInPlaceTextSession(heading);
    caret(textOf(heading, "Title"), 0);
    beforeInput(heading, "deleteContentBackward");
    expect(heading.children[1].tagName).toBe("P");
    beforeInput(heading, "deleteContentBackward");
    expect(heading.children).toHaveLength(1);
    expect(heading.firstElementChild?.textContent).toBe("AboveTitle");
    session.end();

    const quote = mount(
      '<div id="t"><p>Above</p><blockquote><p>Quoted</p></blockquote></div>',
    );
    session = startInPlaceTextSession(quote);
    caret(textOf(quote, "Quoted"), 0);
    beforeInput(quote, "deleteContentBackward");
    expect(quote.querySelector("blockquote")).toBeNull();
    expect(quote.children[1].tagName).toBe("P");
    beforeInput(quote, "deleteContentBackward");
    expect(quote.children).toHaveLength(1);
    expect(quote.firstElementChild?.textContent).toBe("AboveQuoted");
  });

  it("restores a root div when Backspace demotes a Markdown heading", () => {
    const el = mount('<div id="t">Alpha</div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Alpha"), 0);

    type(el, "## ");
    expect(session.element.tagName).toBe("H2");
    beforeInput(session.element, "deleteContentBackward");

    expect(session.element.tagName).toBe("DIV");
    expect(session.element.textContent).toBe("Alpha");
  });

  it("demotes a root quote without escaping the edited element", () => {
    const el = mount(
      '<p>Outside</p><blockquote id="t"><p>Quoted</p></blockquote>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Quoted"), 0);

    beforeInput(session.element, "deleteContentBackward");

    expect(session.element.tagName).toBe("DIV");
    expect(session.element.querySelector("blockquote")).toBeNull();
    beforeInput(session.element, "deleteContentBackward");

    expect(session.element.firstElementChild?.textContent).toBe("Quoted");
    expect(document.querySelector(".fmd-slide > p")?.textContent).toBe(
      "Outside",
    );
  });

  it("does not save an empty quote wrapper after Backspace at its paragraph start", () => {
    const el = mount(
      '<div id="t"><p>Intro</p><blockquote><p>Quoted</p></blockquote><p>Tail</p></div>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Quoted"), 0);

    beforeInput(session.element, "deleteContentBackward");
    session.end();

    expect(el.querySelector("blockquote")).toBeNull();
    expect(el.children[0]?.textContent).toBe("Intro");
    expect(el.children[1]?.textContent).toBe("Quoted");
    expect(el.children[2]?.textContent).toBe("Tail");
  });

  it("keeps a standalone heading Backspace merge inside its edit root", () => {
    mount('<p>outside</p><h2 id="t">Title</h2>');
    const root = document.getElementById("t")!;
    session = startInPlaceTextSession(root);
    caret(textOf(root, "Title"), 0);

    beforeInput(session.element, "deleteContentBackward");
    expect(session.element.tagName).toBe("P");
    expect(session.element.textContent).toBe("Title");
    beforeInput(session.element, "deleteContentBackward");

    expect(document.querySelector("p")?.textContent).toBe("outside");
    expect(session.element.textContent).toBe("Title");
  });

  it.each([
    ["paragraph", "<h2", "P"],
    ["heading1", "<p", "H1"],
    ["heading2", "<p", "H2"],
    ["heading3", "<p", "H3"],
    ["bulletList", "<div", "UL"],
    ["orderedList", "<div", "OL"],
    ["quote", "<p", "BLOCKQUOTE"],
    ["divider", "<div", "HR"],
  ] as const)(
    "applies the %s slash command and keeps it undoable",
    (kind, tag, result) => {
      const el = mount(`${tag} id="t">/Alpha</${tag.slice(1)}`);
      session = startInPlaceTextSession(el);
      const slashText = textOf(el, "/Alpha");
      const slash = document.createRange();
      slash.setStart(slashText, 0);
      slash.setEnd(slashText, 1);
      caret(slashText, 1);
      const before = session.element.outerHTML;

      expect(session.commands.applyAuthoringCommand(kind, slash)).toBe(true);
      const hasResult =
        result === "HR"
          ? !!session.element.querySelector("hr")
          : result === "UL"
            ? !!session.element.querySelector("ul") ||
              session.element.tagName === "UL"
            : result === "OL"
              ? !!session.element.querySelector("ol") ||
                session.element.tagName === "OL"
              : session.element.tagName === result;
      expect(hasResult).toBe(true);
      expect(session.undo()).toBe(true);
      expect(session.element.outerHTML).toBe(before);
      expect(session.redo()).toBe(true);
      expect(
        result === "HR"
          ? session.element.querySelector("hr")
          : session.element.tagName === result ||
              !!session.element.querySelector(result.toLowerCase()),
      ).toBeTruthy();
    },
  );

  it("restores slash input as literal text when the command is undone", () => {
    const el = mount('<p id="t">/heading 2</p>');
    session = startInPlaceTextSession(el);
    const text = el.firstChild as Text;
    const slash = document.createRange();
    slash.setStart(text, 0);
    slash.setEnd(text, text.length);
    caret(text, text.length);

    expect(session.commands.applyAuthoringCommand("heading2", slash)).toBe(
      true,
    );
    expect(session.undo()).toBe(true);
    expect(session.element.textContent).toBe("/heading 2");
  });

  it("converts every block in a mixed selection to Text", () => {
    const el = mount(
      '<div id="t"><p>First block</p><h2>Second block</h2></div>',
    );
    session = startInPlaceTextSession(el);
    select(textOf(el, "First block"), 0, textOf(el, "Second block"), 12);

    expect(session.commands.applyAuthoringCommand("paragraph")).toBe(true);

    expect(el.innerHTML).toBe("<p>First block</p><p>Second block</p>");
  });

  it("applies one heading to every block in a mixed selection", () => {
    const el = mount(
      '<div id="t"><p>First block</p><h1>Second block</h1></div>',
    );
    session = startInPlaceTextSession(el);
    select(textOf(el, "First block"), 0, textOf(el, "Second block"), 12);

    expect(session.commands.applyAuthoringCommand("heading2")).toBe(true);

    expect(el.innerHTML).toBe("<h2>First block</h2><h2>Second block</h2>");
  });

  it("exits an empty nested slide bullet row into a plain line", () => {
    const row = (text: string) =>
      `<div style="display: flex"><span>●</span><span>${text}</span></div>`;
    const el = mount(`<div id="t">${row("One")}${row("")}</div>`);
    session = startInPlaceTextSession(el);
    caret(el.children[1].lastElementChild!, 0);

    beforeInput(el, "insertParagraph");
    type(session.element, "Plain");

    expect(session.element.querySelectorAll("span")).toHaveLength(2);
    expect(session.element.lastElementChild?.textContent).toBe("Plain");
  });

  it("demotes a real list item before joining it on a second Backspace", () => {
    const el = mount('<ul id="t"><li><p>One</p></li><li><p>Two</p></li></ul>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Two"), 0);

    beforeInput(session.element, "deleteContentBackward");

    expect(session.element.querySelectorAll("li")).toHaveLength(1);
    expect(session.element.querySelector(":scope > p")?.textContent).toBe(
      "Two",
    );
    beforeInput(session.element, "deleteContentBackward");

    expect(session.element.querySelectorAll("li")).toHaveLength(1);
    expect(session.element.querySelector("li")?.innerHTML).toBe(
      "<p>OneTwo</p>",
    );
  });

  it("joins paragraph list items after Enter, Tab, and Shift+Tab", () => {
    const el = mount('<ul id="t"><li><p>Alpha</p></li></ul>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Alpha"), 5);
    beforeInput(el, "insertParagraph");
    expect(el.children[1].querySelector("p")).toBeNull();
    type(el, "Beta");
    key(el, { key: "Tab" });
    key(el, { key: "Tab", shiftKey: true });
    caret(textOf(el, "Beta"), 0);

    const backspace = beforeInput(el, "deleteContentBackward");

    expect(backspace.defaultPrevented).toBe(true);
    expect(session.element.querySelector(":scope > p")?.textContent).toBe(
      "Beta",
    );
    beforeInput(session.element, "deleteContentBackward");
    expect(session.element.querySelectorAll("li")).toHaveLength(1);
    expect(session.element.querySelector("li")?.innerHTML).toBe(
      "<p>AlphaBeta</p>",
    );
  });

  it("toggles a paragraph-backed list item without nesting a list in its paragraph", () => {
    const el = mount('<ul id="t"><li><p>Alpha</p></li></ul>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Alpha"), 2);

    expect(session.commands.applyAuthoringCommand("bulletList")).toBe(true);

    expect(session.element.tagName).toBe("DIV");
    expect(session.element.querySelector("ul")).toBeNull();
    expect(session.element.querySelector("p ul, p ol")).toBeNull();
    expect(session.element.textContent).toContain("Alpha");
  });

  it("converts a paragraph-backed bullet list to an ordered list", () => {
    const el = mount(
      '<ul id="t"><li><p>Alpha</p></li><li><p>Beta</p></li></ul>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Alpha"), 2);

    expect(session.commands.applyAuthoringCommand("orderedList")).toBe(true);

    expect(session.element.tagName).toBe("OL");
    expect(session.element.querySelectorAll("ol > li > p")).toHaveLength(2);
    expect(session.element.querySelector("p ul, p ol")).toBeNull();
  });

  it("keeps a markdown bullet shortcut in a paragraph-backed list item valid", () => {
    const el = mount('<ul id="t"><li><p>Alpha</p></li></ul>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Alpha"), 0);

    type(el, "- ");

    expect(session.element.innerHTML).toBe("<li><p>Alpha</p></li>");
    expect(session.element.querySelector("p ul, p ol, p div")).toBeNull();
  });

  it("changes only the targeted ordered item to bullets for a '- ' shortcut", () => {
    const el = mount(
      '<ol id="t"><li><p>Alpha</p></li><li><p>Beta</p></li></ol>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Alpha"), 0);

    type(el, "- ");

    expect(session.element.tagName).toBe("DIV");
    expect(
      session.element.querySelector(":scope > ul > li > p")?.textContent,
    ).toBe("Alpha");
    expect(
      session.element.querySelector(":scope > ol")?.getAttribute("start"),
    ).toBe("2");
    expect(
      session.element.querySelector(":scope > ol > li > p")?.textContent,
    ).toBe("Beta");
    expect(session.element.querySelector("p ul, p ol, p div")).toBeNull();
    expect(session.undo()).toBe(true);
    expect(session.element.outerHTML).toBe(
      '<ol id="t" contenteditable="true" data-editing-block="true"><li><p>- Alpha</p></li><li><p>Beta</p></li></ol>',
    );
    expect(session.redo()).toBe(true);
  });

  it("keeps an ordered shortcut local to the current item in an existing list", () => {
    const el = mount(
      '<ol id="t"><li>First</li><li>Second</li><li>Third</li></ol>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Second"), 0);

    type(el, "42. ");

    expect(el.querySelectorAll(":scope > li")).toHaveLength(3);
    expect(el.querySelectorAll("ol ol, ul ol, ol ul, ul ul")).toHaveLength(0);
    expect(el.children[1].getAttribute("value")).toBe("42");
    expect(el.children[0].textContent).toBe("First");
    expect(el.children[2].textContent).toBe("Third");
  });

  it("keeps a root OL intact when `2. ` is typed in its middle item", () => {
    const el = mount('<ol id="t"><li>One</li><li>Two</li><li>Three</li></ol>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Two"), 0);

    type(el, "2. ");

    expect(session.element.tagName).toBe("OL");
    expect(session.element.querySelectorAll(":scope > li")).toHaveLength(3);
    expect(session.element.children[1]?.getAttribute("value")).toBe("2");
    expect(
      Array.from(session.element.children, (item) => item.textContent),
    ).toEqual(["One", "Two", "Three"]);
  });

  it("keeps a styled OL intact when `2. ` is typed at an item start", () => {
    const el = mount(
      '<div id="t"><ol style="padding-left:1.2em"><li>One</li><li>Two</li><li>Three</li></ol></div>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Two"), 0);

    type(el, "2. ");

    const list = session.element.querySelector(
      ":scope > ol",
    ) as HTMLOListElement;
    expect(list).not.toBeNull();
    expect(list.style.paddingLeft).toBe("1.2em");
    expect(Array.from(list.children, (item) => item.textContent)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
    expect(list.children[1].getAttribute("value")).toBe("2");
  });

  it("converts only the middle OL item when its line starts with a bullet prefix", () => {
    const el = mount(
      '<div id="t"><ol style="padding-left:1.2em"><li>One</li><li>Two</li><li>Three</li></ol></div>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Two"), 0);

    type(el, "- ");

    expect(
      Array.from(session.element.children, (child) => child.tagName),
    ).toEqual(["OL", "UL", "OL"]);
    expect(
      (session.element.children[0] as HTMLOListElement).style.paddingLeft,
    ).toBe("1.2em");
    expect(
      (session.element.children[2] as HTMLOListElement).style.paddingLeft,
    ).toBe("1.2em");
    expect(session.element.children[0]?.textContent).toBe("One");
    expect(session.element.children[1]?.textContent).toBe("Two");
    expect(session.element.children[2]?.textContent).toBe("Three");
  });

  it("splits a root OL around the middle item for a `- ` shortcut", () => {
    const el = mount(
      '<ol id="t" style="padding-left:1.2em;list-style-position:inside"><li>One</li><li>Two</li><li>Three</li></ol>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Two"), 0);

    type(el, "- ");

    expect(session.element.tagName).toBe("DIV");
    expect(
      Array.from(session.element.children, (list) => list.tagName),
    ).toEqual(["OL", "UL", "OL"]);
    expect(
      Array.from(
        session.element.children,
        (list) => (list as HTMLElement).style.paddingLeft,
      ),
    ).toEqual(["1.2em", "1.2em", "1.2em"]);
    expect(
      Array.from(
        session.element.children,
        (list) => (list as HTMLElement).style.listStylePosition,
      ),
    ).toEqual(["inside", "inside", "inside"]);
    expect(
      (session.element.children[1] as HTMLOListElement).style.listStyleType,
    ).toBe("disc");
    expect(
      Array.from(session.element.children, (list) => list.textContent),
    ).toEqual(["One", "Two", "Three"]);
    expect(
      session.element.querySelector("ol ul, ul ol, ol ol, ul ul"),
    ).toBeNull();
  });

  it("keeps an OL when a number prefix is typed after a soft break", () => {
    const el = mount(
      '<div id="t"><ol style="padding-left:1.2em"><li>One</li><li>Two<br>more</li><li>Three</li></ol></div>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "more"), 0);

    type(el, "1. ");

    const list = session.element.querySelector(":scope > ol");
    expect(list).not.toBeNull();
    expect((list as HTMLOListElement).style.paddingLeft).toBe("1.2em");
    expect(
      Array.from(
        list?.querySelectorAll(":scope > li") ?? [],
        (item) => item.textContent,
      ),
    ).toEqual(["One", "Two", "more", "Three"]);
    expect(list?.textContent).toContain("Twomore");
    expect(list?.textContent).not.toContain("1. ");
  });

  it("converts only the soft-break line to an ordered list from a UL item", () => {
    const el = mount(
      '<ul id="t"><li>One</li><li>Two<br>more</li><li>Three</li></ul>',
    );
    session = startInPlaceTextSession(el);
    caret(textOf(el, "more"), 0);

    type(el, "1. ");

    expect(session.element.tagName).toBe("DIV");
    expect(
      Array.from(session.element.children, (child) => child.tagName),
    ).toEqual(["UL", "OL", "UL"]);
    expect(session.element.children[0]?.textContent).toBe("OneTwo");
    expect(session.element.children[1]?.textContent).toBe("more");
    expect(session.element.children[2]?.textContent).toBe("Three");
    expect(session.element.textContent).not.toContain("1. ");
  });

  it("scopes the list keyboard shortcut to the caret block", () => {
    const el = mount('<div id="t"><h2>Title</h2><p>Body</p></div>');
    session = startInPlaceTextSession(el);
    caret(textOf(el, "Body"), 2);

    const event = key(el, {
      key: "8",
      code: "Digit8",
      metaKey: true,
      shiftKey: true,
    });

    expect(event.defaultPrevented).toBe(true);
    expect(session.element.querySelector(":scope > h2")?.textContent).toBe(
      "Title",
    );
    expect(session.element.querySelector(":scope > ul > li")?.textContent).toBe(
      "Body",
    );
    expect(session.element.querySelector("li li")).toBeNull();
  });
});
