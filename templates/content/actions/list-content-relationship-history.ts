import {
  defineAction,
  isActionContractError,
  type ActionRunContext,
} from "@agent-native/core/action";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  listContentRelationshipHistoryInputSchema,
  type ContentRelationshipHistoryChange,
  type ContentRelationshipHistoryEndpoint,
  type ContentRelationshipHistoryItem,
  type ListContentRelationshipHistoryInput,
  type ListContentRelationshipHistoryResult,
} from "../shared/relationships.js";
import {
  decodeRelationshipCursor,
  encodeRelationshipCursor,
  loadRelationshipDatabase,
  loadRelationshipTypeBundle,
  relationshipError,
  resolveRelationshipDocumentAccess,
} from "./_relationship-core.js";

const actorSchema = z
  .object({
    kind: z.enum(["person", "agent", "automation", "programmatic"]),
    displayName: z.string(),
    email: z.string().optional(),
    runId: z.string().optional(),
    networkProtocol: z.enum(["a2a", "mcp", "provider-api"]).optional(),
    networkId: z.string().optional(),
    networkPeer: z.string().optional(),
    threadId: z.string().optional(),
    turnId: z.string().optional(),
  })
  .strict();
const jsonRecordSchema = z.record(z.string(), z.unknown());
const edgeTargetsSchema = z
  .object({
    lineageId: z.string().min(1),
    sourcePageId: z.string().min(1),
    targetPageId: z.string().min(1),
    displacedLineageIds: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

const edgeChangeKinds = {
  "relationship-added": "added",
  "relationship-removed": "removed",
  "relationship-removed-with-projection": "removed",
  "relationship-replaced": "replaced",
  "relationship-add-undone": "removed",
  "relationship-removal-undone": "restored",
  "relationship-replacement-undone": "restored",
} as const;

type EdgeChangeEventKind = keyof typeof edgeChangeKinds;

function parseRecord(
  value: string,
  description: string,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    relationshipError("UNAVAILABLE", `${description} is unreadable.`, {
      statusCode: 503,
    });
  }
  const result = jsonRecordSchema.safeParse(parsed);
  if (!result.success) {
    relationshipError("UNAVAILABLE", `${description} is invalid.`, {
      statusCode: 503,
    });
  }
  return result.data;
}

function extractPageIds(value: unknown, key = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractPageIds(entry, key));
  }
  if (!value || typeof value !== "object") {
    return typeof value === "string" && /(?:^|_)pageids?$/i.test(key)
      ? [value]
      : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([childKey, child]) => {
      if (
        typeof child === "string" &&
        /(?:^|_)(?:source|target)?pageid$/i.test(childKey)
      ) {
        return [child];
      }
      if (Array.isArray(child) && /(?:^|_)pageids$/i.test(childKey)) {
        return child.filter(
          (entry): entry is string => typeof entry === "string",
        );
      }
      return extractPageIds(child, childKey);
    },
  );
}

function extractDatabaseIds(value: unknown, key = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractDatabaseIds(entry, key));
  }
  if (!value || typeof value !== "object") {
    return typeof value === "string" && /(?:^|_)databaseids?$/i.test(key)
      ? [value]
      : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([childKey, child]) => {
      if (
        typeof child === "string" &&
        /(?:^|_)(?:source|target|owner)?databaseid$/i.test(childKey)
      ) {
        return [child];
      }
      if (Array.isArray(child) && /(?:^|_)databaseids$/i.test(childKey)) {
        return child.filter(
          (entry): entry is string => typeof entry === "string",
        );
      }
      return extractDatabaseIds(child, childKey);
    },
  );
}

function edgeChangeKind(kind: string) {
  return kind in edgeChangeKinds
    ? edgeChangeKinds[kind as EdgeChangeEventKind]
    : null;
}

function historySummary(operation: string, eventKinds: string[]): string {
  const count = eventKinds.length;
  if (operation === "mutate-relationships") {
    return `${count} relationship change${count === 1 ? "" : "s"}`;
  }
  if (operation === "remove-relation-property") {
    const removals = eventKinds.filter((kind) =>
      kind.includes("relationship-removed"),
    ).length;
    return removals
      ? `Removed a relation Property and ${removals} selected relationship${removals === 1 ? "" : "s"}`
      : "Removed a relation Property and kept its relationships";
  }
  if (operation === "configure-relation-property") {
    return "Configured a relation Property";
  }
  if (operation === "undo-relationship-revision") {
    return `${count} compensating relationship change${count === 1 ? "" : "s"}`;
  }
  return `${count} committed relationship event${count === 1 ? "" : "s"}`;
}

