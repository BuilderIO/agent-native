/// <reference lib="dom" />
/**
 * Code that runs inside the Slides editor page. `installInPageHelpers` is
 * serialized by Playwright's addInitScript, so everything it uses must live
 * inside its body — it cannot close over module scope.
 */

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
  occurrence: number;
  point: { x: number; y: number };
  rect: Rect;
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
}

export interface EditorState {
  editing: boolean;
  focusInEditor: boolean;
  blocks: number;
  editorRect: Rect | null;
  sourceRect: Rect | null;
  sourceTag: string | null;
  sourceText: string | null;
  sourceOccurrence: number;
  editorHtml: string;
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
  backgroundPoint(canvasSel: string): { x: number; y: number } | null;
  canonical(html: string): string[];
  canonicalOutside(
    stored: string,
    saved: string,
    target: { tag: string; text: string; occurrence: number },
  ): CanonicalPair;
  takeWriteStacks(): string[];
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
      if (score < bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  }

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
        text: norm(el.textContent).slice(0, 400),
        occurrence: occurrenceOf(el, slideRoot),
        point,
        rect: rectOf(el.getBoundingClientRect(), origin),
        covered: !hit || !(el === hit || el.contains(hit)),
      };
    });
  }

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
      sourceTag: source?.tagName ?? null,
      sourceText: source ? norm(source.textContent).slice(0, 400) : null,
      sourceOccurrence: source ? occurrenceOf(source, slideRoot) : 0,
      editorHtml: pm?.innerHTML.slice(0, 4000) ?? "",
      editorText: pm ? norm(pm.textContent).slice(0, 400) : "",
    };
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
  const nativeFetch = window.fetch;
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const url =
      input instanceof Request ? input.url : new URL(input, location.href).href;
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    if (
      method === "POST" &&
      /\/_agent-native\/actions\/(patch-deck|save-deck|update-slide)\b/.test(
        url,
      )
    ) {
      writeStacks.push(new Error().stack ?? "");
    }
    return nativeFetch.call(this, input, init);
  };
  const takeWriteStacks = () => writeStacks.splice(0);

  window.__editFidelity = {
    listTargets,
    takeWriteStacks,
    snapshot,
    editorState,
    backgroundPoint,
    canonical,
    canonicalOutside,
  };
}
