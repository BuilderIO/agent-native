import { resolveCanvasIntent } from "./canvas-dimensions.js";

const SPECIFICATION_SIGNAL_PATTERNS = [
  /\b(?:attached|uploaded|reference|mockup|screenshot|wireframe|source of truth|source-of-truth)\b/i,
  /\b(?:\d+\s*[- ]\s*col(?:umn)?|grid spec|layout spec|section order|feature list)\b/i,
  /\b(?:design system|brand system|brand kit|visual language|tokens?)\b/i,
] as const;

/** A brief `present-design-variants` cannot satisfy with direction-only variants. */
export function hasSpecifiedDesignPrompt(prompt?: string): boolean {
  const value = prompt?.trim() ?? "";
  if (!value) return false;
  if (resolveCanvasIntent(value).kind === "fixed") return true;
  return SPECIFICATION_SIGNAL_PATTERNS.some((pattern) => pattern.test(value));
}
