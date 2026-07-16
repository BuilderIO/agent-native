import { getDbExec } from "@agent-native/core/db";
import { deletePrivateBlob } from "@agent-native/core/private-blob";
import {
  resourceDeleteByPath,
  sharedResourceOwner,
} from "@agent-native/core/resources/store";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, or } from "drizzle-orm";

import { parsePrivateBlobHandle } from "../connectors/private-artifacts.js";
import { deletePostgresFtsDocuments } from "../search/postgres-fts.js";
import { getCreativeContext } from "../server/context.js";
import { nowIso, parseJson, stringifyJson } from "./helpers.js";
import { createJob } from "./jobs.js";
import { resolveLayoutProjectionItemId } from "./suggestions.js";

export async function purgeContextSourceArtifacts(sourceId: string) {
  await assertAccess("creative-context-source", sourceId, "editor", undefined, {
    skipResourceBody: true,
  });
  const { getDb, schema, vectorAdapter, projections } = getCreativeContext();
  const sourceRows = await getDb()
    .select({
      ownerEmail: schema.contextSources.ownerEmail,
      orgId: schema.contextSources.orgId,
    })
    .from(schema.contextSources)
    .where(eq(schema.contextSources.id, sourceId))
    .limit(1);
  const source = sourceRows[0];
  if (!source) throw new Error("Creative context source not found");
  const items = await getDb()
    .select({ id: schema.contextItems.id })
    .from(schema.contextItems)
    .where(eq(schema.contextItems.sourceId, sourceId));
  const itemIds = items.map((item: any) => item.id as string);
  if (!itemIds.length) return { sourceId, purgedItems: 0, purgedBlobs: 0 };
  const versions = await getDb()
    .select({
      id: schema.contextItemVersions.id,
      rawSnapshotBlobRef: schema.contextItemVersions.rawSnapshotBlobRef,
    })
    .from(schema.contextItemVersions)
    .where(inArray(schema.contextItemVersions.itemId, itemIds));
  const versionIds = versions.map((version: any) => version.id as string);
  const [
    chunks,
    media,
    embeddings,
    derivedEdges,
    evidence,
    packMemberships,
    suggestions,
    generationRows,
  ] = await Promise.all([
    getDb()
      .select({ id: schema.contextChunks.id })
      .from(schema.contextChunks)
      .where(inArray(schema.contextChunks.itemVersionId, versionIds)),
    getDb()
      .select({ storageKey: schema.contextMedia.storageKey })
      .from(schema.contextMedia)
      .where(inArray(schema.contextMedia.itemVersionId, versionIds)),
    getDb()
      .select({
        vectorKey: schema.embeddings.vectorKey,
        dimensions: schema.embeddings.dimensions,
      })
      .from(schema.embeddings)
      .where(inArray(schema.embeddings.itemVersionId, versionIds)),
    getDb()
      .select({ fromItemId: schema.contextEdges.fromItemId })
      .from(schema.contextEdges)
      .where(inArray(schema.contextEdges.toItemId, itemIds)),
    getDb()
      .select({ dnaVersionId: schema.brandDnaEvidence.dnaVersionId })
      .from(schema.brandDnaEvidence)
      .where(inArray(schema.brandDnaEvidence.itemId, itemIds)),
    getDb()
      .select({ packId: schema.contextPackMembers.packId })
      .from(schema.contextPackMembers)
      .where(inArray(schema.contextPackMembers.itemId, itemIds)),
    getDb()
      .select({
        id: schema.contextSuggestions.id,
        status: schema.contextSuggestions.status,
        payload: schema.contextSuggestions.payload,
      })
      .from(schema.contextSuggestions)
      .where(inArray(schema.contextSuggestions.itemId, itemIds)),
    getDb()
      .select({
        id: schema.generationRecords.id,
        elementProvenance: schema.generationRecords.elementProvenance,
      })
      .from(schema.generationRecords)
      .where(
        source.orgId
          ? eq(schema.generationRecords.orgId, source.orgId)
          : eq(schema.generationRecords.ownerEmail, source.ownerEmail),
      ),
  ]);
  const dnaVersionIds: string[] = [
    ...new Set<string>(
      (evidence as any[]).map((row) => String(row.dnaVersionId)),
    ),
  ];
  const affectedProfiles = dnaVersionIds.length
    ? await getDb()
        .select({
          profileId: schema.brandDnaVersions.profileId,
          ownerEmail: schema.brandProfiles.ownerEmail,
          orgId: schema.brandProfiles.orgId,
          visibility: schema.brandProfiles.visibility,
        })
        .from(schema.brandDnaVersions)
        .innerJoin(
          schema.brandProfiles,
          eq(schema.brandProfiles.id, schema.brandDnaVersions.profileId),
        )
        .where(inArray(schema.brandDnaVersions.id, dnaVersionIds))
    : [];
  const promotedLayouts = await Promise.all(
    (suggestions as any[])
      .filter((suggestion) => suggestion.status === "promoted")
      .map(async (suggestion) => {
        const payload = parseJson<Record<string, unknown>>(
          suggestion.payload,
          {},
        );
        return {
          suggestionId: suggestion.id as string,
          projectionItemId: await resolveLayoutProjectionItemId(
            suggestion.id,
            payload.projectionItemId,
          ),
        };
      }),
  );
  for (const layout of promotedLayouts) {
    await projections?.layoutTemplate?.demote(layout);
  }
  let purgedBlobs = 0;
  for (const reference of [
    ...versions.map((version: any) => version.rawSnapshotBlobRef),
    ...media.map((entry: any) => entry.storageKey),
  ]) {
    const handle = parsePrivateBlobHandle(reference);
    if (!handle) continue;
    const deleted = await deletePrivateBlob(handle).catch(() => null);
    if (deleted?.deleted) purgedBlobs += 1;
  }
  for (const embedding of embeddings as Array<{
    vectorKey: string;
    dimensions: number;
  }>) {
    await vectorAdapter?.delete(embedding).catch(() => undefined);
  }
  await deletePostgresFtsDocuments(
    getDbExec(),
    chunks.map((chunk: any) => chunk.id),
  ).catch(() => 0);
  await getDb().transaction(async (tx: any) => {
    if (derivedEdges.length) {
      await tx
        .update(schema.contextItems)
        .set({ status: "deprecated", updatedAt: nowIso() })
        .where(
          inArray(
            schema.contextItems.id,
            derivedEdges.map((edge: any) => edge.fromItemId),
          ),
        );
    }
    const projectionItemIds = promotedLayouts.flatMap((layout) =>
      layout.projectionItemId ? [layout.projectionItemId] : [],
    );
    if (projectionItemIds.length) {
      await tx
        .update(schema.contextItems)
        .set({ status: "deprecated", updatedAt: nowIso() })
        .where(inArray(schema.contextItems.id, projectionItemIds));
    }
    for (const record of generationRows as any[]) {
      const provenance = parseJson<Array<Record<string, unknown>>>(
        record.elementProvenance,
        [],
      );
      let changed = false;
      const redacted = provenance.map((entry) => {
        if (
          typeof entry.itemId !== "string" ||
          !itemIds.includes(entry.itemId)
        ) {
          return entry;
        }
        changed = true;
        const {
          itemId: _itemId,
          itemVersionId: _versionId,
          ...summary
        } = entry;
        return { ...summary, referenceUnavailable: true };
      });
      if (changed) {
        await tx
          .update(schema.generationRecords)
          .set({ elementProvenance: stringifyJson(redacted) })
          .where(eq(schema.generationRecords.id, record.id));
      }
    }
    await tx
      .delete(schema.contextPackMembers)
      .where(inArray(schema.contextPackMembers.itemId, itemIds));
    const affectedPackIds: string[] = [
      ...new Set<string>(
        (packMemberships as any[]).map((row) => String(row.packId)),
      ),
    ];
    if (affectedPackIds.length) {
      await tx
        .update(schema.contextPacks)
        .set({ archivedAt: nowIso() })
        .where(inArray(schema.contextPacks.id, affectedPackIds));
    }
    await tx
      .delete(schema.brandDnaEvidence)
      .where(inArray(schema.brandDnaEvidence.itemId, itemIds));
    const affectedProfileIds: string[] = Array.from(
      new Set<string>(
        affectedProfiles.map((row: any) => row.profileId as string),
      ),
    );
    if (affectedProfileIds.length) {
      await tx
        .update(schema.brandProfiles)
        .set({ currentDnaVersionId: null, updatedAt: nowIso() })
        .where(inArray(schema.brandProfiles.id, affectedProfileIds));
    }
    await tx
      .delete(schema.contextSuggestions)
      .where(inArray(schema.contextSuggestions.itemId, itemIds));
    await tx
      .delete(schema.contextFeedback)
      .where(inArray(schema.contextFeedback.itemId, itemIds));
    await tx
      .delete(schema.embeddings)
      .where(inArray(schema.embeddings.itemId, itemIds));
    await tx
      .delete(schema.contextEdges)
      .where(
        or(
          inArray(schema.contextEdges.fromItemId, itemIds),
          inArray(schema.contextEdges.toItemId, itemIds),
        ),
      );
    await tx
      .delete(schema.contextMedia)
      .where(inArray(schema.contextMedia.itemId, itemIds));
    await tx
      .delete(schema.contextChunks)
      .where(inArray(schema.contextChunks.itemId, itemIds));
    await tx
      .delete(schema.contextItemVersions)
      .where(inArray(schema.contextItemVersions.itemId, itemIds));
    await tx
      .delete(schema.contextItems)
      .where(inArray(schema.contextItems.id, itemIds));
    await tx
      .update(schema.contextSources)
      .set({ itemCount: 0, restrictedItemCount: 0, updatedAt: nowIso() })
      .where(eq(schema.contextSources.id, sourceId));
  });
  const profileIds = [
    ...new Set(affectedProfiles.map((row: any) => row.profileId as string)),
  ];
  for (const profile of affectedProfiles as Array<{
    profileId: string;
    ownerEmail: string;
    orgId: string | null;
    visibility: string;
  }>) {
    const owner =
      profile.visibility === "org" && profile.orgId
        ? sharedResourceOwner(profile.orgId)
        : profile.ownerEmail;
    await resourceDeleteByPath(owner, "context/brand-context.md").catch(
      () => false,
    );
  }
  const remainingSources = profileIds.length
    ? await getDb()
        .select({
          id: schema.contextSources.id,
          config: schema.contextSources.config,
        })
        .from(schema.contextSources)
        .where(
          and(
            accessFilter(schema.contextSources, schema.contextSourceShares),
            eq(schema.contextSources.status, "active"),
          ),
        )
    : [];
  let dnaRecomputeJobs = 0;
  for (const profileId of profileIds) {
    const recomputeSource = (remainingSources as any[]).find(
      (candidate) =>
        candidate.id !== sourceId &&
        parseJson<Record<string, unknown>>(candidate.config, {}).profileId ===
          profileId,
    );
    if (recomputeSource) {
      await createJob({
        sourceId: recomputeSource.id,
        kind: "brand-dna",
        request: { profileId, reason: "source-purge-drift-recompute" },
      });
      dnaRecomputeJobs += 1;
    }
  }
  return {
    sourceId,
    purgedItems: itemIds.length,
    purgedBlobs,
    demotedLayouts: promotedLayouts.length,
    invalidatedBrandProfiles: profileIds.length,
    dnaRecomputeJobs,
  };
}
