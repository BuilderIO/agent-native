import { defineAction } from "@agent-native/core/action";
import type { BrandKitTokenType } from "@agent-native/core/brand-kit";
import { buildDeepLink } from "@agent-native/core/server";
import {
  analyzeCodeFile,
  createCodeAnalysisState,
  extractCodeColors,
  extractCodeFonts,
  extractDocumentColors,
  extractDocumentFonts,
} from "@agent-native/core/server/design-token-utils";
import { assertAccess } from "@agent-native/core/sharing";
import * as csstree from "css-tree";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { parse as parseHtml } from "parse5";
import postcss from "postcss";
import postcssLess from "postcss-less";
import postcssScss from "postcss-scss";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js";
import {
  mutateDesignData,
  type DesignDataRecord,
} from "../server/lib/design-data-mutation.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  DESIGN_TOKEN_IMPORT_MAX_BODY_BYTES,
  DESIGN_TOKEN_IMPORT_MAX_FILES,
  DESIGN_TOKEN_IMPORT_MAX_FILENAME_CHARS,
  DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES,
} from "../shared/design-token-import-limits.js";
import {
  isSafeCssTokenValue,
  isSafeCssVarName,
  resolveTweaksToCssVars,
} from "../shared/resolve-tweaks.js";

type ImportedTokenType = BrandKitTokenType;

interface ImportedDesignToken {
  name: string;
  cssVar: string;
  value: string;
  type: ImportedTokenType;
  source: string;
}

type TweakDef = Parameters<typeof resolveTweaksToCssVars>[0][number];
type TweakSelections = Record<string, string | number | boolean>;

function readTweaks(data: DesignDataRecord): TweakDef[] {
  return Array.isArray(data.tweaks) ? (data.tweaks as TweakDef[]) : [];
}

function readSelections(data: DesignDataRecord): TweakSelections {
  return data.tweakSelections &&
    typeof data.tweakSelections === "object" &&
    !Array.isArray(data.tweakSelections)
    ? (data.tweakSelections as TweakSelections)
    : {};
}

function selectionKeyForCssVar(tweaks: TweakDef[], cssVar: string): string {
  return tweaks.find((tweak) => tweak.cssVar === cssVar)?.id ?? cssVar;
}

function tokenSourceLabel(token: ImportedDesignToken, sourceLabel: string) {
  return token.source === "CSS variables" || token.source === "Colors"
    ? sourceLabel
    : token.source;
}

const tokenFileSchema = z.object({
  filename: z
    .string()
    .max(DESIGN_TOKEN_IMPORT_MAX_FILENAME_CHARS)
    .trim()
    .min(1)
    .describe("File name or relative path"),
  content: z
    .string()
    .max(DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES)
    .describe("Raw text content"),
});

const tokenImportSchema = z
  .object({
    designId: z.string().min(1).max(256).describe("Design project ID"),
    source: z
      .enum(["files", "paste", "current-design"])
      .describe(
        "Where to import from: uploaded files, pasted text, or the current design files.",
      ),
    files: z
      .array(tokenFileSchema)
      .max(DESIGN_TOKEN_IMPORT_MAX_FILES)
      .optional()
      .describe("Files to parse when source is files"),
    text: z
      .string()
      .max(DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES)
      .optional()
      .describe("Pasted CSS, JSON, Tailwind config, or design.md content"),
  })
  .superRefine((args, ctx) => {
    if (args.source === "files" && (!args.files || args.files.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["files"],
        message: "files are required when source is files",
      });
    }
    if (args.source === "paste" && !args.text?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["text"],
        message: "text is required when source is paste",
      });
    }
    if ((args.files?.length ?? 0) > DESIGN_TOKEN_IMPORT_MAX_FILES) return;

    const contents = [
      ...(args.files?.map((file) => file.content) ?? []),
      ...(args.text === undefined ? [] : [args.text]),
    ];
    const totalCodeUnits = contents.reduce(
      (total, content) => total + content.length,
      0,
    );
    if (totalCodeUnits > DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [args.files?.length ? "files" : "text"],
        message: `Token import content must total at most ${DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES} bytes.`,
      });
      return;
    }

    const encoder = new TextEncoder();
    const totalBytes = contents.reduce(
      (total, content) => total + encoder.encode(content).byteLength,
      0,
    );
    if (totalBytes > DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [args.files?.length ? "files" : "text"],
        message: `Token import content must total at most ${DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES} bytes.`,
      });
    }
  });

function designDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId },
  });
}

function isMotionValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  return (
    /^-?\d*\.?\d+m?s$/.test(v) ||
    /^(cubic-bezier|steps|linear)\s*\(/.test(v) ||
    /^(linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end)$/.test(v)
  );
}

function isShadowValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === "none") return true;
  return /\d/.test(v) && /(px|rem|em)\b/.test(v);
}

function classifyVar(name: string, value: string): ImportedTokenType {
  const n = name.toLowerCase();
  if (isColorValue(value)) return "color";
  if (/radius|rounded/i.test(n)) return "radius";
  if (/font|size|leading|tracking|weight|heading|body|type/i.test(n)) {
    return "typography";
  }
  if (/spacing|gap|padding|margin|space/i.test(n)) return "spacing";
  if (/shadow|blur|drop|elevation/i.test(n)) return "shadow";
  if (/duration|easing|ease|transition|animation|motion|delay/i.test(n)) {
    return "motion";
  }
  if (
    /color|bg|background|text|border|accent|primary|secondary|surface|muted|foreground|fill|stroke/i.test(
      n,
    ) &&
    !/^-?\d*\.?\d+(px|rem|em|ex|ch|%|vh|vw|vmin|vmax|pt|pc|cm|mm|in|s|ms|deg|fr)?$/i.test(
      value.trim(),
    )
  ) {
    return "color";
  }
  return "other";
}

function isColorValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (
    /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\(|color\()/i.test(normalized)
  ) {
    return true;
  }
  return [
    "red",
    "blue",
    "green",
    "yellow",
    "orange",
    "purple",
    "pink",
    "cyan",
    "magenta",
    "teal",
    "navy",
    "maroon",
    "coral",
    "salmon",
    "gold",
    "silver",
    "gray",
    "grey",
    "indigo",
    "violet",
    "lime",
    "olive",
    "aqua",
    "fuchsia",
    "crimson",
    "turquoise",
    "ivory",
    "beige",
    "lavender",
    "tan",
    "khaki",
    "plum",
    "orchid",
    "sienna",
  ].includes(normalized);
}

function toKebab(value: string): string {
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

function friendlyName(cssVar: string): string {
  return cssVar
    .replace(/^--/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeValue(value: string): string {
  const normalized = value.trim().replace(/[;,]$/, "").trim();
  const quote = normalized[0];
  if (quote !== "'" && quote !== '"') return normalized;

  let escaped = false;
  for (let index = 1; index < normalized.length; index += 1) {
    const char = normalized[index]!;
    if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === quote) {
      return index === normalized.length - 1
        ? normalized.slice(1, -1).trim()
        : normalized;
    }
  }

  return normalized;
}

function tokenVar(prefix: string, key: string): string {
  if (key.startsWith("--")) return key;
  const stem = toKebab(key);
  if (stem === "default" && prefix === "radius") return "--radius";
  if (stem.startsWith(prefix)) return `--${stem}`;
  return `--${prefix}-${stem}`;
}

function addLooseTextSignals(
  state: ReturnType<typeof createCodeAnalysisState>,
  filename: string,
  content: string,
  includeCssVariables = true,
): number {
  const rejectedCssCustomProperties = includeCssVariables
    ? addLooseCssCustomProperties(state, content)
    : 0;
  extractCodeColors(state, content);
  extractCodeFonts(state, content, filename);

  for (const color of extractDocumentColors(content)) {
    state.colors[color] = color;
  }
  for (const font of extractDocumentFonts(content)) {
    const key = font.toLowerCase().replace(/\s+/g, "-");
    if (!state.fonts.some((entry) => entry.family === font)) {
      state.fonts.push({ family: font, source: filename });
      state.seenFonts.add(key);
    }
  }

  return rejectedCssCustomProperties;
}

function addCssCustomProperty(
  state: ReturnType<typeof createCodeAnalysisState>,
  cssVar: string,
  rawValue: string,
  importanceByProperty?: Map<string, boolean>,
  important = false,
): boolean {
  const name = cssVar.slice(2);
  const value = normalizeCssCustomPropertyWhitespace(rawValue);
  const normalized = normalizeValue(value);
  const token: ImportedDesignToken = {
    name: friendlyName(cssVar),
    cssVar,
    value: normalized,
    type: classifyVar(cssVar, normalized),
    source: "CSS variables",
  };
  if (!isValidImportedToken(token)) return false;

  const previousImportance =
    importanceByProperty?.get(cssVar) ??
    (state.cssCustomProperties[cssVar] === undefined ? undefined : false);
  if (previousImportance && !important) return true;

  state.cssCustomProperties[cssVar] = value;
  importanceByProperty?.set(cssVar, important);
  if (
    /color|bg|background|text|border|accent|primary|secondary|surface|muted|foreground/i.test(
      name,
    )
  ) {
    state.colors[cssVar] = value;
  } else if (/spacing|gap|padding|margin|space/i.test(name)) {
    state.spacing[cssVar] = value;
  } else if (/radius|rounded/i.test(name)) {
    state.borderRadius[cssVar] = value;
  }
  return true;
}

function addLooseCssCustomProperties(
  state: ReturnType<typeof createCodeAnalysisState>,
  content: string,
): number {
  const pattern = /--([\w-]+)\s*:\s*([^;}\n]+)/g;
  let rejectedCount = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    if (!addCssCustomProperty(state, `--${match[1]}`, match[2]!)) {
      const lineStart = content.lastIndexOf("\n", match.index - 1) + 1;
      const prefix = content.slice(lineStart, match.index);
      if (/^\s*(?:[^{}]*\{\s*)?$/.test(prefix)) rejectedCount += 1;
    }
  }
  return rejectedCount;
}

function addCssCustomPropertiesFromRoot(
  state: ReturnType<typeof createCodeAnalysisState>,
  root: postcss.Root | postcss.Document,
  importanceByProperty: Map<string, boolean>,
): number {
  if (root.type === "document") {
    return root.nodes.reduce(
      (rejectedCount, child) =>
        rejectedCount +
        addCssCustomPropertiesFromRoot(state, child, importanceByProperty),
      0,
    );
  }

  let rejectedCount = 0;
  root.walkDecls((declaration) => {
    if (!declaration.prop.startsWith("--")) return;
    if (
      !addCssCustomProperty(
        state,
        declaration.prop,
        declaration.value,
        importanceByProperty,
        declaration.important,
      )
    ) {
      rejectedCount += 1;
    }
  });

  return rejectedCount;
}

function normalizeCssCustomPropertyWhitespace(value: string): string {
  let normalized = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let pendingWhitespace = false;

  for (const char of value) {
    if (quote) {
      normalized += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === "'" || char === '"') {
      if (pendingWhitespace && normalized) normalized += " ";
      pendingWhitespace = false;
      quote = char;
      normalized += char;
    } else if (/\s/.test(char)) {
      pendingWhitespace = true;
    } else {
      if (pendingWhitespace && normalized) normalized += " ";
      pendingWhitespace = false;
      normalized += char;
    }
  }

  return normalized.trim();
}

function addStylesheetCustomProperties(
  state: ReturnType<typeof createCodeAnalysisState>,
  filename: string,
  content: string,
  importanceByProperty: Map<string, boolean>,
): number {
  const lowerFilename = filename.toLowerCase();
  const root = lowerFilename.endsWith(".less")
    ? postcssLess.parse(content)
    : lowerFilename.endsWith(".scss")
      ? postcssScss.parse(content)
      : postcss.parse(content);
  return addCssCustomPropertiesFromRoot(state, root, importanceByProperty);
}

const MAX_TOKEN_LABEL_LINE_LENGTH = 220;
const TOKEN_LABEL_LINE =
  /^(?:[-*]\s*)?(?:\*\*)?([A-Za-z][\w\s/().&'’.-]{1,64}?)(?:\*\*)?\s*[:=]\s*(.+?)\s*$/;

function isStructuralConfigOpeningLine(line: string): boolean {
  return /^(?:[\w$-]+|"[\w$-]+"|'[\w$-]+')\s*:\s*[\[{]\s*$/.test(line.trim());
}

function isConfigStructureOpenerValue(value: string): boolean {
  return /^(?:\{|\[)\s*,?$/.test(value.trim());
}

function parseNamedLines(
  files: { filename: string; content: string }[],
): ImportedDesignToken[] {
  const tokens: ImportedDesignToken[] = [];

  for (const file of files) {
    for (const rawLine of file.content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (
        !line ||
        line.length > MAX_TOKEN_LABEL_LINE_LENGTH ||
        isStructuralConfigOpeningLine(line)
      ) {
        continue;
      }

      const namedLine =
        line.startsWith("{") && line.endsWith("}")
          ? line.slice(1, -1).trim()
          : line;
      const match = namedLine.match(TOKEN_LABEL_LINE);
      if (!match || isConfigStructureOpenerValue(match[2] ?? "")) continue;

      const label = match[1].replace(/\*\*/g, "").trim();
      const rawValue = stripTrailingCssLineComment(match[2]).trim();
      if (!hasBalancedCssValueSyntax(rawValue)) continue;
      const value = normalizeValue(rawValue);

      const lower = label.toLowerCase();
      let cssVar: string | null = null;
      if (
        isColorValue(value) ||
        /color|background|surface|accent|brand/.test(lower)
      ) {
        cssVar = tokenVar("color", label.replace(/\bcolor\b/gi, ""));
      } else if (/radius|rounded/.test(lower)) {
        cssVar = tokenVar("radius", label);
      } else if (/spacing|gap|padding|margin|space/.test(lower)) {
        cssVar = tokenVar("spacing", label);
      } else if (/font|typeface|typography/.test(lower)) {
        cssVar = tokenVar("font", label);
      } else if (/shadow|elevation/.test(lower) && isShadowValue(value)) {
        cssVar = tokenVar("shadow", label);
      } else if (
        /duration|easing|ease|transition|animation|motion|delay/.test(lower) &&
        isMotionValue(value)
      ) {
        cssVar = tokenVar("motion", label);
      }

      if (!cssVar) continue;
      tokens.push({
        name: friendlyName(cssVar),
        cssVar,
        value,
        type: classifyVar(cssVar, value),
        source: file.filename,
      });
    }
  }

  return tokens;
}

function uniqueTokenList(tokens: ImportedDesignToken[]): ImportedDesignToken[] {
  const byVar = new Map<string, ImportedDesignToken>();
  const namedValues = new Set<string>();

  for (const token of tokens) {
    if (!/^--[-_a-zA-Z0-9]+$/.test(token.cssVar)) continue;
    const previous = byVar.get(token.cssVar);
    byVar.set(token.cssVar, token);
    if (!previous && !/^--color-imported-\d+$/.test(token.cssVar)) {
      namedValues.add(token.value.toLowerCase());
    }
  }

  return [...byVar.values()].filter((token) => {
    if (!/^--color-imported-\d+$/.test(token.cssVar)) return true;
    return !namedValues.has(token.value.toLowerCase());
  });
}

function stripTrailingCssLineComment(value: string): string {
  const delimiters: string[] = [];
  let quote: "'" | '"' | null = null;
  let inBlockComment = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    const next = value[index + 1];

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "(" || char === "[") {
      delimiters.push(char);
    } else if (char === ")" || char === "]") {
      delimiters.pop();
    } else if (
      char === "/" &&
      next === "/" &&
      delimiters.length === 0 &&
      (index === 0 || /\s/.test(value[index - 1]!))
    ) {
      return value.slice(0, index).trimEnd();
    }
  }

  return value;
}

function hasBalancedCssValueSyntax(value: string): boolean {
  value = stripTrailingCssLineComment(value);
  const delimiters: string[] = [];
  let quote: "'" | '"' | null = null;
  let inBlockComment = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    const next = value[index + 1];

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "(" || char === "[") {
      delimiters.push(char);
    } else if (char === ")" || char === "]") {
      const opening = delimiters.pop();
      if (opening !== (char === ")" ? "(" : "[")) return false;
    }
  }

  return !quote && !inBlockComment && !escaped && delimiters.length === 0;
}

function removeMalformedNamedLines(content: string): {
  content: string;
  rejectedCount: number;
} {
  let rejectedCount = 0;
  const lines = content.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    if (
      line.length > MAX_TOKEN_LABEL_LINE_LENGTH ||
      isStructuralConfigOpeningLine(trimmed)
    ) {
      return true;
    }
    const match = trimmed.match(TOKEN_LABEL_LINE);
    if (
      !match ||
      isConfigStructureOpenerValue(match[2] ?? "") ||
      hasBalancedCssValueSyntax(match[2] ?? "")
    ) {
      return true;
    }
    rejectedCount += 1;
    return false;
  });

  return { content: lines.join("\n"), rejectedCount };
}

function isProseTokenLabelLine(
  line: string,
  allowSingleWordLabel = false,
): boolean {
  if (line.length > MAX_TOKEN_LABEL_LINE_LENGTH) return false;
  const match = line.match(TOKEN_LABEL_LINE);
  return Boolean(
    match &&
    (allowSingleWordLabel ||
      /\s/.test(match[1]?.replace(/\*\*/g, "").trim() ?? "")) &&
    hasBalancedCssValueSyntax(match[2] ?? ""),
  );
}

function pastedTokenListCssCandidate(content: string): string | null {
  if (/[{}]/.test(content)) return null;

  const declarations: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (
      !line ||
      isProseTokenLabelLine(line, true) ||
      /^\[[^\]\r\n]{1,80}\]$/.test(line) ||
      /^\[\s*\d+\s*\]\s+[^\]\r\n]{1,80}$/.test(line)
    ) {
      continue;
    }
    if (/^--[\w-]+\s*:\s*.+;?$/.test(line)) {
      declarations.push(line);
      continue;
    }
    if (/^[\p{L}\p{N}][\p{L}\p{N}\s'’–—-]{1,119}:?$/u.test(line)) {
      continue;
    }
    return null;
  }

  return declarations.length > 0
    ? `:root {\n${declarations.join("\n")}\n}`
    : null;
}

