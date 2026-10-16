/**
 * Shared happy-dom helpers for the in-place text session's behavior suites.
 * Mirrors what a browser does around the session: a key goes down, and when
 * the session does not take it the matching `beforeinput` follows.
 */

import { vi } from "vitest";

export { ZERO_WIDTH_SPACE as ZWSP } from "./bullet-editing";

const MAC = /Mac|iPhone|iPad/;

export function textNodes(root: Node): Text[] {
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
 * Call from `beforeAll`.
 */
export function installSelectionModify() {
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
}

/** Mounts `html` the way a slide holds it; returns the element matching `selector`. */
export function mount(html: string, selector = "#t") {
  document.body.innerHTML = `<div class="slide-content"><div class="fmd-slide">${html}</div></div>`;
  return document.querySelector<HTMLElement>(selector)!;
}

export function caret(node: Node, offset: number) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

export function select(
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

export function textOf(element: Element, text: string): Text {
  const found = textNodes(element).find((node) => node.data.includes(text));
  if (!found) throw new Error(`no text node with ${text}`);
  return found;
}

/** Caret at `offset` into the first text node of `element` containing `text`. */
export function caretIn(element: Element, text: string, offset: number) {
  caret(textOf(element, text), offset);
}

export function beforeInput(
  target: Element,
  inputType: string,
  init: object = {},
) {
  const event = new InputEvent("beforeinput", {
    inputType,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

/** Types like a browser: the session may take the input, or let it through. */
export function type(target: Element, text: string) {
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

export function keydown(target: Element, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

export function paste(target: Element, data: Record<string, string>) {
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

const KEY_INPUT: Record<string, string> = {
  Enter: "insertParagraph",
  "Shift+Enter": "insertLineBreak",
  Backspace: "deleteContentBackward",
  Delete: "deleteContentForward",
  "Alt+Backspace": "deleteWordBackward",
  "Alt+Delete": "deleteWordForward",
  "Meta+Backspace": "deleteSoftLineBackward",
};

/**
 * One chord ("Enter", "Shift+Tab", "Meta+b", "Alt+Backspace"): keydown first,
 * then the default `beforeinput` for editing keys the session did not take.
 * An input the session lets through is applied natively (one character or the
 * selected range), which is what the browser would do.
 */
export function press(target: Element, chord: string) {
  const parts = chord.split("+");
  const name = parts.pop()!;
  const init: KeyboardEventInit = {
    key: name.length === 1 ? name.toLowerCase() : name,
    code: name.length === 1 ? `Key${name.toUpperCase()}` : name,
    shiftKey: parts.includes("Shift"),
    metaKey: parts.includes("Meta"),
    ctrlKey: parts.includes("Control"),
    altKey: parts.includes("Alt"),
  };
  const down = keydown(target, init);
  if (down.defaultPrevented) return down;
  const inputType = KEY_INPUT[chord];
  if (!inputType) return down;
  const input = beforeInput(target, inputType);
  if (input.defaultPrevented) return input;
  const range = window.getSelection()!.getRangeAt(0);
  if (!range.collapsed) {
    range.deleteContents();
    caret(range.startContainer, range.startOffset);
  } else if (inputType === "deleteContentBackward") {
    const node = range.startContainer as Text;
    if (node.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
      node.deleteData(range.startOffset - 1, 1);
      caret(node, range.startOffset - 1);
    }
  } else if (inputType === "deleteContentForward") {
    const node = range.startContainer as Text;
    if (node.nodeType === Node.TEXT_NODE && range.startOffset < node.length) {
      node.deleteData(range.startOffset, 1);
    }
  }
  target.dispatchEvent(new InputEvent("input", { inputType, bubbles: true }));
  return input;
}

/** True on Mac-like platforms: the session reads navigator.platform. */
export function isMacPlatform() {
  return MAC.test(navigator.platform);
}

/**
 * The element's markup with the selection printed inline (`|` collapsed,
 * `[ ]` range) and zero-width placeholders removed, for readable assertions.
 */
export function show(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  const selection = window.getSelection();
  const range =
    selection && selection.rangeCount ? selection.getRangeAt(0) : null;
  const mirror = (node: Node): Node | null => {
    const path: number[] = [];
    for (let at: Node | null = node; at && at !== root; at = at.parentNode) {
      path.unshift(Array.prototype.indexOf.call(at.parentNode!.childNodes, at));
      if (!at.parentNode) return null;
    }
    let found: Node = clone;
    for (const index of path) found = found.childNodes[index];
    return found ?? null;
  };
  const mark = (node: Node, offset: number, marker: string) => {
    const target = mirror(node);
    if (!target) return;
    if (target.nodeType === Node.TEXT_NODE) {
      (target as Text).insertData(offset, marker);
    } else {
      target.insertBefore(
        document.createTextNode(marker),
        target.childNodes[offset] ?? null,
      );
    }
  };
  if (
    range &&
    root.contains(range.startContainer) &&
    root.contains(range.endContainer)
  ) {
    if (range.collapsed) mark(range.startContainer, range.startOffset, "|");
    else {
      mark(range.endContainer, range.endOffset, "]");
      mark(range.startContainer, range.startOffset, "[");
    }
  }
  return clone.innerHTML.replaceAll("​", "");
}

export function restoreGlobals() {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}
