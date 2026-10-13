import {
  guessTokenType,
  type DesignTokenType,
} from "../../shared/design-token-types.js";

/**
 * Parser for W3C Design Tokens Community Group (DTCG) files: nested groups of
 * `{ "$value": …, "$type": … }` tokens, where `$type` may be declared on a
 * parent group and `{group.token}` references point at other tokens.
 */

export interface DtcgToken {
  cssVar: string;
  value: string;
  /** Absent when the DTCG token has no `$type`; the caller guesses one. */
  type?: DesignTokenType;
}

export function toKebab(value: string): string {
  return (
    value
      .trim()
      .replace(/^--/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "token"
  );
}

type Json = unknown;

interface RawToken {
  path: string[];
  type?: string;
  value: Json;
}

const REFERENCE = /^\{([^{}]+)\}$/;

function isRecord(value: Json): value is Record<string, Json> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cssVarForPath(path: string[]): string {
  return `--${path.map(toKebab).join("-")}`;
}

function collect(
  node: Record<string, Json>,
  path: string[],
  inheritedType: string | undefined,
  out: RawToken[],
): void {
  const type = typeof node.$type === "string" ? node.$type : inheritedType;
  if ("$value" in node) {
    out.push({ path, type, value: node.$value });
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$") || !isRecord(child)) continue;
    collect(child, [...path, key], type, out);
  }
}

function hasDtcgToken(node: Json): boolean {
  if (!isRecord(node)) return false;
  if ("$value" in node) return true;
  return Object.entries(node).some(
    ([key, child]) => !key.startsWith("$") && hasDtcgToken(child),
  );
}

const COLOR_FUNCTION_SPACES = new Set([
  "srgb",
  "srgb-linear",
  "display-p3",
  "a98-rgb",
  "prophoto-rgb",
  "rec2020",
  "xyz",
  "xyz-d50",
  "xyz-d65",
]);
const NAMED_COLOR_SPACES = new Set(["oklch", "oklab", "lab", "lch"]);

function formatColor(value: Json): string | null {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return null;
  if (typeof value.hex === "string" && value.alpha === undefined) {
    return value.hex;
  }
  const space = typeof value.colorSpace === "string" ? value.colorSpace : "";
  if (!Array.isArray(value.components)) return null;
  const channels = value.components.map(String).join(" ");
  const alpha =
    typeof value.alpha === "number" && value.alpha < 1
      ? ` / ${value.alpha}`
      : "";
  if (COLOR_FUNCTION_SPACES.has(space)) {
    return `color(${space} ${channels}${alpha})`;
  }
  if (NAMED_COLOR_SPACES.has(space)) return `${space}(${channels}${alpha})`;
  return typeof value.hex === "string" ? value.hex : null;
}

function formatDimension(value: Json): string | null {
  if (typeof value === "string") return value;
  if (
    isRecord(value) &&
    typeof value.value === "number" &&
    typeof value.unit === "string"
  ) {
    return `${value.value}${value.unit}`;
  }
  return null;
}

function formatFontFamily(value: Json): string | null {
  const families = Array.isArray(value) ? value : [value];
  if (!families.every((family) => typeof family === "string")) return null;
  return (families as string[])
    .map((family) => (/\s/.test(family) ? `"${family}"` : family))
    .join(", ");
}

function formatScalar(value: Json): string | null {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

function formatCubicBezier(value: Json): string | null {
  if (typeof value === "string") return value;
  if (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => typeof n === "number")
  ) {
    return `cubic-bezier(${value.join(", ")})`;
  }
  return null;
}

function formatShadow(
  value: Json,
  resolve: (value: Json) => Json,
): string | null {
  if (typeof value === "string") return value;
  const layers = Array.isArray(value) ? value : [value];
  const parts: string[] = [];
  for (const layer of layers) {
    if (!isRecord(layer)) return null;
    const dims = ["offsetX", "offsetY", "blur", "spread"].map((key) =>
      formatDimension(resolve(layer[key] ?? "0")),
    );
    const color = formatColor(resolve(layer.color));
    if (dims.some((dim) => dim === null) || !color) return null;
    parts.push(
      [layer.inset === true ? "inset" : null, ...dims, color]
        .filter(Boolean)
        .join(" "),
    );
  }
  return parts.join(", ");
}

const DIMENSION_TYPES = new Set<DesignTokenType>([
  "font-size",
  "line-height",
  "letter-spacing",
  "spacing",
  "container",
  "breakpoint",
  "radius",
]);
const NUMBER_TYPES = new Set<DesignTokenType>([
  "font-weight",
  "line-height",
  "opacity",
]);

/**
 * A DTCG `dimension` or `number` says what the value is, not what it is for;
 * the name decides that, limited to the types that value can be.
 */
function typeFromName(
  cssVar: string,
  value: string,
  allowed: Set<DesignTokenType>,
): DesignTokenType | undefined {
  const guess = guessTokenType(cssVar, value);
  return allowed.has(guess) ? guess : undefined;
}

const TYPOGRAPHY_PARTS: {
  key: string;
  type: DesignTokenType;
  format: (value: Json) => string | null;
}[] = [
  {
    key: "fontFamily",
    type: "font-family",
    format: formatFontFamily,
  },
  {
    key: "fontWeight",
    type: "font-weight",
    format: formatScalar,
  },
  {
    key: "fontSize",
    type: "font-size",
    format: formatDimension,
  },
  {
    key: "lineHeight",
    type: "line-height",
    format: (v) => formatScalar(v) ?? formatDimension(v),
  },
  {
    key: "letterSpacing",
    type: "letter-spacing",
    format: formatDimension,
  },
];

/**
 * Returns the tokens in a DTCG file, or `null` when the content is not a DTCG
 * file at all, so the caller can fall back to its generic parsers. Tokens whose
 * type or value cannot be expressed as one CSS value (border, gradient,
 * transition, unresolvable references) are left out.
 */
export function parseDtcgTokens(content: string): DtcgToken[] | null {
  let json: Json;
  try {
    json = JSON.parse(content);
    // coercion-ok: non-JSON content is "not DTCG" (null), distinct from an empty DTCG file ([]); callers fall back to the CSS/Tailwind parsers.
  } catch {
    return null;
  }
  if (!hasDtcgToken(json)) return null;

  const raw: RawToken[] = [];
  collect(json as Record<string, Json>, [], undefined, raw);
  const byPath = new Map(raw.map((token) => [token.path.join("."), token]));

  // References become `var(--…)` so the imported tokens keep their links.
  const resolve = (value: Json): Json => {
    if (typeof value !== "string") return value;
    const match = value.match(REFERENCE);
    if (!match) return value;
    const target = byPath.get(match[1]);
    return target ? `var(${cssVarForPath(target.path)})` : undefined;
  };

  const tokens: DtcgToken[] = [];
  for (const token of raw) {
    const cssVar = cssVarForPath(token.path);
    const value = resolve(token.value);
    if (value === undefined) continue;
    const push = (formatted: string | null, type?: DesignTokenType) => {
      if (formatted) tokens.push({ cssVar, value: formatted, type });
    };

    switch (token.type) {
      case "color":
        push(formatColor(value), "color");
        break;
      case "dimension": {
        const formatted = formatDimension(value);
        push(
          formatted,
          formatted
            ? (typeFromName(cssVar, formatted, DIMENSION_TYPES) ?? "spacing")
            : undefined,
        );
        break;
      }
      case "fontFamily":
        push(formatFontFamily(value), "font-family");
        break;
      case "fontWeight":
        push(formatScalar(value), "font-weight");
        break;
      case "number": {
        const formatted = formatScalar(value);
        push(
          formatted,
          formatted ? typeFromName(cssVar, formatted, NUMBER_TYPES) : undefined,
        );
        break;
      }
      case "shadow":
        push(formatShadow(value, resolve), "shadow");
        break;
      case "duration":
        push(formatDimension(value), "motion");
        break;
      case "cubicBezier":
        push(formatCubicBezier(value), "motion");
        break;
      case "typography":
        if (!isRecord(value)) break;
        for (const part of TYPOGRAPHY_PARTS) {
          const partValue = resolve(value[part.key]);
          const formatted =
            partValue === undefined ? null : part.format(partValue);
          if (formatted) {
            tokens.push({
              cssVar: `${cssVar}-${part.type}`,
              value: formatted,
              type: part.type,
            });
          }
        }
        break;
      case undefined:
        push(formatScalar(value));
        break;
      default:
        break;
    }
  }
  return tokens;
}
