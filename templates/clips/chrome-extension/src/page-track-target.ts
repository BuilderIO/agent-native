const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "label",
  "[role]",
  "[tabindex]",
  "[contenteditable='']",
  "[contenteditable='true']",
].join(", ");
const MAX_NAME_CHARS = 200;
const MAX_SELECTOR_DEPTH = 4;
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export type PageTargetPrivacy = {
  blockSelector: string;
  maskTextClass: string;
  maskTextSelector: string;
};

export type PageTarget = {
  id: number;
  rect: { x: number; y: number; width: number; height: number };
  role: string | null;
  name: string | null;
  selector: string;
  blocked: boolean;
};

export function maskText(text: string): string {
  return text.replace(/\S/g, "*");
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_CHARS);
}

export function implicitRole(element: Element): string | null {
  const explicit = element.getAttribute("role")?.trim();
  if (explicit) return /^\S+/.exec(explicit)?.[0] ?? null;
  const tag = element.localName;
  if (tag === "a") return element.hasAttribute("href") ? "link" : null;
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "img") return "img";
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "li") return "listitem";
  if (tag !== "input") return null;
  const type = (element.getAttribute("type") ?? "text").toLowerCase();
  if (type === "checkbox" || type === "radio") return type;
  if (type === "range") return "slider";
  if (type === "button" || type === "submit" || type === "reset") {
    return "button";
  }
  if (type === "hidden") return null;
  return "textbox";
}

function isMasked(element: Element, privacy: PageTargetPrivacy): boolean {
  return (
    matchesWithin(element, `.${escapeIdent(privacy.maskTextClass)}`) ||
    matchesWithin(element, privacy.maskTextSelector)
  );
}

function containsPrivate(
  element: Element,
  privacy: PageTargetPrivacy,
): boolean {
  try {
    return (
      element.querySelector(
        [
          privacy.blockSelector,
          `.${escapeIdent(privacy.maskTextClass)}`,
          privacy.maskTextSelector,
        ].join(", "),
      ) !== null
    );
  } catch {
    return true;
  }
}

function collectText(
  node: Node,
  privacy: PageTargetPrivacy,
  masked: boolean,
  parts: string[],
): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === TEXT_NODE) {
      const text = child.nodeValue ?? "";
      parts.push(masked ? maskText(text) : text);
    } else if (child.nodeType === ELEMENT_NODE) {
      const element = child as Element;
      if (matchesWithin(element, privacy.blockSelector)) continue;
      collectText(
        element,
        privacy,
        masked || isMasked(element, privacy),
        parts,
      );
    }
  }
}

function shownText(element: Element, privacy: PageTargetPrivacy): string {
  if (matchesWithin(element, privacy.blockSelector)) return "";
  const masked = isMasked(element, privacy);
  if (!containsPrivate(element, privacy)) {
    const text = (element as HTMLElement).innerText || element.textContent;
    return masked ? maskText(text) : text;
  }
  const parts: string[] = [];
  collectText(element, privacy, masked, parts);
  return parts.join(" ");
}

function labelledByText(element: Element, privacy: PageTargetPrivacy): string {
  const ids = element.getAttribute("aria-labelledby")?.trim();
  if (!ids) return "";
  return ids
    .split(/\s+/)
    .map((id) => element.ownerDocument.getElementById(id))
    .map((label) => (label ? shownText(label, privacy) : ""))
    .join(" ");
}

function fieldName(element: Element, privacy: PageTargetPrivacy): string {
  const labels = (element as HTMLInputElement).labels;
  const label = Array.from(labels ?? [], (item) =>
    shownText(item, privacy),
  ).find((text) => text.trim());
  if (label) return label;
  const placeholder = element.getAttribute("placeholder");
  if (placeholder?.trim()) return placeholder;
  const type = (element.getAttribute("type") ?? "").toLowerCase();
  if (
    element.localName === "input" &&
    (type === "button" || type === "submit" || type === "reset")
  ) {
    return (element as HTMLInputElement).value;
  }
  return element.getAttribute("title") ?? "";
}

