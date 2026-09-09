import { createHash } from "node:crypto";

import {
  ActionContractError,
  type ActionRunContext,
} from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import {
  accessFilter,
  ROLE_RANK,
  type ShareRole,
} from "@agent-native/core/sharing";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type {
  CanonicalRelationProjection,
  RelationshipActionErrorCode,
  RelationshipCapabilities,
  RelationshipInvalidation,
  RelationshipType,
  RelationshipTypeVersion,
} from "../shared/relationships.js";
import { resolveContentDocumentAccess } from "./_content-document-access.js";
import { getContentOrganizationMembership } from "./_content-space-access.js";
import { nanoid } from "./_property-utils.js";

export type RelationshipDb = ReturnType<typeof getDb>;

export interface RelationshipActorContext {
  userEmail: string;
  orgId: string | null;
  callerScope: string;
  actor: {
    kind: "person" | "agent" | "automation" | "programmatic";
    displayName: string;
    email?: string;
    runId?: string;
    networkProtocol?: "a2a" | "mcp" | "provider-api";
    networkId?: string;
    networkPeer?: string;
    threadId?: string;
    turnId?: string;
  };
  authorizingPrincipal: {
    kind: "user";
    email: string;
    orgId: string | null;
  };
  origin: string;
  runId: string | null;
}

export interface RelationshipTypeBundle {
  type: typeof schema.contentRelationshipTypes.$inferSelect;
  version: typeof schema.contentRelationshipTypeVersions.$inferSelect;
}

export interface RelationshipDatabaseContext {
  database: typeof schema.contentDatabases.$inferSelect;
  document: typeof schema.documents.$inferSelect;
  role: ShareRole | "owner";
}

export interface RelationshipRevisionContext {
  revisionId: string;
  recoveryToken: string;
  eventIds: string[];
  actor: RelationshipActorContext;
}

function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

export function relationshipRequestHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

export function relationshipError(
  errorCode: RelationshipActionErrorCode,
  message: string,
  options: { statusCode?: number; details?: Record<string, unknown> } = {},
): never {
  throw new ActionContractError(message, {
    errorCode,
    statusCode: options.statusCode ?? 400,
    details: options.details,
  });
}

export function relationshipActorContext(
  context?: ActionRunContext,
): RelationshipActorContext {
  const userEmail = (context?.userEmail ?? getRequestUserEmail())
    ?.trim()
    .toLowerCase();
  if (!userEmail) {
    relationshipError("NOT_ACCESSIBLE", "Authentication is required.", {
      statusCode: 401,
    });
  }
  const orgId = context?.orgId ?? getRequestOrgId() ?? null;
  const agentCaller = context?.caller === "tool" || context?.caller === "mcp";
  const automationCaller = context?.caller === "automation";
  const caller = context?.caller ?? "frontend";
  const programmaticCaller =
    context?.caller === "http" ||
    context?.caller === "cli" ||
    context?.caller === "a2a" ||
    context?.caller === "webmcp";
  const kind = automationCaller
    ? "automation"
    : agentCaller
      ? "agent"
      : programmaticCaller
        ? "programmatic"
        : "person";
  const displayName =
    kind === "agent"
      ? context?.networkPeer ||
        context?.networkId ||
        (context?.threadId ? `Agent ${context.threadId}` : "Agent")
      : kind === "automation"
        ? context?.automation?.triggerName || "Automation"
        : userEmail;
  return {
    userEmail,
    orgId,
    callerScope: `${userEmail}|org:${orgId ?? "personal"}`,
    actor: {
      kind,
      displayName,
      ...(kind === "person" || kind === "programmatic"
        ? { email: userEmail }
        : {}),
      ...(context?.runId ? { runId: context.runId } : {}),
      ...(context?.networkProtocol
        ? { networkProtocol: context.networkProtocol }
        : {}),
      ...(context?.networkId ? { networkId: context.networkId } : {}),
      ...(context?.networkPeer ? { networkPeer: context.networkPeer } : {}),
      ...(context?.threadId ? { threadId: context.threadId } : {}),
      ...(context?.turnId ? { turnId: context.turnId } : {}),
    },
    authorizingPrincipal: { kind: "user", email: userEmail, orgId },
    origin: caller,
    runId: context?.runId ?? null,
  };
}

