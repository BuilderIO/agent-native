import {
  defineAction,
  isActionContractError,
  type ActionRunContext,
} from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq, exists, inArray, lt, notExists, or } from "drizzle-orm";
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
import { listContentOrganizationMemberships } from "./_content-space-access.js";
import {
  loadRelationshipDatabase,
  loadRelationshipTypeBundle,
  relationshipActorContext,
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

type HistoryCursor = { createdAt: string; revisionId: string };

function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify({ v: 2, ...cursor }), "utf8").toString(
    "base64url",
  );
}

function decodeHistoryCursor(cursor: string | undefined): HistoryCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { v?: unknown; createdAt?: unknown; revisionId?: unknown };
    if (
      parsed.v !== 2 ||
      typeof parsed.createdAt !== "string" ||
      !parsed.createdAt ||
      typeof parsed.revisionId !== "string" ||
      !parsed.revisionId
    ) {
      throw new Error("invalid cursor");
    }
    return { createdAt: parsed.createdAt, revisionId: parsed.revisionId };
  } catch {
    relationshipError("INVALID_TARGET", "The relationship cursor is invalid.");
  }
}

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
  const actor = relationshipActorContext(context);
  const organizationMemberships = await listContentOrganizationMemberships(
    actor.userEmail,
  );
  const accessContexts = [
    actor.orgId,
    ...organizationMemberships.map((membership) => membership.orgId),
  ]
    .filter((orgId, index, values) => values.indexOf(orgId) === index)
    .map((orgId) => ({
      userEmail: actor.userEmail,
      ...(orgId ? { orgId } : {}),
    }));
  const accessibleMappedDocument = db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(
      and(
        eq(
          schema.documents.id,
          schema.contentRelationshipRevisionDocuments.documentId,
        ),
        or(
          ...accessContexts.map((accessContext) =>
            accessFilter(
              schema.documents,
              schema.documentShares,
              accessContext,
              "viewer",
              { includePublic: true },
            ),
          ),
        ),
      ),
    );
  const inaccessibleReference = db
    .select({ id: schema.contentRelationshipRevisionDocuments.id })
    .from(schema.contentRelationshipRevisionDocuments)
    .where(
      and(
        eq(
          schema.contentRelationshipRevisionDocuments.revisionId,
          schema.contentRelationshipRevisions.id,
        ),
        or(
          eq(schema.contentRelationshipRevisionDocuments.unresolved, 1),
          notExists(accessibleMappedDocument),
        ),
      ),
    );
  const hasMappedDocument = db
    .select({ id: schema.contentRelationshipRevisionDocuments.id })
    .from(schema.contentRelationshipRevisionDocuments)
    .where(
      eq(
        schema.contentRelationshipRevisionDocuments.revisionId,
        schema.contentRelationshipRevisions.id,
      ),
    );
  if (directRevision) {
    const [accessibleDirectRevision] = await db
      .select({ id: schema.contentRelationshipRevisions.id })
      .from(schema.contentRelationshipRevisions)
      .where(
        and(
          eq(schema.contentRelationshipRevisions.id, directRevision.id),
          exists(hasMappedDocument),
          notExists(inaccessibleReference),
        ),
      )
      .limit(1);
    if (!accessibleDirectRevision) {
      relationshipError(
        "NOT_ACCESSIBLE",
        "The requested relationship history is not accessible.",
        { statusCode: 404 },
      );
    }
  }
  const readinessEvent = db
    .select({ id: schema.contentRelationshipEvents.id })
    .from(schema.contentRelationshipEvents)
    .where(
      and(
        eq(
          schema.contentRelationshipEvents.revisionId,
          schema.contentRelationshipRevisions.id,
        ),
        input.relationshipTypeId
          ? eq(
              schema.contentRelationshipEvents.relationshipTypeId,
              input.relationshipTypeId,
            )
          : undefined,
      ),
    );
  const anyRevisionEvent = db
    .select({ id: schema.contentRelationshipEvents.id })
    .from(schema.contentRelationshipEvents)
    .where(
      eq(
        schema.contentRelationshipEvents.revisionId,
        schema.contentRelationshipRevisions.id,
      ),
    );
  const readinessScope = and(
    eq(schema.contentRelationshipRevisions.spaceId, spaceId),
    directRevision
      ? eq(schema.contentRelationshipRevisions.id, directRevision.id)
      : undefined,
  );
  const [[unindexedRevision], [emptyRevision]] = await Promise.all([
    db
      .select({ id: schema.contentRelationshipRevisions.id })
      .from(schema.contentRelationshipRevisions)
      .where(
        and(
          readinessScope,
          exists(readinessEvent),
          notExists(hasMappedDocument),
        ),
      )
      .limit(1),
    db
      .select({ id: schema.contentRelationshipRevisions.id })
      .from(schema.contentRelationshipRevisions)
      .where(and(readinessScope, notExists(anyRevisionEvent)))
      .limit(1),
  ]);
  if (unindexedRevision || emptyRevision) {
    relationshipError(
      "UNAVAILABLE",
      "Relationship history is not ready. Run the relationship history index migration and retry.",
      { statusCode: 503 },
    );
  }
  const matchingEvent = db
    .select({ id: schema.contentRelationshipEvents.id })
    .from(schema.contentRelationshipEvents)
    .where(
      and(
        eq(
          schema.contentRelationshipEvents.revisionId,
          schema.contentRelationshipRevisions.id,
        ),
        input.relationshipTypeId
          ? eq(
              schema.contentRelationshipEvents.relationshipTypeId,
              input.relationshipTypeId,
            )
          : undefined,
      ),
    );
  const matchingPage = input.pageId
    ? db
        .select({ id: schema.contentRelationshipRevisionDocuments.id })
        .from(schema.contentRelationshipRevisionDocuments)
        .where(
          and(
            eq(
              schema.contentRelationshipRevisionDocuments.revisionId,
              schema.contentRelationshipRevisions.id,
            ),
            eq(
              schema.contentRelationshipRevisionDocuments.documentId,
              input.pageId,
            ),
          ),
        )
    : null;
  const cursor = decodeHistoryCursor(input.cursor);
  const revisionWhere = and(
    eq(schema.contentRelationshipRevisions.spaceId, spaceId),
    directRevision
      ? eq(schema.contentRelationshipRevisions.id, directRevision.id)
      : undefined,
    exists(hasMappedDocument),
    notExists(inaccessibleReference),
    exists(matchingEvent),
    matchingPage ? exists(matchingPage) : undefined,
    !directRevision && cursor
      ? or(
          lt(schema.contentRelationshipRevisions.createdAt, cursor.createdAt),
          and(
            eq(schema.contentRelationshipRevisions.createdAt, cursor.createdAt),
            lt(schema.contentRelationshipRevisions.id, cursor.revisionId),
          ),
        )
      : undefined,
  );
  const revisions = await db
    .select()
    .from(schema.contentRelationshipRevisions)
    .where(revisionWhere)
    .orderBy(
      desc(schema.contentRelationshipRevisions.createdAt),
      desc(schema.contentRelationshipRevisions.id),
    )
    .limit(directRevision ? 1 : input.limit + 1);
  if (directRevision && revisions.length === 0) {
    relationshipError(
      "NOT_ACCESSIBLE",
      "The requested relationship history is not accessible.",
      { statusCode: 404 },
    );
  }
  const pageRevisions = revisions.slice(0, input.limit);
  const revisionIds = pageRevisions.map((revision) => revision.id);
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
  for (const revision of pageRevisions) {
    const revisionEvents = [...(eventsByRevision.get(revision.id) ?? [])].sort(
      (left, right) =>
        left.sequence - right.sequence || left.id.localeCompare(right.id),
    );
    if (revisionEvents.length === 0) continue;
    let accessible = true;
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
  const lastRevision = pageRevisions[pageRevisions.length - 1];
  return {
    scope: "viewer-accessible",
    items: authorized,
    nextCursor:
      !directRevision && revisions.length > input.limit && lastRevision
        ? encodeHistoryCursor({
            createdAt: lastRevision.createdAt,
            revisionId: lastRevision.id,
          })
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