function pastedStylesheetCssCandidate(content: string): string | null {
  if (!/[{}]/.test(content)) return null;

  const lines: string[] = [];
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let inBlockComment = false;
  let escaped = false;
  let changed = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const openingBraceCount = (line.match(/{/g) ?? []).length;
    const closingBraceCount = (line.match(/}/g) ?? []).length;
    if (
      !quote &&
      !inBlockComment &&
      depth === 0 &&
      openingBraceCount === closingBraceCount &&
      isProseTokenLabelLine(line)
    ) {
      changed = true;
      continue;
    }

    for (let index = 0; index < rawLine.length; index += 1) {
      const char = rawLine[index]!;
      const next = rawLine[index + 1];

      if (inBlockComment) {
        if (char === "*" && next === "/") {
          inBlockComment = false;
          index += 1;
        }
        continue;
      }

      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = null;
        continue;
      }

      if (char === "/" && next === "*") {
        inBlockComment = true;
        index += 1;
      } else if (char === "'" || char === '"') {
        quote = char;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth < 0) return null;
      }
    }

    lines.push(rawLine);
  }

  return changed && depth === 0 && !quote && !inBlockComment
    ? lines.join("\n")
    : null;
}

function looksLikePastedJson(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }

    return /^\{\s*(?:"[^\"]*"\s*:|})/.test(trimmed);
  }
  if (!trimmed.startsWith("[")) return false;

  try {
    JSON.parse(trimmed);
    return true;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }

  const [firstLine = "", ...remainingLines] = trimmed.split(/\r?\n/);
  if (/^\[[^\]\r\n]{1,80}\][ \t]+\S/.test(firstLine.trim())) {
    return false;
  }
  const firstLineLooksLikeJsonArray = /^\[\s*(?:\{|\[|")/.test(firstLine);
  const isNoteWithTokenList =
    /^\[[^\]\r\n]{1,80}\]$/.test(firstLine.trim()) &&
    !firstLineLooksLikeJsonArray &&
    remainingLines.some((line) => /^--[\w-]+\s*:/.test(line.trim()));

  if (isNoteWithTokenList || /^\[[^\]\r\n]+\]\s*\{/.test(trimmed)) {
    return false;
  }

  const arrayContent = trimmed.slice(1).trimStart();
  return (
    arrayContent.startsWith("]") ||
    arrayContent.startsWith("{") ||
    arrayContent.startsWith("[") ||
    arrayContent.startsWith('"') ||
    /^[-\d]/.test(arrayContent) ||
    /^(?:true|false|null)(?=\s*(?:,|\]|$))/.test(arrayContent)
  );
}

function isCssPropertyNameCharacter(char: string | undefined): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (
    char === "-" ||
    char === "_" ||
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

function startsCssPropertyDeclaration(
  content: string,
  start: number,
  end: number,
): boolean {
  let index = start;
  while (
    index < end &&
    (content[index] === " " ||
      content[index] === "\t" ||
      content[index] === "\r")
  ) {
    index += 1;
  }

  if (content.startsWith("--", index)) {
    index += 2;
    const nameStart = index;
    while (index < end && isCssPropertyNameCharacter(content[index])) {
      index += 1;
    }
    if (index === nameStart) return false;
  } else {
    const first = content[index];
    const isLetter =
      first !== undefined &&
      ((first >= "a" && first <= "z") || (first >= "A" && first <= "Z"));
    if (first !== "-" && !isLetter) return false;
    index += 1;
    while (index < end && isCssPropertyNameCharacter(content[index])) {
      index += 1;
    }
  }

  while (
    index < end &&
    (content[index] === " " ||
      content[index] === "\t" ||
      content[index] === "\r")
  ) {
    index += 1;
  }
  return content[index] === ":";
}

function looksLikePastedCss(content: string): boolean {
  if (
    /^[ \t]*--[\w-]+[ \t]*:/m.test(content) ||
    /^[ \t]*:root[ \t]*\{/m.test(content)
  ) {
    return true;
  }

  if (
    /^[ \t]*(?:export[ \t]+default\b|module\.exports[ \t]*=|(?:const|let|var)[ \t]+\w+[ \t]*=)/m.test(
      content,
    )
  ) {
    return false;
  }

  let blockDepth = 0;
  let segmentStart = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let inBlockComment = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]!;
    const next = content[index + 1];

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        segmentStart = index + 2;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      if (
        blockDepth > 0 &&
        startsCssPropertyDeclaration(content, segmentStart, index)
      ) {
        return true;
      }
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "{") {
      if (
        blockDepth > 0 &&
        startsCssPropertyDeclaration(content, segmentStart, index)
      ) {
        return true;
      }
      blockDepth += 1;
      segmentStart = index + 1;
      continue;
    }

    if (char === "}" || char === ";" || char === "\n" || char === "\r") {
      if (
        blockDepth > 0 &&
        startsCssPropertyDeclaration(content, segmentStart, index)
      ) {
        return true;
      }
      if (char === "}") blockDepth = Math.max(0, blockDepth - 1);
      segmentStart = index + 1;
    }
  }

  return (
    blockDepth > 0 &&
    startsCssPropertyDeclaration(content, segmentStart, content.length)
  );
}

function stripScssLessLineComments(content: string): string {
  let output = "";
  let quote: "'" | '"' | null = null;
  let inBlockComment = false;
  let escaped = false;
  let parentheses = 0;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]!;
    const next = content[index + 1];

    if (inBlockComment) {
      output += char;
      if (char === "*" && next === "/") {
        output += next;
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (quote) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      output += "/*";
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (
      char === "/" &&
      next === "/" &&
      parentheses === 0 &&
      (index === 0 || /[\s;{}]/.test(content[index - 1]!))
    ) {
      while (index < content.length && !/[\r\n]/.test(content[index]!)) {
        index += 1;
      }
      index -= 1;
      continue;
    }

    if (char === "'" || char === '"') quote = char;
    if (char === "(") parentheses += 1;
    if (char === ")") parentheses = Math.max(0, parentheses - 1);
    output += char;
  }

  return output;
}

function isValidImportFile(file: {
  filename: string;
  content: string;
}): boolean {
  const filename = file.filename.toLowerCase();
  const isPastedInput = filename === "pasted-tokens.txt";
  const isJsonFile = filename.endsWith(".json");
  const isPastedJson = isPastedInput && looksLikePastedJson(file.content);

  if (filename.endsWith(".sass")) return false;

  if (isJsonFile || isPastedJson) {
    try {
      JSON.parse(file.content);
    } catch (error) {
      if (error instanceof SyntaxError) return false;
      throw error;
    }
  }

  const isStylesheet = /\.(css|scss|less)$/.test(filename);
  const isPastedStylesheet = isPastedInput && looksLikePastedCss(file.content);
  if (!isStylesheet && !isPastedStylesheet) {
    return true;
  }

  const tokenListCandidate = isPastedStylesheet
    ? pastedTokenListCssCandidate(file.content)
    : null;
  const stylesheetCandidate = isPastedStylesheet
    ? pastedStylesheetCssCandidate(file.content)
    : null;
  const cssCandidates = isPastedStylesheet
    ? [
        file.content,
        ...(tokenListCandidate ? [tokenListCandidate] : []),
        ...(stylesheetCandidate ? [stylesheetCandidate] : []),
      ]
    : [file.content];
  const isScssOrLess = /\.(scss|less)$/.test(filename);
  const isLess = filename.endsWith(".less");
  const isScss = filename.endsWith(".scss");

  for (const css of cssCandidates) {
    const normalizedCss = isScssOrLess ? stripScssLessLineComments(css) : css;
    try {
      if (isLess) postcssLess.parse(normalizedCss);
      else if (isScss) postcssScss.parse(normalizedCss);
      else postcss.parse(normalizedCss);
      return true;
    } catch (error) {
      if (
        (isLess && error instanceof TypeError) ||
        (error instanceof Error && error.name === "CssSyntaxError")
      ) {
        continue;
      }
      throw error;
    }
  }
  return false;
}

