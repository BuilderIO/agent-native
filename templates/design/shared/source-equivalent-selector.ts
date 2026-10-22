/**
 * Versioned source-equivalent selectors name an element by its place in the source
 * tree. The design bridge builds them inside the preview frame, and the parent canvas
 * resolves them again after layout moves. Both sides must skip the same siblings:
 * Alpine's generated template instances and the editor's own injected overlays are
 * not in the source, so native querySelector, which counts them, can land on a
 * different element. This module is compiled into the bridge, so keep it dependency-free.
 */

export const SOURCE_EQUIVALENT_SELECTOR_PREFIX = "source-equivalent:v1:";

export type SourceEquivalentSelectorStatus =
  | "matched"
  | "not-found"
  | "invalid-selector";

export type SourceEquivalentSelectorResolution =
  | { status: "matched"; element: Element }
  | { status: "not-found" }
  | { status: "invalid-selector"; format: "legacy-css" | "source-path" };

export function sourceEquivalentSelectorPath(selector: string): string {
  return selector.startsWith(SOURCE_EQUIVALENT_SELECTOR_PREFIX)
    ? selector.slice(SOURCE_EQUIVALENT_SELECTOR_PREFIX.length)
    : selector;
}

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
  return `${SOURCE_EQUIVALENT_SELECTOR_PREFIX}${parts.join(" > ")}`;
}

/**
 * Resolves new versioned paths with source sibling rules and older selectors with native
 * CSS matching so previously saved anchors keep their original sibling counts.
 */
export function resolveSourceEquivalentSelector(
  doc: Document,
  selector: string,
): Element | null {
  if (!selector.startsWith(SOURCE_EQUIVALENT_SELECTOR_PREFIX)) {
    return doc.querySelector(selector);
  }
  const resolution = resolveSourceEquivalentSelectorResult(doc, selector);
  return resolution.status === "matched" ? resolution.element : null;
}

export function resolveSourceEquivalentSelectorResult(
  doc: Document,
  selector: string,
): SourceEquivalentSelectorResolution {
  if (!selector.startsWith(SOURCE_EQUIVALENT_SELECTOR_PREFIX)) {
    try {
      const element = doc.querySelector(selector);
      return element ? { status: "matched", element } : { status: "not-found" };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "SyntaxError"
      ) {
        return { status: "invalid-selector", format: "legacy-css" };
      }
      throw error;
    }
  }

  const sourcePath = sourceEquivalentSelectorPath(selector);
  const parts = sourcePath.split(" > ");
  if (parts.length < 2 || parts[0] !== "body") {
    return { status: "invalid-selector", format: "source-path" };
  }
  const path: { tag: string; index: number }[] = [];
  for (let partIndex = 1; partIndex < parts.length; partIndex += 1) {
    // Any HTML tag name, including the underscores and dots some custom elements use.
    const match = /^([^\s:()>]+)(?::nth-of-type\((\d+)\))?$/.exec(
      parts[partIndex] ?? "",
    );
    if (!match) return { status: "invalid-selector", format: "source-path" };
    const index = match[2] === undefined ? 1 : Number(match[2]);
    if (!Number.isSafeInteger(index) || index < 1) {
      return { status: "invalid-selector", format: "source-path" };
    }
    path.push({ tag: match[1] ?? "", index });
  }

  let current: Element | null = doc.body;
  for (const step of path) {
    if (!current) return { status: "not-found" };
    const generated = alpineGeneratedChildrenOf(current);
    let seen = 0;
    let found: Element | null = null;
    for (let i = 0; i < current.children.length; i += 1) {
      const sib: Element | undefined = current.children[i];
      if (!sib || sib.tagName.toLowerCase() !== step.tag) continue;
      if (generated.indexOf(sib) !== -1) continue;
      if (isEditorInjectedElement(sib)) continue;
      seen += 1;
      if (seen === step.index) {
        found = sib;
        break;
      }
    }
    current = found;
  }
  return current && current !== doc.body
    ? { status: "matched", element: current }
    : { status: "not-found" };
}

/**
 * Attributes that name a source location, and so repeat across every instance rendered from
 * it. A plain `id` is unique by HTML rules, so a repeated one is an authoring error rather
 * than a shared identity.
 */
const SOURCE_LOCATION_ID_ATTRIBUTES = [
  "data-agent-native-node-id",
  "data-code-layer-id",
  "data-layer-id",
  "data-builder-id",
  "data-loc",
] as const;

export function isSourceLocationMatch(el: Element, nodeId: string): boolean {
  return SOURCE_LOCATION_ID_ATTRIBUTES.some(
    (attribute) => el.getAttribute(attribute) === nodeId,
  );
}
