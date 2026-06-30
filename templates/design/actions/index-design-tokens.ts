import { defineAction } from "@agent-native/core";
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
    /color|bg|background|text|border|accent|primary|secondary|surface|muted|foreground|fill|stroke/i.test(
      n,
    ) ||
    /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|oklch\(|color\()/.test(value.trim())
  ) {
    return "color";
  }
  if (/font|size|leading|tracking|weight|heading|body|type/i.test(n)) {
    return "typography";
  }
  if (/radius|rounded/i.test(n)) {
    return "radius";
  }
  if (/spacing|gap|padding|margin|space/i.test(n)) {
    return "spacing";
  }
  if (/shadow|blur|drop/i.test(n)) {
    return "shadow";
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
    "the user's applied tweak selections.  Returns tokens grouped by type " +
    "(color, typography, spacing, radius, shadow, other).",
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
    const files = await db
      .select({
        filename: schema.designFiles.filename,
        content: schema.designFiles.content,
      })
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, designId));

    /** cssVar -> { value, source } */
    const rawTokens: Map<string, { value: string; source: string }> = new Map();

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
        rawTokens.set(k, { value: v, source: file.filename });
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
            if (v) rawTokens.set(cssVar, { value: v, source: "Brand Kit" });
          }
          // Border radius
          if (dsData.borders?.radius) {
            rawTokens.set("--radius", {
              value: dsData.borders.radius,
              source: "Brand Kit",
            });
          }
          // Spacing
          if (dsData.spacing?.elementGap) {
            rawTokens.set("--spacing-element-gap", {
              value: dsData.spacing.elementGap,
              source: "Brand Kit",
            });
          }
          if (dsData.spacing?.pagePadding) {
            rawTokens.set("--spacing-page-padding", {
              value: dsData.spacing.pagePadding,
              source: "Brand Kit",
            });
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
      rawTokens.set(cssVar, {
        value,
        source: tokenImportSources[cssVar] ?? "Tweaks",
      });
    }

    // ------------------------------------------------------------------
    // 4. Build friendly token list
    // ------------------------------------------------------------------
    const tokens: DesignToken[] = [];
    for (const [cssVar, { value, source }] of rawTokens) {
      tokens.push({
        name: friendlyName(cssVar),
        cssVar,
        value,
        type: classifyVar(cssVar, value),
        source,
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