function prepareHtmlImport(content: string): {
  proseContent: string;
  stylesheets: string[];
  rejectedStylesheetCount: number;
} {
  interface HtmlNode {
    attrs?: { name: string; value: string }[];
    childNodes?: HtmlNode[];
    tagName?: string;
    sourceCodeLocation?: {
      attrs?: Record<string, { endOffset: number; startOffset: number }>;
      endTag?: { endOffset: number; startOffset: number };
      startOffset: number;
      startTag?: { endOffset: number };
    } | null;
  }

  const sourceRanges: {
    end: number;
    start: number;
  }[] = [];
  const stylesheets: string[] = [];
  let rejectedStylesheetCount = 0;
  const duplicateAttributeOffsets: number[] = [];
  const document = parseHtml(content, {
    sourceCodeLocationInfo: true,
    onParseError(error) {
      if (error.code === "duplicate-attribute") {
        duplicateAttributeOffsets.push(error.startOffset);
      }
    },
  }) as unknown as HtmlNode;

  const duplicateStyleAttributeRangeAt = (errorOffset: number) => {
    let start = errorOffset;
    while (start > 0 && /[^\t\n\f\r />=]/.test(content[start - 1]!)) {
      start -= 1;
    }
    let nameEnd = start;
    while (
      nameEnd < content.length &&
      /[^\t\n\f\r />=]/.test(content[nameEnd]!)
    ) {
      nameEnd += 1;
    }
    if (content.slice(start, nameEnd).toLowerCase() !== "style") return null;

    let cursor = nameEnd;
    while (/\s/.test(content[cursor] ?? "")) cursor += 1;
    if (content[cursor] !== "=") return null;
    cursor += 1;
    while (/\s/.test(content[cursor] ?? "")) cursor += 1;

    const quote = content[cursor];
    if (quote === "'" || quote === '"') {
      const closingQuote = content.indexOf(quote, cursor + 1);
      return {
        start,
        end: closingQuote < 0 ? content.length : closingQuote + 1,
      };
    }

    while (cursor < content.length && !/[\s>]/.test(content[cursor]!)) {
      cursor += 1;
    }
    return { start, end: cursor };
  };

  for (const offset of duplicateAttributeOffsets) {
    const range = duplicateStyleAttributeRangeAt(offset);
    if (!range) continue;
    sourceRanges.push(range);
    rejectedStylesheetCount += 1;
  }

  const pendingNodes = [document];
  while (pendingNodes.length > 0) {
    const node = pendingNodes.pop()!;
    if (node.tagName === "style" && node.sourceCodeLocation?.startTag) {
      const start = node.sourceCodeLocation.startOffset;
      const contentStart = node.sourceCodeLocation.startTag.endOffset;
      const contentEnd =
        node.sourceCodeLocation.endTag?.startOffset ?? content.length;
      const end = node.sourceCodeLocation.endTag?.endOffset ?? content.length;
      const stylesheet = content.slice(contentStart, contentEnd);
      sourceRanges.push({ start, end });
      if (!node.sourceCodeLocation.endTag) {
        rejectedStylesheetCount += 1;
      } else {
        try {
          postcss.parse(stylesheet);
          stylesheets.push(stylesheet);
        } catch (error) {
          if (!(error instanceof Error) || error.name !== "CssSyntaxError") {
            throw error;
          }
          rejectedStylesheetCount += 1;
        }
      }
    }

    const styleAttribute = node.attrs?.find(
      (attribute) => attribute.name.toLowerCase() === "style",
    );
    const styleAttributeLocation =
      node.sourceCodeLocation?.attrs?.style ??
      node.sourceCodeLocation?.attrs?.STYLE;
    if (node.tagName !== "style" && styleAttribute && styleAttributeLocation) {
      sourceRanges.push({
        start: styleAttributeLocation.startOffset,
        end: styleAttributeLocation.endOffset,
      });
      const stylesheet = `:root { ${styleAttribute.value} }`;
      try {
        postcss.parse(stylesheet);
        stylesheets.push(stylesheet);
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "CssSyntaxError") {
          throw error;
        }
        rejectedStylesheetCount += 1;
      }
    }

    const children = node.childNodes ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pendingNodes.push(children[index]!);
    }
  }

  let proseContent = "";
  let cursor = 0;
  sourceRanges.sort((left, right) => left.start - right.start);
  for (const range of sourceRanges) {
    if (range.start < cursor) {
      cursor = Math.max(cursor, range.end);
      continue;
    }
    proseContent += content.slice(cursor, range.start) + "\n";
    cursor = range.end;
  }
  proseContent += content.slice(cursor);

  return { proseContent, stylesheets, rejectedStylesheetCount };
}

function readSingleCssFunctionArguments(
  value: string,
  functionName: string,
): string | null {
  const input = value.trim();
  const prefix = `${functionName}(`;
  if (!input.toLowerCase().startsWith(prefix)) return null;

  let depth = 1;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = prefix.length; index < input.length; index += 1) {
    const char = input[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index === input.length - 1
          ? input.slice(prefix.length, index)
          : null;
      }
    }
  }
  return null;
}

function splitCssFunctionArguments(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(value.slice(start).trim());
  return parts;
}

function cssFunctionFirstArgumentEnd(value: string): number {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) return index;
  }

  return value.length;
}

function readSingleCssIdentifier(value: string): string | null {
  let parsed: csstree.CssNode;
  try {
    parsed = csstree.parse(value.trim(), { context: "value" });
  } catch (error) {
    if (error instanceof Error && error.name === "SyntaxError") return null;
    throw error;
  }

  if (parsed.type !== "Value" || parsed.children.size !== 1) return null;
  const child = parsed.children.first;
  return child?.type === "Identifier" ? csstree.ident.decode(child.name) : null;
}

function readSingleCssString(value: string): string | null {
  let parsed: csstree.CssNode;
  try {
    parsed = csstree.parse(value.trim(), { context: "value" });
  } catch (error) {
    if (error instanceof Error && error.name === "SyntaxError") return null;
    throw error;
  }

  if (parsed.type !== "Value" || parsed.children.size !== 1) return null;
  const child = parsed.children.first;
  return child?.type === "String" ? csstree.string.decode(child.value) : null;
}

const cssAttrSyntaxTypes = new Set([
  "angle",
  "color",
  "custom-ident",
  "image",
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
  "url",
]);

function isValidCssAttrSyntax(value: string): boolean {
  if (value.trim() === "*") return true;
  const components = value.split("|").map((component) => component.trim());
  if (components.some((component) => !component || component === "*")) {
    return false;
  }
  if (components.length === 1) {
    const syntaxString = readSingleCssString(components[0]!);
    if (syntaxString !== null) return isValidCssAttrSyntax(syntaxString);
  }

  return components.every((component) => {
    const multiplier = component[component.length - 1];
    const type =
      multiplier === "#" || multiplier === "+"
        ? component.slice(0, -1)
        : component;
    if (!type) return false;

    const typedSyntax = type.match(/^<([a-z-]+)>$/i);
    if (typedSyntax)
      return cssAttrSyntaxTypes.has(typedSyntax[1]!.toLowerCase());
    return readSingleCssIdentifier(type) !== null;
  });
}

function isValidCssSubstitutionFunction(name: string, args: string): boolean {
  const parts = splitCssFunctionArguments(args);
  const head = parts[0]?.trim() ?? "";

  if (name === "var") {
    const propertyName = readSingleCssIdentifier(head);
    return Boolean(propertyName?.startsWith("--") && propertyName !== "--");
  }

  if (name === "env") {
    const headParts = head.split(/\s+/);
    const environmentName = readSingleCssIdentifier(headParts.shift() ?? "");
    if (
      !environmentName ||
      /^(?:initial|inherit|unset|revert|revert-layer|default)$/i.test(
        environmentName,
      )
    ) {
      return false;
    }
    return headParts.every((index) => /^\+?\d+$/.test(index));
  }

  if (parts.length > 2) return false;
  const attrName = head.match(
    /^([^\s|]+)(?:\s*\|\s*([^\s|]+))?(?:\s+([\s\S]*))?$/,
  );
  if (!attrName) return false;
  if (!readSingleCssIdentifier(attrName[1] ?? "")) return false;
  if (attrName[2] && !readSingleCssIdentifier(attrName[2])) return false;
  return cssAttrSyntaxComponents(args) !== null;
}

function readCssFunctionAt(
  value: string,
  functionTokenEnd: number,
): { args: string; end: number } | null {
  let depth = 1;
  let quote: "'" | '"' | null = null;
  let inBlockComment = false;
  let escaped = false;

  for (let index = functionTokenEnd; index < value.length; index += 1) {
    const char = value[index]!;
    const next = value[index + 1];

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return {
          args: value.slice(functionTokenEnd, index),
          end: index + 1,
        };
      }
    }
  }

  return null;
}

const cssMathFunctions = new Set([
  "calc",
  "min",
  "max",
  "clamp",
  "round",
  "mod",
  "rem",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "pow",
  "sqrt",
  "hypot",
  "log",
  "exp",
  "abs",
  "sign",
]);

type CssMathDimension =
  | "angle"
  | "frequency"
  | "flex"
  | "length"
  | "length-percentage"
  | "number"
  | "percentage"
  | "resolution"
  | "time"
  | "unknown"
  | "invalid"
  | (string & {});

type CssMathReplacement = {
  start: number;
  end: number;
  dimension?: CssMathDimension;
};

function cssAttrUnitDimension(unit: string): CssMathDimension | null {
  const normalized = unit.toLowerCase();
  if (normalized === "%") return "percentage";
  if (["deg", "grad", "rad", "turn"].includes(normalized)) return "angle";
  if (normalized === "fr") return "flex";
  if (["hz", "khz"].includes(normalized)) return "frequency";
  if (["dpcm", "dpi", "dppx", "x"].includes(normalized)) {
    return "resolution";
  }
  if (["ms", "s"].includes(normalized)) return "time";
  if (
    [
      "cap",
      "ch",
      "cm",
      "cqmax",
      "cqmin",
      "cqb",
      "cqh",
      "cqi",
      "cqw",
      "dvb",
      "dvh",
      "dvi",
      "dvmax",
      "dvmin",
      "dvw",
      "ex",
      "ic",
      "in",
      "lh",
      "lvb",
      "lvh",
      "lvi",
      "lvmax",
      "lvmin",
      "lvw",
      "mm",
      "pc",
      "pt",
      "px",
      "q",
      "rem",
      "rlh",
      "svb",
      "svh",
      "svi",
      "svmax",
      "svmin",
      "svw",
      "vb",
      "vh",
      "vi",
      "vmax",
      "vmin",
      "vw",
    ].includes(normalized)
  ) {
    return "length";
  }
  return null;
}

function cssAttrSyntaxComponents(args: string): string[] | null {
  const head = splitCssFunctionArguments(args)[0]?.trim() ?? "";
  const attrHead = head.match(
    /^([^\s|]+)(?:\s*\|\s*([^\s|]+))?(?:\s+([\s\S]*))?$/,
  );
  if (!attrHead) return null;
  const syntax = attrHead[3]?.trim();
  if (!syntax) return ["string"];

  const typeSyntax = readSingleCssFunctionArguments(syntax, "type");
  if (typeSyntax !== null) {
    if (!isValidCssAttrSyntax(typeSyntax)) return null;
    const normalizedTypeSyntax =
      readSingleCssString(typeSyntax) ?? typeSyntax.trim().toLowerCase();
    return normalizedTypeSyntax.split("|").map((component) => component.trim());
  }

  const normalizedType = syntax.toLowerCase();
  if (normalizedType === "raw-string") return ["string"];
  if (normalizedType === "number") return ["number"];
  const unitDimension = cssAttrUnitDimension(syntax);
  if (unitDimension) return [unitDimension];
  if (!isValidCssAttrSyntax(syntax)) return null;
  const normalizedSyntax =
    readSingleCssString(syntax) ?? syntax.trim().toLowerCase();
  return normalizedSyntax.split("|").map((component) => component.trim());
}

function cssAttrMathDimension(args: string): CssMathDimension {
  const components = cssAttrSyntaxComponents(args);
  if (!components?.length) return "invalid";

  const dimensions = components.map((component): CssMathDimension => {
    if (component.endsWith("+") || component.endsWith("#")) return "invalid";
    const type =
      component.match(/^<([a-z-]+)>$/i)?.[1]?.toLowerCase() ?? component;
    if (type === "integer") return "number";
    if (
      [
        "angle",
        "flex",
        "frequency",
        "length",
        "length-percentage",
        "number",
        "percentage",
        "resolution",
        "time",
      ].includes(type)
    ) {
      return type as CssMathDimension;
    }
    return "invalid";
  });

  return dimensions
    .slice(1)
    .reduce(
      (dimension, next) => compatibleCssMathDimensions(dimension, next),
      dimensions[0]!,
    );
}

function cssAttrPlaceholder(token: ImportedDesignToken, args: string): string {
  const fallback = splitCssFunctionArguments(args).slice(1).join(",").trim();
  if (fallback) return fallback;

  const firstComponent = cssAttrSyntaxComponents(args)?.[0];
  const type =
    firstComponent?.match(/^<([a-z-]+)>$/i)?.[1]?.toLowerCase() ??
    firstComponent;
  switch (type) {
    case "angle":
      return "1deg";
    case "custom-ident":
      return "token";
    case "flex":
      return "1fr";
    case "frequency":
      return "1hz";
    case "integer":
    case "number":
      return "1";
    case "length":
    case "length-percentage":
      return "1px";
    case "percentage":
      return "1%";
    case "resolution":
      return "1dppx";
    case "string":
      return '"token"';
    case "time":
      return "1s";
    default:
      return cssSubstitutionPlaceholders(token)[0] ?? "initial";
  }
}