export function accessibleName(
  element: Element,
  privacy: PageTargetPrivacy,
): string {
  const aria = element.getAttribute("aria-label");
  if (aria?.trim()) return collapse(aria);
  const labelledBy = labelledByText(element, privacy);
  if (labelledBy.trim()) return collapse(labelledBy);
  const tag = element.localName;
  if (tag === "input" || tag === "select" || tag === "textarea") {
    return collapse(fieldName(element, privacy));
  }
  if (tag === "img") return collapse(element.getAttribute("alt") ?? "");
  const text = shownText(element, privacy);
  if (text.trim()) return collapse(text.slice(0, MAX_NAME_CHARS * 10));
  return collapse(element.getAttribute("title") ?? "");
}

function escapeIdent(value: string): string {
  const css = (globalThis as { CSS?: { escape?: (value: string) => string } })
    .CSS;
  return css?.escape
    ? css.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

export function cssSelector(element: Element): string {
  const parts: string[] = [];
  let node: Element | null = element;
  while (node && parts.length < MAX_SELECTOR_DEPTH) {
    const tag = node.localName;
    const testId = node.getAttribute("data-testid");
    if (testId) {
      parts.unshift(`${tag}[data-testid="${escapeIdent(testId)}"]`);
      break;
    }
    if (node.id) {
      parts.unshift(`${tag}#${escapeIdent(node.id)}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    let part = tag;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (child) => child.localName === tag,
      );
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(" > ");
}

export function matchesWithin(element: Element, selector: string): boolean {
  try {
    return element.closest(selector) !== null;
  } catch {
    // coercion-ok: a selector this browser can't parse matches nothing.
    return false;
  }
}

export function pressedElement(start: Element): Element {
  return start.closest(INTERACTIVE_SELECTOR) ?? start;
}

export function describeTarget(
  start: Element,
  nodeId: (node: Node) => number,
  privacy: PageTargetPrivacy,
): PageTarget {
  const element = pressedElement(start);
  const box = element.getBoundingClientRect();
  const blocked = matchesWithin(element, privacy.blockSelector);
  const masked = isMasked(element, privacy);
  const name = blocked ? null : accessibleName(element, privacy);
  return {
    id: nodeId(element),
    rect: {
      x: Math.round(box.left),
      y: Math.round(box.top),
      width: Math.round(box.width),
      height: Math.round(box.height),
    },
    role: implicitRole(element),
    name: name === null || name === "" ? null : masked ? maskText(name) : name,
    selector: cssSelector(element),
    blocked,
  };
}

export type ViewportGeometry = {
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  screenX: number;
  screenY: number;
  screenLeft: number;
  screenTop: number;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
};

export type PageViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
  basis: "exact" | "estimated";
};

export function viewportInCapture(
  capture: "tab" | "window" | "display",
  captureWidthPx: number,
  captureHeightPx: number,
  geometry: ViewportGeometry,
): PageViewport {
  const dpr = geometry.devicePixelRatio > 0 ? geometry.devicePixelRatio : 1;
  if (capture === "tab") {
    return {
      x: 0,
      y: 0,
      width: captureWidthPx,
      height: captureHeightPx,
      dpr,
      basis: "exact",
    };
  }
  const sideBorder = Math.max(
    0,
    (geometry.outerWidth - geometry.innerWidth) / 2,
  );
  const top = Math.max(
    0,
    geometry.outerHeight - geometry.innerHeight - sideBorder,
  );
  const sourceWidth =
    capture === "window" ? geometry.outerWidth : geometry.screenWidth;
  const sourceHeight =
    capture === "window" ? geometry.outerHeight : geometry.screenHeight;
  const scaleX = sourceWidth > 0 ? captureWidthPx / (sourceWidth * dpr) : 1;
  const scaleY = sourceHeight > 0 ? captureHeightPx / (sourceHeight * dpr) : 1;
  const originX =
    capture === "window" ? 0 : geometry.screenX - geometry.screenLeft;
  const originY =
    capture === "window" ? 0 : geometry.screenY - geometry.screenTop;
  return {
    x: Math.round((originX + sideBorder) * dpr * scaleX),
    y: Math.round((originY + top) * dpr * scaleY),
    width: Math.round(geometry.innerWidth * dpr * scaleX),
    height: Math.round(geometry.innerHeight * dpr * scaleY),
    dpr,
    basis: "estimated",
  };
}
