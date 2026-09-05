import { defineAction } from "@agent-native/core/action";
import { extractCssVars } from "@agent-native/core/server/design-token-utils";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import type { DesignSystemData } from "../shared/api.js";
import {
  isDirectCssVarSelectionKey,
  resolveTweaksToCssVars,
} from "../shared/resolve-tweaks.js";

// ---------------------------------------------------------------------------
// Token type classification
// ---------------------------------------------------------------------------

function classifyVar(
  name: string,
  value: string,
): "color" | "typography" | "spacing" | "radius" | "shadow" | "other" {
  const n = name.toLowerCase();
  if (
    /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\(|color\()/.test(value.trim())
  ) {
    return "color";
  }
  if (/radius|rounded/i.test(n)) {
    return "radius";
  }
  if (/font|size|leading|tracking|weight|heading|body|type/i.test(n)) {
    return "typography";
  }
  if (/spacing|gap|padding|margin|space/i.test(n)) {
    return "spacing";
  }
  if (/shadow|blur|drop/i.test(n)) {
    return "shadow";
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

/** Derive a friendly display name from a CSS var name like `--primary-color`. */
function friendlyName(cssVar: string): string {
  return cssVar
    .replace(/^--/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Token entry shape
// ---------------------------------------------------------------------------

export interface DesignToken {
  /** Human-readable display name, e.g. "Primary Color". */
  name: string;
  /** CSS custom property, e.g. "--primary-color". */
  cssVar: string;
  /** Resolved string value, e.g. "#3B82F6" or "0.5rem". */
  value: string;
  /** Semantic token category. */
  type: "color" | "typography" | "spacing" | "radius" | "shadow" | "other";
  /** Opaque source chip label, e.g. "globals.css" or "Brand Kit". */
  source: string;
  /**
   * Every design file that declares this cssVar, when more than one does
   * (e.g. the same :root var repeated in index.html and task-details.html).
   * `source` stays the first file for compatibility; omitted when only one
   * file contributed.
   */
  sources?: string[];
  /**
   * Per-file value, keyed by filename, present only when contributing files
   * disagree on this cssVar's value — surfaced instead of silently keeping
   * whichever file's value happened to be read first.
   */
  sourceValues?: Record<string, string>;
  /**
   * True when the value comes from the design's own tweak selections (i.e.
   * the user has already customised this token in the editor).
   */
  isTweakOverride?: boolean;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export default defineAction({
  description:
    "Index the design tokens for a design as a friendly { name, cssVar, " +
    "value, type, source } list. Parses CSS custom properties from the " +
    "design's HTML :root block, the linked Brand Kit / design system, and " +
    "the user's applied tweak selections. When multiple files declare the " +
    "same cssVar, also returns `sources` (every contributing filename) and " +
    "`sourceValues` (per-file value) if those files disagree. Returns tokens " +
    "grouped by type (color, typography, spacing, radius, shadow, other).",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId }) => {
    const access = await resolveAccess("design", designId);
    if (!access) {
      throw new Error("Design not found");
    }
    const design = access.resource;
    const db = getDb();

    // ------------------------------------------------------------------
    // 1. Parse tokens from the design's own HTML files (:root vars)
    // ------------------------------------------------------------------
    const files = (
      await db
        .select({
          filename: schema.designFiles.filename,
          content: schema.designFiles.content,
        })
        .from(schema.designFiles)
        .where(eq(schema.designFiles.designId, designId))
    ).sort((a, b) => (a.filename ?? "").localeCompare(b.filename ?? ""));

    interface RawTokenEntry {
      value: string;
      source: string;
      sources: string[];
      sourceValues?: Record<string, string>;
    }
    /** cssVar -> contributing (value, source) info. */
    const rawTokens: Map<string, RawTokenEntry> = new Map();
    // Persisted Brand Kit JSON can outlive its schema. Keep one malformed token
    // from taking down the whole read action while preserving valid siblings.
    //
    // `accumulate` distinguishes two different meanings of "setting a token
    // again": the design's own files merely co-declaring the same :root var
    // (accumulate — every file is a legitimate contributor, so track them
    // all) vs. the Brand Kit / Tweaks overlay passes below, which intend to
    // replace whatever an earlier layer set (not accumulate).
    const setRawToken = (
      cssVar: string,
      value: unknown,
      source: unknown,
      opts?: { accumulate?: boolean },
    ): void => {
      if (typeof value !== "string") return;
      const src = typeof source === "string" && source ? source : "Unknown";

      const existing = opts?.accumulate ? rawTokens.get(cssVar) : undefined;
      if (!existing) {
        rawTokens.set(cssVar, { value, source: src, sources: [src] });
        return;
      }

      // Same cssVar declared in more than one design file — keep the first
      // file's (value, source) as the reported primary for compatibility,
      // record every contributing file, and call out disagreeing values
      // instead of silently keeping whichever file the DB happened to
      // return last.
      const sources = existing.sources.includes(src)
        ? existing.sources
        : [...existing.sources, src];
      const sourceValues =
        value !== existing.value
          ? {
              ...(existing.sourceValues ?? {
                [existing.source]: existing.value,
              }),
              [src]: value,
            }
          : existing.sourceValues;
      rawTokens.set(cssVar, { ...existing, sources, sourceValues });
    };

    for (const file of files) {
      const state = {
        colors: {} as Record<string, string>,
        cssCustomProperties: {} as Record<string, string>,
        fonts: [],
        spacing: {} as Record<string, string>,
        borderRadius: {} as Record<string, string>,
        stylingFramework: null,
        rawExtracts: [],
        seenFonts: new Set<string>(),
      };
      extractCssVars(state, file.content);
      for (const [k, v] of Object.entries(state.cssCustomProperties)) {
        setRawToken(k, v, file.filename, { accumulate: true });
      }
    }

    // ------------------------------------------------------------------
    // 2. Overlay tokens from the linked Brand Kit / design system
    // ------------------------------------------------------------------
    if (design.designSystemId) {
      // Design systems are their own access boundary (same pattern as
      // get-design-system.ts). A user who can read the design but has no
      // access to the linked design system must NOT receive its tokens.
      const dsAccess = await resolveAccess(
        "design-system",
        design.designSystemId,
      );

      const [dsRow] = dsAccess
        ? await db
            .select({ data: schema.designSystems.data })
            .from(schema.designSystems)
            .where(eq(schema.designSystems.id, design.designSystemId))
            .limit(1)
        : [];

      if (dsRow?.data) {
        try {
          const dsData = JSON.parse(dsRow.data) as Partial<DesignSystemData>;
          // Flatten the Brand Kit's known token fields into CSS vars
          const brandColors = dsData.colors ?? {};
          const colorRoleMap: Record<string, string> = {
            primary: "--color-primary",
            secondary: "--color-secondary",
            accent: "--color-accent",
            background: "--color-background",
            surface: "--color-surface",
            text: "--color-text",
            textMuted: "--color-text-muted",
          };
          for (const [role, cssVar] of Object.entries(colorRoleMap)) {
            const v = (brandColors as Record<string, string>)[role];
            if (v) setRawToken(cssVar, v, "Brand Kit");
          }
          // Border radius
          if (dsData.borders?.radius) {
            setRawToken("--radius", dsData.borders.radius, "Brand Kit");
          }
          // Spacing
          if (dsData.spacing?.elementGap) {
            setRawToken(
              "--spacing-element-gap",
              dsData.spacing.elementGap,
              "Brand Kit",
            );
          }
          if (dsData.spacing?.pagePadding) {
            setRawToken(
              "--spacing-page-padding",
              dsData.spacing.pagePadding,
              "Brand Kit",
            );
          }
        } catch {
          // Malformed JSON — skip Brand Kit overlay silently.
        }
      }
    }

    // ------------------------------------------------------------------
    // 3. Overlay tweak-resolved values (user customisations win)
    // ------------------------------------------------------------------
    let designData: Record<string, unknown> = {};
    try {
      designData = design.data
        ? (JSON.parse(design.data) as Record<string, unknown>)
        : {};
    } catch {
      // ignore
    }
    const tweaks = Array.isArray(designData.tweaks)
      ? (designData.tweaks as Array<{
          id: string;
          cssVar?: string;
          defaultValue: unknown;
        }>)
      : [];
    const tweakSelections =
      designData.tweakSelections &&
      typeof designData.tweakSelections === "object" &&
      !Array.isArray(designData.tweakSelections)
        ? (designData.tweakSelections as Record<
            string,
            string | number | boolean
          >)
        : {};
    const tokenImportSources =
      designData.tokenImportSources &&
      typeof designData.tokenImportSources === "object" &&
      !Array.isArray(designData.tokenImportSources)
        ? (designData.tokenImportSources as Record<string, string>)
        : {};

    // Cast tweaks array to the shape resolveTweaksToCssVars expects
    type TweakDef = Parameters<typeof resolveTweaksToCssVars>[0][number];
    const resolvedOverrides = resolveTweaksToCssVars(
      tweaks as TweakDef[],
      tweakSelections,
    );
    const tweakCssVars = new Set([
      ...(tweaks.map((t) => t.cssVar).filter(Boolean) as string[]),
      ...Object.keys(tweakSelections).filter(isDirectCssVarSelectionKey),
    ]);
    for (const [cssVar, value] of Object.entries(resolvedOverrides)) {
      setRawToken(cssVar, value, tokenImportSources[cssVar] ?? "Tweaks");
    }

    // ------------------------------------------------------------------
    // 4. Build friendly token list
    // ------------------------------------------------------------------
    const tokens: DesignToken[] = [];
    for (const [
      cssVar,
      { value, source, sources, sourceValues },
    ] of rawTokens) {
      tokens.push({
        name: friendlyName(cssVar),
        cssVar,
        value,
        type: classifyVar(cssVar, value),
        source,
        ...(sources.length > 1 ? { sources } : {}),
        ...(sourceValues ? { sourceValues } : {}),
        isTweakOverride: tweakCssVars.has(cssVar),
      });
    }

    // Group by type for the panel
    type TokenGroup = { type: DesignToken["type"]; tokens: DesignToken[] };
    const ORDER: DesignToken["type"][] = [
      "color",
      "typography",
      "spacing",
      "radius",
      "shadow",
      "other",
    ];
    const byType = new Map<DesignToken["type"], DesignToken[]>(
      ORDER.map((t) => [t, []]),
    );
    for (const tok of tokens) {
      byType.get(tok.type)!.push(tok);
    }
    const groups: TokenGroup[] = [];
    for (const type of ORDER) {
      const toks = byType.get(type)!;
      if (toks.length > 0) groups.push({ type, tokens: toks });
    }

    return { designId, tokenCount: tokens.length, groups, tokens };
  },
});
