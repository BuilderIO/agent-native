import { act } from "react";

/**
 * How a test reaches the tagged parts of a settings surface, whatever draws
 * it. Nothing here knows a skin: a caller mounts the surface itself.
 */

export function click(element: Element): void {
  act(() => {
    (element as HTMLElement).click();
  });
}

function interactive(element: Element): HTMLElement {
  const target = element.matches("button, input, textarea, a")
    ? element
    : element.querySelector("button, input, textarea, a");
  if (!target) {
    throw new Error(
      `nothing to operate in ${element.getAttribute("data-rid")}`,
    );
  }
  return target as HTMLElement;
}

/** A tagged element by row id and part, and by entity key for a collection item. */
export function tagged(
  root: ParentNode,
  rid: string,
  part: string,
  key?: string,
): Element {
  const selector =
    `[data-rid="${rid}"][data-part="${part}"]` +
    (key === undefined ? "" : `[data-rid-key="${key}"]`);
  const found = root.querySelector(selector);
  if (!found) throw new Error(`no element for ${selector}`);
  return found;
}

/** The control of a tagged part: the element itself, or the first button, input or link inside it. */
export function partControl(
  root: ParentNode,
  rid: string,
  part: string,
  key?: string,
): HTMLElement {
  return interactive(tagged(root, rid, part, key));
}
