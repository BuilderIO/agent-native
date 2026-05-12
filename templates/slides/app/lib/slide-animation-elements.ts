export interface ParsedAnimationElement {
  index: number;
  path: number[];
  preview: string;
}

export interface AnimationTarget {
  elementIndex: number;
  elementPath?: number[];
}

const INLINE_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "br",
  "code",
  "em",
  "i",
  "mark",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
]);

const SKIPPED_TAGS = new Set(["script", "style", "template"]);

function normalizeText(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function hasOwnText(element: Element): boolean {
  return Array.from(element.childNodes).some(
    (node) =>
      node.nodeType === Node.TEXT_NODE && normalizeText(node.textContent),
  );
}

function hasVisualStyle(element: Element): boolean {
  const style = element.getAttribute("style") ?? "";
  return /(?:^|;)\s*(background(?:-color)?|border|box-shadow|width|height|min-width|min-height)\s*:/i.test(
    style,
  );
}

function hasMeaningfulContent(element: Element): boolean {
  if (SKIPPED_TAGS.has(element.tagName.toLowerCase())) return false;
  return (
    normalizeText(element.textContent).length > 0 ||
    hasVisualStyle(element) ||
    element.matches("img,svg,video,canvas,table,.fmd-img-placeholder") ||
    !!element.querySelector("img,svg,video,canvas,table,.fmd-img-placeholder")
  );
}

function shouldKeepAsSingleElement(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();

  if (SKIPPED_TAGS.has(tagName)) return false;
  if (
    element.matches(
      "img,svg,video,canvas,table,.fmd-img-placeholder,h1,h2,h3,h4,h5,h6,p,li,blockquote,pre",
    )
  ) {
    return true;
  }

  const children = Array.from(element.children).filter(
    (child) => !SKIPPED_TAGS.has(child.tagName.toLowerCase()),
  );
  if (children.length === 0) return hasMeaningfulContent(element);
  if (hasOwnText(element)) return true;

  // Rows composed of inline fragments, like bullet-dot + text spans, should
  // animate as one visual unit instead of exposing punctuation as a target.
  return children.every((child) =>
    INLINE_TAGS.has(child.tagName.toLowerCase()),
  );
}

function collectAnimationElements(
  parent: Element,
  parentPath: number[],
  elements: ParsedAnimationElement[],
) {
  Array.from(parent.children).forEach((child, childIndex) => {
    if (SKIPPED_TAGS.has(child.tagName.toLowerCase())) return;

    const path = [...parentPath, childIndex];
    if (shouldKeepAsSingleElement(child)) {
      if (hasMeaningfulContent(child)) {
        elements.push({
          index: elements.length,
          path,
          preview: getElementPreview(child, `Element ${elements.length + 1}`),
        });
      }
      return;
    }

    const before = elements.length;
    collectAnimationElements(child, path, elements);
    if (elements.length === before && hasMeaningfulContent(child)) {
      elements.push({
        index: elements.length,
        path,
        preview: getElementPreview(child, `Element ${elements.length + 1}`),
      });
    }
  });
}

export function animationElementKey(path: number[]): string {
  return path.join(".");
}

export function findLegacyAnimationContainer(root: Element): Element | null {
  const children = Array.from(root.children);
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i].children.length >= 2) return children[i];
  }
  return null;
}

export function getElementPreview(element: Element, fallback: string): string {
  const text = normalizeText(element.textContent);
  if (text) return text.slice(0, 50);

  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return normalizeText(ariaLabel).slice(0, 50);

  const alt = element.getAttribute("alt");
  if (alt) return normalizeText(alt).slice(0, 50);

  return fallback;
}

export function getElementPath(
  root: Element,
  target: Element,
): number[] | null {
  const path: number[] = [];
  let current: Element | null = target;

  while (current && current !== root) {
    const parent = current.parentElement;
    if (!parent) return null;
    const index = Array.from(parent.children).indexOf(current);
    if (index === -1) return null;
    path.unshift(index);
    current = parent;
  }

  return current === root ? path : null;
}

export function resolveElementPath(
  root: Element,
  path: number[],
): Element | null {
  let current: Element | null = root;

  for (const index of path) {
    const next = current.children.item(index);
    if (!next) return null;
    current = next;
  }

  return current;
}

export function parseSlideAnimationElements(
  html: string,
): ParsedAnimationElement[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector(".fmd-slide");
  if (!root) return [];

  const elements: ParsedAnimationElement[] = [];
  collectAnimationElements(root, [], elements);
  return elements;
}

export function resolveSlideAnimationElement(
  root: Element,
  target: AnimationTarget,
): Element | null {
  if (Array.isArray(target.elementPath) && target.elementPath.length > 0) {
    const pathTarget = resolveElementPath(root, target.elementPath);
    if (pathTarget) return pathTarget;
  }

  const legacyContainer = findLegacyAnimationContainer(root);
  return legacyContainer?.children.item(target.elementIndex) ?? null;
}

export function getSlideAnimationTargetKey(
  html: string,
  target: AnimationTarget,
): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector(".fmd-slide");
  if (!root) return null;

  const element = resolveSlideAnimationElement(root, target);
  if (!element) return null;

  const path = getElementPath(root, element);
  return path ? animationElementKey(path) : null;
}

export function getSlideAnimationTargetPreview(
  html: string,
  target: AnimationTarget,
): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root = doc.querySelector(".fmd-slide");
  if (!root) return `Element ${target.elementIndex + 1}`;

  const element = resolveSlideAnimationElement(root, target);
  return element
    ? getElementPreview(element, `Element ${target.elementIndex + 1}`)
    : `Element ${target.elementIndex + 1}`;
}
