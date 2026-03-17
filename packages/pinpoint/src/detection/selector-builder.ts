// @agent-native/pinpoint — CSS selector generation using @medv/finder
// MIT License

import { finder } from "@medv/finder";

export interface SelectorOptions {
  /** Timeout for selector generation (ms) */
  timeoutMs?: number;
  /** Additional class names to skip */
  skipClassPatterns?: RegExp[];
}

const DEFAULT_SKIP_CLASSES = [
  /^css-/, // CSS-in-JS (Emotion, etc.)
  /^_/, // CSS Modules hashes
  /^sc-/, // styled-components
  /^go\d/, // Goober
  /^tw-/, // Tailwind utilities (sometimes hashed)
  /^chakra-/, // Chakra UI internals
];

const DEFAULT_SKIP_IDS = [
  /^:r[0-9]/, // React auto-generated IDs
  /^radix-/, // Radix UI auto IDs
  /^headlessui-/, // HeadlessUI auto IDs
];

/**
 * Generate a unique, human-readable CSS selector for an element.
 * Uses @medv/finder (MIT) with configuration to skip CSS-in-JS hashes.
 */
export function buildSelector(
  element: Element,
  options: SelectorOptions = {},
): string {
  const { timeoutMs = 200, skipClassPatterns = [] } = options;

  const allSkipClasses = [...DEFAULT_SKIP_CLASSES, ...skipClassPatterns];

  try {
    return finder(element, {
      className: (name: string) =>
        !allSkipClasses.some((pattern) => pattern.test(name)),
      idName: (name: string) =>
        !DEFAULT_SKIP_IDS.some((pattern) => pattern.test(name)),
      attr: (name: string) =>
        name.startsWith("data-testid") || name.startsWith("data-cy"),
      timeoutMs,
    });
  } catch {
    // Fallback: build a basic selector from tag + classes
    return buildFallbackSelector(element);
  }
}

function buildFallbackSelector(element: Element): string {
  const parts: string[] = [];

  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  parts.push(element.tagName.toLowerCase());

  // Use data-testid if available
  const testId = element.getAttribute("data-testid");
  if (testId) {
    return `[data-testid="${CSS.escape(testId)}"]`;
  }

  // Add meaningful class names
  const classes = Array.from(element.classList).filter(
    (name) => !DEFAULT_SKIP_CLASSES.some((pattern) => pattern.test(name)),
  );
  if (classes.length > 0) {
    parts.push(`.${classes.map((c) => CSS.escape(c)).join(".")}`);
  }

  // Add nth-child for uniqueness
  const parent = element.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter(
      (child) => child.tagName === element.tagName,
    );
    if (siblings.length > 1) {
      const index = siblings.indexOf(element) + 1;
      parts.push(`:nth-child(${index})`);
    }
  }

  return parts.join("");
}