async function typeIsAccessible(
  typeId: string,
  context?: ActionRunContext,
): Promise<boolean> {
  const db = getDb();
  try {
    const bundle = await loadRelationshipTypeBundle(typeId, {
      allowArchived: true,
      db,
    });
    await Promise.all([
      loadRelationshipDatabase(
        bundle.version.sourceDatabaseId,
        "viewer",
        db,
        context,
        { allowDeleted: true },
      ),
      loadRelationshipDatabase(
        bundle.version.targetDatabaseId,
        "viewer",
        db,
        context,
        { allowDeleted: true },
      ),
    ]);
    return true;
  } catch (error) {
    if (isActionContractError(error) && error.errorCode === "NOT_ACCESSIBLE") {
      return false;
    }
    throw error;
  }
}

async function listContentRelationshipHistory(
  input: ListContentRelationshipHistoryInput,
  context?: ActionRunContext,
): Promise<ListContentRelationshipHistoryResult> {
  const db = getDb();
  let spaceId: string | null = null;
  if (input.pageId) {
    const access = await resolveRelationshipDocumentAccess(input.pageId, {
      db,
      context,
    });
    if (!access?.resource.spaceId) {
      relationshipError(
        "NOT_ACCESSIBLE",
        "The requested relationship history is not accessible.",
        { statusCode: 404 },
      );
    }
    spaceId = access.resource.spaceId;
  }
  if (input.relationshipTypeId) {
    if (!(await typeIsAccessible(input.relationshipTypeId, context))) {
      relationshipError(
        "NOT_ACCESSIBLE",
        "The requested relationship history is not accessible.",
        { statusCode: 404 },
      );
    }
    const bundle = await loadRelationshipTypeBundle(input.relationshipTypeId, {
      allowArchived: true,
      db,
    });
    if (spaceId && spaceId !== bundle.type.spaceId) {
      return { scope: "viewer-accessible", items: [], nextCursor: null };
    }
    spaceId = bundle.type.spaceId;
  }
  let directRevision:
    | typeof schema.contentRelationshipRevisions.$inferSelect
    | null = null;
  if (input.revisionId) {
    [directRevision] = await db
      .select()
      .from(schema.contentRelationshipRevisions)
      .where(eq(schema.contentRelationshipRevisions.id, input.revisionId));
    if (!directRevision || (spaceId && directRevision.spaceId !== spaceId)) {
      relationshipError(
        "NOT_ACCESSIBLE",
        "The requested relationship history is not accessible.",
        { statusCode: 404 },
      );
    }
    spaceId = directRevision.spaceId;
  }
  if (!spaceId) {
    relationshipError(
      "NOT_ACCESSIBLE",
      "The requested relationship history is not accessible.",
      { statusCode: 404 },
    );
  }
  const revisions = directRevision
    ? [directRevision]
    : await db
        .select()
        .from(schema.contentRelationshipRevisions)
        .where(eq(schema.contentRelationshipRevisions.spaceId, spaceId))
        .orderBy(
          desc(schema.contentRelationshipRevisions.createdAt),
          desc(schema.contentRelationshipRevisions.id),
        );
  const revisionIds = revisions.map((revision) => revision.id);
  const events = revisionIds.length
    ? await db
        .select()
        .from(schema.contentRelationshipEvents)
        .where(
          inArray(schema.contentRelationshipEvents.revisionId, revisionIds),
        )
    : [];
  const eventsByRevision = new Map<
    string,
    Array<typeof schema.contentRelationshipEvents.$inferSelect>
  >();
  for (const event of events) {
    eventsByRevision.set(event.revisionId, [
      ...(eventsByRevision.get(event.revisionId) ?? []),
      event,
    ]);
  }
  const compensated = revisionIds.length
    ? await db
        .select({
          compensatesRevisionId:
            schema.contentRelationshipRevisions.compensatesRevisionId,
        })
        .from(schema.contentRelationshipRevisions)
        .where(
          inArray(
            schema.contentRelationshipRevisions.compensatesRevisionId,
            revisionIds,
          ),
        )
    : [];
  const compensatedIds = new Set(
    compensated.flatMap((row) =>
      row.compensatesRevisionId ? [row.compensatesRevisionId] : [],
    ),
  );
  const authorized: ContentRelationshipHistoryItem[] = [];
  for (const revision of revisions) {
    const revisionEvents = [...(eventsByRevision.get(revision.id) ?? [])].sort(
      (left, right) =>
        left.sequence - right.sequence || left.id.localeCompare(right.id),
    );
    if (revisionEvents.length === 0) continue;
    if (
      input.relationshipTypeId &&
      !revisionEvents.some(
        (event) => event.relationshipTypeId === input.relationshipTypeId,
      )
    ) {
      continue;
    }
    const typeIds = [
      ...new Set(
        revisionEvents.flatMap((event) =>
          event.relationshipTypeId ? [event.relationshipTypeId] : [],
        ),
      ),
    ];
    let accessible = true;
    for (const typeId of typeIds) {
      if (!(await typeIsAccessible(typeId, context))) {
        accessible = false;
        break;
      }
    }
    if (!accessible) continue;
    const eventRecords = revisionEvents.map((event) => ({
      event,
      targets: parseRecord(event.targetsJson, "A relationship event target"),
      diff: parseRecord(event.diffJson, "A relationship event diff"),
    }));
    const edgeRecords = eventRecords.flatMap((record) => {
      const kind = edgeChangeKind(record.event.kind);
      if (!kind) return [];
      const targets = edgeTargetsSchema.safeParse(record.targets);
      if (
        !targets.success ||
        !record.event.relationshipTypeId ||
        !record.event.relationshipTypeVersionId
      ) {
        relationshipError(
          "UNAVAILABLE",
          "A relationship history change is incomplete.",
          { statusCode: 503 },
        );
      }
      return [
        {
          event: record.event,
          kind,
          targets: targets.data,
          relationshipTypeId: record.event.relationshipTypeId,
          relationshipTypeVersionId: record.event.relationshipTypeVersionId,
        },
      ];
    });
    const displacedLineageIds = [
      ...new Set(
        edgeRecords.flatMap(
          (record) => record.targets.displacedLineageIds ?? [],
        ),
      ),
    ];
    const displacedLineages = displacedLineageIds.length
      ? await db
          .select()
          .from(schema.contentRelationshipLineages)
          .where(
            inArray(schema.contentRelationshipLineages.id, displacedLineageIds),
          )
      : [];
    if (displacedLineages.length !== displacedLineageIds.length) {
      relationshipError(
        "UNAVAILABLE",
        "A relationship history replacement is incomplete.",
        { statusCode: 503 },
      );
    }
    const displacedById = new Map(
      displacedLineages.map((lineage) => [lineage.id, lineage]),
    );
    for (const record of edgeRecords) {
      const displacedIds = record.targets.displacedLineageIds ?? [];
      if (displacedIds.length > 1) {
        relationshipError(
          "UNAVAILABLE",
          "A relationship history replacement is invalid.",
          { statusCode: 503 },
        );
      }
      for (const displacedId of displacedIds) {
        const displaced = displacedById.get(displacedId);
        if (
          !displaced ||
          displaced.relationshipTypeId !== record.relationshipTypeId ||
          displaced.sourcePageId !== record.targets.sourcePageId
        ) {
          relationshipError(
            "UNAVAILABLE",
            "A relationship history replacement is inconsistent.",
            { statusCode: 503 },
          );
        }
      }
    }
    const databaseIds = [
      ...new Set(
        eventRecords.flatMap(({ targets, diff }) => [
          ...extractDatabaseIds(targets),
          ...extractDatabaseIds(diff),
        ]),
      ),
    ];
    const historyDatabases = databaseIds.length
      ? await db
          .select({
            id: schema.contentDatabases.id,
            documentId: schema.contentDatabases.documentId,
          })
          .from(schema.contentDatabases)
          .where(inArray(schema.contentDatabases.id, databaseIds))
      : [];
    if (historyDatabases.length !== databaseIds.length) {
      relationshipError(
        "UNAVAILABLE",
        "A relationship history Database reference is unavailable.",
        { statusCode: 503 },
      );
    }
    const pageIds = [
      ...new Set([
        ...eventRecords.flatMap(({ targets, diff }) => [
          ...extractPageIds(targets),
          ...extractPageIds(diff),
        ]),
        ...historyDatabases.map((database) => database.documentId),
        ...displacedLineages.flatMap((lineage) => [
          lineage.sourcePageId,
          lineage.targetPageId,
        ]),
      ]),
    ];
    if (input.pageId && !pageIds.includes(input.pageId)) continue;
    const endpoints = new Map<string, ContentRelationshipHistoryEndpoint>();
    for (const pageId of pageIds) {
      const access = await resolveRelationshipDocumentAccess(pageId, {
        db,
        context,
      });
      if (!access) {
        accessible = false;
        break;
      }
      endpoints.set(pageId, { pageId, title: access.resource.title });
    }
    if (!accessible) continue;
    const versionIds = [
      ...new Set(edgeRecords.map((record) => record.relationshipTypeVersionId)),
    ];
    const versions = versionIds.length
      ? await db
          .select()
          .from(schema.contentRelationshipTypeVersions)
          .where(inArray(schema.contentRelationshipTypeVersions.id, versionIds))
      : [];
    if (versions.length !== versionIds.length) {
      relationshipError(
        "UNAVAILABLE",
        "A relationship history definition is unavailable.",
        { statusCode: 503 },
      );
    }
    const versionsById = new Map(
      versions.map((version) => [version.id, version]),
    );
    for (const record of edgeRecords) {
      const version = versionsById.get(record.relationshipTypeVersionId);
      if (
        !version ||
        version.relationshipTypeId !== record.relationshipTypeId
      ) {
        relationshipError(
          "UNAVAILABLE",
          "A relationship history definition is inconsistent.",
          { statusCode: 503 },
        );
      }
      try {
        await Promise.all([
          loadRelationshipDatabase(
            version.sourceDatabaseId,
            "viewer",
            db,
            context,
            { allowDeleted: true },
          ),
          loadRelationshipDatabase(
            version.targetDatabaseId,
            "viewer",
            db,
            context,
            { allowDeleted: true },
          ),
        ]);
      } catch (error) {
        if (
          isActionContractError(error) &&
          error.errorCode === "NOT_ACCESSIBLE"
        ) {
          accessible = false;
          break;
        }
        throw error;
      }
    }
    if (!accessible) continue;
    const changes: ContentRelationshipHistoryChange[] = edgeRecords.map(
      (record) => {
        const source = endpoints.get(record.targets.sourcePageId);
        const target = endpoints.get(record.targets.targetPageId);
        const version = versionsById.get(record.relationshipTypeVersionId);
        if (!source || !target || !version) {
          relationshipError(
            "UNAVAILABLE",
            "A relationship history change is unavailable.",
            { statusCode: 503 },
          );
        }
        const displacedId = record.targets.displacedLineageIds?.[0];
        const displaced = displacedId
          ? displacedById.get(displacedId)
          : undefined;
        const previousTarget = displaced
          ? endpoints.get(displaced.targetPageId)
          : undefined;
        if (displaced && !previousTarget) {
          relationshipError(
            "UNAVAILABLE",
            "A relationship history replacement target is unavailable.",
            { statusCode: 503 },
          );
        }
        return {
          eventId: record.event.id,
          kind: record.kind,
          relationshipTypeId: record.relationshipTypeId,
          relationshipLabel: version.forwardLabel,
          source,
          target,
          ...(previousTarget ? { previousTarget } : {}),
        };
      },
    );
    let actorValue: unknown;
    try {
      actorValue = JSON.parse(revision.actorJson);
    } catch {
      relationshipError(
        "UNAVAILABLE",
        "A relationship history actor is unreadable.",
        {
          statusCode: 503,
        },
      );
    }
    const actor = actorSchema.safeParse(actorValue);
    if (!actor.success) {
      relationshipError(
        "UNAVAILABLE",
        "A relationship history actor is invalid.",
        {
          statusCode: 503,
        },
      );
    }
    const diff = parseRecord(
      revision.diffJson,
      "A relationship history revision",
    );
    const recoverable =
      !compensatedIds.has(revision.id) &&
      ["mutate-relationships", "remove-relation-property"].includes(
        revision.operation,
      );
    authorized.push({
      revisionId: revision.id,
      eventIds: revisionEvents.map((event) => event.id).sort(),
      committedAt: revision.createdAt,
      actor: actor.data,
      authorizingPrincipal: parseRecord(
        revision.authorizingPrincipalJson,
        "A relationship history principal",
      ),
      origin: revision.origin,
      operation: revision.operation,
      summary: historySummary(
        revision.operation,
        revisionEvents.map((event) => event.kind),
      ),
      changes,
      diff,
      recovery: recoverable
        ? { allowed: true, recoveryToken: revision.recoveryToken }
        : { allowed: false },
    });
  }
  if (input.revisionId && authorized.length === 0) {
    relationshipError(
      "NOT_ACCESSIBLE",
      "The requested relationship history is not accessible.",
      { statusCode: 404 },
    );
  }
  const offset = decodeRelationshipCursor(input.cursor);
  const page = authorized.slice(offset, offset + input.limit);
  return {
    scope: "viewer-accessible",
    items: page,
    nextCursor:
      offset + page.length < authorized.length
        ? encodeRelationshipCursor(offset + page.length)
        : null,
  };
}

export default defineAction({
  description:
    "List caller-accessible committed canonical relationship revisions with typed attribution and recovery state.",
  mcpTool: true,
  schema: listContentRelationshipHistoryInputSchema,
  http: { method: "GET" },
  readOnly: true,
  run: listContentRelationshipHistory,
});