export function encodeRelationshipCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ v: 1, offset }), "utf8").toString(
    "base64url",
  );
}

export function decodeRelationshipCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { v?: unknown; offset?: unknown };
    if (
      parsed.v !== 1 ||
      typeof parsed.offset !== "number" ||
      !Number.isInteger(parsed.offset) ||
      parsed.offset < 0
    ) {
      throw new Error("invalid cursor");
    }
    return parsed.offset;
  } catch {
    relationshipError("INVALID_TARGET", "The relationship cursor is invalid.");
  }
}

export function roleAtLeast(
  role: ShareRole | "owner",
  minimum: ShareRole | "owner",
): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export async function resolveRelationshipDocumentAccess(
  documentId: string,
  options: { db?: RelationshipDb; context?: ActionRunContext } = {},
) {
  if (!options.db) return resolveContentDocumentAccess(documentId);
  const db = options.db;
  const actor = relationshipActorContext(options.context);
  const [unscoped] = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  if (!unscoped) return null;
  let accessOrgId = actor.orgId;
  if (unscoped.orgId) {
    const membership = await getContentOrganizationMembership(
      unscoped.orgId,
      actor.userEmail,
      { db },
    );
    accessOrgId = membership ? unscoped.orgId : null;
  }
  const accessContext = {
    userEmail: actor.userEmail,
    ...(accessOrgId ? { orgId: accessOrgId } : {}),
  };
  if (unscoped.ownerEmail.toLowerCase() === actor.userEmail) {
    return { role: "owner" as const, resource: unscoped };
  }
  for (const role of ["admin", "editor", "commenter", "viewer"] as const) {
    const [resource] = await db
      .select()
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, documentId),
          accessFilter(
            schema.documents,
            schema.documentShares,
            accessContext,
            role,
            { includePublic: true },
          ),
        ),
      );
    if (resource) return { role, resource };
  }
  return null;
}

export async function requireRelationshipDocumentAccess(
  documentId: string,
  minimum: ShareRole | "owner" = "viewer",
  options: { db?: RelationshipDb; context?: ActionRunContext } = {},
) {
  const access = await resolveRelationshipDocumentAccess(documentId, options);
  if (!access || !roleAtLeast(access.role, minimum)) {
    relationshipError(
      "NOT_ACCESSIBLE",
      "The requested Content object is not accessible.",
      {
        statusCode: 404,
      },
    );
  }
  return access;
}

export async function loadRelationshipDatabase(
  databaseId: string,
  minimum: ShareRole | "owner" = "viewer",
  db: RelationshipDb = getDb(),
  context?: ActionRunContext,
  options: { allowDeleted?: boolean } = {},
): Promise<RelationshipDatabaseContext> {
  const [database] = await db
    .select()
    .from(schema.contentDatabases)
    .where(
      options.allowDeleted
        ? eq(schema.contentDatabases.id, databaseId)
        : and(
            eq(schema.contentDatabases.id, databaseId),
            isNull(schema.contentDatabases.deletedAt),
          ),
    );
  if (!database?.spaceId) {
    relationshipError(
      "NOT_ACCESSIBLE",
      "The requested Content database is not accessible.",
      {
        statusCode: 404,
      },
    );
  }
  const access = await requireRelationshipDocumentAccess(
    database.documentId,
    minimum,
    { db, context },
  );
  return {
    database,
    document: access.resource,
    role: access.role,
  };
}

