import type { TweakDefinition } from "./api.js";
import { sourceContentHash } from "./source-workspace.js";

export type TweakSelections = Record<string, string | number | boolean>;

export function tweakSelectionsHash(
  selections: Readonly<Record<string, unknown>>,
): string {
  const canonicalEntries = Object.keys(selections)
    .sort()
    .map((key) => [key, selections[key]]);
  return sourceContentHash(JSON.stringify(canonicalEntries));
}

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
const CSS_ATTR_TYPE_SYNTAX =
  /\battr\(\s*(?:[-_a-z][\w-]*\s*\|\s*)?[-_a-z][\w-]*\s+type\(\s*([^()]*)\s*\)/gi;
const SAFE_CSS_ATTR_SYNTAX_TYPES = new Set([
  "angle",
  "color",
  "custom-ident",
  "integer",
  "length",
  "length-percentage",
  "number",
  "percentage",
  "resolution",
  "string",
  "time",
  "transform-function",
  "transform-list",
]);

function hasOnlySafeCssAttrTypeSyntax(value: string): boolean {
  const valueWithoutTypedAngles = value.replace(
    CSS_ATTR_TYPE_SYNTAX,
    (match, syntax: string) => {
      const components = syntax.split("|").map((component) => component.trim());
      if (
        !components.every((component) => {
          const type = component.replace(/[+#]$/, "");
          const angleType = type.match(/^<([a-z-]+)>$/i)?.[1]?.toLowerCase();
          return angleType
            ? SAFE_CSS_ATTR_SYNTAX_TYPES.has(angleType)
            : /^[-_a-z][\w-]*$/i.test(type);
        })
      ) {
        return match;
      }
      return match.replace(/<([a-z-]+)>/gi, "$1");
    },
  );
  return !/[<>]/.test(valueWithoutTypedAngles);
}

export function isSafeCssVarName(value: string): boolean {
  return CSS_CUSTOM_PROPERTY_NAME.test(value);
}

export function isSafeCssTokenValue(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 300 &&
    !/[;{}]/.test(value) &&
    hasOnlySafeCssAttrTypeSyntax(value) &&
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