function parseCssMathExpression(
  value: string,
  allowedIdentifiers?: ReadonlySet<string>,
): { parsed: csstree.CssNode; unknownRanges: CssMathReplacement[] } | null {
  const replacements: CssMathReplacement[] = [];
  try {
    csstree.tokenize(value, (type, start, end) => {
      if (type === csstree.tokenTypes.Ident) {
        const identifier = csstree.ident
          .decode(value.slice(start, end))
          .toLowerCase();
        if (allowedIdentifiers?.has(identifier)) {
          replacements.push({ start, end, dimension: "number" });
        }
        return;
      }
      if (type !== csstree.tokenTypes.Function) return;
      const name = csstree.ident
        .decode(value.slice(start, end - 1))
        .toLowerCase();
      if (name !== "var" && name !== "env" && name !== "attr") return;
      const functionValue = readCssFunctionAt(value, end);
      if (!functionValue) return;
      if (
        !replacements.some(
          (replacement) =>
            replacement.start < start && replacement.end >= functionValue.end,
        )
      ) {
        replacements.push({
          start,
          end: functionValue.end,
          dimension:
            name === "attr"
              ? cssAttrMathDimension(functionValue.args)
              : "unknown",
        });
      }
    });
  } catch (error) {
    if (error instanceof Error && error.name === "SyntaxError") return null;
    throw error;
  }

  for (const replacement of replacements.filter((candidate) =>
    allowedIdentifiers?.size
      ? replacements.some(
          (substitution) =>
            substitution.start < candidate.start &&
            substitution.end >= candidate.end,
        )
      : false,
  )) {
    replacements.splice(replacements.indexOf(replacement), 1);
  }

  replacements.sort((left, right) => left.start - right.start);
  const unknownRanges: CssMathReplacement[] = [];
  let offsetDelta = 0;
  for (const replacement of replacements) {
    const outputStart = replacement.start + offsetDelta;
    unknownRanges.push({
      start: outputStart,
      end: outputStart + 1,
      dimension: replacement.dimension,
    });
    offsetDelta += 1 - (replacement.end - replacement.start);
  }

  let mathValue = value;
  for (let index = replacements.length - 1; index >= 0; index -= 1) {
    const substitution = replacements[index]!;
    mathValue =
      mathValue.slice(0, substitution.start) +
      "1" +
      mathValue.slice(substitution.end);
  }

  let parsed: csstree.CssNode;
  try {
    parsed = csstree.parse(mathValue, { context: "value", positions: true });
  } catch (error) {
    if (error instanceof Error && error.name === "SyntaxError") return null;
    throw error;
  }
  if (parsed.type !== "Value") return null;

  return { parsed, unknownRanges };
}

function compatibleCssMathDimensions(
  left: CssMathDimension,
  right: CssMathDimension,
): CssMathDimension {
  if (left === "invalid" || right === "invalid") return "invalid";
  if (left === "unknown" || right === "unknown") return "unknown";
  if (left === right) return left;
  if (
    (left === "length" && right === "percentage") ||
    (left === "percentage" && right === "length") ||
    (left === "length-percentage" &&
      (right === "length" || right === "percentage")) ||
    (right === "length-percentage" &&
      (left === "length" || left === "percentage"))
  ) {
    return "length-percentage";
  }
  return "invalid";
}

type CssMathBaseDimension =
  | "angle"
  | "frequency"
  | "flex"
  | "length"
  | "percentage"
  | "resolution"
  | "time";

function cssMathDimensionVector(
  dimension: CssMathDimension,
): Map<CssMathBaseDimension, number> | null {
  if (dimension === "number") return new Map();
  if (
    dimension === "unknown" ||
    dimension === "invalid" ||
    dimension === "length-percentage"
  ) {
    return null;
  }

  const vector = new Map<CssMathBaseDimension, number>();
  const terms = dimension.startsWith("product:")
    ? dimension.slice("product:".length).split("*")
    : [`${dimension}^1`];
  for (const term of terms) {
    const match = term.match(
      /^(angle|frequency|flex|length|percentage|resolution|time)\^(-?\d+)$/,
    );
    if (!match) return null;
    const base = match[1] as CssMathBaseDimension;
    const exponent = Number(match[2]);
    if (!Number.isInteger(exponent)) return null;
    vector.set(base, (vector.get(base) ?? 0) + exponent);
  }
  return vector;
}

function cssMathDimensionFromVector(
  vector: Map<CssMathBaseDimension, number>,
): CssMathDimension {
  const entries = [...vector.entries()]
    .filter(([, exponent]) => exponent !== 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "number";
  if (entries.length === 1 && entries[0]![1] === 1) return entries[0]![0];
  return `product:${entries.map(([base, exponent]) => `${base}^${exponent}`).join("*")}`;
}

function combineCssMathDimensions(
  left: CssMathDimension,
  right: CssMathDimension,
  sign: 1 | -1,
): CssMathDimension {
  if (left === "invalid" || right === "invalid") return "invalid";
  if (left === "unknown" || right === "unknown") return "unknown";
  if (
    (left === "length-percentage" && right === "number") ||
    (sign === 1 && left === "number" && right === "length-percentage")
  ) {
    return "length-percentage";
  }
  const leftVector = cssMathDimensionVector(left);
  const rightVector = cssMathDimensionVector(right);
  if (!leftVector || !rightVector) return "invalid";
  for (const [base, exponent] of rightVector) {
    leftVector.set(base, (leftVector.get(base) ?? 0) + sign * exponent);
  }
  return cssMathDimensionFromVector(leftVector);
}

function cssMathDimensionForNode(
  node: csstree.CssNode,
  unknownRanges: CssMathReplacement[],
): CssMathDimension {
  const offset = node.loc?.start.offset;
  if (typeof offset === "number") {
    const replacement = unknownRanges.find((range) => range.start === offset);
    if (replacement) return replacement.dimension ?? "unknown";
  }

  if (node.type === "Number") return "number";
  if (node.type === "Percentage") return "percentage";
  if (node.type === "Dimension") {
    const unit = csstree.ident.decode(node.unit).toLowerCase();
    if (
      /^(?:px|cm|mm|q|in|pt|pc|em|rem|ex|rex|ch|rch|cap|rcap|ic|ric|lh|rlh|vw|vh|vi|vb|vmin|vmax|svw|svh|svi|svb|svmin|svmax|lvw|lvh|lvi|lvb|lvmin|lvmax|dvw|dvh|dvi|dvb|dvmin|dvmax|cqw|cqh|cqi|cqb|cqmin|cqmax)$/.test(
        unit,
      )
    ) {
      return "length";
    }
    if (/^(?:deg|grad|rad|turn)$/.test(unit)) return "angle";
    if (/^(?:s|ms)$/.test(unit)) return "time";
    if (/^(?:hz|khz)$/.test(unit)) return "frequency";
    if (/^(?:dpi|dpcm|dppx|x)$/.test(unit)) return "resolution";
    if (unit === "fr") return "flex";
    return "invalid";
  }
  if (node.type === "Identifier") {
    const identifier = csstree.ident.decode(node.name).toLowerCase();
    return /^(?:e|pi|infinity|nan|-infinity)$/.test(identifier)
      ? "number"
      : "invalid";
  }
  if (node.type === "Parentheses") {
    return cssMathDimensionForNodes([...node.children], unknownRanges);
  }
  if (node.type === "Function") {
    const name = csstree.ident.decode(node.name).toLowerCase();
    if (name === "calc") {
      return cssMathDimensionForNodes([...node.children], unknownRanges);
    }
    if (name === "abs") {
      return cssMathDimensionForNodes([...node.children], unknownRanges);
    }
    if (/^(?:asin|acos|atan|atan2)$/.test(name)) return "angle";
    if (/^(?:sign|sin|cos|tan|log|exp|pow)$/.test(name)) {
      return "number";
    }
    if (name === "sqrt") {
      const dimension = cssMathDimensionForNodes(
        [...node.children],
        unknownRanges,
      );
      return dimension === "number" || dimension === "unknown"
        ? "number"
        : "invalid";
    }
    if (name === "min" || name === "max" || name === "hypot") {
      const args = splitCssMathNodeArguments([...node.children]);
      if (args.length === 0) return "invalid";
      const dimensions = args.map((argument) =>
        cssMathDimensionForNodes(argument, unknownRanges),
      );
      return dimensions
        .slice(1)
        .reduce(
          (dimension, next) => compatibleCssMathDimensions(dimension, next),
          dimensions[0]!,
        );
    }
    if (name === "clamp") {
      const args = splitCssMathNodeArguments([...node.children]);
      if (args.length !== 3) return "invalid";
      const dimensions = args.flatMap((argument, index) => {
        const isNone =
          argument.length === 1 &&
          argument[0]?.type === "Identifier" &&
          csstree.ident.decode(argument[0].name).toLowerCase() === "none";
        if (isNone && (index === 0 || index === 2)) return [];
        if (isNone) return ["invalid" as const];
        return [cssMathDimensionForNodes(argument, unknownRanges)];
      });
      if (dimensions.length === 0) return "invalid";
      return dimensions
        .slice(1)
        .reduce(
          (dimension, next) => compatibleCssMathDimensions(dimension, next),
          dimensions[0]!,
        );
    }
    if (name === "round" || name === "mod" || name === "rem") {
      const args = splitCssMathNodeArguments([...node.children]);
      if (name === "round") {
        const hasStrategy =
          args[0]?.length === 1 &&
          args[0][0]?.type === "Identifier" &&
          cssRoundingStrategies.has(
            csstree.ident.decode(args[0][0].name).toLowerCase(),
          );
        const calculationArgs = hasStrategy ? args.slice(1) : args;
        if (
          calculationArgs.length < 1 ||
          calculationArgs.length > 2 ||
          (args.length === 3 && !hasStrategy)
        ) {
          return "invalid";
        }
        const dimensions = calculationArgs.map((argument) =>
          cssMathDimensionForNodes(argument, unknownRanges),
        );
        return dimensions
          .slice(1)
          .reduce(
            (dimension, next) => compatibleCssMathDimensions(dimension, next),
            dimensions[0]!,
          );
      }
      if (args.length !== 2) return "invalid";
      return compatibleCssMathDimensions(
        cssMathDimensionForNodes(args[0]!, unknownRanges),
        cssMathDimensionForNodes(args[1]!, unknownRanges),
      );
    }
    return "invalid";
  }

  return "invalid";
}

function splitCssMathNodeArguments(
  nodes: csstree.CssNode[],
): csstree.CssNode[][] {
  const arguments_: csstree.CssNode[][] = [[]];
  for (const node of nodes) {
    if (node.type === "Operator" && node.value.trim() === ",") {
      arguments_.push([]);
    } else {
      arguments_[arguments_.length - 1]!.push(node);
    }
  }
  return arguments_;
}

function cssMathDimensionForNodes(
  nodes: csstree.CssNode[],
  unknownRanges: CssMathReplacement[],
): CssMathDimension {
  let total: CssMathDimension | null = null;
  let term: CssMathDimension | null = null;
  let multiplicativeOperator: "*" | "/" | null = null;

  for (const node of nodes) {
    if (node.type === "Operator") {
      const operator = node.value.trim();
      if (operator === "+" || operator === "-") {
        if (!/^\s/.test(node.value) || !/\s$/.test(node.value)) {
          return "invalid";
        }
        if (term === null) continue;
        total =
          total === null ? term : compatibleCssMathDimensions(total, term);
        if (total === "invalid") return total;
        term = null;
        continue;
      }
      if (operator === "*" || operator === "/") {
        if (term === null || multiplicativeOperator !== null) return "invalid";
        multiplicativeOperator = operator;
        continue;
      }
      return "invalid";
    }

    const operand = cssMathDimensionForNode(node, unknownRanges);
    if (term === null) {
      term = operand;
    } else if (multiplicativeOperator === "*") {
      term = combineCssMathDimensions(term, operand, 1);
      if (term === "invalid") return term;
      multiplicativeOperator = null;
    } else if (multiplicativeOperator === "/") {
      term = combineCssMathDimensions(term, operand, -1);
      if (term === "invalid") return term;
      multiplicativeOperator = null;
    } else {
      return "invalid";
    }
  }

  if (multiplicativeOperator !== null) return "invalid";
  if (term === null) return "invalid";
  if (total === null) return term;
  return compatibleCssMathDimensions(total, term);
}

function cssMathExpressionDimension(
  value: string,
  allowedIdentifiers?: ReadonlySet<string>,
): CssMathDimension {
  const expression = parseCssMathExpression(value, allowedIdentifiers);
  if (!expression || expression.parsed.type !== "Value") return "invalid";
  return cssMathDimensionForNodes(
    [...expression.parsed.children],
    expression.unknownRanges,
  );
}

function hasValidCssMathSubstitutionFallbacks(
  value: string,
  allowedIdentifiers?: ReadonlySet<string>,
): boolean {
  let valid = true;

  csstree.tokenize(value, (type, start, end) => {
    if (!valid || type !== csstree.tokenTypes.Function) return;
    const name = csstree.ident
      .decode(value.slice(start, end - 1))
      .toLowerCase();
    if (name !== "var") return;

    const functionValue = readCssFunctionAt(value, end);
    if (!functionValue) {
      valid = false;
      return;
    }
    const parts = splitCssFunctionArguments(functionValue.args);
    if (parts.length < 2) return;
    const fallback = parts.slice(1).join(",").trim();
    if (!fallback) return;

    const dimension = cssMathExpressionDimension(fallback, allowedIdentifiers);
    valid = dimension !== "invalid" && !dimension.startsWith("product:");
  });

  return valid;
}

const cssRoundingStrategies = new Set(["nearest", "up", "down", "to-zero"]);

function isValidCssMathFunction(
  name: string,
  parts: string[],
  allowedIdentifiers?: ReadonlySet<string>,
): boolean {
  if (
    !parts.every((part) =>
      hasValidCssMathSubstitutionFallbacks(part, allowedIdentifiers),
    )
  ) {
    return false;
  }

  const dimensions = parts.map((part) =>
    name === "clamp" && part.trim().toLowerCase() === "none"
      ? "unknown"
      : cssMathExpressionDimension(part, allowedIdentifiers),
  );
  const allPartsValid = dimensions.every(
    (dimension) => dimension !== "invalid",
  );
  const isSupportedResultDimension = (dimension: CssMathDimension) =>
    dimension !== "invalid" && !dimension.startsWith("product:");
  const argumentsCompatible = (values: CssMathDimension[]) =>
    values
      .slice(1)
      .every((dimension) =>
        values.length > 0
          ? compatibleCssMathDimensions(values[0]!, dimension) !== "invalid"
          : true,
      );

  if (name === "calc") {
    return (
      parts.length === 1 &&
      allPartsValid &&
      isSupportedResultDimension(dimensions[0]!)
    );
  }
  if (name === "min" || name === "max" || name === "hypot") {
    return (
      parts.length > 0 &&
      allPartsValid &&
      dimensions.every(isSupportedResultDimension) &&
      argumentsCompatible(dimensions)
    );
  }
  if (name === "clamp") {
    const isNone = (part: string) => part.trim().toLowerCase() === "none";
    const clampDimensions = parts
      .map((part, index) => (isNone(part) ? "unknown" : dimensions[index]!))
      .filter((_, index) => !isNone(parts[index]!));
    return (
      parts.length === 3 &&
      (isNone(parts[0]!) || dimensions[0] !== "invalid") &&
      !isNone(parts[1]!) &&
      dimensions[1] !== "invalid" &&
      (isNone(parts[2]!) || dimensions[2] !== "invalid") &&
      dimensions.every(isSupportedResultDimension) &&
      argumentsCompatible(clampDimensions)
    );
  }
  if (name === "round") {
    if (parts.length < 1 || parts.length > 3) return false;
    const hasStrategy = cssRoundingStrategies.has(
      parts[0]!.trim().toLowerCase(),
    );
    if (parts.length === 3 && !hasStrategy) return false;
    const calculationParts = hasStrategy ? parts.slice(1) : parts;
    const calculationDimensions = hasStrategy
      ? dimensions.slice(1)
      : dimensions;
    return (
      calculationParts.length > 0 &&
      calculationParts.length <= 2 &&
      calculationDimensions.every((dimension) => dimension !== "invalid") &&
      calculationDimensions.every(isSupportedResultDimension) &&
      (calculationParts.length === 2 ||
        calculationDimensions[0] === "number" ||
        calculationDimensions[0] === "unknown") &&
      argumentsCompatible(calculationDimensions)
    );
  }
  if (name === "log") {
    return (
      (parts.length === 1 || parts.length === 2) &&
      dimensions.every(
        (dimension) => dimension === "number" || dimension === "unknown",
      )
    );
  }
  if (name === "pow") {
    return (
      parts.length === 2 &&
      dimensions.every(
        (dimension) => dimension === "number" || dimension === "unknown",
      )
    );
  }
  if (["mod", "rem", "atan2"].includes(name)) {
    if (name === "atan2") {
      return (
        parts.length === 2 &&
        allPartsValid &&
        dimensions.every(isSupportedResultDimension) &&
        argumentsCompatible(dimensions)
      );
    }
    return (
      parts.length === 2 &&
      allPartsValid &&
      dimensions.every(isSupportedResultDimension) &&
      argumentsCompatible(dimensions)
    );
  }
  if (["sin", "cos", "tan"].includes(name)) {
    return (
      parts.length === 1 &&
      (dimensions[0] === "number" ||
        dimensions[0] === "angle" ||
        dimensions[0] === "unknown")
    );
  }
  if (["asin", "acos", "atan", "exp"].includes(name)) {
    return (
      parts.length === 1 &&
      (dimensions[0] === "number" || dimensions[0] === "unknown")
    );
  }
  if (name === "sign") return parts.length === 1 && allPartsValid;
  if (name === "sqrt") {
    return (
      parts.length === 1 &&
      (dimensions[0] === "number" || dimensions[0] === "unknown")
    );
  }
  return (
    name === "abs" &&
    parts.length === 1 &&
    allPartsValid &&
    isSupportedResultDimension(dimensions[0]!)
  );
}

const relativeCssColorChannels = new Map<string, ReadonlySet<string>>([
  ["rgb", new Set(["r", "g", "b", "alpha"])],
  ["rgba", new Set(["r", "g", "b", "alpha"])],
  ["hsl", new Set(["h", "s", "l", "alpha"])],
  ["hsla", new Set(["h", "s", "l", "alpha"])],
  ["hwb", new Set(["h", "w", "b", "alpha"])],
  ["lab", new Set(["l", "a", "b", "alpha"])],
  ["lch", new Set(["l", "c", "h", "alpha"])],
  ["oklab", new Set(["l", "a", "b", "alpha"])],
  ["oklch", new Set(["l", "c", "h", "alpha"])],
  ["color", new Set(["r", "g", "b", "x", "y", "z", "alpha"])],
  ["alpha", new Set(["alpha"])],
]);

const relativeColorRgbChannels = new Set(["r", "g", "b", "alpha"]);
const relativeColorXyzChannels = new Set(["x", "y", "z", "alpha"]);

function relativeColorChannelIdentifiers(
  name: string,
  components: string[],
): ReadonlySet<string> | undefined {
  if (name === "color") {
    const space = components[2]?.toLowerCase();
    if (
      /^(?:srgb|srgb-linear|display-p3|display-p3-linear|a98-rgb|prophoto-rgb|rec2020)$/.test(
        space ?? "",
      )
    ) {
      return relativeColorRgbChannels;
    }
    if (/^(?:xyz|xyz-d50|xyz-d65)$/.test(space ?? "")) {
      return relativeColorXyzChannels;
    }
    return undefined;
  }
  return relativeCssColorChannels.get(name);
}

function splitCssSpaceComponents(value: string): string[] {
  const components: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const push = (end: number) => {
    const component = value.slice(start, end).trim();
    if (component) components.push(component);
  };

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[") {
      depth += 1;
      continue;
    }
    if (char === ")" || char === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0) continue;
    if (/\s/.test(char)) {
      push(index);
      start = index + 1;
    } else if (char === "/") {
      push(index);
      components.push("/");
      start = index + 1;
    }
  }
  push(value.length);
  return components;
}

