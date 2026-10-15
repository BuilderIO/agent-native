/**
 * Browser host for in-place-text-session.browser.spec.ts: boots the real
 * session the way SlideEditor.enterInlineEdit does and reads the edited
 * element back as canonical HTML.
 *
 * Canonical vocabulary: p, h1-h6, blockquote and ul/ol>li blocks; inline runs
 * a > b > i > u > s > code (by tag or by own computed style), <br>, NBSP
 * printed as &nbsp;. `|` is a collapsed caret, `[` `]` a range. ZWSP
 * placeholders and the empty runs they leave are dropped.
 */
import {
  startInPlaceTextSession,
  type InPlaceTextSession,
} from "./in-place-text-session";

export { startInPlaceTextSession };

// Plain-CSS mirror of templates/slides/app/global.css `.slide-content` /
// `.fmd-slide`. The session reads computed font-size, display and list-style.
const APP_CSS = `
.slide-content h1,.slide-content h2,.slide-content h3,.slide-content p,.slide-content blockquote,
.slide-content ul,.slide-content ol{margin:0}
.slide-content ul,.slide-content ol{padding:0}
.slide-content{font-family:var(--ds-body-font,"Inter",sans-serif)}
.slide-content [data-slide-text-block="true"],.slide-content [data-editing-block="true"]{cursor:text}
.slide-content h1{font-size:3rem;line-height:1.25;font-weight:700;margin-bottom:1.5rem;letter-spacing:-.025em}
.slide-content h2{font-size:1.875rem;line-height:1.375;font-weight:600;margin-bottom:1rem;letter-spacing:-.025em}
.slide-content h3{font-size:1.5rem;line-height:1.3333;font-weight:500;margin-bottom:.75rem}
.slide-content p{font-size:1.25rem;line-height:1.625;margin-bottom:1rem}
.slide-content ul,.slide-content ol{font-size:1.125rem;line-height:1.5556;list-style-position:inside}
.slide-content ul{list-style-type:disc}
.slide-content ol{list-style-type:decimal}
.slide-content ul>:not(:last-child),.slide-content ol>:not(:last-child){margin-bottom:.75rem}
.slide-content code{padding:.125rem .5rem;border-radius:.25rem;font-size:1rem;font-family:ui-monospace,monospace}
.slide-content blockquote{border-left:4px solid;padding-left:1rem;font-style:italic;font-size:1.25rem;line-height:1.75;opacity:.8}
.slide-content strong{font-weight:700}
.slide-content em{font-style:italic}
.slide-content a{text-decoration:underline}
.fmd-slide{position:relative;width:100%;height:100%;display:flex;flex-direction:column;padding:64px 80px;
font-family:var(--ds-body-font,"Inter",sans-serif);
box-sizing:border-box;overflow:hidden}
`;

// The slide wrapper authored per .agents/skills/create-deck/SKILL.md.
const FMD_SLIDE_STYLE =
  "--deck-body-font: 'Inter', Arial, sans-serif; " +
  "padding: 64px 80px; display: flex; flex-direction: column; justify-content: flex-start; " +
  "font-family: var(--deck-body-font);";

// A generated text leaf: flow-layout div with its own type scale and colour.
const TEXT_BLOCK_STYLE =
  "font-size: 18px; line-height: 1.4; color: var(--deck-muted); margin: 0;";

// ---------------------------------------------------------------- canonicalizer

type Marks = {
  a: string | null;
  b: boolean;
  i: boolean;
  u: boolean;
  s: boolean;
  code: boolean;
};
type Leaf =
  | { kind: "text"; node: Text; text: string; marks: Marks }
  | { kind: "br"; node: Element };
type PathEntry = { tag: string; key: object };
type Block = {
  tag: string;
  path: PathEntry[];
  key: object;
  leaves: Leaf[];
  empty: boolean;
  range: Range;
  host: Node;
  hostIdx: number;
};
type Ctx = { style: boolean; blocks: Block[]; doc: Document };
type BO = { b: number; o: number };
type Mk = { o: number; ch: string };