export async function loadRelationshipTypeBundle(
  typeId: string,
  options: { allowArchived?: boolean; db?: RelationshipDb } = {},
): Promise<RelationshipTypeBundle> {
  const db = options.db ?? getDb();
  const [type] = await db
    .select()
    .from(schema.contentRelationshipTypes)
    .where(eq(schema.contentRelationshipTypes.id, typeId));
  if (!type || (!options.allowArchived && type.state !== "active")) {
    relationshipError(
      "TYPE_UNAVAILABLE",
      "The relationship type is unavailable.",
      {
        statusCode: 409,
      },
    );
  }
  const [version] = await db
    .select()
    .from(schema.contentRelationshipTypeVersions)
    .where(
      and(
        eq(schema.contentRelationshipTypeVersions.id, type.currentVersionId),
        eq(schema.contentRelationshipTypeVersions.relationshipTypeId, type.id),
      ),
    );
  if (!version) {
    relationshipError(
      "UNAVAILABLE",
      "The relationship definition is unavailable.",
      {
        statusCode: 503,
      },
    );
  }
  if (
    version.directionalKind !== "directional" ||
    version.inverseCardinality !== "many" ||
    version.allowSelf !== 0 ||
    version.selectorKind !== "database" ||
    (version.forwardCardinality !== "one" &&
      version.forwardCardinality !== "many")
  ) {
    relationshipError(
      "UNSUPPORTED_CONFIGURATION",
      "This relationship configuration is not supported.",
    );
  }
  return { type, version };
}

export function relationshipTypeDto(
  row: typeof schema.contentRelationshipTypes.$inferSelect,
): RelationshipType {
  return {
    id: row.id,
    spaceId: row.spaceId,
    currentVersionId: row.currentVersionId,
    state: row.state === "archived" ? "archived" : "active",
    provenance: "local",
    archivedAt: row.archivedAt,
  };
}

export function relationshipTypeVersionDto(
  row: typeof schema.contentRelationshipTypeVersions.$inferSelect,
): RelationshipTypeVersion {
  return {
    id: row.id,
    relationshipTypeId: row.relationshipTypeId,
    version: row.version,
    forwardLabel: row.forwardLabel,
    inverseLabel: row.inverseLabel,
    forwardCardinality: row.forwardCardinality === "one" ? "one" : "many",
    inverseCardinality: "many",
    sourceDatabaseId: row.sourceDatabaseId,
    targetDatabaseId: row.targetDatabaseId,
    directional: true,
    allowSelf: false,
    selectorKind: "database",
  };
}

export function relationshipProjectionDto(
  row: typeof schema.contentRelationshipProjections.$inferSelect,
): CanonicalRelationProjection {
  return {
    id: row.id,
    propertyId: row.propertyId,
    databaseId: row.databaseId,
    relationshipTypeId: row.relationshipTypeId,
    direction: row.direction === "inverse" ? "inverse" : "forward",
    editable: row.editable === 1,
    alias: row.alias,
    description: row.description,
    archivedAt: row.archivedAt,
  };
}

export function relationshipCapabilities(args: {
  databaseRole?: ShareRole | "owner" | null;
  pageRole?: ShareRole | "owner" | null;
  direction?: "forward" | "inverse";
  editable?: boolean;
  cardinality?: "one" | "many";
}): RelationshipCapabilities {
  const canConfigure = Boolean(
    args.databaseRole && roleAtLeast(args.databaseRole, "admin"),
  );
  const rowEditable = Boolean(
    args.databaseRole &&
    roleAtLeast(args.databaseRole, "editor") &&
    args.pageRole &&
    roleAtLeast(args.pageRole, "editor"),
  );
  const canEditInverse =
    args.direction === "inverse" && args.editable === true && rowEditable;
  const canMutate = args.direction === "inverse" ? canEditInverse : rowEditable;
  return {
    canConfigure,
    canAdd: canMutate,
    canRemove: canMutate,
    canReplace: canMutate && args.cardinality === "one",
    canEditInverse,
  };
}

export function emptyRelationshipInvalidation(): RelationshipInvalidation {
  return {
    pageIds: [],
    databaseIds: [],
    propertyIds: [],
    relationshipTypeIds: [],
  };
}

