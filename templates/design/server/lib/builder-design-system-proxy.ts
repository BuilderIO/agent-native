import {
  friendlyTokenName,
  isColorTokenValue,
  normalizeBrandKitTokens,
  resolveBrandKitTokens,
} from "@agent-native/core/brand-kit";
import {
  createBuilderDesignSystemProxyFields,
  localBuilderDesignSystemId,
  type BuilderDesignSystemHydratedReference,
  type BuilderDesignSystemIndexResult,
  type BuilderDesignSystemGitHubSource,
  type BuilderDesignSystemSourceKind,
} from "@agent-native/core/server";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "../db/index.js";

type ProxyData = Record<string, unknown> & {
  colors?: Record<string, unknown>;
  typography?: Record<string, unknown>;
  spacing?: Record<string, unknown>;
  borders?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  customCSS?: unknown;
  tokens?: unknown;
};

type HydratedBuilderDesignSystemReference =
  BuilderDesignSystemHydratedReference & {
    completionConfirmed?: boolean;
  };

export function isBuilderDesignSystemReady(
  status: string | undefined,
): boolean {
  return status === "ready" || status === "complete" || status === "completed";
}

export interface BuilderProxyReconciliation {
  data: string;
  tokenCount: number;
  rejectedTokenCount: number;
  completionConfirmed: boolean;
}

function parseProxyData(data: string): ProxyData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new Error("Builder design-system proxy data is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Builder design-system proxy data must be a JSON object.");
  }
  return parsed as ProxyData;
}

function normalizedTokenName(value: string): string {
  return value.toLowerCase().replace(/^--/, "").replace(/_/g, "-");
}

function tokenShade(name: string): number | undefined {
  const match = name.match(/(?:^|-)(\d{2,4})(?:-|$)/);
  return match ? Number(match[1]) : undefined;
}

function findTokenValue(
  tokens: Array<{ cssVar: string; value: string; type: string }>,
  names: string[],
  excludedNamePattern?: RegExp,
): string | undefined {
  const candidates = tokens
    .filter((token) => isColorTokenValue(token.value))
    .map((token) => {
      const name = normalizedTokenName(token.cssVar);
      const exactIndex = names.indexOf(name);
      const hasName = names.some((candidate) =>
        new RegExp(`(?:^|-)${candidate}(?:-|$)`, "i").test(name),
      );
      return {
        token,
        name,
        score: exactIndex >= 0 ? 100 - exactIndex : hasName ? 10 : 0,
      };
    })
    .filter(
      (candidate) =>
        candidate.score > 0 && !excludedNamePattern?.test(candidate.name),
    );
  const exactCandidates = candidates
    .filter((candidate) => names.includes(candidate.name))
    .sort((a, b) => b.score - a.score);
  if (exactCandidates.length > 0) {
    return exactCandidates[0].token.value;
  }

  const fallbackCandidates = candidates.sort((a, b) => {
    const aShade = tokenShade(a.name);
    const bShade = tokenShade(b.name);
    const aShadeRank = aShade === 500 ? 0 : aShade === undefined ? 1 : 2;
    const bShadeRank = bShade === 500 ? 0 : bShade === undefined ? 1 : 2;
    return (
      aShadeRank - bShadeRank ||
      (aShade === undefined
        ? Number.MAX_SAFE_INTEGER
        : Math.abs(aShade - 500)) -
        (bShade === undefined
          ? Number.MAX_SAFE_INTEGER
          : Math.abs(bShade - 500)) ||
      a.name.localeCompare(b.name)
    );
  });
  return fallbackCandidates[0]?.token.value;
}

function findTypedTokenValue(
  tokens: Array<{ cssVar: string; value: string; type: string }>,
  patterns: RegExp[],
  excludedNamePattern?: RegExp,
): string | undefined {
  const candidates = tokens
    .filter((token) => {
      if (token.type !== "typography") return false;
      const name = normalizedTokenName(token.cssVar);
      if (
        excludedNamePattern?.test(name) ||
        !/(?:^|-)font(?:-family)?(?:-|$)|(?:^|-)family(?:-|$)/i.test(name) ||
        /(?:^|-)weight(?:-|$)|(?:^|-)size(?:-|$)|line-?height|leading|letter|tracking/i.test(
          name,
        ) ||
        /^-?\d*\.?\d+(?:px|rem|em|ex|ch|%|vh|vw|vmin|vmax|pt|pc|cm|mm|in|s|ms|deg|fr)?$/i.test(
          token.value.trim(),
        )
      ) {
        return false;
      }
      return true;
    })
    .map((token) => ({
      token,
      name: normalizedTokenName(token.cssVar),
      patternIndex: patterns.findIndex((pattern) =>
        pattern.test(normalizedTokenName(token.cssVar)),
      ),
    }))
    .filter((candidate) => candidate.patternIndex >= 0)
    .sort(
      (a, b) => a.patternIndex - b.patternIndex || a.name.localeCompare(b.name),
    );
  return candidates[0]?.token.value;
}

