import { defineAction, fail } from "@agent-native/core/action";
import { friendlyTokenName } from "@agent-native/core/brand-kit";
import { extractCssVars } from "@agent-native/core/server/design-token-utils";
import { resolveAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js";
import type { DesignSystemData } from "../shared/api.js";
import {
  groupDesignTokens,
  guessTokenType,
  readTokenTypes,
  type DesignToken,
} from "../shared/design-token-types.js";
import {
  isDirectCssVarSelectionKey,
  resolveTweaksToCssVars,
} from "../shared/resolve-tweaks.js";

export default defineAction({
  description:
    "Index the design tokens for a design as a friendly { name, cssVar, " +
    "value, type, source } list. Parses CSS custom properties from the " +
    "design's HTML :root block, the linked Brand Kit / design system, and " +
    "the user's applied tweak selections. When multiple files declare the " +
    "same cssVar, also returns `sources` (every contributing filename) and " +
    "`sourceValues` (per-file value) if those files disagree. Each token's " +
    "`type` is the one saved when it was created (apply-design-token-edit " +
    "`type`, or a DTCG `$type` on import), else a guess from its name and " +
    "value. Also returns `groups`: tokens in panel sections (color, " +
    "typography, spacing, radius, shadow, other) derived from each type.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designId }) => {
    const access = await resolveAccess("design", designId);
    if (!access) {
      fail("Design not found", { errorCode: "not_found", statusCode: 404 });
    }
    const design = access.resource;
    const db = getDb();

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
    const rawTokens: Map<string, RawTokenEntry> = new Map();
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
        rawTokens.set(cssVar, {
          value,
          source: src,
          sources: [src],
          sourceValues: { [src]: value },
        });
        return;
      }

      const sources = existing.sources.includes(src)
        ? existing.sources
        : [...existing.sources, src];
      rawTokens.set(cssVar, {
        ...existing,
        sources,
        sourceValues: { ...existing.sourceValues, [src]: value },
      });
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

    if (design.designSystemId) {
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
          if (dsData.borders?.radius) {
            setRawToken("--radius", dsData.borders.radius, "Brand Kit");
          }
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
    const tokenTypes = readTokenTypes(designData);

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

    const tokens: DesignToken[] = [];
    for (const [
      cssVar,
      { value, source, sources, sourceValues },
    ] of rawTokens) {
      tokens.push({
        name: friendlyTokenName(cssVar),
        cssVar,
        value,
        type: tokenTypes[cssVar] ?? guessTokenType(cssVar, value),
        source,
        ...(sources.length > 1 ? { sources } : {}),
        ...(sourceValues && new Set(Object.values(sourceValues)).size > 1
          ? { sourceValues }
          : {}),
        isTweakOverride: tweakCssVars.has(cssVar),
      });
    }

    return {
      designId,
      tokenCount: tokens.length,
      groups: groupDesignTokens(tokens),
      tokens,
    };
  },
});