export function mergeRelationshipInvalidation(
  target: RelationshipInvalidation,
  patch: Partial<RelationshipInvalidation>,
): RelationshipInvalidation {
  for (const key of [
    "pageIds",
    "databaseIds",
    "propertyIds",
    "relationshipTypeIds",
  ] as const) {
    target[key] = [...new Set([...target[key], ...(patch[key] ?? [])])].sort();
  }
  return target;
}

export async function lockRelationshipTypes(
  tx: RelationshipDb,
  typeIds: string[],
): Promise<void> {
  const ids = [...new Set(typeIds)].sort();
  for (const id of ids) {
    await tx
      .update(schema.contentRelationshipTypes)
      .set({ updatedAt: sql`${schema.contentRelationshipTypes.updatedAt}` })
      .where(eq(schema.contentRelationshipTypes.id, id))
      .returning({ id: schema.contentRelationshipTypes.id });
  }
}

export async function lockRelationshipLineages(
  tx: RelationshipDb,
  lineageIds: string[],
): Promise<void> {
  const ids = [...new Set(lineageIds)].sort();
  for (const id of ids) {
    await tx
      .update(schema.contentRelationshipLineages)
      .set({ updatedAt: sql`${schema.contentRelationshipLineages.updatedAt}` })
      .where(eq(schema.contentRelationshipLineages.id, id))
      .returning({ id: schema.contentRelationshipLineages.id });
  }
}

export async function createRelationshipRevision(
  tx: RelationshipDb,
  args: {
    tenant: { ownerEmail: string; orgId: string | null; spaceId: string };
    operationId: string;
    operation: string;
    diff: Record<string, unknown>;
    context?: ActionRunContext;
    compensatesRevisionId?: string | null;
  },
): Promise<RelationshipRevisionContext> {
  const actor = relationshipActorContext(args.context);
  const revisionId = nanoid(24);
  const recoveryToken = nanoid(32);
  await tx.insert(schema.contentRelationshipRevisions).values({
    id: revisionId,
    ownerEmail: args.tenant.ownerEmail,
    orgId: args.tenant.orgId,
    spaceId: args.tenant.spaceId,
    operationId: args.operationId,
    operation: args.operation,
    actorJson: JSON.stringify(actor.actor),
    authorizingPrincipalJson: JSON.stringify(actor.authorizingPrincipal),
    origin: actor.origin,
    recoveryToken,
    diffJson: JSON.stringify(args.diff),
    compensatesRevisionId: args.compensatesRevisionId ?? null,
  });
  return { revisionId, recoveryToken, eventIds: [], actor };
}

export async function appendRelationshipEvent(
  tx: RelationshipDb,
  revision: RelationshipRevisionContext,
  args: {
    tenant: { ownerEmail: string; orgId: string | null; spaceId: string };
    kind: string;
    relationshipTypeId?: string | null;
    relationshipTypeVersionId?: string | null;
    route?: unknown;
    targets?: unknown;
    diff?: unknown;
    eventId?: string;
  },
): Promise<string> {
  const eventId = args.eventId ?? nanoid(24);
  await tx.insert(schema.contentRelationshipEvents).values({
    id: eventId,
    ownerEmail: args.tenant.ownerEmail,
    orgId: args.tenant.orgId,
    spaceId: args.tenant.spaceId,
    revisionId: revision.revisionId,
    sequence: revision.eventIds.length,
    relationshipTypeId: args.relationshipTypeId ?? null,
    relationshipTypeVersionId: args.relationshipTypeVersionId ?? null,
    kind: args.kind,
    actorJson: JSON.stringify(revision.actor.actor),
    authorizingPrincipalJson: JSON.stringify(
      revision.actor.authorizingPrincipal,
    ),
    origin: revision.actor.origin,
    runId: revision.actor.runId,
    routeJson: JSON.stringify(args.route ?? {}),
    targetsJson: JSON.stringify(args.targets ?? {}),
    diffJson: JSON.stringify(args.diff ?? {}),
  });
  revision.eventIds.push(eventId);
  return eventId;
}

