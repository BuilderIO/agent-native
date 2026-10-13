import { defineAction } from "@agent-native/core/action";
import type { BrandKitTokenType } from "@agent-native/core/brand-kit";
import { buildDeepLink } from "@agent-native/core/server";
import {
  CODE_MAX_FILES,
  CODE_MAX_TOTAL_BYTES,
  analyzeCodeFile,
  createCodeAnalysisState,
  extractCodeColors,
  extractCodeFonts,
  extractCssVars,
  extractDocumentColors,
  extractDocumentFonts,
} from "@agent-native/core/server/design-token-utils";
import { assertAccess } from "@agent-native/core/sharing";
import * as csstree from "css-tree";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import postcss from "postcss";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js";
import {
  mutateDesignData,
  type DesignDataRecord,
} from "../server/lib/design-data-mutation.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
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
  filename: z.string().trim().min(1).describe("File name or relative path"),
  content: z.string().describe("Raw text content"),
});

const tokenImportSchema = z
  .object({
    designId: z.string().describe("Design project ID"),
    source: z
      .enum(["files", "paste", "current-design"])
      .describe(
        "Where to import from: uploaded files, pasted text, or the current design files.",
      ),
    files: z
      .array(tokenFileSchema)
      .optional()
      .describe("Files to parse when source is files"),
    text: z
      .string()
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
  return value
    .trim()
    .replace(/;$/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
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
): void {
  extractCssVars(state, content);
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
}

function parseNamedLines(
  files: { filename: string; content: string }[],
): ImportedDesignToken[] {
  const tokens: ImportedDesignToken[] = [];

  for (const file of files) {
    for (const rawLine of file.content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.length > 220) continue;

      const match = line.match(
        /^(?:[-*]\s*)?(?:\*\*)?([A-Za-z][\w\s/.-]{1,64}?)(?:\*\*)?\s*[:=]\s*(.+?)\s*$/,
      );
      if (!match) continue;

      const label = match[1].replace(/\*\*/g, "").trim();
      const value = normalizeValue(match[2]);
      if (!isSafeCssTokenValue(value)) continue;

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

const TOKEN_LABEL_LINE =
  /^(?:[-*]\s*)?(?:\*\*)?([A-Za-z][\w\s/.-]{1,64}?)(?:\*\*)?\s*[:=]\s*(.+?)\s*$/;

function hasBalancedCssValueSyntax(value: string): boolean {
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

function isProseTokenLabelLine(line: string): boolean {
  const match = line.match(TOKEN_LABEL_LINE);
  return Boolean(
    match &&
    /\s/.test(match[1]?.replace(/\*\*/g, "").trim() ?? "") &&
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
      isProseTokenLabelLine(line) ||
      /^\[[^\]\r\n]{1,80}\]$/.test(line)
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
    if (
      !quote &&
      !inBlockComment &&
      depth === 0 &&
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
  if (trimmed.startsWith("{")) return true;
  if (!trimmed.startsWith("[")) return false;

  try {
    JSON.parse(trimmed);
    return true;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }

  const [firstLine = "", ...remainingLines] = trimmed.split(/\r?\n/);
  const isNoteWithTokenList =
    /^\[[^\]\r\n]{1,80}\]$/.test(firstLine.trim()) &&
    remainingLines.some((line) => /^--[\w-]+\s*:/.test(line.trim()));

  return !isNoteWithTokenList;
}

function looksLikePastedCss(content: string): boolean {
  if (
    /(?:^|\n)\s*--[\w-]+\s*:/m.test(content) ||
    /(?:^|\n)\s*:root\s*\{/m.test(content)
  ) {
    return true;
  }

  if (
    /^\s*(?:export\s+default\b|module\.exports\s*=|(?:const|let|var)\s+\w+\s*=)/m.test(
      content,
    )
  ) {
    return false;
  }

  return /\{[^{}]*\b(?:--[\w-]+|[-a-z][\w-]*)\s*:/i.test(content);
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

  for (const css of cssCandidates) {
    try {
      postcss.parse(isScssOrLess ? stripScssLessLineComments(css) : css);
      return true;
    } catch (error) {
      if (!(error instanceof Error && error.name === "CssSyntaxError")) {
        throw error;
      }
    }
  }
  return false;
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

function isValidCssColor(value: string): boolean {
  const normalized = value.trim();
  if (csstree.lexer.matchType("color", normalized).matched) return true;

  const args = readSingleCssFunctionArguments(normalized, "var");
  if (args === null) return false;
  const [name, ...fallbackParts] = splitCssFunctionArguments(args);
  if (!/^--[-_a-zA-Z0-9]+$/.test(name ?? "")) return false;
  return (
    fallbackParts.length === 0 || isValidCssColor(fallbackParts.join(", "))
  );
}

function isValidImportedToken(token: ImportedDesignToken): boolean {
  if (!isSafeCssVarName(token.cssVar) || !isSafeCssTokenValue(token.value)) {
    return false;
  }
  if (/\b(?:url|expression)\s*\(/i.test(token.value)) return false;
  if (
    token.value.trim().startsWith("#") &&
    !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(
      token.value.trim(),
    )
  ) {
    return false;
  }
  return token.type !== "color" || isValidCssColor(token.value);
}

function tokensFromFiles(files: { filename: string; content: string }[]) {
  const accepted: { filename: string; content: string }[] = [];
  let totalBytes = 0;
  let omittedFileCount = 0;

  for (const [index, file] of files.entries()) {
    if (accepted.length >= CODE_MAX_FILES) {
      omittedFileCount += files.length - index;
      break;
    }
    const size = new TextEncoder().encode(file.content).byteLength;
    if (totalBytes + size > CODE_MAX_TOTAL_BYTES) {
      omittedFileCount += files.length - index;
      break;
    }
    totalBytes += size;
    accepted.push(file);
  }

  const validFiles = accepted.filter(isValidImportFile);
  const state = createCodeAnalysisState();
  for (const file of validFiles) {
    const analysisFilename =
      file.filename.toLowerCase() === "pasted-tokens.txt" &&
      looksLikePastedJson(file.content)
        ? "pasted-tokens.json"
        : file.filename;
    analyzeCodeFile(state, analysisFilename, file.content);
    addLooseTextSignals(state, file.filename, file.content);
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

  const rejectedCount = tokens.filter(
    (token) => !isValidImportedToken(token),
  ).length;
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
  run: async ({ designId, source, files, text }, context) => {
    await assertAccess("design", designId, "editor");
    await snapshotDesignBeforeAgentEdit(designId, context);

    const db = getDb();
    let importFiles: { filename: string; content: string }[] = [];
    let sourceLabel = "Imported tokens";

    if (source === "current-design") {
      const designFiles = await db
        .select({
          filename: schema.designFiles.filename,
          content: schema.designFiles.content,
        })
        .from(schema.designFiles)
        .where(eq(schema.designFiles.designId, designId));
      importFiles = designFiles;
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
    } = tokensFromFiles(importFiles);
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
