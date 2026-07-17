import {
  accessFilter,
  assertAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
} from "drizzle-orm";

import { getCreativeContext } from "../server/context.js";
import type {
  ContextPackDetail,
  ContextPackMember,
  ContextPackMemberInput,
  ContextPackSummary,
} from "../types.js";
import {
  newId,
  nowIso,
  parseJson,
  requireActor,
  stringifyJson,
} from "./helpers.js";

export function assertImmutablePackMembership(operation: string): never {
  throw new Error(
    `Context-pack membership is append-only; ${operation} must derive a new pack snapshot`,
  );
}

async function resolveBrandDnaVersion(
  dnaVersionId: string | null | undefined,
): Promise<string | null> {
  if (!dnaVersionId) return null;
  const { getDb, schema } = getCreativeContext();
  const rows = await getDb()
    .select({ profileId: schema.brandDnaVersions.profileId })
    .from(schema.brandDnaVersions)
    .where(eq(schema.brandDnaVersions.id, dnaVersionId))
    .limit(1);
  if (!rows[0])
    throw new Error("Brand DNA version not found or not accessible");
  await assertAccess(
    "creative-context-brand",
    rows[0].profileId,
    "viewer",
    undefined,
    { skipResourceBody: true },
  );
  return dnaVersionId;
}

async function resolveMembers(members: ContextPackMemberInput[]): Promise<
  Array<{
    itemId: string;
    itemVersionId: string;
    reason?: string;
    score?: number;
    scoreMetadata?: Record<string, unknown>;
  }>
> {
  const { getDb, schema } = getCreativeContext();
  const itemIds = members.map((member) => member.itemId);
  if (new Set(itemIds).size !== itemIds.length) {
    throw new Error("A context-pack snapshot cannot contain duplicate items");
  }
  if (!itemIds.length) return [];
  const accessibleItems = await getDb()
    .select({
      id: schema.contextItems.id,
      currentVersionId: schema.contextItems.currentVersionId,
    })
    .from(schema.contextItems)
    .innerJoin(
      schema.contextSources,
      eq(schema.contextSources.id, schema.contextItems.sourceId),
    )
    .leftJoin(
      schema.creativeContextMemberships,
      and(
        eq(
          schema.creativeContextMemberships.publishedItemId,
          schema.contextItems.id,
        ),
        eq(schema.creativeContextMemberships.status, "active"),
      ),
    )
    .leftJoin(
      schema.creativeContexts,
      eq(
        schema.creativeContexts.id,
        schema.creativeContextMemberships.contextId,
      ),
    )
    .where(
      and(
        inArray(schema.contextItems.id, itemIds),
        or(
          and(
            accessFilter(schema.contextSources, schema.contextSourceShares),
            ne(schema.contextSources.upstreamAccess, "restricted"),
            ne(schema.contextSources.status, "archived"),
          ),
          accessFilter(schema.creativeContexts, schema.creativeContextShares),
        ),
        eq(schema.contextItems.curationStatus, "included"),
        ne(schema.contextItems.curationRank, "ignored"),
        eq(schema.contextItems.status, "active"),
      ),
    );
  if (accessibleItems.length !== itemIds.length) {
    throw new Error("All context-pack items must be accessible");
  }
  const itemById = new Map(accessibleItems.map((row: any) => [row.id, row]));
  const requestedVersionIds = members.flatMap((member) =>
    member.itemVersionId ? [member.itemVersionId] : [],
  );
  const versionRows = requestedVersionIds.length
    ? await getDb()
        .select({
          id: schema.contextItemVersions.id,
          itemId: schema.contextItemVersions.itemId,
        })
        .from(schema.contextItemVersions)
        .where(
          and(
            inArray(schema.contextItemVersions.id, requestedVersionIds),
            inArray(schema.contextItemVersions.itemId, itemIds),
          ),
        )
    : [];
  const versionOwner = new Map(
    versionRows.map((row: any) => [row.id, row.itemId]),
  );
  return members.map((member) => {
    const item = itemById.get(member.itemId) as any;
    const itemVersionId = member.itemVersionId ?? item.currentVersionId;
    if (
      member.itemVersionId &&
      versionOwner.get(member.itemVersionId) !== member.itemId
    ) {
      throw new Error("Pinned item version must belong to its context item");
    }
    if (member.score !== undefined && !Number.isFinite(member.score)) {
      throw new Error("Context-pack member scores must be finite numbers");
    }
    return {
      itemId: member.itemId,
      itemVersionId,
      reason: member.reason,
      score: member.score,
      scoreMetadata: member.scoreMetadata,
    };
  });
}

