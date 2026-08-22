import {
  friendlyTokenName,
  isColorTokenValue,
  normalizeBrandKitTokens,
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
  tokens?: unknown;
};

export interface BuilderProxyReconciliation {
  data: string;
  tokenCount: number;
  rejectedTokenCount: number;
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

function findTokenValue(
  tokens: Array<{ cssVar: string; value: string; type: string }>,
  names: string[],
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
        score: exactIndex >= 0 ? 100 - exactIndex : hasName ? 10 : 0,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.token.value;
}

function findTypedTokenValue(
  tokens: Array<{ cssVar: string; value: string; type: string }>,
  pattern: RegExp,
): string | undefined {
  return tokens.find(
    (token) => token.type === "typography" && pattern.test(token.cssVar),
  )?.value;
}

/**
 * Merge completed Builder token extraction into the local selectable proxy.
 * The Builder docs remain the source of truth, but the local row must carry
 * concrete values because list/detail UI and token indexing read that row.
 */
export function reconcileBuilderProxyData(
  data: string,
  hydrated: BuilderDesignSystemHydratedReference,
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
  if (extracted.tokens.length === 0) return null;

  const existing = normalizeBrandKitTokens(parsed.tokens).tokens;
  const tokensByCssVar = new Map(
    existing.map((token) => [token.cssVar, token]),
  );
  for (const token of extracted.tokens) {
    tokensByCssVar.set(token.cssVar, token);
  }
  const tokens = [...tokensByCssVar.values()];
  const colorTokens = tokens.filter((token) => token.type === "color");
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
    const value = findTokenValue(colorTokens, names);
    if (value) nextColors[role] = value;
  }

  const nextTypography = { ...(parsed.typography ?? {}) };
  const headingFont = findTypedTokenValue(
    tokens,
    /heading|display|title|font-family-heading/i,
  );
  const bodyFont = findTypedTokenValue(
    tokens,
    /body|font-family-body|font-family/i,
  );
  if (headingFont) nextTypography.headingFont = headingFont;
  if (bodyFont) nextTypography.bodyFont = bodyFont;

  const nextSpacing = { ...(parsed.spacing ?? {}) };
  const gap = tokens.find(
    (token) =>
      /gap|gutter|spacing/i.test(token.cssVar) && token.type === "spacing",
  )?.value;
  const pagePadding = tokens.find(
    (token) =>
      /padding|page-space|outer-space/i.test(token.cssVar) &&
      token.type === "spacing",
  )?.value;
  if (gap) nextSpacing.elementGap = gap;
  if (pagePadding) nextSpacing.pagePadding = pagePadding;

  const nextBorders = { ...(parsed.borders ?? {}) };
  const radius = tokens.find(
    (token) =>
      /radius|rounded|corner/i.test(token.cssVar) && token.type === "radius",
  )?.value;
  if (radius) nextBorders.radius = radius;

  const nextDefaults = { ...(parsed.defaults ?? {}) };
  if (typeof nextColors.background === "string") {
    nextDefaults.background = nextColors.background;
  }

  return {
    data: JSON.stringify({
      ...parsed,
      builderStatus: "ready",
      builderSyncedAt: syncedAt,
      colors: nextColors,
      typography: nextTypography,
      spacing: nextSpacing,
      borders: nextBorders,
      defaults: nextDefaults,
      tokens,
    }),
    tokenCount: extracted.tokens.length,
    rejectedTokenCount: extracted.rejected.length,
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
      isDefault: !ownedSystem,
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
