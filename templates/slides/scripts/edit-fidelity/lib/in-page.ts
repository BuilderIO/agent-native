/// <reference lib="dom" />
/**
 * Code that runs inside the Slides editor page. `installInPageHelpers` is
 * serialized by Playwright's addInitScript, so everything it uses must live
 * inside its body — it cannot close over module scope.
 */

/** Editor chrome that legitimately differs between view and edit. */
export const CHROME_SELECTOR = [
  "[data-slide-selection-chrome]",
  "[data-slide-selection-outline]",
  "[data-slide-resize-handle]",
  "[data-slide-resize-handle-bar]",
  "[data-slide-move-handle]",
  "[data-slide-rotate-handle]",
  "[data-slide-layer-hover-outline]",
  "[data-slide-container-outline]",
  "[data-slide-group-move-handle]",
  "[data-selection-overlay-left]",
  "[data-block-bubble-menu]",
].join(",");

export const MASK_CSS = `${CHROME_SELECTOR}{visibility:hidden!important}
*,*::before,*::after{caret-color:transparent!important;transition:none!important;animation:none!important}
::selection{background:transparent!important}`;

export const EDITOR_SELECTOR = ".slide-rich-editor-host .ProseMirror";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextTarget {
  index: number;
  tag: string;
  className: string;
  text: string;
  /** Which same-tag, same-text element this is, in document order. */
  occurrence: number;
  /** Viewport point on the first non-space glyph. */
  point: { x: number; y: number };
  /** Relative to the slide canvas. */
  rect: Rect;
  /** Viewport point is covered by something other than the target. */
  covered: boolean;
}

export interface SnapRecord {
  key: string;
  kind: "text" | "box";
  inside: boolean;
  props: Record<string, string>;
  rect: Rect;
}

export interface Inventory {
  elements: number;
  visible: number;
  hidden: number;
  svg: number;
  img: number;
  style: number;
}

export interface Snapshot {
  records: SnapRecord[];
  inventory: Inventory;
  text: string;
  editedRect: Rect | null;
  /** Rendered lines of the element the edit is matched to, in full. */
  editedText: string | null;
}

export interface EditorState {
  editing: boolean;
  focusInEditor: boolean;
  blocks: number;
  editorRect: Rect | null;
  sourceRect: Rect | null;
  /** Top of the edited element's content, which moves with anchored text. */
  contentTop: number | null;
  /** The caret's box, or null unless the selection is a caret in the edited element. */
  caretRect: Rect | null;
  /**
   * Position among the edited element's descendants of the block box holding
   * the caret, -1 for the element itself; null with no caret in it.
   */
  caretBlock: number | null;
  sourceTag: string | null;
  sourceText: string | null;
  sourceOccurrence: number;
  editorHtml: string;
  /** The editor's rendered lines, which the element shows once saved. */
  editorText: string;
}

export interface CanonicalPair {
  stored: string[];
  saved: string[];
  found: boolean;
}

export interface InPageHelpers {
  listTargets(canvasSel: string): TextTarget[];
  snapshot(
    canvasSel: string,
    edited: { targetIndex?: number; text?: string },
  ): Snapshot;
  editorState(canvasSel: string): EditorState;
  /** Why the selection entering edit left is not at the gesture's point, or null. */
  entryCaretProblem(
    point: { x: number; y: number },
    gesture: string,
  ): Promise<string | null>;
  backgroundPoint(canvasSel: string): { x: number; y: number } | null;
  canonical(html: string): string[];
  canonicalOutside(
    stored: string,
    saved: string,
    target: { tag: string; text: string; occurrence: number },
  ): CanonicalPair;
  /** Call stacks of content writes sent since the last call, oldest first. */
  takeWriteStacks(): string[];
  /** Keepalive content writes sent since the last call, in this tab. */
  takeKeepaliveWrites(): KeepaliveWrite[];
}