export async function createContextPack(input: {
  name: string;
  description?: string | null;
  derivedFromPackId?: string;
  brandDnaVersionId?: string | null;
  contextMode?: string;
  baseContextId?: string | null;
  specialtyContextId?: string | null;
  selectionReason?: string | null;
  request?: Record<string, unknown>;
  members: ContextPackMemberInput[];
  pinned?: boolean;
}): Promise<ContextPackDetail> {
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const timestamp = nowIso();
  const id = newId("ccp");
  const [resolvedMembers, brandDnaVersionId] = await Promise.all([
    resolveMembers(input.members),
    resolveBrandDnaVersion(input.brandDnaVersionId),
  ]);
  if (input.derivedFromPackId) {
    await assertAccess(
      "creative-context-pack",
      input.derivedFromPackId,
      "viewer",
      undefined,
      { skipResourceBody: true },
    );
  }
  const contextAccess = input.baseContextId
    ? await resolveAccess("creative-context", input.baseContextId)
    : null;
  if (input.baseContextId && !contextAccess) {
    throw new Error("Base Creative Context not found or not accessible");
  }
  const inheritedShares = input.baseContextId
    ? await getDb()
        .select()
        .from(schema.creativeContextShares)
        .where(eq(schema.creativeContextShares.resourceId, input.baseContextId))
    : [];
  await getDb().transaction(async (tx: any) => {
    await tx.insert(schema.contextPacks).values({
      id,
      name: input.name,
      description: input.description ?? null,
      derivedFromPackId: input.derivedFromPackId ?? null,
      brandDnaVersionId,
      contextMode: input.contextMode ?? "manual",
      baseContextId: input.baseContextId ?? null,
      specialtyContextId: input.specialtyContextId ?? null,
      selectionReason: input.selectionReason ?? null,
      request: stringifyJson(input.request),
      archivedAt: null,
      ownerEmail: actor.ownerEmail,
      orgId: actor.orgId,
      visibility: contextAccess?.resource.visibility ?? "private",
      createdAt: timestamp,
    });
    if (resolvedMembers.length) {
      await tx.insert(schema.contextPackMembers).values(
        resolvedMembers.map((member, ordinal) => ({
          id: newId("ccpm"),
          packId: id,
          itemId: member.itemId,
          itemVersionId: member.itemVersionId,
          ordinal,
          reason: member.reason ?? null,
          score: member.score ?? null,
          scoreMetadata: stringifyJson(member.scoreMetadata),
          ownerEmail: actor.ownerEmail,
          orgId: actor.orgId,
          createdAt: timestamp,
        })),
      );
    }
    if (inheritedShares.length) {
      await tx.insert(schema.contextPackShares).values(
        (inheritedShares as any[]).map((share) => ({
          id: newId("ccpsh"),
          resourceId: id,
          principalType: share.principalType,
          principalId: share.principalId,
          role: share.role,
          createdBy: actor.ownerEmail,
          createdAt: timestamp,
        })),
      );
    }
    if (input.pinned) {
      await tx.insert(schema.contextPackPins).values({
        id: newId("ccpp"),
        packId: id,
        ownerEmail: actor.ownerEmail,
        orgId: actor.orgId,
        createdAt: timestamp,
      });
    }
  });
  const created = await getContextPack(id);
  if (!created) throw new Error("Failed to create context pack");
  return created;
}

export async function deriveContextPack(input: {
  packId: string;
  name?: string;
  description?: string | null;
  addMembers?: ContextPackMemberInput[];
  removeItemIds?: string[];
  brandDnaVersionId?: string | null;
  pinned?: boolean;
}): Promise<ContextPackDetail> {
  const base = await getContextPack(input.packId);
  if (!base) throw new Error("Context pack not found or not accessible");
  const removed = new Set(input.removeItemIds ?? []);
  const members = new Map<string, ContextPackMemberInput>();
  for (const member of base.members) {
    if (!removed.has(member.itemId)) {
      members.set(member.itemId, {
        itemId: member.itemId,
        itemVersionId: member.itemVersionId,
        reason: member.reason ?? undefined,
        score: member.score ?? undefined,
        scoreMetadata: member.scoreMetadata,
      });
    }
  }
  for (const member of input.addMembers ?? []) {
    members.set(member.itemId, member);
  }
  return createContextPack({
    name: input.name ?? base.name,
    description:
      input.description === undefined ? base.description : input.description,
    derivedFromPackId: base.id,
    brandDnaVersionId:
      input.brandDnaVersionId === undefined
        ? base.brandDnaVersionId
        : input.brandDnaVersionId,
    contextMode: base.contextMode,
    baseContextId: base.baseContextId,
    specialtyContextId: base.specialtyContextId,
    selectionReason: base.selectionReason,
    request: base.request,
    members: Array.from(members.values()),
    pinned: input.pinned,
  });
}

