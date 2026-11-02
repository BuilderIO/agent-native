import { DRAFTING_ATTRIBUTE } from "./draft-outlines.js";

/** Set on each element a streaming patch inserts, for one entrance animation. */
export const STREAMED_IN_ATTRIBUTE = "data-agent-native-streamed-in";

/**
 * Entrance motion for streamed-in elements. Only the outermost new element
 * animates; its new descendants arrive with it. Where frames are drafted
 * (`createDraftOutlines`), the draft times each reveal instead.
 */
export const STREAMED_IN_CSS = `
@keyframes agent-native-streamed-in {
  from { opacity: 0; transform: translateY(6px); filter: blur(2px); }
  to { opacity: 1; transform: none; filter: none; }
}
[${STREAMED_IN_ATTRIBUTE}] {
  animation: agent-native-streamed-in 320ms cubic-bezier(0.2, 0, 0, 1) both;
}
[${DRAFTING_ATTRIBUTE}] [${STREAMED_IN_ATTRIBUTE}] { animation: none; }
@media (prefers-reduced-motion: reduce) {
  [${STREAMED_IN_ATTRIBUTE}] { animation: none; }
}
`;

/**
 * Patches `target`'s children to match `source` in place. Nodes that match
 * by position and tag are kept, so text grows inside elements already on
 * screen and nothing replays its entrance; new elements get `markAttribute`
 * and are passed to `onInsert`. A kept element that `keepChildren` claims
 * has its attributes synced but its children left alone, for content another
 * renderer owns, such as a React portal's slot.
 *
 * With `ownership`, only the nodes the stream inserted are compared or
 * removed, and an attribute changes only while it still holds the value the
 * stream gave it. A runtime working on the result (Alpine's `x-for` clones,
 * `x-text`, `x-show`'s style, `:class`) is not in the source, so a positional
 * comparison would otherwise overwrite or delete its work.
 *
 * This function is serialized into sandboxed preview frames with
 * `Function.prototype.toString`, so it must not reference anything outside
 * its own body.
 */
export interface StreamOwnership {
  /** Nodes the stream inserted. */
  nodes: WeakSet<Node>;
  /** The attributes the stream last gave each element it owns. */
  attributes: WeakMap<Element, Map<string, string>>;
}

export function morphChildren(
  target: Node,
  source: Node,
  markAttribute: string,
  onInsert?: (element: Element) => void,
  keepChildren?: (element: Element) => boolean,
  ownership?: StreamOwnership,
): void {
  const doc = target.ownerDocument ?? (target as Document);

  // A template's markup lives in its content fragment, not its children.
  const templateContent = (node: Node): DocumentFragment | null =>
    (node as Element).tagName === "TEMPLATE"
      ? (node as HTMLTemplateElement).content
      : null;
  const own = (node: Node): void => {
    if (!ownership) return;
    ownership.nodes.add(node);
    if (node.nodeType === 1) recordAttributes(node as Element);
    node.childNodes.forEach(own);
    templateContent(node)?.childNodes.forEach(own);
  };
  const childrenToMatch = (node: Node) =>
    Array.from(node.childNodes).filter(
      (child) => !ownership || ownership.nodes.has(child),
    );

  // What the stream gave `element`, taken from `source` (by default the
  // element itself, as it was inserted).
  const recordAttributes = (element: Element, source: Element = element) => {
    if (!ownership) return;
    const applied = new Map<string, string>();
    for (const attr of Array.from(source.attributes)) {
      if (attr.name !== markAttribute) applied.set(attr.name, attr.value);
    }
    ownership.attributes.set(element, applied);
  };
  const syncAttributes = (to: Element, from: Element) => {
    const applied = ownership?.attributes.get(to);
    // Whether the live value is still the stream's: a runtime may own it.
    const untouched = (name: string) =>
      !ownership ||
      (applied?.has(name)
        ? to.getAttribute(name) === applied.get(name)
        : !to.hasAttribute(name));
    for (const attr of Array.from(to.attributes)) {
      if (attr.name === markAttribute || from.hasAttribute(attr.name)) continue;
      if (!ownership || applied?.get(attr.name) === attr.value) {
        to.removeAttribute(attr.name);
      }
    }
    for (const attr of Array.from(from.attributes)) {
      if (to.getAttribute(attr.name) === attr.value) continue;
      if (untouched(attr.name)) to.setAttribute(attr.name, attr.value);
    }
    recordAttributes(to, from);
  };

  const inserted: Element[] = [];
  const adopt = (node: Node): Node => {
    const copy = doc.importNode(node, true);
    own(copy);
    if (copy.nodeType === 1) {
      (copy as Element).setAttribute(markAttribute, "");
      inserted.push(copy as Element);
    }
    return copy;
  };

  const sameKind = (a: Node, b: Node) =>
    a.nodeType === b.nodeType &&
    (a.nodeType !== 1 || (a as Element).tagName === (b as Element).tagName);

  const patch = (to: Node, from: Node) => {
    const next = Array.from(from.childNodes);
    const current = childrenToMatch(to);
    // A runtime replaced everything the stream put here (Alpine's x-text or
    // x-html): the content is the runtime's now, and the source's fallback
    // must not be appended beside it.
    if (ownership && current.length === 0 && to.childNodes.length > 0) return;
    next.forEach((wanted, i) => {
      const existing = current.at(i);
      if (!existing) {
        to.appendChild(adopt(wanted));
        return;
      }
      if (!sameKind(existing, wanted)) {
        to.replaceChild(adopt(wanted), existing);
        return;
      }
      if (existing.nodeType === 1) {
        const element = existing as Element;
        syncAttributes(element, wanted as Element);
        // A script's text never changes once present; rewriting it is a no-op
        // for the browser and would only churn the DOM.
        const content = templateContent(element);
        const wantedContent = templateContent(wanted);
        if (content && wantedContent) patch(content, wantedContent);
        else if (element.tagName !== "SCRIPT" && !keepChildren?.(element)) {
          patch(element, wanted);
        }
      } else if (existing.nodeValue !== wanted.nodeValue) {
        existing.nodeValue = wanted.nodeValue;
      }
    });
    for (const extra of current.slice(next.length)) to.removeChild(extra);
  };

  patch(target, source);
  if (onInsert) inserted.forEach(onInsert);
}