const ZWSP = "​";
const OPEN = "";
const CLOSE = "";
const CARET = "";
const WS = /^[ \t\r\n\f]*$/;
const MONO = /monospace|courier|consolas|menlo|monaco|sf mono/i;
const BLOCK_TAGS = new Set(
  "P DIV H1 H2 H3 H4 H5 H6 BLOCKQUOTE UL OL LI PRE SECTION ARTICLE ASIDE HEADER FOOTER NAV MAIN FIGURE FIGCAPTION ADDRESS DL DT DD TABLE THEAD TBODY TR TD TH".split(
    " ",
  ),
);

const isEl = (n: Node): n is Element => n.nodeType === 1;
const isBlock = (n: Node) => isEl(n) && BLOCK_TAGS.has(n.tagName);
const isList = (n: Node) =>
  isEl(n) && (n.tagName === "UL" || n.tagName === "OL");
const hasBlockChild = (e: Element) => Array.from(e.childNodes).some(isBlock);
const indexOf = (n: Node) =>
  Array.prototype.indexOf.call(n.parentNode!.childNodes, n) as number;

function hasContent(nodes: Node[]): boolean {
  return nodes.some((n) => {
    if (n.nodeType === 3) return !WS.test((n as Text).data);
    if (!isEl(n)) return false;
    return (
      n.tagName === "BR" ||
      n.querySelector("br") !== null ||
      !WS.test(n.textContent || "")
    );
  });
}

const weight = (cs: CSSStyleDeclaration) =>
  cs.fontWeight === "bold" ? 700 : parseInt(cs.fontWeight, 10) || 400;

function applyElement(e: Element, m: Marks, style: boolean) {
  const tag = e.tagName;
  const cs = style ? getComputedStyle(e) : null;
  const ps =
    style && e.parentElement ? getComputedStyle(e.parentElement) : null;
  if (tag === "A" && e.getAttribute("href") != null && m.a == null) {
    m.a = e.getAttribute("href");
  }
  if (tag === "B" || tag === "STRONG") {
    if (!cs || weight(cs) >= 600) m.b = true;
  } else if (cs && weight(cs) >= 600 && (!ps || weight(ps) < 600)) m.b = true;
  if (tag === "I" || tag === "EM") {
    if (!cs || cs.fontStyle !== "normal") m.i = true;
  } else if (
    cs &&
    cs.fontStyle !== "normal" &&
    (!ps || ps.fontStyle === "normal")
  ) {
    m.i = true;
  }
  if (tag === "U" || tag === "INS") {
    if (!cs || cs.textDecorationLine.includes("underline")) m.u = true;
  } else if (cs && tag !== "A" && cs.textDecorationLine.includes("underline")) {
    m.u = true;
  }
  if (tag === "S" || tag === "STRIKE" || tag === "DEL") {
    if (!cs || cs.textDecorationLine.includes("line-through")) m.s = true;
  } else if (cs && cs.textDecorationLine.includes("line-through")) m.s = true;
  if (["CODE", "TT", "KBD", "SAMP"].includes(tag)) m.code = true;
  else if (
    cs &&
    MONO.test(cs.fontFamily) &&
    (!ps || !MONO.test(ps.fontFamily))
  ) {
    m.code = true;
  }
}

function marksFor(t: Text, style: boolean): Marks {
  const m: Marks = {
    a: null,
    b: false,
    i: false,
    u: false,
    s: false,
    code: false,
  };
  for (let e = t.parentElement; e && !isBlock(e); e = e.parentElement) {
    applyElement(e, m, style);
  }
  return m;
}

function leavesOf(nodes: Node[], style: boolean): Leaf[] {
  const out: Leaf[] = [];
  const visit = (n: Node) => {
    if (n.nodeType === 3) {
      const t = n as Text;
      if (t.data)
        out.push({
          kind: "text",
          node: t,
          text: t.data,
          marks: marksFor(t, style),
        });
    } else if (isEl(n)) {
      if (n.tagName === "BR") out.push({ kind: "br", node: n });
      else Array.from(n.childNodes).forEach(visit);
    }
  };
  nodes.forEach(visit);
  return out;
}

