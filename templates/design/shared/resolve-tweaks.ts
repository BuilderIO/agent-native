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
 *  - numbers   -> `${value}` plus "px" when the CSS var name contains "radius",
 *                 otherwise unitless
 *  - strings   -> the string as-is
 *
 * Tweaks without a `cssVar` are skipped (they don't map to a property).
 * A missing selection falls back to the tweak's `defaultValue`.
 */
export function resolveTweaksToCssVars(
  tweaks: TweakDefinition[],
  selections: TweakSelections,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tweaks) {
    if (!t.cssVar) continue;
    const v = selections[t.id] ?? t.defaultValue;
    if (typeof v === "boolean") {
      out[t.cssVar] = v ? "1" : "0";
    } else if (typeof v === "number") {
      const unit = t.cssVar.toLowerCase().includes("radius") ? "px" : "";
      out[t.cssVar] = `${v}${unit}`;
    } else {
      out[t.cssVar] = String(v);
    }
  }
  return out;
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
  if (entries.length === 0) return "";
  const decls = entries
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  return `:root {\n${decls}\n}`;
}