export interface KeepaliveWrite {
  action: string;
  /** The JSON body; null when it was not a string and could not be read. */
  body: string | null;
}

declare global {
  interface Window {
    __editFidelity: InPageHelpers;
  }
}

export function installInPageHelpers(chromeSelector: string) {
  const TEXT_PROPS = [
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "line-height",
    "letter-spacing",
    "word-spacing",
    "text-transform",
    "color",
    "-webkit-text-fill-color",
    "text-shadow",
    "text-decoration-line",
    "font-feature-settings",
    "font-variation-settings",
    "text-align",
    "white-space",
    "opacity",
    "visibility",
  ];
  const SIDES = ["top", "right", "bottom", "left"];
  const BOX_PROPS = [
    "display",
    "opacity",
    "visibility",
    ...SIDES.map((s) => `margin-${s}`),
    ...SIDES.map((s) => `padding-${s}`),
    ...SIDES.flatMap((s) => [
      `border-${s}-width`,
      `border-${s}-style`,
      `border-${s}-color`,
    ]),
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
    "background-color",
    "background-image",
    "box-shadow",
  ];
  const PAINTED_TAGS = new Set([
    "SVG",
    "IMG",
    "HR",
    "CANVAS",
    "VIDEO",
    "PICTURE",
    "IFRAME",
  ]);
  const INLINE_TAGS = new Set([
    "a",
    "abbr",
    "b",
    "br",
    "code",
    "em",
    "font",
    "i",
    "img",
    "mark",
    "s",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "u",
  ]);

  const norm = (s: string | null | undefined) =>
    (s ?? "").replace(/[\s\u200b\ufeff]+/g, " ").trim();
  const strip = (s: string | null | undefined) =>
    (s ?? "").replace(/[\s\u200b\ufeff]+/g, "");
  /**
   * The element's text, one line per <br> or block, placeholders and blank
   * lines dropped: textContent gives a <br> nothing, so it cannot tell a kept
   * break from a lost one, and innerText applies text-transform.
   */
  const lines = (el: Element) => {
    let out = "";
    const walk = (n: Node) => {
      // Source indentation is not a line break.
      if (n.nodeType === Node.TEXT_NODE)
        out += (n as Text).data.replace(/\s+/g, " ");
      else if (n.nodeName === "BR") out += "\n";
      else if (n instanceof Element && !/^(STYLE|SCRIPT)$/.test(n.tagName)) {
        const block =
          n !== el && !getComputedStyle(n).display.startsWith("inline");
        if (block) out += "\n";
        n.childNodes.forEach(walk);
        if (block) out += "\n";
      }
    };
    walk(el);
    return out
      .replace(/[\u200b\ufeff]/g, "")
      .split("\n")
      .map(norm)
      .filter(Boolean)
      .join("\n");
  };
  const rectOf = (r: DOMRect, origin: DOMRect): Rect => ({
    x: Math.round(r.left - origin.left),
    y: Math.round(r.top - origin.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  });
  const isChrome = (el: Element) => !!el.closest(chromeSelector);
  const directText = (el: Element) =>
    Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.nodeValue ?? "")
      .join("");
  const alpha = (color: string) => {
    if (!color || color === "transparent") return 0;
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return 1;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length > 3 ? Number(parts[3]) : 1;
  };
  const paints = (el: Element, cs: CSSStyleDeclaration) =>
    PAINTED_TAGS.has(el.tagName.toUpperCase()) ||
    alpha(cs.backgroundColor) > 0 ||
    cs.backgroundImage !== "none" ||
    cs.boxShadow !== "none" ||
    SIDES.some(
      (s) =>
        parseFloat(cs.getPropertyValue(`border-${s}-width`)) > 0 &&
        cs.getPropertyValue(`border-${s}-style`) !== "none" &&
        alpha(cs.getPropertyValue(`border-${s}-color`)) > 0,
    );
  const pick = (cs: CSSStyleDeclaration, props: string[]) => {
    const out: Record<string, string> = {};
    for (const p of props) out[p] = cs.getPropertyValue(p).trim();
    return out;
  };
  // getComputedStyle resolves an `auto` margin to its used length, which
  // moves whenever a flex sibling grows; the computed value stays `auto`.
  const boxProps = (el: Element, cs: CSSStyleDeclaration) => {
    const out = pick(cs, BOX_PROPS);
    const map = el.computedStyleMap();
    for (const s of SIDES) {
      if (String(map.get(`margin-${s}`)) === "auto")
        out[`margin-${s}`] = "auto";
    }
    return out;
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    );
  };

  function textTargets(root: Element): HTMLElement[] {
    return Array.from(
      root.querySelectorAll<HTMLElement>('[data-slide-text-block="true"]'),
    ).filter((el) => {
      if (el.tagName === "STYLE" || el.tagName === "SCRIPT") return false;
      if (isChrome(el)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && norm(el.textContent) !== "";
    });
  }

  function firstGlyphRect(el: Element): DOMRect {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const value = n.nodeValue ?? "";
      const offset = value.search(/\S/);
      if (offset < 0) continue;
      const range = document.createRange();
      range.setStart(n, offset);
      range.setEnd(n, offset + 1);
      const r = range.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return r;
    }
    return el.getBoundingClientRect();
  }

  function occurrenceOf(el: Element, root: ParentNode): number {
    const tag = el.tagName;
    const text = strip(el.textContent);
    let n = 0;
    for (const other of Array.from(root.querySelectorAll(tag))) {
      if (other === el) return n;
      if (strip(other.textContent) === text) n++;
    }
    return n;
  }

  /** Deepest-first match for text an edit may have extended. */
  function findByText(root: Element, text: string): Element | null {
    const want = strip(text);
    if (!want) return null;
    const prefix = want.slice(0, 40);
    let best: Element | null = null;
    let bestScore = Infinity;
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (el.tagName === "STYLE" || isChrome(el)) continue;
      const have = strip(el.textContent);
      if (!have.startsWith(prefix)) continue;
      const score = Math.abs(have.length - want.length);
      // Ties go to the outermost element, which is what the editor targets.
      if (score < bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  }

  /**
   * The element's box grown to its content: text that overflows a fixed-size
   * box (a freeform object) paints outside the box but is still the edit.
   */
  function paintedRect(el: Element): DOMRect {
    const box = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const content = range.getBoundingClientRect();
    if (!content.width && !content.height) return box;
    const left = Math.min(box.left, content.left);
    const top = Math.min(box.top, content.top);
    return new DOMRect(
      left,
      top,
      Math.max(box.right, content.right) - left,
      Math.max(box.bottom, content.bottom) - top,
    );
  }

  function listTargets(canvasSel: string): TextTarget[] {
    const root = document.querySelector(canvasSel);
    if (!root) throw new Error(`canvas not found: ${canvasSel}`);
    const origin = root.getBoundingClientRect();
    const slideRoot = root.querySelector(".slide-content") ?? root;
    return textTargets(root).map((el, index) => {
      const glyph = firstGlyphRect(el);
      const point = {
        x: glyph.left + glyph.width / 2,
        y: glyph.top + glyph.height / 2,
      };
      const hit = document.elementFromPoint(point.x, point.y);
      return {
        index,
        tag: el.tagName,
        className: el.getAttribute("class") ?? "",
        text: norm(el.textContent),
        occurrence: occurrenceOf(el, slideRoot),
        point,
        rect: rectOf(el.getBoundingClientRect(), origin),
        covered: !hit || !(el === hit || el.contains(hit)),
      };
    });
  }

  /** The focused editor root, in place or floating; a fix may move it. */
  function activeEditor(): HTMLElement | null {
    const a = document.activeElement as HTMLElement | null;
    if (a && a.isContentEditable) {
      let top: HTMLElement = a;
      while (top.parentElement?.isContentEditable) top = top.parentElement;
      return top;
    }
    return document.querySelector<HTMLElement>(
      ".slide-rich-editor-host .ProseMirror",
    );
  }

  /** Editor surface living outside the slide canvas (the floating host). */
  function floatingHost(root: Element, editor: HTMLElement | null) {
    if (!editor || root.contains(editor)) return null;
    return editor.closest(".slide-rich-editor-host") ?? editor;
  }

  function editedSource(root: Element, editor: HTMLElement | null) {
    return (
      root.querySelector<HTMLElement>('[data-editing-block="true"]') ??
      (editor && root.contains(editor)
        ? (editor.closest<HTMLElement>("[data-slide-text-block]") ?? editor)
        : null)
    );
  }

  function caretRect(origin: DOMRect, source: HTMLElement | null): Rect | null {
    const selection = getSelection();
    if (!source || !selection?.rangeCount) return null;
    const caret = selection.getRangeAt(0);
    if (!caret.collapsed || !source.contains(caret.endContainer)) return null;
    let box: DOMRect | undefined = caret.getClientRects()[0];
    // A caret in an empty or collapsed-whitespace text node, or on an empty
    // line, draws no box of its own; the next <br> or rendered character
    // after it in document order sits on the caret's line.
    if (!box?.height) {
      box = undefined;
      const walker = document.createTreeWalker(
        source,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      );
      const char = document.createRange();
      for (let n = walker.nextNode(); n && !box; n = walker.nextNode()) {
        if (n.nodeName === "BR") {
          const at = Array.from(n.parentNode!.childNodes).indexOf(
            n as ChildNode,
          );
          const r = (n as Element).getBoundingClientRect();
          if (caret.comparePoint(n.parentNode!, at) >= 0 && r.height) box = r;
        } else if (n.nodeType === Node.TEXT_NODE) {
          const from =
            caret.comparePoint(n, 0) >= 0
              ? 0
              : n === caret.startContainer
                ? caret.startOffset
                : null;
          if (from === null) continue;
          for (let i = from; i < (n as Text).length && !box; i++) {
            char.setStart(n, i);
            char.setEnd(n, i + 1);
            const r = char.getClientRects()[0];
            if (r?.height) box = r;
          }
        }
      }
    }
    return box?.height ? rectOf(box, origin) : null;
  }

  function caretBlock(source: HTMLElement | null): number | null {
    const selection = getSelection();
    const at = selection?.rangeCount
      ? selection.getRangeAt(0).endContainer
      : null;
    if (!source || !at || !source.contains(at)) return null;
    let el = at instanceof Element ? at : at.parentElement;
    // A flex item computes to display: block, yet the items along a flex row
    // share its line, so a flex item never counts as a block of its own.
    while (
      el &&
      el !== source &&
      (/^inline|^contents/.test(getComputedStyle(el).display) ||
        /flex$/.test(getComputedStyle(el.parentElement!).display))
    )
      el = el.parentElement;
    return !el || el === source
      ? -1
      : Array.from(source.querySelectorAll("*")).indexOf(el);
  }

  /**
   * Top of the element's rendered text and line breaks. A range over the
   * whole element would also take in the border box of every child, so a
   * taller icon or shape beside the text would pin it.
   */
  function contentTop(source: HTMLElement, origin: DOMRect): number {
    let top = Infinity;
    const walker = document.createTreeWalker(
      source,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    );
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      let rects: ArrayLike<DOMRect> = [];
      if (n.nodeName === "BR") rects = (n as Element).getClientRects();
      else if (n.nodeType === Node.TEXT_NODE) {
        range.selectNodeContents(n);
        rects = range.getClientRects();
      }
      for (const r of Array.from(rects))
        if (r.height) top = Math.min(top, r.top);
    }
    if (top === Infinity) top = source.getBoundingClientRect().top;
    return Math.round(top - origin.top);
  }

  function editorState(canvasSel: string): EditorState {
    const root = document.querySelector(canvasSel);
    if (!root) throw new Error(`canvas not found: ${canvasSel}`);
    const origin = root.getBoundingClientRect();
    const pm = activeEditor();
    const source = editedSource(root, pm);
    const slideRoot = root.querySelector(".slide-content") ?? root;
    return {
      editing: !!pm,
      focusInEditor: !!pm && pm.contains(document.activeElement),
      blocks: pm ? pm.children.length : 0,
      editorRect: pm ? rectOf(pm.getBoundingClientRect(), origin) : null,
      sourceRect: source
        ? rectOf(source.getBoundingClientRect(), origin)
        : null,
      contentTop: source ? contentTop(source, origin) : null,
      caretRect: caretRect(origin, source),
      caretBlock: caretBlock(source),
      sourceTag: source?.tagName ?? null,
      sourceText: source ? norm(source.textContent) : null,
      sourceOccurrence: source ? occurrenceOf(source, slideRoot) : 0,
      editorHtml: pm?.innerHTML.slice(0, 4000) ?? "",
      editorText: pm ? lines(pm) : "",
    };
  }

  /**
   * Compares in rendered characters from the editor's start, so equivalent
   * DOM positions agree. That count makes a row's end equal the next row's
   * start, so the selection must also lie in the point's row. A click on a
   * glyph's middle may put the caret on either side of it, so the point spans
   * one grapheme each way; a double-click spans the word and a space after
   * it; a point on a short leading element of a row (a bullet marker) spans
   * that element up to the row's text.
   */
  async function entryCaretProblem(
    point: { x: number; y: number },
    gesture: string,
  ): Promise<string | null> {
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
    const editor = activeEditor();
    const selection = getSelection();
    if (!editor || !selection?.rangeCount) return "no selection";
    const sel = selection.getRangeAt(0);
    if (
      !editor.contains(sel.startContainer) ||
      !editor.contains(sel.endContainer)
    )
      return "the selection is outside the editor";
    const offsetOf = (node: Node, offset: number) => {
      const r = document.createRange();
      r.setStart(editor, 0);
      r.setEnd(node, offset);
      return strip(r.toString()).length;
    };
    const start = offsetOf(sel.startContainer, sel.startOffset);
    const end = offsetOf(sel.endContainer, sel.endOffset);
    if (gesture !== "dblclick" && !sel.collapsed)
      return `a ${gesture} selected characters ${start}-${end} instead of placing a caret`;
    // caretRangeFromPoint rounds the point to whole pixels, which can move it
    // across a narrow glyph; the click itself used the fractional point.
    const pos = document.caretPositionFromPoint?.(point.x, point.y);
    const range = pos ? null : document.caretRangeFromPoint(point.x, point.y);
    const node = pos?.offsetNode ?? range?.startContainer;
    const offset = pos?.offset ?? range?.startOffset ?? 0;
    if (!node || !editor.contains(node))
      return "the click point is outside the editor";
    let lo = offset;
    let hi = offset;
    if (node instanceof Text) {
      const segments = Array.from(
        new Intl.Segmenter(undefined, {
          granularity: gesture === "dblclick" ? "word" : "grapheme",
        }).segment(node.data),
      );
      segments.forEach(({ index, segment }, i) => {
        if (index < offset && index + segment.length >= offset) lo = index;
        if (index <= offset && index + segment.length > offset) {
          hi = index + segment.length;
          const next = segments[i + 1]?.segment;
          if (gesture === "dblclick" && next && !next.trim()) hi += next.length;
        }
      });
    }
    let from = offsetOf(node, lo);
    let to = offsetOf(node, hi);
    let row: Element = editor;
    for (
      let el = node instanceof Element ? node : node.parentElement;
      el && el !== editor && editor.contains(el);
      el = el.parentElement
    ) {
      const parent = el.parentElement;
      const own = strip(el.textContent).length;
      if (
        parent &&
        parent.firstElementChild === el &&
        own >= 1 &&
        own <= 3 &&
        strip(parent.textContent).length > own &&
        offsetOf(parent, 0) === offsetOf(el, 0)
      ) {
        from = offsetOf(el, 0);
        to = from + own;
        row = parent;
        break;
      }
      if (!getComputedStyle(el).display.startsWith("inline")) {
        row = el;
        break;
      }
    }
    const rowRange = document.createRange();
    rowRange.selectNode(row);
    const inRow =
      rowRange.comparePoint(sel.startContainer, sel.startOffset) === 0 &&
      rowRange.comparePoint(sel.endContainer, sel.endOffset) === 0;
    if (inRow && start >= from && end <= to) return null;
    const total = strip(editor.textContent).length;
    return `selection at character ${start}${end !== start ? `-${end}` : ""} of ${total}${inRow ? "" : " in another row"}, click at ${from}${to !== from ? `-${to}` : ""}`;
  }

  function snapshot(
    canvasSel: string,
    edited: { targetIndex?: number; text?: string },
  ): Snapshot {
    const root = document.querySelector(canvasSel);
    if (!root) throw new Error(`canvas not found: ${canvasSel}`);
    const origin = root.getBoundingClientRect();
    const editor = activeEditor();
    const host = floatingHost(root, editor);
    const editingBlock = editedSource(root, editor);
    let editedEl: Element | null = null;
    if (edited.targetIndex !== undefined) {
      editedEl = textTargets(root)[edited.targetIndex] ?? null;
    } else if (edited.text) {
      editedEl = findByText(root, edited.text);
    }
    const insideEdited = (el: Element) =>
      (!!host && host.contains(el)) ||
      (!!editingBlock && editingBlock.contains(el)) ||
      (!!editedEl && editedEl.contains(el));

    const records: SnapRecord[] = [];
    const seen = new Map<string, number>();
    const push = (
      base: string,
      kind: SnapRecord["kind"],
      inside: boolean,
      props: Record<string, string>,
      rect: Rect,
    ) => {
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      records.push({ key: `${base}#${n}`, kind, inside, props, rect });
    };
    const boxKey = (el: Element) => {
      const cls = (el.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .sort()
        .join(".");
      return `box:${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`;
    };

    const visit = (el: Element) => {
      if (el.tagName === "STYLE" || el.tagName === "SCRIPT") return;
      if (isChrome(el)) return;
      // The hidden source of a floating editor is represented by the
      // editor's own copy; counting both would double every edited run.
      if (host && editingBlock && el === editingBlock) return;
      const cs = getComputedStyle(el);
      const inside = insideEdited(el);
      const text = norm(directText(el));
      if (text) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const textRect = rectOf(range.getBoundingClientRect(), origin);
        push(
          `text:${text.slice(0, 80)}`,
          "text",
          inside,
          { ...pick(cs, TEXT_PROPS), visible: String(visible(el)) },
          textRect,
        );
      }
      if (paints(el, cs)) {
        push(
          boxKey(el),
          "box",
          inside,
          boxProps(el, cs),
          rectOf(el.getBoundingClientRect(), origin),
        );
      }
      for (const pseudo of ["::before", "::after"]) {
        const ps = getComputedStyle(el, pseudo);
        if (ps.content === "none" || ps.content === "normal") continue;
        if (!paints(el, ps) && norm(ps.content.replace(/^"|"$/g, "")) === "")
          continue;
        push(
          `${boxKey(el)}${pseudo}`,
          "box",
          inside,
          { ...pick(ps, BOX_PROPS), content: ps.content },
          { x: 0, y: 0, width: 0, height: 0 },
        );
      }
      if (el.tagName.toUpperCase() === "SVG") return;
      for (const child of Array.from(el.children)) visit(child);
    };
    visit(root);
    if (host) visit(host);

    const all = Array.from(root.querySelectorAll("*")).filter(
      (el) => el.tagName !== "STYLE" && !isChrome(el),
    );
    const meaningful = all.filter(
      (el) =>
        norm(directText(el)) !== "" ||
        paints(el, getComputedStyle(el)) ||
        PAINTED_TAGS.has(el.tagName.toUpperCase()),
    );
    const inventory: Inventory = {
      elements: all.length,
      visible: meaningful.filter(visible).length,
      hidden: meaningful.filter((el) => !visible(el)).length,
      svg: root.querySelectorAll("svg").length,
      img: root.querySelectorAll("img").length,
      style: root.querySelectorAll("style").length,
    };
    const editedBox = editingBlock ?? editedEl;
    return {
      records,
      inventory,
      text: norm((root as HTMLElement).innerText),
      editedRect: editedBox ? rectOf(paintedRect(editedBox), origin) : null,
      editedText: editedEl ? lines(editedEl) : null,
    };
  }

  function backgroundPoint(canvasSel: string) {
    const canvas = document.querySelector(canvasSel);
    const track = document.querySelector(
      '[data-main-slide-canvas="true"]',
    )?.parentElement;
    if (!canvas || !track) return null;
    const c = canvas.getBoundingClientRect();
    const t = track.getBoundingClientRect();
    const candidates = [
      { x: c.left - 12, y: c.top + c.height / 2 },
      { x: c.right + 12, y: c.top + c.height / 2 },
      { x: c.left + c.width / 2, y: c.bottom + 12 },
      { x: c.left + c.width / 2, y: c.top - 12 },
    ];
    for (const p of candidates) {
      if (p.x <= t.left || p.x >= t.right || p.y <= t.top || p.y >= t.bottom)
        continue;
      const hit = document.elementFromPoint(p.x, p.y);
      if (hit && track.contains(hit) && !canvas.contains(hit)) return p;
    }
    return null;
  }

  function canonicalNode(node: Node, depth: number, out: string[]) {
    const pad = "  ".repeat(depth);
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.nodeValue ?? "";
      const text = raw.replace(/[\s\u200b\ufeff]+/g, " ");
      if (text.trim() === "") {
        const inline = (n: Node | null) =>
          !!n &&
          (n.nodeType === Node.TEXT_NODE ||
            (n.nodeType === Node.ELEMENT_NODE &&
              INLINE_TAGS.has((n as Element).tagName.toLowerCase())));
        if (!(inline(node.previousSibling) && inline(node.nextSibling))) return;
      }
      out.push(`${pad}"${text}"`);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    const attrs = Array.from(el.attributes)
      .map((a) => {
        if (a.name === "style") {
          const scratch = document.createElement("div").style;
          scratch.cssText = a.value;
          const decls: string[] = [];
          for (let i = 0; i < scratch.length; i++) {
            const name = scratch[i];
            const prio = scratch.getPropertyPriority(name);
            decls.push(
              `${name}:${scratch.getPropertyValue(name).trim()}${prio ? ` !${prio}` : ""}`,
            );
          }
          return `style="${decls.sort().join("; ")}"`;
        }
        if (a.name === "class") {
          return `class="${a.value.split(/\s+/).filter(Boolean).sort().join(" ")}"`;
        }
        return `${a.name}="${a.value}"`;
      })
      .sort();
    out.push(`${pad}<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`);
    if (tag === "style") {
      out.push(`${pad}  ${norm(el.textContent)}`);
      return;
    }
    const kids =
      tag === "template"
        ? Array.from((el as HTMLTemplateElement).content.childNodes)
        : Array.from(el.childNodes);
    for (const child of kids) canonicalNode(child, depth + 1, out);
  }

  function parse(html: string): DocumentFragment {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    return tpl.content;
  }

  function canonicalFragment(frag: ParentNode): string[] {
    const out: string[] = [];
    for (const child of Array.from(frag.childNodes))
      canonicalNode(child, 0, out);
    return out;
  }

  function canonical(html: string): string[] {
    return canonicalFragment(parse(html));
  }

  function pathOf(el: Element, root: ParentNode): number[] {
    const path: number[] = [];
    let cur: Element | null = el;
    while (cur && cur.parentNode && cur !== root) {
      path.unshift(Array.from(cur.parentNode.children).indexOf(cur));
      if (cur.parentNode === root) break;
      cur = cur.parentElement;
    }
    return path;
  }

  function atPath(root: ParentNode, path: number[]): Element | null {
    let cur: ParentNode | null = root;
    for (const i of path) {
      cur = (cur?.children[i] as Element | undefined) ?? null;
      if (!cur) return null;
    }
    return cur as Element | null;
  }

  function canonicalOutside(
    stored: string,
    saved: string,
    target: { tag: string; text: string; occurrence: number },
  ): CanonicalPair {
    const a = parse(stored);
    const b = parse(saved);
    const want = strip(target.text);
    const matches = Array.from(a.querySelectorAll(target.tag)).filter(
      (el) => strip(el.textContent) === want,
    );
    const el = matches[target.occurrence] ?? matches[0];
    if (!el)
      return {
        stored: canonical(stored),
        saved: canonical(saved),
        found: false,
      };
    const path = pathOf(el, a);
    const other = atPath(b, path);
    // Enter in a list item adds sibling items right after the edited one;
    // they belong to the edit, not to "everything else".
    const extra =
      other && other.parentNode && el.parentNode
        ? Math.max(
            0,
            other.parentNode.children.length - el.parentNode.children.length,
          )
        : 0;
    const placeholder = () => document.createElement("edited-element");
    el.replaceWith(placeholder());
    if (other) {
      for (let i = 0; i < extra; i++) other.nextElementSibling?.remove();
      other.replaceWith(placeholder());
    }
    return {
      stored: canonicalFragment(a),
      saved: canonicalFragment(b),
      found: !!other,
    };
  }

  const writeStacks: string[] = [];
  const KEEPALIVE_WRITES = "edit-fidelity:keepalive-writes";
  const nativeFetch = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const url =
      input instanceof Request ? input.url : new URL(input, location.href).href;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const action =
      method === "POST" || method === "PUT"
        ? /\/_agent-native\/actions\/(patch-deck|save-deck|update-slide)\b/.exec(
            url,
          )?.[1]
        : undefined;
    if (action) {
      writeStacks.push(new Error().stack ?? "");
      // Slides sends these on pagehide, and Playwright's request events never
      // report them; the bodies survive the reload in sessionStorage.
      if (init?.keepalive || (input instanceof Request && input.keepalive)) {
        const sent: KeepaliveWrite[] = JSON.parse(
          sessionStorage.getItem(KEEPALIVE_WRITES) ?? "[]",
        );
        sent.push({
          action,
          body: typeof init?.body === "string" ? init.body : null,
        });
        sessionStorage.setItem(KEEPALIVE_WRITES, JSON.stringify(sent));
      }
    }
    return nativeFetch.call(this, input, init);
  };
  const takeWriteStacks = () => writeStacks.splice(0);
  const takeKeepaliveWrites = (): KeepaliveWrite[] => {
    const sent = JSON.parse(sessionStorage.getItem(KEEPALIVE_WRITES) ?? "[]");
    sessionStorage.removeItem(KEEPALIVE_WRITES);
    return sent;
  };

  window.__editFidelity = {
    listTargets,
    takeWriteStacks,
    takeKeepaliveWrites,
    snapshot,
    editorState,
    entryCaretProblem,
    backgroundPoint,
    canonical,
    canonicalOutside,
  };
}
