/**
 * Operations on Y.XmlFragment for ProseMirror-based collaborative editing.
 *
 * These produce minimal Yjs operations so the client-side ySyncPlugin
 * applies targeted ProseMirror transactions (preserving cursor/selection).
 */

import * as Y from "yjs";

/**
 * Walk a Y.XmlFragment tree and replace the first occurrence of `find`
 * with `replace` in Y.XmlText nodes.
 *
 * Returns true if a replacement was made, false if text was not found.
 */
export function searchAndReplaceInYXml(
  element: Y.XmlFragment | Y.XmlElement,
  find: string,
  replace: string,
): boolean {
  for (let i = 0; i < element.length; i++) {
    const child = element.get(i) as any;
    if (
      child &&
      typeof child.toString === "function" &&
      typeof child.delete === "function" &&
      typeof child.insert === "function" &&
      child.length !== undefined &&
      typeof child.get !== "function"
    ) {
      // Y.XmlText — has delete/insert but no get (not a container)
      const text = child.toString();
      const idx = text.indexOf(find);
      if (idx !== -1) {
        child.delete(idx, find.length);
        child.insert(idx, replace);
        return true;
      }
    } else if (child && typeof child.get === "function") {
      // Y.XmlElement or Y.XmlFragment — has get() for children
      if (searchAndReplaceInYXml(child, find, replace)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Extract all plain text from a Y.XmlFragment tree.
 * Joins block-level elements with newlines.
 */
export function extractTextFromYXml(
  element: Y.XmlFragment | Y.XmlElement,
): string {
  const parts: string[] = [];
  for (let i = 0; i < element.length; i++) {
    const child = element.get(i) as any;
    if (child && typeof child.get === "function") {
      // Container node (XmlElement/XmlFragment)
      parts.push(extractTextFromYXml(child));
    } else if (child) {
      // Text node
      parts.push(child.toString());
    }
  }
  return parts.join("\n");
}