export async function replayRelationshipReceipt<T>(
  tx: RelationshipDb,
  args: {
    spaceId: string;
    operationId: string;
    requestHash: string;
    context?: ActionRunContext;
  },
): Promise<T | null> {
  const actor = relationshipActorContext(args.context);
  const [receipt] = await tx
    .select()
    .from(schema.contentRelationshipReceipts)
    .where(
      and(
        eq(schema.contentRelationshipReceipts.spaceId, args.spaceId),
        eq(schema.contentRelationshipReceipts.callerScope, actor.callerScope),
        eq(schema.contentRelationshipReceipts.operationId, args.operationId),
      ),
    );
  if (!receipt) return null;
  if (receipt.requestHash !== args.requestHash) {
    relationshipError(
      "IDEMPOTENCY_CONFLICT",
      "This operation ID was already used with different relationship changes.",
      { statusCode: 409 },
    );
  }
  try {
    return JSON.parse(receipt.resultJson) as T;
  } catch {
    relationshipError(
      "UNAVAILABLE",
      "The committed relationship receipt is unreadable.",
      {
        statusCode: 503,
      },
    );
  }
}

export async function lockRelationshipOperation(
  tx: RelationshipDb,
  args: {
    tenant: { ownerEmail: string; orgId: string | null; spaceId: string };
    operationId: string;
    context?: ActionRunContext;
  },
): Promise<void> {
  const actor = relationshipActorContext(args.context);
  const id = relationshipRequestHash({
    spaceId: args.tenant.spaceId,
    callerScope: actor.callerScope,
    operationId: args.operationId,
  });
  await tx
    .insert(schema.contentRelationshipOperationLocks)
    .values({
      id,
      ownerEmail: args.tenant.ownerEmail,
      orgId: args.tenant.orgId,
      spaceId: args.tenant.spaceId,
      callerScope: actor.callerScope,
      operationId: args.operationId,
    })
    .onConflictDoNothing();
  await tx
    .update(schema.contentRelationshipOperationLocks)
    .set({
      updatedAt: sql`${schema.contentRelationshipOperationLocks.updatedAt}`,
    })
    .where(eq(schema.contentRelationshipOperationLocks.id, id))
    .returning({ id: schema.contentRelationshipOperationLocks.id });
}

export async function insertRelationshipReceipt(
  tx: RelationshipDb,
  args: {
    id: string;
    tenant: { ownerEmail: string; orgId: string | null; spaceId: string };
    operationId: string;
    requestHash: string;
    revisionId: string;
    result: unknown;
    context?: ActionRunContext;
  },
): Promise<void> {
  const actor = relationshipActorContext(args.context);
  await tx.insert(schema.contentRelationshipReceipts).values({
    id: args.id,
    ownerEmail: args.tenant.ownerEmail,
    orgId: args.tenant.orgId,
    spaceId: args.tenant.spaceId,
    callerScope: actor.callerScope,
    operationId: args.operationId,
    requestHash: args.requestHash,
    revisionId: args.revisionId,
    resultJson: JSON.stringify(args.result),
  });
}

export function relationshipTenant(
  database: typeof schema.contentDatabases.$inferSelect,
) {
  if (!database.spaceId) {
    relationshipError("INVALID_TARGET", "The database has no Content space.");
  }
  return {
    ownerEmail: database.ownerEmail,
    orgId: database.orgId,
    spaceId: database.spaceId,
  };
}

export function assertSameRelationshipTenant(
  left: typeof schema.contentDatabases.$inferSelect,
  right: typeof schema.contentDatabases.$inferSelect,
): void {
  const leftAuthority = left.orgId
    ? `org:${left.orgId}`
    : `owner:${left.ownerEmail.toLowerCase()}`;
  const rightAuthority = right.orgId
    ? `org:${right.orgId}`
    : `owner:${right.ownerEmail.toLowerCase()}`;
  if (
    !left.spaceId ||
    left.spaceId !== right.spaceId ||
    leftAuthority !== rightAuthority
  ) {
    relationshipError(
      "INVALID_TARGET",
      "Relationship endpoints must belong to the same Content space and tenant.",
    );
  }
}

