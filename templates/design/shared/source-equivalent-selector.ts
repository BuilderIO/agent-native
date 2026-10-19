/**
 * Source-equivalent selectors name an element by its place in the source tree.
 * The design bridge builds them inside the preview frame, and the parent canvas
 * resolves them again after layout moves. Both sides must skip the same siblings:
 * Alpine's generated template instances and the editor's own injected overlays are
 * not in the source, so native querySelector, which counts them, can land on a
 * different element. This module is compiled into the bridge, so keep it dependency-free.
 */

export function alpineGeneratedChildrenOf(parent: Element): Element[] {
  const generated: Element[] = [];
  const children = parent.children;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i] as Element & {
      _x_lookup?: Map<unknown, Element> | Record<string, Element>;
      _x_currentIfEl?: Element;
    };
    if (!child.tagName || child.tagName.toLowerCase() !== "template") {
      continue;
    }
    if (child._x_currentIfEl) generated.push(child._x_currentIfEl);
    const lookup = child._x_lookup;
    if (lookup) {
      const map = lookup as Map<unknown, Element>;
      if (typeof map.forEach === "function" && typeof map.get === "function") {
        map.forEach((item) => {
          if (item) generated.push(item);
        });
      } else {
        const record = lookup as Record<string, Element>;
        for (const key in record) {
          if (Object.prototype.hasOwnProperty.call(record, key)) {
            const item = record[key];
            if (item) generated.push(item);
          }
        }
      }
    }
  }
  return generated;
}

export function isEditorInjectedElement(el: Element): boolean {
  return !!(
    el.getAttribute &&
    (el.getAttribute("data-agent-native-edit-overlay") !== null ||
      el.getAttribute("data-agent-native-hit-test-preview") !== null)
  );
}

export function buildSourceEquivalentSelector(el: Element | null): string {
  if (!el || !el.ownerDocument) return "";
  const doc = el.ownerDocument;
  if (el === doc.documentElement || el === doc.body) return "";
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== doc.body) {
    const parent: Element | null = node.parentElement;
    if (!parent) return "";
    const generated = alpineGeneratedChildrenOf(parent);
    if (generated.indexOf(node) !== -1) return "";
    if (isEditorInjectedElement(node)) return "";
    const tag = node.tagName ? node.tagName.toLowerCase() : "";
    if (!tag || tag === "template") return "";
    let nth = 0;
    const siblings = parent.children;
    for (let i = 0; i < siblings.length; i += 1) {
      const sib = siblings[i];
      if (!sib.tagName || sib.tagName.toLowerCase() !== tag) continue;
      if (generated.indexOf(sib) !== -1) continue;
      if (isEditorInjectedElement(sib)) continue;
      nth += 1;
      if (sib === node) break;
    }
    if (nth === 0) return "";
    parts.unshift(`${tag}:nth-of-type(${nth})`);
    node = parent;
  }
  if (!node) return "";
  parts.unshift("body");
  return parts.join(" > ");
}

/**
 * Walks a source-equivalent selector the way buildSourceEquivalentSelector counted it.
 * A segment without :nth-of-type is accepted too: selectors persisted before the count
 * was written leave it out when a tag had a single sibling, which means the first one.
 */
export function resolveSourceEquivalentSelector(
  doc: Document,
  selector: string,
): Element | null {
  const parts = selector.split(" > ");
  if (parts[0] !== "body") return null;
  let current: Element | null = doc.body;
  for (let partIndex = 1; partIndex < parts.length; partIndex += 1) {
    const match = /^([a-z][a-z0-9-]*)(?::nth-of-type\((\d+)\))?$/.exec(
      parts[partIndex] ?? "",
    );
    if (!match || !current) return null;
    const tag = match[1] ?? "";
    const wanted = match[2] === undefined ? 1 : Number(match[2]);
    const generated = alpineGeneratedChildrenOf(current);
    let seen = 0;
    let found: Element | null = null;
    for (let i = 0; i < current.children.length; i += 1) {
      const sib: Element | undefined = current.children[i];
      if (!sib || sib.tagName.toLowerCase() !== tag) continue;
      if (generated.indexOf(sib) !== -1) continue;
      if (isEditorInjectedElement(sib)) continue;
      seen += 1;
      if (seen === wanted) {
        found = sib;
        break;
      }
    }
    current = found;
  }
  return current === doc.body ? null : current;
}
