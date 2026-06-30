/**
 * Shared, pure tweak-value resolver.
 *
 * The Design editor exposes a small set of live "knobs" (color swatches,
 * segmented controls, sliders, toggles) bound to CSS custom properties the
 * generated design's `:root` block actually defines. This module is the single
 * source of truth for turning a `{ tweakId -> value }` selection map into the
 * `{ "--css-var" -> "resolved string" }` map that both:
 *
 *  - the editor pushes into the live preview iframe, and
 *  - the snapshot / coding-handoff actions inject so an external agent
 *    continues from the *tuned* design, not the original generated tokens.
 *
 * Keep it pure and dependency-free so the UI and the server actions produce
 * byte-identical output.
 */

import type { TweakDefinition } from "./api.js";

export type TweakSelections = Record<string, string | number | boolean>;

/**
 * Resolve tweak definitions + a selection map to concrete CSS custom-property
 * assignments. Rules (must match the editor's historical inline behavior):
 *
 *  - booleans  -> "1" / "0"
 *  - numbers   -> `${value}` plus `t.unit` when provided, falling back to "px"
 *                 when the CSS var name contains "radius", otherwise unitless
 *  - strings   -> the string as-is
 *
 * Tweaks without a `cssVar` are skipped (they don't map to a property).
 * A missing selection falls back to the tweak's `defaultValue`.
 * Selection keys that are themselves safe CSS custom properties are also
 * emitted directly, which lets token edits persist vars that were not part of
 * the generated tweak definition list.
 */
const CSS_CUSTOM_PROPERTY_NAME = /^--[-_a-zA-Z0-9]+$/;

export function isSafeCssVarName(value: string): boolean {
  return CSS_CUSTOM_PROPERTY_NAME.test(value);
}

export function isSafeCssTokenValue(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 300 &&
    !/[;{}<>]/.test(value) &&
    !/\/\*/.test(value) &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function resolveTweaksToCssVars(
  tweaks: TweakDefinition[],
  selections: TweakSelections,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tweaks) {
    if (!t.cssVar || !isSafeCssVarName(t.cssVar)) continue;
    const v = selections[t.id] ?? t.defaultValue;
    const resolved = stringifyCssVarValue(t.cssVar, v, t.unit);
    if (isSafeCssTokenValue(resolved)) {
      out[t.cssVar] = resolved;
    }
  }

  for (const [key, value] of Object.entries(selections)) {
    if (!isDirectCssVarSelectionKey(key)) continue;
    const resolved = stringifyCssVarValue(key, value);
    if (isSafeCssTokenValue(resolved)) {
      out[key] = resolved;
    }
  }

  return out;
}

export function isDirectCssVarSelectionKey(key: string): boolean {
  return isSafeCssVarName(key);
}

function stringifyCssVarValue(
  cssVar: string,
  value: string | number | boolean,
  unit?: string,
): string {
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }
  if (typeof value === "number") {
    const resolvedUnit =
      unit ?? (cssVar.toLowerCase().includes("radius") ? "px" : "");
    return `${value}${resolvedUnit}`;
  }
  return String(value);
}

/**
 * Render resolved CSS vars as a `:root { ... }` block. Used by the
 * coding-handoff bundle so external agents inherit the user's tuned tokens
 * even if they only read the prompt.
 */
export function renderResolvedRootBlock(
  resolvedCssVars: Record<string, string>,
): string {
  const entries = Object.entries(resolvedCssVars);
  const safeEntries = entries.filter(
    ([name, value]) => isSafeCssVarName(name) && isSafeCssTokenValue(value),
  );
  if (safeEntries.length === 0) return "";
  const decls = safeEntries
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  return `:root {\n${decls}\n}`;
}