export async function activeActivationIdsForLineages(
  db: RelationshipDb,
  lineageIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (lineageIds.length === 0) return result;
  const rows = await db
    .select({
      id: schema.contentRelationshipActivations.id,
      lineageId: schema.contentRelationshipActivations.lineageId,
      retiredId: schema.contentRelationshipActivationRetirements.id,
    })
    .from(schema.contentRelationshipActivations)
    .leftJoin(
      schema.contentRelationshipActivationRetirements,
      eq(
        schema.contentRelationshipActivationRetirements.activationId,
        schema.contentRelationshipActivations.id,
      ),
    )
    .where(
      inArray(schema.contentRelationshipActivations.lineageId, lineageIds),
    );
  for (const row of rows) {
    if (row.retiredId) continue;
    const current = result.get(row.lineageId) ?? [];
    current.push(row.id);
    result.set(row.lineageId, current);
  }
  for (const ids of result.values()) ids.sort();
  return result;
}

export async function retireRelationshipActivations(
  tx: RelationshipDb,
  args: {
    activationIds: string[];
    eventId: string;
    tenant: { ownerEmail: string; orgId: string | null; spaceId: string };
    actorEmail: string;
  },
): Promise<string[]> {
  if (args.activationIds.length === 0) return [];
  const active = await tx
    .select({ id: schema.contentRelationshipActivations.id })
    .from(schema.contentRelationshipActivations)
    .leftJoin(
      schema.contentRelationshipActivationRetirements,
      eq(
        schema.contentRelationshipActivationRetirements.activationId,
        schema.contentRelationshipActivations.id,
      ),
    )
    .where(
      and(
        inArray(schema.contentRelationshipActivations.id, args.activationIds),
        isNull(schema.contentRelationshipActivationRetirements.id),
      ),
    );
  for (const activation of active) {
    await tx
      .insert(schema.contentRelationshipActivationRetirements)
      .values({
        id: nanoid(24),
        ownerEmail: args.tenant.ownerEmail,
        orgId: args.tenant.orgId,
        spaceId: args.tenant.spaceId,
        activationId: activation.id,
        removedEventId: args.eventId,
        removedBy: args.actorEmail,
      })
      .onConflictDoNothing();
  }
  return active.map((activation) => activation.id).sort();
}

export async function lockRelationshipCardinalitySlots(
  tx: RelationshipDb,
  slots: Array<{
    ownerEmail: string;
    orgId: string | null;
    spaceId: string;
    relationshipTypeId: string;
    sourcePageId: string;
  }>,
): Promise<void> {
  const unique = [
    ...new Map(
      slots.map((slot) => [
        `${slot.relationshipTypeId}\u0000${slot.sourcePageId}`,
        slot,
      ]),
    ).values(),
  ].sort((left, right) =>
    `${left.relationshipTypeId}\u0000${left.sourcePageId}`.localeCompare(
      `${right.relationshipTypeId}\u0000${right.sourcePageId}`,
    ),
  );
  for (const slot of unique) {
    await tx
      .insert(schema.contentRelationshipCardinalitySlots)
      .values({ id: nanoid(18), ...slot })
      .onConflictDoNothing();
    await tx
      .update(schema.contentRelationshipCardinalitySlots)
      .set({
        updatedAt: sql`${schema.contentRelationshipCardinalitySlots.updatedAt}`,
      })
      .where(
        and(
          eq(
            schema.contentRelationshipCardinalitySlots.relationshipTypeId,
            slot.relationshipTypeId,
          ),
          eq(
            schema.contentRelationshipCardinalitySlots.sourcePageId,
            slot.sourcePageId,
          ),
        ),
      )
      .returning({ id: schema.contentRelationshipCardinalitySlots.id });
  }
}