function makeBlock(
  ctx: Ctx,
  tag: string,
  path: PathEntry[],
  nodes: Node[],
  range: Range,
  host: Node,
  hostIdx: number,
  key?: object,
) {
  const leaves = leavesOf(nodes, ctx.style);
  if (leaves.length && leaves[leaves.length - 1].kind === "br") leaves.pop();
  const empty = leaves.every((l) => l.kind === "text" && /^​*$/.test(l.text));
  ctx.blocks.push({
    tag,
    path,
    key: key || {},
    leaves,
    empty,
    range,
    host,
    hostIdx,
  });
}

function rangeFor(ctx: Ctx, build: (r: Range) => void) {
  const r = ctx.doc.createRange();
  build(r);
  return r;
}
const rangeContents = (ctx: Ctx, el: Node) =>
  rangeFor(ctx, (r) => r.selectNodeContents(el));
const rangeAround = (ctx: Ctx, nodes: Node[]) =>
  rangeFor(ctx, (r) => {
    r.setStartBefore(nodes[0]);
    r.setEndAfter(nodes[nodes.length - 1]);
  });
const rangeAt = (ctx: Ctx, node: Node, idx: number) =>
  rangeFor(ctx, (r) => {
    r.setStart(node, idx);
    r.collapse(true);
  });

function addRun(
  ctx: Ctx,
  tag: string,
  path: PathEntry[],
  run: Node[],
  parent: Node,
  key?: object,
) {
  makeBlock(
    ctx,
    tag,
    path,
    run,
    rangeAround(ctx, run),
    parent,
    indexOf(run[0]),
    key,
  );
}

function walkChildren(parent: Node, path: PathEntry[], ctx: Ctx) {
  let run: Node[] = [];
  const flush = () => {
    if (run.length && hasContent(run)) addRun(ctx, "p", path, run, parent);
    run = [];
  };
  for (const child of Array.from(parent.childNodes)) {
    if (isBlock(child)) {
      flush();
      walkBlock(child as Element, path, ctx);
    } else run.push(child);
  }
  flush();
}

function walkBlock(el: Element, path: PathEntry[], ctx: Ctx) {
  const tag = el.tagName;
  if (tag === "UL" || tag === "OL") walkList(el, path, ctx);
  else if (tag === "LI") walkLi(el, path, ctx);
  else if (tag === "BLOCKQUOTE") {
    walkChildren(el, [...path, { tag: "blockquote", key: el }], ctx);
  } else if (hasBlockChild(el)) walkChildren(el, path, ctx);
  else {
    const t = /^H[1-6]$/.test(tag) ? tag.toLowerCase() : "p";
    makeBlock(
      ctx,
      t,
      path,
      Array.from(el.childNodes),
      rangeContents(ctx, el),
      el,
      0,
    );
  }
}

// An <li> holding only a nested list folds under the previous <li>.
function isWrapperLi(li: Element): boolean {
  let lists = 0;
  for (const c of Array.from(li.childNodes)) {
    if (isList(c)) lists++;
    else if (c.nodeType === 3 ? !WS.test((c as Text).data) : isEl(c))
      return false;
  }
  return lists > 0;
}

function walkList(list: Element, path: PathEntry[], ctx: Ctx) {
  const lp: PathEntry[] = [
    ...path,
    { tag: list.tagName === "OL" ? "ol" : "ul", key: list },
  ];
  let last: PathEntry | null = null;
  const synthetic = (before: Node): PathEntry => {
    const key = {};
    ctx.blocks.push({
      tag: "li",
      path: lp,
      key,
      leaves: [],
      empty: true,
      range: rangeAt(ctx, before.parentNode!, indexOf(before)),
      host: before.parentNode!,
      hostIdx: indexOf(before),
    });
    return { tag: "li", key };
  };
  for (const child of Array.from(list.childNodes)) {
    if (child.nodeType === 3) {
      if (!WS.test((child as Text).data)) addRun(ctx, "p", lp, [child], list);
    } else if (isEl(child)) {
      if (child.tagName === "LI") {
        if (last && isWrapperLi(child)) {
          for (const c of Array.from(child.childNodes)) {
            if (isList(c)) walkList(c as Element, [...lp, last], ctx);
          }
        } else last = walkLi(child, lp, ctx);
      } else if (isList(child)) {
        if (!last) last = synthetic(child);
        walkList(child, [...lp, last], ctx);
      } else walkBlock(child, lp, ctx);
    }
  }
}