function relativeColorMathIdentifiersAt(
  value: string,
  mathStart: number,
  mathEnd: number,
): ReadonlySet<string> | undefined {
  let identifiers: ReadonlySet<string> | undefined;
  csstree.tokenize(value, (type, start, end) => {
    if (type !== csstree.tokenTypes.Function || start >= mathStart) return;
    const name = csstree.ident
      .decode(value.slice(start, end - 1))
      .toLowerCase();
    const functionValue = readCssFunctionAt(value, end);
    if (!functionValue || functionValue.end < mathEnd) return;
    const components = splitCssSpaceComponents(functionValue.args);
    const channels = relativeColorChannelIdentifiers(name, components);
    if (channels && components[0]?.toLowerCase() === "from") {
      identifiers = channels;
    }
  });
  return identifiers;
}

function hasValidCssMathFunctionSyntax(value: string): boolean {
  let valid = true;

  csstree.tokenize(value, (type, start, end) => {
    if (!valid || type !== csstree.tokenTypes.Function) return;
    const name = csstree.ident
      .decode(value.slice(start, end - 1))
      .toLowerCase();
    if (!cssMathFunctions.has(name) && !["var", "env", "attr"].includes(name)) {
      return;
    }

    const functionValue = readCssFunctionAt(value, end);
    if (functionValue === null) {
      valid = false;
      return;
    }

    if (["var", "env", "attr"].includes(name)) {
      valid = isValidCssSubstitutionFunction(name, functionValue.args);
      return;
    }

    const parts = splitCssFunctionArguments(functionValue.args);
    const allowedIdentifiers = relativeColorMathIdentifiersAt(
      value,
      start,
      functionValue.end,
    );
    valid = isValidCssMathFunction(name, parts, allowedIdentifiers);
  });

  return valid;
}

function isValidCssColor(value: string): boolean {
  const normalized = value.trim();
  const openParen = normalized.indexOf("(");
  const functionName =
    openParen > 0 ? normalized.slice(0, openParen).trim().toLowerCase() : "";
  if (relativeCssColorChannels.has(functionName)) {
    const args = readSingleCssFunctionArguments(normalized, functionName);
    if (
      args !== null &&
      splitCssSpaceComponents(args)[0]?.toLowerCase() === "from"
    ) {
      return isValidRelativeCssColor(normalized);
    }
  }
  if (hasCssSubstitutionFunction(normalized)) {
    return (
      hasValidCssMathFunctionSyntax(normalized) &&
      isValidCssColorWithSubstitutions(normalized)
    );
  }
  if (csstree.lexer.matchType("color", normalized).matched) return true;

  if (isValidRelativeCssColor(normalized)) return true;
  if (
    functionName !== "var" &&
    hasValidCssMathFunctionSyntax(normalized) &&
    isValidCssColorWithSubstitutions(normalized)
  ) {
    return true;
  }

  const args = readSingleCssFunctionArguments(normalized, "var");
  if (args === null) return false;
  const [name, ...fallbackParts] = splitCssFunctionArguments(args);
  if (!/^--[-_a-zA-Z0-9]+$/.test(name ?? "")) return false;
  return (
    fallbackParts.length === 0 || isValidCssColor(fallbackParts.join(", "))
  );
}

function isValidCssColorWithSubstitutions(value: string, depth = 0): boolean {
  if (depth > 5) return false;
  const ranges: { end: number; fallback?: string; start: number }[] = [];
  let valid = true;

  csstree.tokenize(value, (type, start, end) => {
    if (!valid || type !== csstree.tokenTypes.Function) return;
    const name = csstree.ident
      .decode(value.slice(start, end - 1))
      .toLowerCase();
    if (!["var", "env", "attr"].includes(name)) return;

    const functionValue = readCssFunctionAt(value, end);
    if (
      !functionValue ||
      !isValidCssSubstitutionFunction(name, functionValue.args)
    ) {
      valid = false;
      return;
    }
    const parts = splitCssFunctionArguments(functionValue.args);
    ranges.push({
      start,
      end: functionValue.end,
      ...(parts.length > 1
        ? { fallback: parts.slice(1).join(",").trim() }
        : {}),
    });
  });

  if (!valid) return false;
  if (ranges.length === 0) {
    return csstree.lexer.matchType("color", value).matched !== null;
  }

  const outermostRanges: { end: number; fallback?: string; start: number }[] =
    [];
  for (const range of ranges.sort((left, right) => left.start - right.start)) {
    const parent = outermostRanges[outermostRanges.length - 1];
    if (parent && range.start < parent.end) continue;
    outermostRanges.push(range);
  }
  if (outermostRanges.length > 5) return false;

  const replacements = ["0", "0 0 0", "red"];
  const hasValidReplacement = (
    index: number,
    values: string[],
    fixedIndex = -1,
    fixedValue = "",
  ): boolean => {
    if (index === outermostRanges.length) {
      let candidate = value;
      for (
        let rangeIndex = outermostRanges.length - 1;
        rangeIndex >= 0;
        rangeIndex -= 1
      ) {
        const range = outermostRanges[rangeIndex]!;
        candidate =
          candidate.slice(0, range.start) +
          values[rangeIndex] +
          candidate.slice(range.end);
      }
      return csstree.lexer.matchType("color", candidate).matched !== null;
    }

    if (index === fixedIndex) {
      values[index] = fixedValue;
      return hasValidReplacement(index + 1, values, fixedIndex, fixedValue);
    }

    for (const replacement of replacements) {
      values[index] = replacement;
      if (hasValidReplacement(index + 1, values, fixedIndex, fixedValue)) {
        return true;
      }
    }
    return false;
  };

  for (const [index, range] of outermostRanges.entries()) {
    if (range.fallback === undefined) continue;
    if (
      !hasCssSubstitutionFunction(range.fallback) &&
      !hasValidReplacement(0, [], index, range.fallback)
    ) {
      return false;
    }
    if (
      !isValidCssColorWithSubstitutions(
        value.slice(0, range.start) + range.fallback + value.slice(range.end),
        depth + 1,
      )
    ) {
      return false;
    }
  }

  return hasValidReplacement(0, []);
}

