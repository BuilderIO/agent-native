// @agent-native/pinpoint — Element metadata extraction
// MIT License

import type {
  ElementInfo,
  ElementContext,
  FrameworkInfo,
} from "../types/index.js";
import { buildSelector } from "./selector-builder.js";

/** Relevant computed style properties to capture */
const STYLE_KEYS = [
  "color",
  "backgroundColor",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "lineHeight",
  "padding",
  "margin",
  "border",
  "borderRadius",
  "display",
  "position",
  "width",
  "height",
  "opacity",
  "zIndex",
  "overflow",
  "textAlign",
  "textDecoration",
] as const;

/**
 * Extract comprehensive metadata from a DOM element.
 */
export function extractElementInfo(element: Element): ElementInfo {
  const rect = element.getBoundingClientRect();
  const computed = window.getComputedStyle(element);

  // Extract computed styles (relevant subset)
  const computedStyles: Record<string, string> = {};
  for (const key of STYLE_KEYS) {
    const value = computed.getPropertyValue(
      key.replace(/([A-Z])/g, "-$1").toLowerCase(),
    );
    if (value) {
      computedStyles[key] = value;
    }
  }

  // Extract ARIA attributes
  const ariaAttributes: Record<string, string> = {};
  for (const attr of element.attributes) {
    if (attr.name.startsWith("aria-") || attr.name === "role") {
      ariaAttributes[attr.name] = attr.value;
    }
  }

  // Extract data attributes
  const dataAttributes: Record<string, string> = {};
  for (const attr of element.attributes) {
    if (attr.name.startsWith("data-")) {
      dataAttributes[attr.name] = attr.value;
    }
  }

  // Build DOM path
  const domPath = buildDomPath(element);

  // Get text content (truncated)
  const textContent = getTextContent(element);

  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || undefined,
    classNames: Array.from(element.classList),
    selector: buildSelector(element),
    textContent,
    boundingRect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    computedStyles,
    ariaAttributes:
      Object.keys(ariaAttributes).length > 0 ? ariaAttributes : undefined,
    dataAttributes:
      Object.keys(dataAttributes).length > 0 ? dataAttributes : undefined,
    domPath,
  };
}

/**
 * Build a full ElementContext including HTML snippet and framework info.
 */
export function buildElementContext(
  element: Element,
  frameworkInfo?: FrameworkInfo,
): ElementContext {
  const info = extractElementInfo(element);
  const htmlSnippet = getCleanedHtml(element);

  return {
    element: info,
    framework: frameworkInfo,
    htmlSnippet,
    cssSelector: info.selector,
    computedStyles: info.computedStyles || {},
  };
}

/**
 * Get text content of an element, truncated to 200 characters.
 * Only includes direct text nodes, not deeply nested text.
 */
function getTextContent(element: Element): string | undefined {
  // Get direct text content only (not children's text)
  let text = "";
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent?.trim() || "";
    }
  }

  // Fallback to full textContent if no direct text
  if (!text) {
    text = element.textContent?.trim() || "";
  }

  if (!text) return undefined;
  return text.length > 200 ? text.slice(0, 200) + "..." : text;
}

/**
 * Build a DOM path string like: html > body > div#root > main > section.hero
 */
function buildDomPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.documentElement) {
    let part = current.tagName.toLowerCase();
    if (current.id) {
      part += `#${current.id}`;
    } else if (current.classList.length > 0) {
      const firstClass = current.classList[0];
      if (firstClass && !/^(css-|_|sc-)/.test(firstClass)) {
        part += `.${firstClass}`;
      }
    }
    parts.unshift(part);
    current = current.parentElement;
  }

  return parts.join(" > ");
}

/**
 * Get a cleaned HTML snippet of an element.
 * Removes inline event handlers and excessive whitespace.
 */
function getCleanedHtml(element: Element, maxLength = 500): string {
  const clone = element.cloneNode(true) as Element;

  // Remove event handler attributes
  const allElements = [clone, ...Array.from(clone.querySelectorAll("*"))];
  for (const el of allElements) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("on")) {
        el.removeAttribute(attr.name);
      }
    }
  }

  let html = clone.outerHTML;
  // Collapse whitespace
  html = html.replace(/\s+/g, " ").trim();

  if (html.length > maxLength) {
    // Truncate but keep the opening tag intact
    const openTagEnd = html.indexOf(">") + 1;
    if (openTagEnd > 0 && openTagEnd < maxLength) {
      html = html.slice(0, maxLength) + "...";
    }
  }

  return html;
}