function findTokenByPattern(
  tokens: Array<{ cssVar: string; value: string; type: string }>,
  type: string,
  pattern: RegExp,
): string | undefined {
  return tokens.find(
    (token) => token.type === type && pattern.test(token.cssVar),
  )?.value;
}

/**
 * Merge completed Builder token extraction into the local selectable proxy.
 * The Builder docs remain the source of truth, but the local row must carry
 * concrete values because list/detail UI and token indexing read that row.
 */
export function reconcileBuilderProxyData(
  data: string,
  hydrated: HydratedBuilderDesignSystemReference,
  syncedAt: string,
): BuilderProxyReconciliation | null {
  const parsed = parseProxyData(data);
  const extracted = normalizeBrandKitTokens(
    Object.entries(hydrated.tokenValues).map(([cssVar, value]) => ({
      name: friendlyTokenName(cssVar),
      cssVar,
      value,
      source: "Builder DSI",
    })),
  );
  const completionConfirmed =
    hydrated.completionConfirmed === true ||
    hydrated.builderStatus === "ready" ||
    hydrated.builderStatus === "complete" ||
    hydrated.builderStatus === "completed";
  if (extracted.tokens.length === 0) {
    if (extracted.rejected.length > 0) {
      return {
        data,
        tokenCount: 0,
        rejectedTokenCount: extracted.rejected.length,
        completionConfirmed: false,
      };
    }
    if (!completionConfirmed) return null;
    return {
      data: JSON.stringify({
        ...parsed,
        builderStatus: "ready",
        builderSyncedAt: syncedAt,
      }),
      tokenCount: 0,
      rejectedTokenCount: 0,
      completionConfirmed: true,
    };
  }

  const legacyCssTokens =
    typeof parsed.customCSS === "string"
      ? resolveBrandKitTokens({ customCSS: parsed.customCSS }, "Local CSS")
      : [];
  const existing = [
    ...legacyCssTokens,
    ...normalizeBrandKitTokens(parsed.tokens).tokens,
  ].filter((token) => token.source !== "Builder DSI");
  const tokensByCssVar = new Map(
    existing.map((token) => [token.cssVar, token]),
  );
  for (const token of extracted.tokens) {
    tokensByCssVar.set(token.cssVar, token);
  }
  const tokens = [...tokensByCssVar.values()];
  const colorTokens = tokens.filter((token) => token.type === "color");
  const builderColorTokens = extracted.tokens.filter(
    (token) => token.type === "color",
  );
  const nextColors = { ...(parsed.colors ?? {}) };
  const colorRoles: Record<string, string[]> = {
    primary: ["primary", "color-primary", "brand-primary"],
    secondary: ["secondary", "color-secondary", "brand-secondary"],
    accent: ["accent", "color-accent", "brand-accent"],
    background: ["background", "color-background", "page-background"],
    surface: ["surface", "color-surface", "card-background"],
    text: ["text", "color-text", "foreground", "text-primary"],
    textMuted: ["text-muted", "muted-foreground", "text-secondary", "muted"],
  };
  for (const [role, names] of Object.entries(colorRoles)) {
    const excludedNamePattern =
      role === "primary" ? /(?:^|-)text(?:-|$)/i : undefined;
    const value =
      findTokenValue(builderColorTokens, names, excludedNamePattern) ??
      findTokenValue(colorTokens, names, excludedNamePattern);
    if (value) nextColors[role] = value;
  }

  const nextTypography = { ...(parsed.typography ?? {}) };
  const builderTypographyTokens = extracted.tokens.filter(
    (token) => token.type === "typography",
  );
  const headingPatterns = [
    /(?:^|-)heading(?:-|$)/i,
    /(?:^|-)display(?:-|$)/i,
    /(?:^|-)title(?:-|$)/i,
  ];
  const bodyPatterns = [
    /(?:^|-)body(?:-|$)/i,
    /(?:^|-)base(?:-|$)/i,
    /(?:^|-)text(?:-|$)/i,
    /(?:^|-)font-family(?:-|$)/i,
  ];
  const headingFont =
    findTypedTokenValue(builderTypographyTokens, headingPatterns) ??
    findTypedTokenValue(tokens, headingPatterns);
  const bodyFont =
    findTypedTokenValue(
      builderTypographyTokens,
      bodyPatterns,
      /(?:^|-)heading(?:-|$)|(?:^|-)display(?:-|$)|(?:^|-)title(?:-|$)/i,
    ) ??
    findTypedTokenValue(
      tokens,
      bodyPatterns,
      /(?:^|-)heading(?:-|$)|(?:^|-)display(?:-|$)|(?:^|-)title(?:-|$)/i,
    );
  if (headingFont) nextTypography.headingFont = headingFont;
  if (bodyFont) nextTypography.bodyFont = bodyFont;

  const nextSpacing = { ...(parsed.spacing ?? {}) };
  const builderSpacingTokens = extracted.tokens.filter(
    (token) => token.type === "spacing",
  );
  const spacingGapPattern = /gap|gutter|spacing/i;
  const spacingPaddingPattern = /padding|page-space|outer-space/i;
  const gap =
    findTokenByPattern(builderSpacingTokens, "spacing", spacingGapPattern) ??
    findTokenByPattern(tokens, "spacing", spacingGapPattern);
  const pagePadding =
    findTokenByPattern(
      builderSpacingTokens,
      "spacing",
      spacingPaddingPattern,
    ) ?? findTokenByPattern(tokens, "spacing", spacingPaddingPattern);
  if (gap) nextSpacing.elementGap = gap;
  if (pagePadding) nextSpacing.pagePadding = pagePadding;

  const nextBorders = { ...(parsed.borders ?? {}) };
  const radiusPattern = /radius|rounded|corner/i;
  const radius =
    findTokenByPattern(extracted.tokens, "radius", radiusPattern) ??
    findTokenByPattern(tokens, "radius", radiusPattern);
  if (radius) nextBorders.radius = radius;

  const nextDefaults = { ...(parsed.defaults ?? {}) };
  if (typeof nextColors.background === "string") {
    nextDefaults.background = nextColors.background;
  }

  return {
    data: JSON.stringify({
      ...parsed,
      builderStatus: completionConfirmed ? "ready" : "in-progress",
      ...(completionConfirmed ? { builderSyncedAt: syncedAt } : {}),
      colors: nextColors,
      typography: nextTypography,
      spacing: nextSpacing,
      borders: nextBorders,
      defaults: nextDefaults,
      tokens,
    }),
    tokenCount: extracted.tokens.length,
    rejectedTokenCount: extracted.rejected.length,
    completionConfirmed,
  };
}

