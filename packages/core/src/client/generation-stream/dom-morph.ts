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
 * and are passed to `onInsert`.
 *
 * This function is serialized into sandboxed preview frames with
 * `Function.prototype.toString`, so it must not reference anything outside
 * its own body.
 */
export function morphChildren(
  target: Node,
  source: Node,
  markAttribute: string,
  onInsert?: (element: Element) => void,
): void {
  const doc = target.ownerDocument ?? (target as Document);

  const syncAttributes = (to: Element, from: Element) => {
    for (const attr of Array.from(to.attributes)) {
      if (attr.name === markAttribute) continue;
      if (!from.hasAttribute(attr.name)) to.removeAttribute(attr.name);
    }
    for (const attr of Array.from(from.attributes)) {
      if (to.getAttribute(attr.name) !== attr.value) {
        to.setAttribute(attr.name, attr.value);
      }
    }
  };

  const inserted: Element[] = [];
  const adopt = (node: Node): Node => {
    const copy = doc.importNode(node, true);
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
    const current = Array.from(to.childNodes);
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
        if (element.tagName !== "SCRIPT") patch(element, wanted);
      } else if (existing.nodeValue !== wanted.nodeValue) {
        existing.nodeValue = wanted.nodeValue;
      }
    });
    while (to.childNodes.length > next.length) {
      const extra = to.lastChild;
      if (!extra) break;
      to.removeChild(extra);
    }
  };

  patch(target, source);
  if (onInsert) inserted.forEach(onInsert);
}