function walkLi(li: Element, listPath: PathEntry[], ctx: Ctx): PathEntry {
  const entry: PathEntry = { tag: "li", key: li };
  const inner = [...listPath, entry];
  let own: Node[] = [];
  let run: Node[] = [];
  let emitted = false;
  const emitOwn = () => {
    emitted = true;
    if (own.length && hasContent(own)) addRun(ctx, "li", listPath, own, li, li);
    else makeBlock(ctx, "li", listPath, [], rangeAt(ctx, li, 0), li, 0, li);
  };
  const flushRun = () => {
    if (run.length && hasContent(run)) addRun(ctx, "p", inner, run, li);
    run = [];
  };
  for (const child of Array.from(li.childNodes)) {
    if (isBlock(child)) {
      const el = child as Element;
      if (!emitted) {
        if (!isList(el) && !hasContent(own) && !hasBlockChild(el)) {
          emitted = true;
          makeBlock(
            ctx,
            "li",
            listPath,
            Array.from(el.childNodes),
            rangeContents(ctx, el),
            el,
            0,
            li,
          );
          continue;
        }
        emitOwn();
      } else flushRun();
      walkBlock(el, inner, ctx);
    } else if (!emitted) own.push(child);
    else run.push(child);
  }
  if (!emitted) emitOwn();
  else flushRun();
  return entry;
}

function walk(root: Element, style: boolean): Block[] {
  const ctx: Ctx = { style, blocks: [], doc: root.ownerDocument };
  walkChildren(root, [], ctx);
  if (!ctx.blocks.length) {
    ctx.blocks.push({
      tag: "p",
      path: [],
      key: {},
      leaves: [],
      empty: true,
      range: rangeAt(ctx, root, 0),
      host: root,
      hostIdx: 0,
    });
  }
  return ctx.blocks;
}

const blockText = (b: Block) =>
  b.empty
    ? ""
    : b.leaves.map((l) => (l.kind === "br" ? "\n" : l.text)).join("");

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  " ": "&nbsp;",
  [ZWSP]: "&zwsp;",
  "|": "&vert;",
  "[": "&#91;",
  "]": "&#93;",
};
const esc = (s: string) => s.replace(/[&<> ​|[\]]/g, (c) => ESCAPES[c]);

function wrap(text: string, m: Marks): string {
  let open = "";
  let close = "";
  if (m.a != null) {
    const href = m.a
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
    open += `<a href="${href}">`;
    close = "</a>";
  }
  for (const k of ["b", "i", "u", "s", "code"] as const) {
    if (m[k]) {
      open += `<${k}>`;
      close = `</${k}>` + close;
    }
  }
  return open + text + close;
}

function inlineHtml(b: Block, marks: Mk[]): string {
  const cs: { c: string; k: string; m: Marks | null }[] = [];
  if (!b.empty) {
    for (const l of b.leaves) {
      if (l.kind === "br") cs.push({ c: "\n", k: "", m: null });
      else {
        const k = JSON.stringify(l.marks);
        for (let i = 0; i < l.text.length; i++)
          cs.push({ c: l.text[i], k, m: l.marks });
      }
    }
  }
  const mk = marks.slice().sort((x, y) => x.o - y.o);
  let out = "";
  let run = "";
  let runK: string | null = null;
  let runM: Marks | null = null;
  let mi = 0;
  const flush = () => {
    if (run) out += wrap(esc(run), runM!);
    run = "";
    runK = null;
    runM = null;
  };
  for (let p = 0; p <= cs.length; p++) {
    while (mi < mk.length && mk[mi].o <= p) {
      flush();
      out += mk[mi++].ch;
    }
    if (p === cs.length) break;
    const c = cs[p];
    if (c.m === null) {
      flush();
      out += "<br>";
    } else {
      if (c.k !== runK) {
        flush();
        runK = c.k;
        runM = c.m;
      }
      run += c.c;
    }
  }
  flush();
  return out;
}

