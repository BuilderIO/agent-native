import { defineAction } from "@agent-native/core";
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
import { assertAccess, resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  isSafeCssTokenValue,
  isSafeCssVarName,
  resolveTweaksToCssVars,
} from "../shared/resolve-tweaks.js";

type ImportedTokenType =
  | "color"
  | "typography"
  | "spacing"
  | "radius"
  | "shadow"
  | "other";

interface ImportedDesignToken {
  name: string;
  cssVar: string;
  value: string;
  type: ImportedTokenType;
  source: string;
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

function classifyVar(name: string, value: string): ImportedTokenType {
  const n = name.toLowerCase();
  if (
    /color|bg|background|text|border|accent|primary|secondary|surface|muted|foreground|fill|stroke/i.test(
      n,
    ) ||
    isColorValue(value)
  ) {
    return "color";
  }
  if (/font|size|leading|tracking|weight|heading|body|type/i.test(n)) {
    return "typography";
  }
  if (/radius|rounded/i.test(n)) return "radius";
  if (/spacing|gap|padding|margin|space/i.test(n)) return "spacing";
  if (/shadow|blur|drop/i.test(n)) return "shadow";
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
    if (!isSafeCssTokenValue(token.value)) continue;
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

function tokensFromFiles(files: { filename: string; content: string }[]) {
  const accepted: { filename: string; content: string }[] = [];
  let totalBytes = 0;

  for (const file of files.slice(0, CODE_MAX_FILES)) {
    const size = new TextEncoder().encode(file.content).byteLength;
    if (totalBytes + size > CODE_MAX_TOTAL_BYTES) break;
    totalBytes += size;
    accepted.push(file);
  }

  const state = createCodeAnalysisState();
  for (const file of accepted) {
    analyzeCodeFile(state, file.filename, file.content);
    addLooseTextSignals(state, file.filename, file.content);
  }

  const tokens: ImportedDesignToken[] = parseNamedLines(accepted);

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

  return {
    filesAnalyzed: accepted.map((file) => file.filename),
    tokens: uniqueTokenList(tokens).slice(0, 120),
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
  run: async ({ designId, source, files, text }) => {
    await assertAccess("design", designId, "editor");

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

    const { filesAnalyzed, tokens } = tokensFromFiles(importFiles);
    const safeTokens = tokens.filter(
      (token) =>
        isSafeCssVarName(token.cssVar) && isSafeCssTokenValue(token.value),
    );
    if (safeTokens.length === 0) {
      return {
        designId,
        source,
        importedCount: 0,
        skippedCount: importFiles.length - filesAnalyzed.length,
        filesAnalyzed,
        tokens: [],
        resolvedCssVars: {},
        deepLink: designDeepLink(designId),
      };
    }

    const access = await resolveAccess("design", designId);
    if (!access) throw new Error("Design not found");

    let prevData: Record<string, unknown> = {};
    if (access.resource.data) {
      try {
        const parsed = JSON.parse(access.resource.data);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          prevData = parsed;
        }
      } catch {
        // Stale/invalid JSON — preserve the write with a fresh object.
      }
    }

    type TweakDef = Parameters<typeof resolveTweaksToCssVars>[0][number];
    const tweaks: TweakDef[] = Array.isArray(prevData.tweaks)
      ? (prevData.tweaks as TweakDef[])
      : [];
    const cssVarToTweakId = new Map<string, string>();
    for (const tweak of tweaks) {
      if (tweak.cssVar) cssVarToTweakId.set(tweak.cssVar, tweak.id);
    }

    const prevSelections: Record<string, string | number | boolean> =
      prevData.tweakSelections &&
      typeof prevData.tweakSelections === "object" &&
      !Array.isArray(prevData.tweakSelections)
        ? (prevData.tweakSelections as Record<
            string,
            string | number | boolean
          >)
        : {};
    const nextSelections = { ...prevSelections };

    for (const token of safeTokens) {
      const tweakId = cssVarToTweakId.get(token.cssVar);
      nextSelections[tweakId ?? token.cssVar] = token.value;
    }

    const previousSources =
      prevData.tokenImportSources &&
      typeof prevData.tokenImportSources === "object" &&
      !Array.isArray(prevData.tokenImportSources)
        ? (prevData.tokenImportSources as Record<string, string>)
        : {};
    const tokenImportSources = { ...previousSources };
    for (const token of safeTokens) {
      tokenImportSources[token.cssVar] =
        token.source === "CSS variables" || token.source === "Colors"
          ? sourceLabel
          : token.source;
    }

    const now = new Date().toISOString();
    const previousImports = Array.isArray(prevData.tokenImports)
      ? (prevData.tokenImports as unknown[])
      : [];
    const nextData: Record<string, unknown> = {
      ...prevData,
      tweakSelections: nextSelections,
      tokenImportSources,
      tokenImports: [
        ...previousImports.slice(-9),
        {
          source,
          sourceLabel,
          tokenCount: safeTokens.length,
          filesAnalyzed,
          importedAt: now,
        },
      ],
      tweaksAppliedAt: now,
    };

    await db
      .update(schema.designs)
      .set({ data: JSON.stringify(nextData), updatedAt: now })
      .where(eq(schema.designs.id, designId));

    return {
      designId,
      source,
      importedCount: safeTokens.length,
      skippedCount: importFiles.length - filesAnalyzed.length,
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