export async function upsertBuilderProxyDesignSystem({
  result,
  ownerEmail,
  orgId,
  projectName,
  description,
  sourceKind,
  githubSources,
  localDesignSystemId: requestedLocalDesignSystemId,
}: {
  result: BuilderDesignSystemIndexResult;
  ownerEmail: string;
  orgId?: string | null;
  projectName?: string;
  description?: string;
  sourceKind?: BuilderDesignSystemSourceKind;
  githubSources?: BuilderDesignSystemGitHubSource[];
  localDesignSystemId?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const baseLocalDesignSystemId = localBuilderDesignSystemId(
    result.designSystemId,
  );
  const proxyFields = createBuilderDesignSystemProxyFields({
    result,
    projectName,
    description,
    surface: "design",
    sourceKind,
    githubSources,
    syncedAt: githubSources?.length ? now : undefined,
  });
  const [existing] = await db
    .select({
      id: schema.designSystems.id,
      ownerEmail: schema.designSystems.ownerEmail,
      orgId: schema.designSystems.orgId,
    })
    .from(schema.designSystems)
    .where(
      eq(
        schema.designSystems.id,
        requestedLocalDesignSystemId ?? baseLocalDesignSystemId,
      ),
    )
    .limit(1);
  const existingBelongsToScope =
    existing?.ownerEmail === ownerEmail &&
    (existing?.orgId ?? null) === (orgId ?? null);
  const localDesignSystemId =
    existing && !existingBelongsToScope
      ? `${baseLocalDesignSystemId}-${nanoid(8)}`
      : (requestedLocalDesignSystemId ?? baseLocalDesignSystemId);
  if (existingBelongsToScope) {
    await db
      .update(schema.designSystems)
      .set({
        title: proxyFields.title,
        description: proxyFields.description,
        data: proxyFields.data,
        assets: "[]",
        customInstructions: proxyFields.customInstructions,
        updatedAt: now,
      })
      .where(eq(schema.designSystems.id, existing.id));
  } else {
    const [ownedSystem] = await db
      .select({ id: schema.designSystems.id })
      .from(schema.designSystems)
      .where(
        orgId
          ? and(
              eq(schema.designSystems.ownerEmail, ownerEmail),
              eq(schema.designSystems.orgId, orgId),
            )
          : and(
              eq(schema.designSystems.ownerEmail, ownerEmail),
              isNull(schema.designSystems.orgId),
            ),
      )
      .limit(1);
    await db.insert(schema.designSystems).values({
      id: localDesignSystemId,
      title: proxyFields.title,
      description: proxyFields.description,
      data: proxyFields.data,
      assets: "[]",
      customInstructions: proxyFields.customInstructions,
      // An indexing proxy has placeholders until Builder confirms completion;
      // making it the default here lets new designs consume an unusable kit.
      isDefault: !ownedSystem && isBuilderDesignSystemReady(result.status),
      ownerEmail,
      orgId: orgId ?? null,
      visibility: orgId ? "org" : "private",
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    localDesignSystemId,
    instructions: [
      "Builder design-system indexing has started.",
      `Builder design system: ${result.designSystemId}`,
      `Local selectable design system: ${localDesignSystemId}`,
      `Builder job: ${result.jobId}`,
      `Open: ${result.builderUrl}`,
      "Use the local design system id in Design flows; Builder remains the source of truth for the indexed brand kit.",
    ].join("\n"),
  };
}