export async function setContextPackPinned(
  packId: string,
  pinned: boolean,
): Promise<ContextPackDetail> {
  await assertAccess("creative-context-pack", packId, "viewer", undefined, {
    skipResourceBody: true,
  });
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const existing = await getDb()
    .select({ id: schema.contextPackPins.id })
    .from(schema.contextPackPins)
    .where(
      and(
        eq(schema.contextPackPins.packId, packId),
        eq(schema.contextPackPins.ownerEmail, actor.ownerEmail),
      ),
    )
    .limit(1);
  if (pinned && !existing[0]) {
    await getDb()
      .insert(schema.contextPackPins)
      .values({
        id: newId("ccpp"),
        packId,
        ownerEmail: actor.ownerEmail,
        orgId: actor.orgId,
        createdAt: nowIso(),
      });
  } else if (!pinned && existing[0]) {
    await getDb()
      .delete(schema.contextPackPins)
      .where(eq(schema.contextPackPins.id, existing[0].id));
  }
  const pack = await getContextPack(packId);
  if (!pack) throw new Error("Context pack not found after pin update");
  return pack;
}

export async function archiveContextPack(
  packId: string,
): Promise<ContextPackDetail> {
  await assertAccess("creative-context-pack", packId, "editor", undefined, {
    skipResourceBody: true,
  });
  const { getDb, schema } = getCreativeContext();
  await getDb()
    .update(schema.contextPacks)
    .set({ archivedAt: nowIso() })
    .where(eq(schema.contextPacks.id, packId));
  const pack = await getContextPack(packId);
  if (!pack) throw new Error("Context pack not found after archive");
  return pack;
}

export async function listContextPacks(input: {
  limit: number;
  cursor?: string;
  includeArchived?: boolean;
}): Promise<{ packs: ContextPackSummary[]; nextCursor?: string }> {
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const filters: any[] = [
    accessFilter(schema.contextPacks, schema.contextPackShares),
  ];
  if (input.cursor) filters.push(gt(schema.contextPacks.id, input.cursor));
  if (!input.includeArchived) {
    filters.push(isNull(schema.contextPacks.archivedAt));
  }
  const rows = await getDb()
    .select()
    .from(schema.contextPacks)
    .where(and(...filters))
    .orderBy(asc(schema.contextPacks.id))
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const page = rows.slice(0, input.limit);
  const ids = page.map((row: any) => row.id as string);
  const [memberRows, pinRows] = ids.length
    ? await Promise.all([
        getDb()
          .select({ packId: schema.contextPackMembers.packId })
          .from(schema.contextPackMembers)
          .innerJoin(
            schema.contextItems,
            eq(schema.contextItems.id, schema.contextPackMembers.itemId),
          )
          .innerJoin(
            schema.contextSources,
            eq(schema.contextSources.id, schema.contextItems.sourceId),
          )
          .leftJoin(
            schema.creativeContextPublishedSnapshots,
            and(
              eq(
                schema.creativeContextPublishedSnapshots.itemId,
                schema.contextPackMembers.itemId,
              ),
              eq(
                schema.creativeContextPublishedSnapshots.itemVersionId,
                schema.contextPackMembers.itemVersionId,
              ),
            ),
          )
          .where(
            and(
              inArray(schema.contextPackMembers.packId, ids),
              or(
                and(
                  accessFilter(
                    schema.contextSources,
                    schema.contextSourceShares,
                  ),
                  ne(schema.contextSources.upstreamAccess, "restricted"),
                  ne(schema.contextSources.status, "archived"),
                ),
                isNotNull(schema.creativeContextPublishedSnapshots.id),
              ),
              eq(schema.contextItems.curationStatus, "included"),
              ne(schema.contextItems.curationRank, "ignored"),
              eq(schema.contextItems.status, "active"),
            ),
          ),
        getDb()
          .select({ packId: schema.contextPackPins.packId })
          .from(schema.contextPackPins)
          .where(
            and(
              inArray(schema.contextPackPins.packId, ids),
              eq(schema.contextPackPins.ownerEmail, actor.ownerEmail),
            ),
          ),
      ])
    : [[], []];
  const memberCount = new Map<string, number>();
  for (const member of memberRows as Array<{ packId: string }>) {
    memberCount.set(member.packId, (memberCount.get(member.packId) ?? 0) + 1);
  }
  const pinned = new Set(
    (pinRows as Array<{ packId: string }>).map((row) => row.packId),
  );
  return {
    packs: page.map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      derivedFromPackId: row.derivedFromPackId ?? null,
      brandDnaVersionId: row.brandDnaVersionId ?? null,
      contextMode: row.contextMode,
      baseContextId: row.baseContextId ?? null,
      specialtyContextId: row.specialtyContextId ?? null,
      selectionReason: row.selectionReason ?? null,
      request: parseJson(row.request, {}),
      memberCount: memberCount.get(row.id) ?? 0,
      pinned: pinned.has(row.id),
      archivedAt: row.archivedAt ?? null,
      visibility: row.visibility,
      createdAt: row.createdAt,
    })),
    nextCursor: hasMore ? page.at(-1)?.id : undefined,
  };
}