function hasCssSubstitutionFunction(value: string): boolean {
  let found = false;
  csstree.tokenize(value, (type, start, end) => {
    if (type !== csstree.tokenTypes.Function) return;
    const name = csstree.ident
      .decode(value.slice(start, end - 1))
      .toLowerCase();
    if (["var", "env", "attr"].includes(name)) found = true;
  });
  return found;
}

function isValidRelativeCssColor(value: string): boolean {
  const input = value.trim();
  const openParen = input.indexOf("(");
  if (openParen <= 0) return false;
  const name = input.slice(0, openParen).trim().toLowerCase();
  const args = readSingleCssFunctionArguments(input, name);
  if (args === null) return false;

  const components = splitCssSpaceComponents(args);
  if (components[0]?.toLowerCase() !== "from") return false;
  const origin = components[1];
  if (!origin || !isValidCssColor(origin)) return false;

  if (name === "alpha") {
    if (components.length === 2) return true;
    return (
      components.length === 4 &&
      components[2] === "/" &&
      isValidRelativeColorComponent(
        components[3]!,
        relativeCssColorChannels.get("alpha")!,
        new Set(["number", "percentage"]),
      )
    );
  }

  const colorFunction = name === "color";
  const channels = relativeColorChannelIdentifiers(name, components);
  if (!channels) return false;
  const componentStart = colorFunction ? 3 : 2;
  if (colorFunction) {
    const colorSpace = components[2]?.toLowerCase();
    if (
      !colorSpace ||
      !/^(?:srgb|srgb-linear|display-p3|display-p3-linear|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65)$/.test(
        colorSpace,
      )
    ) {
      return false;
    }
  }

  const slashIndex = components.indexOf("/");
  const hasAlpha = slashIndex !== -1;
  const channelEnd = hasAlpha ? slashIndex : components.length;
  if (
    (hasAlpha && slashIndex !== components.length - 2) ||
    channelEnd - componentStart !== 3
  ) {
    return false;
  }

  const channelValues = components.slice(componentStart, channelEnd);
  if (
    !channelValues.every((component, index) =>
      isValidRelativeColorComponent(
        component,
        channels,
        relativeColorComponentDimensions(name, index),
      ),
    )
  ) {
    return false;
  }
  return (
    !hasAlpha ||
    isValidRelativeColorComponent(
      components[components.length - 1]!,
      channels,
      new Set(["number", "percentage"]),
    )
  );
}

function relativeColorComponentDimensions(
  name: string,
  index: number,
): ReadonlySet<CssMathDimension> {
  if (
    ((name === "hsl" || name === "hsla" || name === "hwb") && index === 0) ||
    ((name === "lch" || name === "oklch") && index === 2)
  ) {
    return new Set(["angle", "number"]);
  }
  return new Set(["number", "percentage"]);
}

