import { SOURCE_STAMP_ATTR } from "./slide-source-map";

/**
 * Brings another writer's saved edit into a canvas whose text is being edited,
 * without replacing the node the caret is in.
 *
 * `prevHtml` is the render of the last slide content this client saw on the
 * server, `nextHtml` the render of the copy the other writer saved. Both carry
 * source stamps, so an element is the same element in both and in the live
 * DOM. Only the delta between them is written, and only to elements outside
 * the edited one: the edited element, and anything inside it, is the typist's.
 *
 * - `applied`: the delta is in the live DOM; the edit was not touched.
 * - `overlap`: the other writer changed the edited element, so both sides
 *   cannot be shown. Nothing was written; the save-time conflict path decides.
 * - `unsupported`: the change adds, removes or reorders elements, or the live
 *   DOM no longer matches `prevHtml`. Nothing was written.
 */
export type LiveRemoteApplyResult = "applied" | "overlap" | "unsupported";

interface Delta {
  live: HTMLElement;
  attrs: Array<{ name: string; prev: string | null; next: string | null }>;
  texts: Array<{ prev: string; next: string; index: number }>;
}

const elementsOf = (root: ParentNode) =>
  Array.from(root.querySelectorAll<HTMLElement>("*"));

function parse(doc: Document, html: string) {
  const template = doc.createElement("template");
  template.innerHTML = html;
  return template.content;
}

function declarations(doc: Document, css: string | null) {
  const probe = doc.createElement("div");
  probe.style.cssText = css ?? "";
  const out = new Map<string, string>();
  for (let i = 0; i < probe.style.length; i++) {
    const property = probe.style[i];
    out.set(
      property,
      probe.style.getPropertyValue(property) +
        (probe.style.getPropertyPriority(property) ? " !important" : ""),
    );
  }
  return out;
}

const sameStyleValue = (
  live: HTMLElement,
  property: string,
  value?: string,
) => {
  const current =
    live.style.getPropertyValue(property) +
    (live.style.getPropertyPriority(property) ? " !important" : "");
  return (value ?? "") === current;
};

export function applyRemoteHtmlUnderEdit(
  root: HTMLElement,
  edited: HTMLElement,
  prevHtml: string,
  nextHtml: string,
): LiveRemoteApplyResult {
  const doc = root.ownerDocument;
  const prevEls = elementsOf(parse(doc, prevHtml));
  const nextEls = elementsOf(parse(doc, nextHtml));
  if (prevEls.length !== nextEls.length) return "unsupported";

  const deltas: Delta[] = [];
  let overlap = false;
  for (let i = 0; i < prevEls.length; i++) {
    const prev = prevEls[i];
    const next = nextEls[i];
    const stamp = prev.getAttribute(SOURCE_STAMP_ATTR);
    if (
      prev.tagName !== next.tagName ||
      stamp !== next.getAttribute(SOURCE_STAMP_ATTR) ||
      prev.childNodes.length !== next.childNodes.length
    ) {
      return "unsupported";
    }

    const attrs: Delta["attrs"] = [];
    for (const name of new Set([
      ...prev.getAttributeNames(),
      ...next.getAttributeNames(),
    ])) {
      if (name === SOURCE_STAMP_ATTR) continue;
      const before = prev.getAttribute(name);
      const after = next.getAttribute(name);
      if (before !== after) attrs.push({ name, prev: before, next: after });
    }
    const texts: Delta["texts"] = [];
    for (let j = 0; j < prev.childNodes.length; j++) {
      const before = prev.childNodes[j];
      const after = next.childNodes[j];
      if (before.nodeType !== after.nodeType) return "unsupported";
      if (before.nodeType === 1) continue;
      if (before.nodeValue !== after.nodeValue) {
        texts.push({
          prev: before.nodeValue ?? "",
          next: after.nodeValue ?? "",
          index: j,
        });
      }
    }
    if (attrs.length === 0 && texts.length === 0) continue;

    // A stamp shared by parser-rebuilt copies or an Enter-split row does not
    // name one element, so a delta cannot be routed by it.
    const matches = stamp
      ? root.querySelectorAll<HTMLElement>(`[${SOURCE_STAMP_ATTR}="${stamp}"]`)
      : [];
    if (matches.length !== 1) return "unsupported";
    const live = matches[0];
    if (live === edited || edited.contains(live)) {
      overlap = true;
      continue;
    }
    deltas.push({ live, attrs, texts });
  }
  if (overlap) return "overlap";

  // Check every delta against the live DOM before writing any: an element the
  // typist (or anything else) already changed is not this render's to rewrite.
  for (const { live, attrs, texts } of deltas) {
    for (const { name, prev, next } of attrs) {
      if (name === "style") {
        const before = declarations(doc, prev);
        const after = declarations(doc, next);
        for (const property of new Set([...before.keys(), ...after.keys()])) {
          if (before.get(property) === after.get(property)) continue;
          if (!sameStyleValue(live, property, before.get(property))) {
            return "unsupported";
          }
        }
      } else if (name === "class") {
        for (const token of (prev ?? "").split(/\s+/).filter(Boolean)) {
          if (!live.classList.contains(token)) return "unsupported";
        }
      } else if (live.getAttribute(name) !== prev) {
        return "unsupported";
      }
    }
    for (const { prev, index } of texts) {
      const node = live.childNodes[index];
      if (!node || node.nodeType === 1 || node.nodeValue !== prev) {
        return "unsupported";
      }
    }
  }

  for (const { live, attrs, texts } of deltas) {
    for (const { name, prev, next } of attrs) {
      if (name === "style") {
        const before = declarations(doc, prev);
        const after = declarations(doc, next);
        for (const property of new Set([...before.keys(), ...after.keys()])) {
          if (before.get(property) === after.get(property)) continue;
          const value = after.get(property);
          if (value === undefined) live.style.removeProperty(property);
          else {
            const important = value.endsWith(" !important");
            live.style.setProperty(
              property,
              important ? value.slice(0, -" !important".length) : value,
              important ? "important" : "",
            );
          }
        }
      } else if (name === "class") {
        const before = new Set((prev ?? "").split(/\s+/).filter(Boolean));
        const after = new Set((next ?? "").split(/\s+/).filter(Boolean));
        for (const token of before) {
          if (!after.has(token)) live.classList.remove(token);
        }
        for (const token of after) {
          if (!before.has(token)) live.classList.add(token);
        }
        if (live.classList.length === 0) live.removeAttribute("class");
      } else if (next === null) {
        live.removeAttribute(name);
      } else {
        live.setAttribute(name, next);
      }
    }
    for (const { next, index } of texts) {
      live.childNodes[index].nodeValue = next;
    }
  }
  return "applied";
}