function emit(blocks: Block[], marks: Map<number, Mk[]>): string {
  const stack: PathEntry[] = [];
  let out = "";
  blocks.forEach((b, bi) => {
    let i = 0;
    while (
      i < stack.length &&
      i < b.path.length &&
      stack[i].key === b.path[i].key
    )
      i++;
    while (stack.length > i) out += `</${stack.pop()!.tag}>`;
    for (let j = i; j < b.path.length; j++) {
      out += `<${b.path[j].tag}>`;
      stack.push(b.path[j]);
    }
    const inner = inlineHtml(b, marks.get(bi) || []);
    if (b.tag === "li") {
      out += `<li>${inner}`;
      stack.push({ tag: "li", key: b.key });
    } else out += `<${b.tag}>${inner}</${b.tag}>`;
  });
  while (stack.length) out += `</${stack.pop()!.tag}>`;
  return out;
}

function pointToBO(blocks: Block[], node: Node, offset: number): BO {
  let found = -1;
  let next = -1;
  for (let i = 0; i < blocks.length; i++) {
    const c = blocks[i].range.comparePoint(node, offset);
    if (c === 0) {
      found = i;
      break;
    }
    if (c < 0 && next < 0) next = i;
  }
  if (found < 0) {
    if (next >= 0) return { b: next, o: 0 };
    const last = blocks.length - 1;
    return { b: last, o: blockText(blocks[last]).length };
  }
  const b = blocks[found];
  if (b.empty) return { b: found, o: 0 };
  const probe = node.ownerDocument!.createRange();
  probe.setStart(node, offset);
  probe.collapse(true);
  let acc = 0;
  for (const l of b.leaves) {
    if (l.kind === "text") {
      if (l.node === node)
        return { b: found, o: acc + Math.min(offset, l.text.length) };
      if (probe.comparePoint(l.node, 0) > 0) break;
      acc += l.text.length;
    } else {
      if (probe.comparePoint(l.node.parentNode!, indexOf(l.node)) >= 0) break;
      acc += 1;
    }
  }
  return { b: found, o: Math.min(acc, blockText(b).length) };
}

function positionFor(b: Block, o: number): [Node, number] {
  const len = blockText(b).length;
  if (o < 0 || o > len)
    throw new RangeError(`offset ${o} outside block text length ${len}`);
  if (b.empty || !b.leaves.length) return [b.host, b.hostIdx];
  let acc = 0;
  for (const l of b.leaves) {
    if (l.kind === "text") {
      if (o <= acc + l.text.length) return [l.node, o - acc];
      acc += l.text.length;
    } else {
      if (o <= acc) return [l.node.parentNode!, indexOf(l.node)];
      acc += 1;
    }
  }
  const last = b.leaves[b.leaves.length - 1];
  return last.kind === "text"
    ? [last.node, last.text.length]
    : [last.node.parentNode!, indexOf(last.node) + 1];
}

function pick(blocks: Block[], i: number): Block {
  if (!Number.isInteger(i) || i < 0 || i >= blocks.length) {
    throw new RangeError(
      `block index ${i} out of range (document has ${blocks.length} blocks)`,
    );
  }
  return blocks[i];
}

const cmp = (x: BO, y: BO) => x.b - y.b || x.o - y.o;

function canonicalize(root: HTMLElement): string {
  const blocks = walk(root, true);
  const marks = new Map<number, Mk[]>();
  const s = getSelection();
  if (
    s?.rangeCount &&
    s.anchorNode &&
    s.focusNode &&
    root.contains(s.anchorNode) &&
    root.contains(s.focusNode)
  ) {
    const anchor = pointToBO(blocks, s.anchorNode, s.anchorOffset);
    const focus = pointToBO(blocks, s.focusNode, s.focusOffset);
    const add = (p: BO, ch: string) =>
      marks.set(p.b, [...(marks.get(p.b) || []), { o: p.o, ch }]);
    if (cmp(anchor, focus) === 0) add(anchor, "|");
    else {
      const [lo, hi] =
        cmp(anchor, focus) < 0 ? [anchor, focus] : [focus, anchor];
      add(lo, "[");
      add(hi, "]");
    }
  }
  let html = emit(blocks, marks).replaceAll("&zwsp;", "");
  for (let prev = ""; prev !== html; ) {
    prev = html;
    html = html.replace(/<(b|i|u|s|code)><\/\1>|<a href="[^"]*"><\/a>/g, "");
  }
  return html;
}

