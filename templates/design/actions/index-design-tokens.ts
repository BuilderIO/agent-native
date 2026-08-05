import { defineAction } from "@agent-native/core";
import {
  brandKitRoleTokens,
  classifyBrandKitToken,
  friendlyTokenName,
  resolveBrandKitTokens,
} from "@agent-native/core/brand-kit/tokens";
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
// Token entry shape
// ---------------------------------------------------------------------------

export interface DesignToken {
  /** The linked Brand Kit's own token name when it has one, else derived. */
  name: string;
  /** CSS custom property, e.g. "--primary-color". */
  cssVar: string;
  /** Resolved string value, e.g. "#3B82F6" or "0.5rem". */
  value: string;
  /** Semantic token category. */
  type: "color" | "typography" | "spacing" | "radius" | "shadow" | "other";
  /** Opaque source chip label, e.g. "globals.css" or "Brand Kit". */
  source: string;
  /** Collection path from the Brand Kit, e.g. "Colors/Interactive". */
  group?: string;
  /**
   * Which layer supplied the token. Filter on this, not on `source` — that is a
   * free-text chip label (a filename, "Brand Kit", "Tweaks", …).
   */
  origin: "design" | "brand-kit";
  /**
   * True when the value comes from the design's own tweak selections (i.e.
   * the user has already customised this token in the editor).
   */
  isTweakOverride?: boolean;
}

/** Layer of a token's provenance, before it is flattened into a DesignToken. */
interface RawToken {
  value: string;
  source: string;
  origin: DesignToken["origin"];
  /** Present only when a Brand Kit supplied the token's own name. */
  name?: string;
  group?: string;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export default defineAction({
  description:
    "Index the design tokens for a design as a friendly { name, cssVar, " +
    "value, type, source, group } list. Parses CSS custom properties from the " +
    "design's HTML :root block, the linked Brand Kit / design system, and " +
    "the user's applied tweak selections. Tokens the linked Brand Kit stores " +
    "by name keep that name and collection group; the rest get a name derived " +
    "from their CSS variable. Returns tokens grouped by type " +
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

    /** cssVar -> latest layer that set it */
    const rawTokens: Map<string, RawToken> = new Map();
    // Persisted Brand Kit JSON can outlive its schema. Keep one malformed token
    // from taking down the whole read action while preserving valid siblings.
    const setRawToken = (
      cssVar: string,
      value: unknown,
      source: unknown,
      provenance: Omit<RawToken, "value" | "source">,
    ): void => {
      if (typeof value !== "string") return;
      rawTokens.set(cssVar, {
        value,
        source: typeof source === "string" && source ? source : "Unknown",
        ...provenance,
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
        setRawToken(k, v, file.filename, { origin: "design" });
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
          // The role -> var mapping lives in core so a rewriter cannot drift.
          for (const token of brandKitRoleTokens(dsData)) {
            setRawToken(token.cssVar, token.value, "Brand Kit", {
              origin: "brand-kit",
            });
          }
          // Layered after the roles: the kit's own names win over the
          // seven-slot summary.
          for (const token of resolveBrandKitTokens(dsData, "Brand Kit")) {
            setRawToken(
              token.cssVar,
              token.value,
              token.source ?? "Brand Kit",
              {
                origin: "brand-kit",
                name: token.name,
                ...(token.group ? { group: token.group } : {}),
              },
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
      // Retuning a value must not rename the token it came from.
      const inherited = rawTokens.get(cssVar);
      setRawToken(cssVar, value, tokenImportSources[cssVar] ?? "Tweaks", {
        origin: inherited?.origin ?? "design",
        ...(inherited?.name ? { name: inherited.name } : {}),
        ...(inherited?.group ? { group: inherited.group } : {}),
      });
    }

    // ------------------------------------------------------------------
    // 4. Build friendly token list
    // ------------------------------------------------------------------
    const tokens: DesignToken[] = [];
    for (const [cssVar, { value, source, name, group, origin }] of rawTokens) {
      tokens.push({
        name: name ?? friendlyTokenName(cssVar),
        cssVar,
        value,
        type: classifyBrandKitToken(cssVar, value),
        source,
        origin,
        ...(group ? { group } : {}),
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
