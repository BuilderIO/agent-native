import {
  createBuilderDesignSystemProxyFields,
  localBuilderDesignSystemId,
  type BuilderDesignSystemIndexResult,
  type BuilderDesignSystemGitHubSource,
  type BuilderDesignSystemSourceKind,
} from "@agent-native/core/server";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "../db/index.js";

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
    surface: "slides",
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
      "Use the local design system id in Slides flows; Builder remains the source of truth for the indexed brand kit.",
    ].join("\n"),
  };
}