/** Splits `|` / `[` `]` markers out of case HTML into block/offset positions. */
function parseMarkers(source: string, backward: boolean) {
  const html = source.split("&zwsp;").join(ZWSP);
  let marked = "";
  let clean = "";
  let inTag = false;
  let quote = "";
  for (let i = 0; i < html.length; i++) {
    const ch = html[i];
    if (inTag) {
      marked += ch;
      clean += ch;
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") inTag = false;
    } else if (ch === "<" && /[A-Za-z/!]/.test(html[i + 1] || "")) {
      inTag = true;
      marked += ch;
      clean += ch;
    } else if (ch === "|") marked += CARET;
    else if (ch === "[") marked += OPEN;
    else if (ch === "]") marked += CLOSE;
    else {
      marked += ch;
      clean += ch;
    }
  }
  const doc = document.implementation.createHTMLDocument("");
  const tpl = doc.createElement("div");
  tpl.innerHTML = marked;
  const found: Record<string, BO> = {};
  const blocks = walk(tpl, false);
  blocks.forEach((b, bi) => {
    const text = blockText(b);
    let removed = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c !== OPEN && c !== CLOSE && c !== CARET) continue;
      if (found[c]) throw new Error("duplicate selection marker");
      found[c] = { b: bi, o: i - removed++ };
    }
  });
  // A marker between blocks would add a phantom block and shift every index.
  const probe = doc.createElement("div");
  probe.innerHTML = clean;
  if (walk(probe, false).length !== blocks.length) {
    throw new Error("selection marker is outside any block");
  }
  if (found[CARET]) return { clean, anchor: found[CARET], focus: found[CARET] };
  if (found[OPEN] && found[CLOSE]) {
    return {
      clean,
      anchor: backward ? found[CLOSE] : found[OPEN],
      focus: backward ? found[OPEN] : found[CLOSE],
    };
  }
  throw new Error("case html has no selection marker (| or [ ])");
}

// ---------------------------------------------------------------- host API

let session: InPlaceTextSession | null = null;

/** The block/offset selection steps share the canonical block walk. */
export function select(anchor: BO, focus: BO) {
  const blocks = walk(session!.element, true);
  const [an, ao] = positionFor(pick(blocks, anchor.b), anchor.o);
  const [fn, fo] = positionFor(pick(blocks, focus.b), focus.o);
  if (!session!.element.contains(document.activeElement)) {
    session!.element.focus({ preventScroll: true });
  }
  getSelection()!.setBaseAndExtent(an, ao, fn, fo);
}

/** Session timers: composition-end reshape (setTimeout 0) and the layout reservation (rAF). */
export async function settle() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/** Mounts `html` as a slide text leaf, starts the session and sets the marked selection. */
export async function boot(markedHtml: string, backward = false) {
  const { clean, anchor, focus } = parseMarkers(markedHtml, backward);
  session?.end();
  if (!document.getElementById("rte-slides-app-css")) {
    const style = document.createElement("style");
    style.id = "rte-slides-app-css";
    style.textContent = APP_CSS;
    document.head.append(style);
  }
  const content = document.createElement("div");
  content.className = "slide-content";
  const slide = document.createElement("div");
  slide.className = "fmd-slide";
  slide.setAttribute("style", FMD_SLIDE_STYLE);
  const block = document.createElement("div");
  block.setAttribute("style", TEXT_BLOCK_STYLE);
  block.innerHTML = clean;
  slide.append(block);
  content.append(slide);
  document.getElementById("stage")!.replaceChildren(content);
  session = startInPlaceTextSession(block, {});
  await settle();
  select(anchor, focus);
  await settle();
}

/** A synthetic bubbling paste on the CURRENT edited element (a retag replaces it). */
export function paste(kind: "html" | "text", payload: string) {
  const el = session!.element;
  if (!el.contains(document.activeElement)) el.focus();
  const dt = new DataTransfer();
  if (kind === "html") {
    dt.setData("text/html", payload);
    dt.setData(
      "text/plain",
      new DOMParser().parseFromString(payload, "text/html").body.textContent ||
        "",
    );
  } else dt.setData("text/plain", payload);
  el.dispatchEvent(
    new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
      composed: true,
    }),
  );
}

/** Canonical HTML of the CURRENT edited element, with selection markers. */
export const canonical = () => canonicalize(session!.element);

export function end() {
  session?.end();
  session = null;
}