export async function getContextPack(
  packId: string,
): Promise<ContextPackDetail | null> {
  const access = await resolveAccess("creative-context-pack", packId);
  if (!access) return null;
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const [memberRows, pinRows] = await Promise.all([
    getDb()
      .select({
        id: schema.contextPackMembers.id,
        packId: schema.contextPackMembers.packId,
        itemId: schema.contextPackMembers.itemId,
        itemVersionId: schema.contextPackMembers.itemVersionId,
        ordinal: schema.contextPackMembers.ordinal,
        reason: schema.contextPackMembers.reason,
        score: schema.contextPackMembers.score,
        scoreMetadata: schema.contextPackMembers.scoreMetadata,
      })
      .from(schema.contextPackMembers)
      .innerJoin(
        schema.contextItems,
        eq(schema.contextItems.id, schema.contextPackMembers.itemId),
      )
      .innerJoin(
        schema.contextSources,
        eq(schema.contextSources.id, schema.contextItems.sourceId),
      )
      .leftJoin(
        schema.creativeContextPublishedSnapshots,
        and(
          eq(
            schema.creativeContextPublishedSnapshots.itemId,
            schema.contextPackMembers.itemId,
          ),
          eq(
            schema.creativeContextPublishedSnapshots.itemVersionId,
            schema.contextPackMembers.itemVersionId,
          ),
        ),
      )
      .where(
        and(
          eq(schema.contextPackMembers.packId, packId),
          or(
            and(
              accessFilter(
                schema.contextSources,
                schema.contextSourceShares,
              ),
              ne(schema.contextSources.upstreamAccess, "restricted"),
              ne(schema.contextSources.status, "archived"),
            ),
            isNotNull(schema.creativeContextPublishedSnapshots.id),
          ),
          eq(schema.contextItems.curationStatus, "included"),
          ne(schema.contextItems.curationRank, "ignored"),
          eq(schema.contextItems.status, "active"),
        ),
      )
      .orderBy(asc(schema.contextPackMembers.ordinal)),
    getDb()
      .select({ id: schema.contextPackPins.id })
      .from(schema.contextPackPins)
      .where(
        and(
          eq(schema.contextPackPins.packId, packId),
          eq(schema.contextPackPins.ownerEmail, actor.ownerEmail),
        ),
      )
      .limit(1),
  ]);
  const row = access.resource;
  const members: ContextPackMember[] = memberRows.map((member: any) => ({
    id: member.id,
    packId: member.packId,
    itemId: member.itemId,
    itemVersionId: member.itemVersionId,
    ordinal: member.ordinal,
    reason: member.reason ?? null,
    score: member.score ?? null,
    scoreMetadata: parseJson(member.scoreMetadata, {}),
  }));
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    derivedFromPackId: row.derivedFromPackId ?? null,
    brandDnaVersionId: row.brandDnaVersionId ?? null,
    contextMode: row.contextMode,
    baseContextId: row.baseContextId ?? null,
    specialtyContextId: row.specialtyContextId ?? null,
    selectionReason: row.selectionReason ?? null,
    request: parseJson(row.request, {}),
    memberCount: members.length,
    pinned: Boolean(pinRows[0]),
    archivedAt: row.archivedAt ?? null,
    visibility: row.visibility,
    createdAt: row.createdAt,
    members,
  };
}