function isValidRelativeColorComponent(
  component: string,
  channels: ReadonlySet<string>,
  dimensions: ReadonlySet<CssMathDimension>,
): boolean {
  const normalized = component.trim().toLowerCase();
  if (normalized === "none" || channels.has(normalized)) return true;

  const mathFunction = component.match(/^([\w-]+)\(/)?.[1]?.toLowerCase();
  if (mathFunction && cssMathFunctions.has(mathFunction)) {
    const dimension = cssMathExpressionDimension(component, channels);
    return dimension === "unknown" || dimensions.has(dimension);
  }
  try {
    const parsed = csstree.parse(component, { context: "value" });
    if (parsed.type !== "Value" || parsed.children.size !== 1) return false;
    const node = parsed.children.first;
    if (!node) return false;
    if (node.type === "Number") return dimensions.has("number");
    if (node.type === "Percentage") return dimensions.has("percentage");
    if (node.type !== "Dimension") return false;
    const unit = csstree.ident.decode(node.unit).toLowerCase();
    return dimensions.has("angle") && /^(?:deg|grad|rad|turn)$/.test(unit);
  } catch (error) {
    if (error instanceof Error && error.name === "SyntaxError") return false;
    throw error;
  }
}

function hasUnsafeCssValueFunction(value: string): boolean {
  let unsafe = false;
  const attrArgumentRanges: {
    end: number;
    replacement: string;
    start: number;
  }[] = [];
  csstree.tokenize(value, (type, start, end) => {
    if (unsafe) return;
    if (type === csstree.tokenTypes.Url || type === csstree.tokenTypes.BadUrl) {
      unsafe = true;
      return;
    }
    if (type !== csstree.tokenTypes.Function) return;

    const name = csstree.ident
      .decode(value.slice(start, end - 1))
      .toLowerCase();
    if (name === "url" || name === "expression") unsafe = true;
    if (name !== "attr") return;

    const functionValue = readCssFunctionAt(value, end);
    if (!functionValue) {
      unsafe = true;
      return;
    }
    const firstArgumentEnd = cssFunctionFirstArgumentEnd(functionValue.args);
    const firstArgument = functionValue.args.slice(0, firstArgumentEnd);
    const attrHead = firstArgument
      .trim()
      .match(/^([^\s|]+)(?:\s*\|\s*([^\s|]+))?(?:\s+([\s\S]*))?$/);
    const attrName = attrHead
      ? `${attrHead[1]}${attrHead[2] ? `|${attrHead[2]}` : ""}`
      : "x";
    attrArgumentRanges.push({
      start: end,
      end: end + firstArgumentEnd,
      replacement: `${firstArgument.match(/^\s*/)?.[0] ?? ""}${attrName}`,
    });
    if (
      cssAttrSyntaxComponents(functionValue.args)?.some((component) => {
        const normalizedComponent = component.replace(/[+#]$/, "");
        const type =
          normalizedComponent.match(/^<([a-z-]+)>$/i)?.[1]?.toLowerCase() ??
          normalizedComponent.toLowerCase();
        return type === "url" || type === "image";
      })
    ) {
      unsafe = true;
    }
  });
  if (unsafe) return true;

  let treeValue = value;
  for (let index = attrArgumentRanges.length - 1; index >= 0; index -= 1) {
    const range = attrArgumentRanges[index]!;
    treeValue = `${treeValue.slice(0, range.start)}${range.replacement}${treeValue.slice(range.end)}`;
  }

  try {
    csstree.walk(csstree.parse(treeValue, { context: "value" }), (node) => {
      if (node.type !== "Function") return;
      const functionName = csstree.ident.decode(node.name).toLowerCase();
      if (functionName === "attr") {
        const firstArgument = node.children
          .toArray()
          .filter(
            (child) => child.type !== "WhiteSpace" && child.type !== "Comment",
          )
          .slice(0, 2);
        if (
          firstArgument[1]?.type === "Identifier" &&
          csstree.ident.decode(firstArgument[1].name).toLowerCase() === "url"
        ) {
          unsafe = true;
        }
        return;
      }
      if (
        !/^(?:image|image-set|-(?:webkit|moz|ms|o)-image-set)$/.test(
          functionName,
        )
      )
        return;

      csstree.walk(node, (child) => {
        if (child.type === "Function") {
          const functionName = csstree.ident.decode(child.name).toLowerCase();
          if (functionName === "image") {
            const source = child.children
              .toArray()
              .find(
                (descendant) =>
                  descendant.type !== "WhiteSpace" &&
                  descendant.type !== "Comment",
              );
            if (source && isUnsafeCssImageSource(source)) unsafe = true;
            return;
          }
          if (
            !/^(?:image-set|-(?:webkit|moz|ms|o)-image-set)$/.test(functionName)
          ) {
            return;
          }
          let firstInCandidate = true;
          for (const descendant of child.children.toArray()) {
            if (descendant.type === "Operator" && descendant.value === ",") {
              firstInCandidate = true;
              continue;
            }
            if (
              !firstInCandidate ||
              descendant.type === "WhiteSpace" ||
              descendant.type === "Comment"
            ) {
              continue;
            }
            firstInCandidate = false;
            if (isUnsafeCssImageSource(descendant)) unsafe = true;
          }
        }
      });
    });
  } catch (error) {
    if (error instanceof Error && error.name === "SyntaxError") return true;
    throw error;
  }

  return unsafe;
}

function isUnsafeCssImageSource(node: csstree.CssNode): boolean {
  if (node.type === "String") {
    return !csstree.string.decode(node.value).trim().startsWith("#");
  }
  if (node.type !== "Function") return false;
  const name = csstree.ident.decode(node.name).toLowerCase();
  if (/^(?:repeating-)?(?:linear|radial|conic)-gradient$/.test(name)) {
    return false;
  }
  let unsafe = false;
  csstree.walk(node, (child) => {
    if (child.type !== "Function") return;
    const functionName = csstree.ident.decode(child.name).toLowerCase();
    if (["var", "env", "attr"].includes(functionName)) unsafe = true;
  });
  return unsafe;
}

function importedTokenGrammars(
  token: ImportedDesignToken,
): { kind: "property" | "type"; name: string }[] | null {
  const name = token.cssVar.slice(2).toLowerCase();
  const properties = (...names: string[]) =>
    names.map((property) => ({ kind: "property" as const, name: property }));

  if (token.type === "radius") return properties("border-radius");
  if (token.type === "spacing") {
    if (/gap/.test(name)) return properties("gap");
    if (/margin/.test(name)) return properties("margin");
    if (/padding/.test(name)) return properties("padding");
    return [{ kind: "type", name: "length-percentage" }];
  }
  if (token.type === "typography") {
    if (/font[-_]?family/.test(name)) return properties("font-family");
    if (/weight/.test(name)) return properties("font-weight");
    if (/line[-_]?height|leading/.test(name)) return properties("line-height");
    if (/tracking|letter[-_]?spacing/.test(name)) {
      return properties("letter-spacing");
    }
    if (/size|text/.test(name)) return properties("font-size");
    return properties(
      "font",
      "font-size",
      "font-family",
      "font-weight",
      "line-height",
      "letter-spacing",
    );
  }
  if (token.type === "shadow") {
    return properties(/text/.test(name) ? "text-shadow" : "box-shadow");
  }
  if (token.type === "motion") {
    if (/duration/.test(name)) {
      return properties("animation-duration", "transition-duration");
    }
    if (/delay/.test(name)) {
      return properties("animation-delay", "transition-delay");
    }
    if (/easing|ease|timing/.test(name)) {
      return properties(
        "animation-timing-function",
        "transition-timing-function",
      );
    }
    if (/transition/.test(name)) return properties("transition");
    if (/animation/.test(name)) return properties("animation");
    return properties(
      "animation-duration",
      "animation-timing-function",
      "animation",
      "transition",
    );
  }
  return null;
}

function importedTokenMathDimensions(
  token: ImportedDesignToken,
): ReadonlySet<CssMathDimension> | null {
  const name = token.cssVar.slice(2).toLowerCase();
  if (token.type === "spacing" || token.type === "radius") {
    return new Set(["length", "length-percentage", "percentage", "unknown"]);
  }
  if (token.type === "typography") {
    if (/weight/.test(name)) return new Set(["number", "unknown"]);
    if (/font[-_]?family/.test(name)) return new Set();
    if (/size|text/.test(name)) {
      return new Set(["length", "length-percentage", "percentage", "unknown"]);
    }
    if (/line[-_]?height|leading/.test(name)) {
      return new Set([
        "number",
        "length",
        "length-percentage",
        "percentage",
        "unknown",
      ]);
    }
    if (/tracking|letter[-_]?spacing/.test(name)) {
      return new Set(["length", "unknown"]);
    }
    return new Set([
      "length",
      "length-percentage",
      "number",
      "percentage",
      "unknown",
    ]);
  }
  if (token.type === "motion") {
    if (/duration|delay/.test(name)) return new Set(["time", "unknown"]);
    if (/easing|ease|timing/.test(name)) {
      return new Set(["number", "percentage", "unknown"]);
    }
    return new Set(["time", "number", "percentage", "unknown"]);
  }
  return null;
}

function importedTokenAttrTypes(
  token: ImportedDesignToken,
): ReadonlySet<string> | null {
  const name = token.cssVar.slice(2).toLowerCase();
  if (token.type === "spacing" || token.type === "radius") {
    return new Set(["length", "length-percentage", "percentage"]);
  }
  if (token.type === "typography") {
    if (/weight/.test(name)) return new Set(["integer", "number"]);
    if (/font[-_]?family/.test(name)) {
      return new Set(["custom-ident", "string"]);
    }
    if (/size|text/.test(name)) {
      return new Set(["length", "length-percentage", "percentage"]);
    }
    if (/line[-_]?height|leading/.test(name)) {
      return new Set([
        "integer",
        "length",
        "length-percentage",
        "number",
        "percentage",
      ]);
    }
    if (/tracking|letter[-_]?spacing/.test(name)) return new Set(["length"]);
    return new Set([
      "custom-ident",
      "integer",
      "length",
      "length-percentage",
      "number",
      "percentage",
      "string",
    ]);
  }
  if (token.type === "motion") {
    if (/duration|delay/.test(name)) return new Set(["time"]);
    if (/easing|ease|timing/.test(name)) {
      return new Set(["integer", "number", "percentage"]);
    }
    return new Set(["custom-ident", "integer", "number", "percentage", "time"]);
  }
  return null;
}

function hasCompatibleCssMathDimensions(
  token: ImportedDesignToken,
  value: string,
): boolean {
  const expected = importedTokenMathDimensions(token);
  if (expected === null) return true;
  const mathRanges: { end: number; start: number }[] = [];
  let valid = true;
  csstree.tokenize(value, (type, start, end) => {
    if (!valid || type !== csstree.tokenTypes.Function) return;
    const name = csstree.ident
      .decode(value.slice(start, end - 1))
      .toLowerCase();
    if (!cssMathFunctions.has(name)) return;
    const functionValue = readCssFunctionAt(value, end);
    if (!functionValue) {
      valid = false;
      return;
    }
    if (
      mathRanges.some(
        (range) => range.start < start && range.end >= functionValue.end,
      )
    ) {
      return;
    }
    mathRanges.push({ start, end: functionValue.end });
  });

  if (!valid) return false;
  return mathRanges.every(({ start, end }) => {
    const dimension = cssMathExpressionDimension(value.slice(start, end));
    return expected.has(dimension);
  });
}

function hasCompatibleCssAttrSyntax(
  token: ImportedDesignToken,
  args: string,
  value: string,
  start: number,
  end: number,
): boolean {
  const expectedTypes = importedTokenAttrTypes(token);
  const components = cssAttrSyntaxComponents(args);
  if (!components) return false;

  let insideCssMathFunction = false;
  csstree.tokenize(value, (type, functionStart, tokenEnd) => {
    if (insideCssMathFunction || type !== csstree.tokenTypes.Function) return;
    const name = csstree.ident
      .decode(value.slice(functionStart, tokenEnd - 1))
      .toLowerCase();
    if (!cssMathFunctions.has(name)) return;
    const functionValue = readCssFunctionAt(value, tokenEnd);
    insideCssMathFunction = Boolean(
      functionValue && functionStart < start && functionValue.end >= end,
    );
  });

  if (insideCssMathFunction) {
    return cssAttrMathDimension(args) !== "invalid";
  }
  if (!expectedTypes) return true;

  return components.every((component) => {
    if (component.endsWith("+") || component.endsWith("#")) return false;
    const type =
      component.match(/^<([a-z-]+)>$/i)?.[1]?.toLowerCase() ?? component;
    return expectedTypes.has(type);
  });
}

function matchesImportedTokenGrammar(
  token: ImportedDesignToken,
  value: string,
): boolean {
  if (!hasCompatibleCssMathDimensions(token, value)) return false;
  const grammars = importedTokenGrammars(token);
  if (!grammars) return true;
  return grammars.some(({ kind, name }) =>
    kind === "type"
      ? csstree.lexer.matchType(name, value).matched !== null
      : csstree.lexer.matchProperty(name, value).matched !== null,
  );
}

function cssSubstitutionPlaceholders(token: ImportedDesignToken): string[] {
  const name = token.cssVar.slice(2).toLowerCase();
  if (token.type === "radius" || token.type === "spacing") return ["1px"];
  if (token.type === "typography") {
    if (/font[-_]?family/.test(name)) return ["serif"];
    if (/weight/.test(name)) return ["400"];
    if (/line[-_]?height|leading/.test(name)) return ["1.5"];
    if (/tracking|letter[-_]?spacing/.test(name)) return ["1px"];
    if (/size|text/.test(name)) return ["1rem"];
    return ["400", "1rem", "serif", "normal 400 1rem/1.5 serif"];
  }
  if (token.type === "shadow") return ["1px", "black", "0 0 1px black"];
  if (token.type === "motion") {
    if (/duration|delay/.test(name)) return ["1s"];
    if (/easing|ease|timing/.test(name)) return ["ease"];
    return ["1s", "ease", "fade-in", "opacity 1s ease"];
  }
  return [];
}

function isValidTypedCssTokenValue(
  token: ImportedDesignToken,
  value: string,
  depth = 0,
): boolean {
  if (depth > 5) return false;
  const ranges: {
    end: number;
    placeholders?: string[];
    start: number;
  }[] = [];
  let valid = true;

  csstree.tokenize(value, (type, start, end) => {
    if (!valid || type !== csstree.tokenTypes.Function) return;
    const name = csstree.ident
      .decode(value.slice(start, end - 1))
      .toLowerCase();
    if (!["var", "env", "attr"].includes(name)) return;
    const functionValue = readCssFunctionAt(value, end);
    if (
      !functionValue ||
      !isValidCssSubstitutionFunction(name, functionValue.args)
    ) {
      valid = false;
      return;
    }
    if (
      name === "attr" &&
      !hasCompatibleCssAttrSyntax(
        token,
        functionValue.args,
        value,
        start,
        functionValue.end,
      )
    ) {
      valid = false;
      return;
    }

    const parts = splitCssFunctionArguments(functionValue.args);
    if (
      name !== "attr" &&
      parts.length > 1 &&
      parts.slice(1).join(",").trim()
    ) {
      valid = isValidTypedCssTokenValue(
        token,
        parts.slice(1).join(",").trim(),
        depth + 1,
      );
      if (!valid) return;
    }

    if (name === "attr") {
      if (
        !ranges.some(
          (range) => range.start < start && range.end >= functionValue.end,
        )
      ) {
        ranges.push({
          start,
          end: functionValue.end,
          placeholders: [cssAttrPlaceholder(token, functionValue.args)],
        });
      }
      return;
    }

    if (
      !ranges.some(
        (range) => range.start < start && range.end >= functionValue.end,
      )
    ) {
      ranges.push({ start, end: functionValue.end });
    }
  });

  if (!valid) return false;
  if (ranges.length === 0) return matchesImportedTokenGrammar(token, value);
  if (ranges.length > 5) return false;

  const placeholders = cssSubstitutionPlaceholders(token);
  if (placeholders.length === 0) return false;
  const matchesWith = (index: number, replacements: string[]): boolean => {
    if (index === ranges.length) {
      let candidate = value;
      for (
        let rangeIndex = ranges.length - 1;
        rangeIndex >= 0;
        rangeIndex -= 1
      ) {
        const range = ranges[rangeIndex]!;
        candidate =
          candidate.slice(0, range.start) +
          replacements[rangeIndex]! +
          candidate.slice(range.end);
      }
      return matchesImportedTokenGrammar(token, candidate);
    }

    for (const placeholder of ranges[index]!.placeholders ?? placeholders) {
      replacements[index] = placeholder;
      if (matchesWith(index + 1, replacements)) return true;
    }
    return false;
  };

  return matchesWith(0, []);
}

function isValidImportedToken(token: ImportedDesignToken): boolean {
  if (
    !isSafeCssVarName(token.cssVar) ||
    !isSafeCssTokenValue(token.value) ||
    !hasBalancedCssValueSyntax(token.value)
  ) {
    return false;
  }
  if (hasUnsafeCssValueFunction(token.value)) return false;
  if (!hasValidCssMathFunctionSyntax(token.value)) return false;
  if (
    token.value.trim().startsWith("#") &&
    !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(
      token.value.trim(),
    )
  ) {
    return false;
  }
  if (token.type === "color") return isValidCssColor(token.value);
  if (token.type === "other") return true;
  return isValidTypedCssTokenValue(token, token.value);
}

function tokensFromFiles(
  files: { filename: string; content: string }[],
  initialOmittedFileCount = 0,
) {
  const accepted: { filename: string; content: string }[] = [];
  let totalBytes = 0;
  let omittedFileCount = initialOmittedFileCount;

  for (const [index, file] of files.entries()) {
    if (accepted.length >= DESIGN_TOKEN_IMPORT_MAX_FILES) {
      omittedFileCount += files.length - index;
      break;
    }
    const remainingBytes = DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES - totalBytes;
    const size = new TextEncoder().encode(file.content).byteLength;
    if (file.content.length > remainingBytes || size > remainingBytes) {
      omittedFileCount += 1;
      continue;
    }
    totalBytes += size;
    accepted.push(file);
  }

  let malformedNamedLineCount = 0;
  const cssCustomPropertyImportance = new Map<string, boolean>();
  const validFiles = accepted.filter(isValidImportFile).map((file) => {
    let content = /\.(scss|less)$/i.test(file.filename)
      ? stripScssLessLineComments(file.content)
      : file.content;
    const isHtml = /\.html?$/i.test(file.filename);
    const htmlImport = isHtml ? prepareHtmlImport(content) : null;
    if (htmlImport) {
      content = htmlImport.proseContent;
      malformedNamedLineCount += htmlImport.rejectedStylesheetCount;
    }
    const isStylesheet = /\.(css|scss|less)$/i.test(file.filename);
    const isPastedStylesheet =
      file.filename.toLowerCase() === "pasted-tokens.txt" &&
      looksLikePastedCss(content);
    const sanitized =
      isStylesheet || isPastedStylesheet
        ? { content, rejectedCount: 0 }
        : removeMalformedNamedLines(content);
    malformedNamedLineCount += sanitized.rejectedCount;
    return {
      ...file,
      content: sanitized.content,
      embeddedStylesheets: htmlImport?.stylesheets ?? [],
    };
  });
  const state = createCodeAnalysisState();
  for (const file of validFiles) {
    const analysisFilename =
      file.filename.toLowerCase() === "pasted-tokens.txt" &&
      looksLikePastedJson(file.content)
        ? "pasted-tokens.json"
        : file.filename;
    const isStylesheet = /\.(css|scss|less)$/i.test(file.filename);
    const isPastedStylesheet =
      file.filename.toLowerCase() === "pasted-tokens.txt" &&
      looksLikePastedCss(file.content);
    const basename = analysisFilename.toLowerCase().split("/").pop() ?? "";
    const hasSpecializedScriptAnalyzer =
      basename.startsWith("tailwind.config") ||
      /^(?:theme|tokens)\.(?:ts|js)$/.test(basename);
    const usesGenericScriptAnalyzer =
      /\.(?:tsx?|jsx?)$/i.test(analysisFilename) &&
      !hasSpecializedScriptAnalyzer;
    if (isStylesheet || isPastedStylesheet) {
      if (isStylesheet) {
        malformedNamedLineCount += addStylesheetCustomProperties(
          state,
          file.filename,
          file.content,
          cssCustomPropertyImportance,
        );
      }
    }
    if (!isStylesheet && !isPastedStylesheet && !usesGenericScriptAnalyzer) {
      analyzeCodeFile(state, analysisFilename, file.content);
    }
    malformedNamedLineCount += addLooseTextSignals(
      state,
      file.filename,
      file.content,
      !isStylesheet && !isPastedStylesheet && !/\.html?$/i.test(file.filename),
    );
    if (isPastedStylesheet) {
      const tokenListCandidate = pastedTokenListCssCandidate(file.content);
      const stylesheetCandidate = pastedStylesheetCssCandidate(file.content);
      const candidates = [
        file.content,
        ...(tokenListCandidate ? [tokenListCandidate] : []),
        ...(stylesheetCandidate ? [stylesheetCandidate] : []),
      ];
      let extracted = false;
      for (const candidate of candidates) {
        try {
          malformedNamedLineCount += addStylesheetCustomProperties(
            state,
            "pasted.css",
            candidate,
            cssCustomPropertyImportance,
          );
          extracted = true;
          break;
        } catch (error) {
          if (!(error instanceof Error) || error.name !== "CssSyntaxError") {
            throw error;
          }
        }
      }
      if (!extracted) {
        // guard:allow-bare-error — invariant: a validated CSS candidate must remain parseable.
        throw new Error("Validated pasted CSS could not be parsed");
      }
    }
    for (const stylesheet of file.embeddedStylesheets) {
      addLooseTextSignals(state, "embedded-style.css", stylesheet, false);
      malformedNamedLineCount += addStylesheetCustomProperties(
        state,
        "embedded-style.css",
        stylesheet,
        cssCustomPropertyImportance,
      );
    }
  }

  const tokens: ImportedDesignToken[] = parseNamedLines(validFiles);

  for (const [cssVar, value] of Object.entries(state.cssCustomProperties)) {
    const normalized = normalizeValue(value);
    tokens.push({
      name: friendlyName(cssVar),
      cssVar,
      value: normalized,
      type: classifyVar(cssVar, normalized),
      source: "CSS variables",
    });
  }

  let importedColorIndex = 1;
  for (const [key, value] of Object.entries(state.colors)) {
    if (key.startsWith("--")) continue;
    const normalized = normalizeValue(value);
    const cssVar =
      key === value
        ? `--color-imported-${importedColorIndex++}`
        : tokenVar("color", key);
    tokens.push({
      name: friendlyName(cssVar),
      cssVar,
      value: normalized,
      type: "color",
      source: "Colors",
    });
  }

  for (const [key, value] of Object.entries(state.spacing)) {
    if (key.startsWith("--")) continue;
    const cssVar = tokenVar("spacing", key);
    tokens.push({
      name: friendlyName(cssVar),
      cssVar,
      value: normalizeValue(value),
      type: "spacing",
      source: "Spacing",
    });
  }

  for (const [key, value] of Object.entries(state.borderRadius)) {
    if (key.startsWith("--")) continue;
    const cssVar = tokenVar("radius", key);
    tokens.push({
      name: friendlyName(cssVar),
      cssVar,
      value: normalizeValue(value),
      type: "radius",
      source: "Radius",
    });
  }

  state.fonts.slice(0, 8).forEach((font, index) => {
    const cssVar =
      index === 0
        ? "--font-heading"
        : index === 1
          ? "--font-body"
          : tokenVar("font", font.family);
    tokens.push({
      name: friendlyName(cssVar),
      cssVar,
      value: font.family,
      type: "typography",
      source: font.source ?? "Fonts",
    });
  });

  const rejectedCount =
    malformedNamedLineCount +
    tokens.filter((token) => !isValidImportedToken(token)).length;
  const candidates = uniqueTokenList(tokens.filter(isValidImportedToken));
  const imported: ImportedDesignToken[] = [];
  for (const token of candidates) {
    if (imported.length === 120) break;
    imported.push(token);
  }

  return {
    filesAnalyzed: validFiles.map((file) => file.filename),
    tokens: imported,
    rejectedCount,
    skippedCount: accepted.length - validFiles.length,
    omittedFileCount,
    omittedTokenCount: candidates.length - imported.length,
  };
}

export default defineAction({
  description:
    "Import design tokens into a design from pasted text, uploaded token/code files, " +
    "or the current design files. Parses CSS variables, design.md-style notes, " +
    "Tailwind/theme JSON, hard-coded colors, spacing, radii, and fonts, then " +
    "persists the imported values through the same CSS-var tweak bridge used by " +
    "apply-design-token-edit. For Figma/.fig and full local-code indexing, use " +
    "the Builder-backed design-system import flow.",
  schema: tokenImportSchema,
  maxBodyBytes: DESIGN_TOKEN_IMPORT_MAX_BODY_BYTES,
  run: async ({ designId, source, files, text }, context) => {
    await assertAccess("design", designId, "editor");
    await snapshotDesignBeforeAgentEdit(designId, context);

    const db = getDb();
    let importFiles: { filename: string; content: string }[] = [];
    let initialOmittedFileCount = 0;
    let sourceLabel = "Imported tokens";

    if (source === "current-design") {
      const result = await db.transaction(
        async (tx) => {
          const currentDesignCandidateFilename = sql`${schema.designFiles.filename} ~* '\\.(css|scss|less|json|md|mdx|txt|html?|tsx?|jsx?|mjs|cjs|mts|cts|vue|svelte|astro|yaml|yml|toml)$'`;
          const countRows = await tx
            .select({ fileCount: sql<number>`count(*)::int` })
            .from(schema.designFiles)
            .where(
              and(
                eq(schema.designFiles.designId, designId),
                currentDesignCandidateFilename,
              ),
            );
          const candidateFilename = sql<string>`left(${schema.designFiles.filename}, ${DESIGN_TOKEN_IMPORT_MAX_FILENAME_CHARS + 1})`;
          const candidateContentBytes = sql<number>`octet_length(left(${schema.designFiles.content}, ${DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES + 1}))`;
          const preferredCandidatePriority = sql<number>`case
            when ${schema.designFiles.filename} ~* '\\.(css|scss|less)$'
              and ${schema.designFiles.filename} ~* '(token|theme|global|variable|design[-_]?system|tailwind|color|palette)' then 0
            when ${schema.designFiles.filename} ~* '\\.(css|scss|less)$' then 1
            when ${schema.designFiles.filename} ~* '\\.json$'
              and ${schema.designFiles.filename} ~* '(token|theme|global|variable|design[-_]?system|tailwind|color|palette)' then 2
            when ${schema.designFiles.filename} ~* '\\.json$' then 3
            else 4
          end`;
          const boundedFilename = sql`char_length(${candidateFilename}) <= ${DESIGN_TOKEN_IMPORT_MAX_FILENAME_CHARS}`;
          const htmlCandidates = await tx
            .select({
              id: schema.designFiles.id,
              filename: candidateFilename,
              contentBytes: candidateContentBytes,
            })
            .from(schema.designFiles)
            .where(
              and(
                eq(schema.designFiles.designId, designId),
                boundedFilename,
                sql`${candidateContentBytes} <= ${DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES}`,
                sql`${schema.designFiles.filename} ~* '\\.(html?)$'`,
              ),
            )
            .orderBy(
              asc(candidateContentBytes),
              asc(schema.designFiles.filename),
              asc(schema.designFiles.id),
            )
            .limit(DESIGN_TOKEN_IMPORT_MAX_FILES);
          const preferredCandidates = await tx
            .select({
              id: schema.designFiles.id,
              filename: candidateFilename,
              contentBytes: candidateContentBytes,
            })
            .from(schema.designFiles)
            .where(
              and(
                eq(schema.designFiles.designId, designId),
                boundedFilename,
                sql`${candidateContentBytes} <= ${DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES}`,
                sql`${schema.designFiles.filename} ~* '\\.(css|scss|less|json|md|mdx|txt)$'`,
              ),
            )
            .orderBy(
              asc(preferredCandidatePriority),
              asc(candidateContentBytes),
              asc(schema.designFiles.filename),
              asc(schema.designFiles.id),
            )
            .limit(DESIGN_TOKEN_IMPORT_MAX_FILES);
          const selected: typeof preferredCandidates = [];
          let totalBytes = 0;

          const addCandidates = (candidates: typeof preferredCandidates) => {
            for (const candidate of candidates) {
              if (selected.length >= DESIGN_TOKEN_IMPORT_MAX_FILES) break;
              if (
                candidate.contentBytes >
                DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES - totalBytes
              ) {
                continue;
              }
              selected.push(candidate);
              totalBytes += candidate.contentBytes;
            }
          };

          const primaryPreferredCandidates =
            htmlCandidates.length > 0
              ? preferredCandidates.slice(0, DESIGN_TOKEN_IMPORT_MAX_FILES - 1)
              : preferredCandidates;
          addCandidates(primaryPreferredCandidates);
          addCandidates(htmlCandidates);
          addCandidates(
            preferredCandidates.slice(primaryPreferredCandidates.length),
          );
          if (
            preferredCandidates.length >= DESIGN_TOKEN_IMPORT_MAX_FILES &&
            selected.length < DESIGN_TOKEN_IMPORT_MAX_FILES &&
            totalBytes < DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES
          ) {
            let candidatesExhausted = false;
            while (
              !candidatesExhausted &&
              selected.length < DESIGN_TOKEN_IMPORT_MAX_FILES &&
              totalBytes < DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES
            ) {
              const availableSlots =
                DESIGN_TOKEN_IMPORT_MAX_FILES - selected.length;
              const additionalCandidates = await tx
                .select({
                  id: schema.designFiles.id,
                  filename: candidateFilename,
                  contentBytes: candidateContentBytes,
                })
                .from(schema.designFiles)
                .where(
                  and(
                    eq(schema.designFiles.designId, designId),
                    boundedFilename,
                    sql`${candidateContentBytes} <= ${DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES - totalBytes}`,
                    sql`${schema.designFiles.filename} ~* '\\.(css|scss|less|json|md|mdx|txt)$'`,
                    ...(selected.length > 0
                      ? [
                          notInArray(
                            schema.designFiles.id,
                            selected.map(({ id }) => id),
                          ),
                        ]
                      : []),
                  ),
                )
                .orderBy(
                  asc(preferredCandidatePriority),
                  asc(candidateContentBytes),
                  asc(schema.designFiles.filename),
                  asc(schema.designFiles.id),
                )
                .limit(availableSlots);
              if (additionalCandidates.length === 0) break;

              const previousSelectionLength = selected.length;
              addCandidates(additionalCandidates);
              candidatesExhausted =
                additionalCandidates.length < availableSlots;
              if (selected.length === previousSelectionLength) break;
            }
          }
          if (
            selected.length < DESIGN_TOKEN_IMPORT_MAX_FILES &&
            totalBytes < DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES
          ) {
            const fallbackCandidates = await tx
              .select({
                id: schema.designFiles.id,
                filename: candidateFilename,
                contentBytes: candidateContentBytes,
              })
              .from(schema.designFiles)
              .where(
                and(
                  eq(schema.designFiles.designId, designId),
                  boundedFilename,
                  currentDesignCandidateFilename,
                  sql`${candidateContentBytes} <= ${DESIGN_TOKEN_IMPORT_MAX_TOTAL_BYTES - totalBytes}`,
                  sql`${schema.designFiles.filename} !~* '\\.(css|scss|less|json|md|mdx|txt|html?)$'`,
                ),
              )
              .orderBy(
                asc(candidateContentBytes),
                asc(schema.designFiles.filename),
                asc(schema.designFiles.id),
              )
              .limit(DESIGN_TOKEN_IMPORT_MAX_FILES - selected.length);
            addCandidates(fallbackCandidates);
          }

          const contents = selected.length
            ? await tx
                .select({
                  id: schema.designFiles.id,
                  content: schema.designFiles.content,
                })
                .from(schema.designFiles)
                .where(
                  inArray(
                    schema.designFiles.id,
                    selected.map(({ id }) => id),
                  ),
                )
            : [];
          const contentById = new Map(
            contents.map(({ id, content }) => [id, content]),
          );

          return {
            files: selected.flatMap(({ id, filename }) => {
              const content = contentById.get(id);
              return content === undefined ? [] : [{ filename, content }];
            }),
            totalFileCount: countRows[0]?.fileCount ?? 0,
          };
        },
        { isolationLevel: "repeatable read" },
      );
      importFiles = result.files;
      initialOmittedFileCount = result.totalFileCount - importFiles.length;
      sourceLabel = "Current design";
    } else if (source === "paste") {
      importFiles = [{ filename: "pasted-tokens.txt", content: text ?? "" }];
      sourceLabel = "Pasted tokens";
    } else {
      importFiles = files ?? [];
      sourceLabel =
        importFiles.length === 1 ? importFiles[0].filename : "Imported files";
    }

    const {
      filesAnalyzed,
      tokens,
      rejectedCount,
      skippedCount,
      omittedFileCount,
      omittedTokenCount,
    } = tokensFromFiles(importFiles, initialOmittedFileCount);
    const safeTokens = tokens.filter(
      (token) =>
        isSafeCssVarName(token.cssVar) && isSafeCssTokenValue(token.value),
    );
    if (safeTokens.length === 0) {
      return {
        designId,
        source,
        importedCount: 0,
        rejectedCount,
        skippedCount,
        omittedFileCount,
        omittedTokenCount,
        filesAnalyzed,
        tokens: [],
        resolvedCssVars: {},
        deepLink: designDeepLink(designId),
      };
    }

    const importId = nanoid();
    const { data: persistedData } = await mutateDesignData({
      designId,
      mutate: (prevData, { updatedAt }) => {
        const tweaks = readTweaks(prevData);
        const nextSelections = { ...readSelections(prevData) };
        for (const token of safeTokens) {
          nextSelections[selectionKeyForCssVar(tweaks, token.cssVar)] =
            token.value;
        }

        const previousSources =
          prevData.tokenImportSources &&
          typeof prevData.tokenImportSources === "object" &&
          !Array.isArray(prevData.tokenImportSources)
            ? (prevData.tokenImportSources as Record<string, string>)
            : {};
        const tokenImportSources = { ...previousSources };
        for (const token of safeTokens) {
          tokenImportSources[token.cssVar] = tokenSourceLabel(
            token,
            sourceLabel,
          );
        }

        const previousImports = Array.isArray(prevData.tokenImports)
          ? (prevData.tokenImports as unknown[])
          : [];
        const alreadyAppended = previousImports.some(
          (entry) =>
            entry !== null &&
            typeof entry === "object" &&
            (entry as { id?: unknown }).id === importId,
        );
        const tokenImports = alreadyAppended
          ? previousImports
          : [
              ...previousImports.slice(-9),
              {
                id: importId,
                source,
                sourceLabel,
                tokenCount: safeTokens.length,
                filesAnalyzed,
                importedAt: updatedAt,
              },
            ];

        return {
          ...prevData,
          tweakSelections: nextSelections,
          tokenImportSources,
          tokenImports,
          tweaksAppliedAt: updatedAt,
        };
      },
      isApplied: (data) => {
        const tweaks = readTweaks(data);
        const selections = readSelections(data);
        const sources =
          data.tokenImportSources &&
          typeof data.tokenImportSources === "object" &&
          !Array.isArray(data.tokenImportSources)
            ? (data.tokenImportSources as Record<string, string>)
            : {};
        const imports = Array.isArray(data.tokenImports)
          ? data.tokenImports
          : [];
        return (
          safeTokens.every(
            (token) =>
              selections[selectionKeyForCssVar(tweaks, token.cssVar)] ===
                token.value &&
              sources[token.cssVar] === tokenSourceLabel(token, sourceLabel),
          ) &&
          imports.some(
            (entry) =>
              entry !== null &&
              typeof entry === "object" &&
              (entry as { id?: unknown }).id === importId,
          )
        );
      },
    });

    const tweaks = readTweaks(persistedData);
    const nextSelections = readSelections(persistedData);

    return {
      designId,
      source,
      importedCount: safeTokens.length,
      rejectedCount,
      skippedCount,
      omittedFileCount,
      omittedTokenCount,
      filesAnalyzed,
      tokens: safeTokens,
      resolvedCssVars: resolveTweaksToCssVars(tweaks, nextSelections),
      deepLink: designDeepLink(designId),
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const designId = (result as { designId?: string }).designId;
    if (!designId) return null;
    return {
      url: designDeepLink(designId),
      label: "Open design",
      view: "editor",
    };
  },
});
