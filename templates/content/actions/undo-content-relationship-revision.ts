import {
  defineAction,
  isActionContractError,
  type ActionRunContext,
} from "@agent-native/core/action";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  canonicalRelationProjectionSchema,
  relationshipRouteRefSchema,
  undoContentRelationshipRevisionInputSchema,
  type RelationshipInvalidation,
  type RelationshipMutationResultItem,
  type RelationshipRouteRef,
  type UndoContentRelationshipRevisionInput,
  type UndoContentRelationshipRevisionResult,
} from "../shared/relationships.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import { nanoid } from "./_property-utils.js";
import { authorizeRelationshipRoute } from "./_relationship-authority.js";
import {
  activeActivationIdsForLineages,
  appendRelationshipEvent,
  createRelationshipRevision,
  insertRelationshipReceipt,
  loadRelationshipDatabase,
  loadRelationshipTypeBundle,
  liveRelationshipLineagesForSlot,
  lockRelationshipCardinalitySlots,
  lockRelationshipLineages,
  lockRelationshipOperation,
  lockRelationshipTypes,
  mergeRelationshipInvalidation,
  relationshipActorContext,
  relationshipError,
  relationshipRequestHash,
  replayRelationshipReceipt,
  requireRelationshipDocumentAccess,
  retireRelationshipActivations,
  type RelationshipDb,
  type RelationshipTypeBundle,
} from "./_relationship-core.js";
import { relationshipRemovalSelectionEntrySchema } from "./prepare-content-relationship-removal.js";

const eventTargetsSchema = z
  .object({
    lineageId: z.string().min(1),
    sourcePageId: z.string().min(1),
    targetPageId: z.string().min(1),
    displacedLineageIds: z.array(z.string().min(1)).optional(),
  })
  .strict();
const eventDiffSchema = z
  .object({
    addedActivationIds: z.array(z.string().min(1)).optional(),
    retiredActivationIds: z.array(z.string().min(1)).optional(),
  })
  .strict();
const propertyDefinitionSnapshotSchema = z
  .object({
    id: z.string().min(1),
    ownerEmail: z.string().min(1),
    orgId: z.string().nullable(),
    databaseId: z.string().nullable(),
    systemRole: z.string().nullable(),
    name: z.string(),
    type: z.string(),
    description: z.string(),
    visibility: z.string(),
    optionsJson: z.string(),
    position: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
const propertyRemovalDiffSchema = z
  .object({
    kind: z.literal("remove-relation-property"),
    propertyDefinition: propertyDefinitionSnapshotSchema,
    projection: canonicalRelationProjectionSchema,
    removedRelationships: z.array(relationshipRemovalSelectionEntrySchema),
  })
  .strict();

type MutationUndoPlan = {
  originalKind: "add" | "remove" | "replace";
  event: typeof schema.contentRelationshipEvents.$inferSelect;
  lineage: typeof schema.contentRelationshipLineages.$inferSelect;
  displacedLineages: Array<
    typeof schema.contentRelationshipLineages.$inferSelect
  >;
  bundle: RelationshipTypeBundle;
  originalRoute: RelationshipRouteRef;
  route: RelationshipRouteRef;
  displacedRoutes: Map<string, RelationshipRouteRef>;
  addedActivationIds: string[];
  retiredActivationIds: string[];
};

function parseJson(value: string, description: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    relationshipError("UNAVAILABLE", `${description} is unreadable.`, {
      statusCode: 503,
    });
  }
}

function routeMatchesEndpoints(
  route: RelationshipRouteRef,
  sourcePageId: string,
  targetPageId: string,
): boolean {
  return route.kind === "inverse-property"
    ? route.targetPageId === targetPageId
    : route.sourcePageId === sourcePageId;
}

async function resolveUndoRoute(
  db: RelationshipDb,
  args: {
    bundle: RelationshipTypeBundle;
    sourcePageId: string;
    targetPageId: string;
    originalRoute: RelationshipRouteRef;
    suppliedRoutes: RelationshipRouteRef[];
    context?: ActionRunContext;
  },
): Promise<RelationshipRouteRef> {
  const candidates = [...args.suppliedRoutes, args.originalRoute].filter(
    (route, index, all) =>
      routeMatchesEndpoints(route, args.sourcePageId, args.targetPageId) &&
      all.findIndex(
        (candidate) => JSON.stringify(candidate) === JSON.stringify(route),
      ) === index,
  );
  let accessError: unknown;
  for (const route of candidates) {
    try {
      await authorizeRelationshipRoute({
        db,
        bundle: args.bundle,
        sourcePageId: args.sourcePageId,
        targetPageId: args.targetPageId,
        route,
        operation: "undo",
        context: args.context,
      });
      return route;
    } catch (error) {
      if (
        !isActionContractError(error) ||
        ![
          "NOT_ACCESSIBLE",
          "ROUTE_NOT_AUTHORIZED",
          "SOURCE_AUTHORITY_UNSUPPORTED",
        ].includes(error.errorCode)
      ) {
        throw error;
      }
      if (error.errorCode === "NOT_ACCESSIBLE") {
        accessError ??= error;
      }
    }
  }
  if (accessError) {
    throw accessError;
  }
  relationshipError(
    "ROUTE_NOT_AUTHORIZED",
    "No currently authorized route can recover this relationship change.",
    { statusCode: 403 },
  );
}

async function mutationUndoPlans(
  db: RelationshipDb,
  events: Array<typeof schema.contentRelationshipEvents.$inferSelect>,
  suppliedRoutes: RelationshipRouteRef[],
  context?: ActionRunContext,
): Promise<MutationUndoPlan[]> {
  const plans: MutationUndoPlan[] = [];
  for (const event of events) {
    const kind =
      event.kind === "relationship-added"
        ? "add"
        : event.kind === "relationship-removed"
          ? "remove"
          : event.kind === "relationship-replaced"
            ? "replace"
            : null;
    if (!kind || !event.relationshipTypeId) {
      relationshipError(
        "UNSUPPORTED_CONFIGURATION",
        "This relationship revision cannot be recovered by this Action.",
      );
    }
    const targets = eventTargetsSchema.safeParse(
      parseJson(event.targetsJson, "A relationship event target"),
    );
    const diff = eventDiffSchema.safeParse(
      parseJson(event.diffJson, "A relationship event diff"),
    );
    const originalRoute = relationshipRouteRefSchema.safeParse(
      parseJson(event.routeJson, "A relationship event route"),
    );
    if (!targets.success || !diff.success || !originalRoute.success) {
      relationshipError(
        "UNAVAILABLE",
        "A relationship event cannot be recovered safely.",
        { statusCode: 503 },
      );
    }
    const [lineage] = await db
      .select()
      .from(schema.contentRelationshipLineages)
      .where(eq(schema.contentRelationshipLineages.id, targets.data.lineageId));
    if (
      !lineage ||
      lineage.relationshipTypeId !== event.relationshipTypeId ||
      lineage.sourcePageId !== targets.data.sourcePageId ||
      lineage.targetPageId !== targets.data.targetPageId
    ) {
      relationshipError(
        "UNAVAILABLE",
        "A relationship lineage needed for recovery is unavailable.",
        { statusCode: 503 },
      );
    }
    const displacedIds = targets.data.displacedLineageIds ?? [];
    const displacedLineages = displacedIds.length
      ? await db
          .select()
          .from(schema.contentRelationshipLineages)
          .where(inArray(schema.contentRelationshipLineages.id, displacedIds))
      : [];
    if (
      displacedLineages.length !== new Set(displacedIds).size ||
      displacedLineages.some(
        (displaced) =>
          displaced.relationshipTypeId !== lineage.relationshipTypeId ||
          displaced.sourcePageId !== lineage.sourcePageId,
      )
    ) {
      relationshipError(
        "UNAVAILABLE",
        "A displaced relationship needed for recovery is unavailable.",
        { statusCode: 503 },
      );
    }
    const bundle = await loadRelationshipTypeBundle(event.relationshipTypeId, {
      allowArchived: true,
      db,
    });
    const selectorDatabases = await Promise.all([
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
    if (
      (kind === "remove" ||
        (kind === "replace" && displacedLineages.length > 0)) &&
      selectorDatabases.some(({ database }) => database.deletedAt)
    ) {
      relationshipError(
        "CONSTRAINT_UNAVAILABLE",
        "A relationship admission database is unavailable.",
        { statusCode: 409 },
      );
    }
    const route = await resolveUndoRoute(db, {
      bundle,
      sourcePageId: lineage.sourcePageId,
      targetPageId: lineage.targetPageId,
      originalRoute: originalRoute.data,
      suppliedRoutes,
      context,
    });
    const displacedRoutes = new Map<string, RelationshipRouteRef>();
    for (const displaced of displacedLineages) {
      displacedRoutes.set(
        displaced.id,
        await resolveUndoRoute(db, {
          bundle,
          sourcePageId: displaced.sourcePageId,
          targetPageId: displaced.targetPageId,
          originalRoute: originalRoute.data,
          suppliedRoutes,
          context,
        }),
      );
    }
    plans.push({
      originalKind: kind,
      event,
      lineage,
      displacedLineages,
      bundle,
      originalRoute: originalRoute.data,
      route,
      displacedRoutes,
      addedActivationIds: [
        ...new Set(diff.data.addedActivationIds ?? []),
      ].sort(),
      retiredActivationIds: [
        ...new Set(diff.data.retiredActivationIds ?? []),
      ].sort(),
    });
  }
  return plans;
}

async function assertPropertyRemovalAccess(
  db: RelationshipDb,
  snapshot: z.infer<typeof propertyRemovalDiffSchema>,
  context?: ActionRunContext,
): Promise<void> {
  const selectorDatabases = await Promise.all([
    loadRelationshipDatabase(
      snapshot.projection.databaseId,
      "admin",
      db,
      context,
      { allowDeleted: true },
    ),
  ]);
  const bundle = await loadRelationshipTypeBundle(
    snapshot.projection.relationshipTypeId,
    { allowArchived: true, db },
  );
  selectorDatabases.push(
    ...(await Promise.all([
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
    ])),
  );
  if (selectorDatabases.some(({ database }) => database.deletedAt)) {
    relationshipError(
      "CONSTRAINT_UNAVAILABLE",
      "A relationship admission database is unavailable.",
      { statusCode: 409 },
    );
  }
  for (const entry of snapshot.removedRelationships) {
    await Promise.all([
      requireRelationshipDocumentAccess(
        entry.sourcePageId,
        snapshot.projection.direction === "inverse" ? "viewer" : "editor",
        { db, context },
      ),
      requireRelationshipDocumentAccess(
        entry.targetPageId,
        snapshot.projection.direction === "inverse" ? "editor" : "viewer",
        { db, context },
      ),
    ]);
  }
}

async function addRecoveryActivation(
  tx: RelationshipDb,
  args: {
    lineageId: string;
    eventId: string;
    tenant: { ownerEmail: string; orgId: string | null; spaceId: string };
    actorName: string;
  },
): Promise<string> {
  const activationId = nanoid(24);
  await tx.insert(schema.contentRelationshipActivations).values({
    id: activationId,
    ownerEmail: args.tenant.ownerEmail,
    orgId: args.tenant.orgId,
    spaceId: args.tenant.spaceId,
    lineageId: args.lineageId,
    addedEventId: args.eventId,
    createdBy: args.actorName,
  });
  return activationId;
}

async function updateSlot(
  tx: RelationshipDb,
  args: {
    typeId: string;
    sourcePageId: string;
    lineageId: string | null;
    targetPageId: string | null;
  },
): Promise<void> {
  await tx
    .update(schema.contentRelationshipCardinalitySlots)
    .set({
      lineageId: args.lineageId,
      targetPageId: args.targetPageId,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(
          schema.contentRelationshipCardinalitySlots.relationshipTypeId,
          args.typeId,
        ),
        eq(
          schema.contentRelationshipCardinalitySlots.sourcePageId,
          args.sourcePageId,
        ),
      ),
    );
}

function emptyInvalidation(): RelationshipInvalidation {
  return {
    pageIds: [],
    databaseIds: [],
    propertyIds: [],
    relationshipTypeIds: [],
  };
}

async function assertPlanActivationHistory(
  db: RelationshipDb,
  plan: MutationUndoPlan,
): Promise<void> {
  const activationIds = [
    ...new Set([...plan.addedActivationIds, ...plan.retiredActivationIds]),
  ];
  if (activationIds.length === 0) return;
  const rows = await db
    .select({
      id: schema.contentRelationshipActivations.id,
      lineageId: schema.contentRelationshipActivations.lineageId,
      addedEventId: schema.contentRelationshipActivations.addedEventId,
      removedEventId:
        schema.contentRelationshipActivationRetirements.removedEventId,
    })
    .from(schema.contentRelationshipActivations)
    .leftJoin(
      schema.contentRelationshipActivationRetirements,
      eq(
        schema.contentRelationshipActivationRetirements.activationId,
        schema.contentRelationshipActivations.id,
      ),
    )
    .where(inArray(schema.contentRelationshipActivations.id, activationIds));
  if (rows.length !== activationIds.length) {
    relationshipError(
      "UNAVAILABLE",
      "The relationship activation history is incomplete.",
      { statusCode: 503 },
    );
  }
  const displacedIds = new Set(
    plan.displacedLineages.map((lineage) => lineage.id),
  );
  for (const row of rows) {
    if (plan.addedActivationIds.includes(row.id)) {
      if (
        row.lineageId !== plan.lineage.id ||
        row.addedEventId !== plan.event.id
      ) {
        relationshipError(
          "UNAVAILABLE",
          "The relationship add history is inconsistent.",
          { statusCode: 503 },
        );
      }
    } else if (
      row.removedEventId !== plan.event.id ||
      (plan.originalKind === "replace"
        ? !displacedIds.has(row.lineageId)
        : row.lineageId !== plan.lineage.id)
    ) {
      relationshipError(
        "UNAVAILABLE",
        "The relationship removal history is inconsistent.",
        { statusCode: 503 },
      );
    }
  }
}

async function undoContentRelationshipRevision(
  input: UndoContentRelationshipRevisionInput,
  context?: ActionRunContext,
): Promise<UndoContentRelationshipRevisionResult> {
  const db = getDb();
  const [originalRevision] = await db
    .select()
    .from(schema.contentRelationshipRevisions)
    .where(eq(schema.contentRelationshipRevisions.id, input.revisionId));
  if (
    !originalRevision ||
    originalRevision.recoveryToken !== input.recoveryToken
  ) {
    relationshipError(
      "STALE_RECOVERY",
      "The relationship recovery reference is stale.",
      { statusCode: 409 },
    );
  }
  const originalEvents = await db
    .select()
    .from(schema.contentRelationshipEvents)
    .where(eq(schema.contentRelationshipEvents.revisionId, input.revisionId))
    .orderBy(schema.contentRelationshipEvents.sequence);
  if (originalEvents.length === 0) {
    relationshipError(
      "UNAVAILABLE",
      "The relationship revision has no committed Events.",
      { statusCode: 503 },
    );
  }
  let initialMutationPlans: MutationUndoPlan[] = [];
  let initialPropertySnapshot: z.infer<
    typeof propertyRemovalDiffSchema
  > | null = null;
  if (originalRevision.operation === "mutate-relationships") {
    initialMutationPlans = await mutationUndoPlans(
      db,
      originalEvents,
      input.routes,
      context,
    );
  } else if (originalRevision.operation === "remove-relation-property") {
    const snapshot = propertyRemovalDiffSchema.safeParse(
      parseJson(
        originalRevision.diffJson,
        "The relationship Property recovery snapshot",
      ),
    );
    if (!snapshot.success) {
      relationshipError(
        "UNAVAILABLE",
        "The relationship Property recovery snapshot is invalid.",
        { statusCode: 503 },
      );
    }
    initialPropertySnapshot = snapshot.data;
    await assertPropertyRemovalAccess(db, snapshot.data, context);
  } else {
    relationshipError(
      "UNSUPPORTED_CONFIGURATION",
      "This relationship revision cannot be undone.",
    );
  }
  const tenant = {
    ownerEmail: originalRevision.ownerEmail,
    orgId: originalRevision.orgId,
    spaceId: originalRevision.spaceId,
  };
  const requestHash = relationshipRequestHash(input);
  const actor = relationshipActorContext(context);

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as RelationshipDb;
    await lockRelationshipOperation(tx, {
      tenant,
      operationId: input.operationId,
      context,
    });
    const replayed =
      await replayRelationshipReceipt<UndoContentRelationshipRevisionResult>(
        tx,
        {
          spaceId: tenant.spaceId,
          operationId: input.operationId,
          requestHash,
          context,
        },
      );
    if (replayed) return replayed;
    await tx
      .update(schema.contentRelationshipRevisions)
      .set({
        recoveryToken: sql`${schema.contentRelationshipRevisions.recoveryToken}`,
      })
      .where(eq(schema.contentRelationshipRevisions.id, input.revisionId))
      .returning({ id: schema.contentRelationshipRevisions.id });
    const [lockedOriginal] = await tx
      .select()
      .from(schema.contentRelationshipRevisions)
      .where(eq(schema.contentRelationshipRevisions.id, input.revisionId));
    if (
      !lockedOriginal ||
      lockedOriginal.recoveryToken !== input.recoveryToken
    ) {
      relationshipError(
        "STALE_RECOVERY",
        "The relationship recovery reference is stale.",
        { statusCode: 409 },
      );
    }
    const [existingCompensation] = await tx
      .select({ id: schema.contentRelationshipRevisions.id })
      .from(schema.contentRelationshipRevisions)
      .where(
        eq(
          schema.contentRelationshipRevisions.compensatesRevisionId,
          input.revisionId,
        ),
      );
    if (existingCompensation) {
      relationshipError(
        "STALE_RECOVERY",
        "This relationship revision has already been recovered.",
        { statusCode: 409 },
      );
    }

    const databaseIds = new Set<string>();
    const typeIds = new Set<string>();
    const lineageIds = new Set<string>();
    const slotInputs: Parameters<typeof lockRelationshipCardinalitySlots>[1] =
      [];
    for (const plan of initialMutationPlans) {
      databaseIds.add(plan.bundle.version.sourceDatabaseId);
      databaseIds.add(plan.bundle.version.targetDatabaseId);
      typeIds.add(plan.bundle.type.id);
      lineageIds.add(plan.lineage.id);
      for (const displaced of plan.displacedLineages)
        lineageIds.add(displaced.id);
      if (plan.bundle.version.forwardCardinality === "one") {
        slotInputs.push({
          ownerEmail: plan.bundle.type.ownerEmail,
          orgId: plan.bundle.type.orgId,
          spaceId: plan.bundle.type.spaceId,
          relationshipTypeId: plan.bundle.type.id,
          sourcePageId: plan.lineage.sourcePageId,
        });
      }
    }
    if (initialPropertySnapshot) {
      databaseIds.add(initialPropertySnapshot.projection.databaseId);
      typeIds.add(initialPropertySnapshot.projection.relationshipTypeId);
      for (const entry of initialPropertySnapshot.removedRelationships) {
        lineageIds.add(entry.edgeId);
        const bundle = await loadRelationshipTypeBundle(entry.typeId, {
          allowArchived: true,
          db: tx,
        });
        databaseIds.add(bundle.version.sourceDatabaseId);
        databaseIds.add(bundle.version.targetDatabaseId);
        if (bundle.version.forwardCardinality === "one") {
          slotInputs.push({
            ownerEmail: bundle.type.ownerEmail,
            orgId: bundle.type.orgId,
            spaceId: bundle.type.spaceId,
            relationshipTypeId: bundle.type.id,
            sourcePageId: entry.sourcePageId,
          });
        }
      }
    }
    for (const databaseId of [...databaseIds].sort()) {
      await lockContentDatabaseMutation(tx, databaseId);
    }
    await lockRelationshipTypes(tx, [...typeIds]);
    await lockRelationshipLineages(tx, [...lineageIds]);
    await lockRelationshipCardinalitySlots(tx, slotInputs);

    let mutationPlans: MutationUndoPlan[] = [];
    let propertySnapshot = initialPropertySnapshot;
    if (lockedOriginal.operation === "mutate-relationships") {
      const events = await tx
        .select()
        .from(schema.contentRelationshipEvents)
        .where(
          eq(schema.contentRelationshipEvents.revisionId, input.revisionId),
        )
        .orderBy(schema.contentRelationshipEvents.sequence);
      mutationPlans = await mutationUndoPlans(
        tx,
        events,
        input.routes,
        context,
      );
    } else if (lockedOriginal.operation === "remove-relation-property") {
      const parsed = propertyRemovalDiffSchema.safeParse(
        parseJson(
          lockedOriginal.diffJson,
          "The relationship Property recovery snapshot",
        ),
      );
      if (!parsed.success) {
        relationshipError(
          "UNAVAILABLE",
          "The relationship Property recovery snapshot is invalid.",
          { statusCode: 503 },
        );
      }
      propertySnapshot = parsed.data;
      await assertPropertyRemovalAccess(tx, parsed.data, context);
    }

    const revision = await createRelationshipRevision(tx, {
      tenant,
      operationId: input.operationId,
      operation: "undo-relationship-revision",
      diff: {
        kind: "undo-relationship-revision",
        undoneRevisionId: input.revisionId,
      },
      context,
      compensatesRevisionId: input.revisionId,
    });
    const invalidation = emptyInvalidation();
    const results: RelationshipMutationResultItem[] = [];
    for (const plan of mutationPlans) {
      await assertPlanActivationHistory(tx, plan);
    }
    for (const plan of [...mutationPlans].reverse()) {
      mergeRelationshipInvalidation(invalidation, {
        pageIds: [plan.lineage.sourcePageId, plan.lineage.targetPageId],
        databaseIds: [
          plan.bundle.version.sourceDatabaseId,
          plan.bundle.version.targetDatabaseId,
        ],
        relationshipTypeIds: [plan.bundle.type.id],
      });
      if (plan.originalKind === "add") {
        const eventId = nanoid(24);
        const retiredIds = await retireRelationshipActivations(tx, {
          activationIds: plan.addedActivationIds,
          eventId,
          tenant,
          actorEmail: actor.actor.displayName,
        });
        await appendRelationshipEvent(tx, revision, {
          tenant,
          eventId,
          kind: "relationship-add-undone",
          relationshipTypeId: plan.bundle.type.id,
          relationshipTypeVersionId: plan.bundle.version.id,
          route: plan.route,
          targets: {
            lineageId: plan.lineage.id,
            sourcePageId: plan.lineage.sourcePageId,
            targetPageId: plan.lineage.targetPageId,
          },
          diff: { retiredActivationIds: retiredIds },
        });
        const remaining = await activeActivationIdsForLineages(tx, [
          plan.lineage.id,
        ]);
        const isActive = (remaining.get(plan.lineage.id)?.length ?? 0) > 0;
        if (plan.bundle.version.forwardCardinality === "one" && !isActive) {
          await updateSlot(tx, {
            typeId: plan.bundle.type.id,
            sourcePageId: plan.lineage.sourcePageId,
            lineageId: null,
            targetPageId: null,
          });
        }
        results.push({
          kind: "remove",
          edgeId: plan.lineage.id,
          lineageId: plan.lineage.id,
          state: isActive ? "active" : "inactive",
          activationIds: retiredIds,
        });
        continue;
      }

      if (plan.originalKind === "remove") {
        if (plan.bundle.version.forwardCardinality === "one") {
          const slot = await liveRelationshipLineagesForSlot(
            tx,
            plan.bundle.type.id,
            plan.lineage.sourcePageId,
          );
          if (slot.lineages.some((lineage) => lineage.id !== plan.lineage.id)) {
            relationshipError(
              "STALE_RECOVERY",
              "The max-one relationship changed after this revision.",
              { statusCode: 409 },
            );
          }
        }
        const eventId = nanoid(24);
        const activationIds: string[] = [];
        if (plan.retiredActivationIds.length > 0) {
          activationIds.push(
            await addRecoveryActivation(tx, {
              lineageId: plan.lineage.id,
              eventId,
              tenant,
              actorName: actor.actor.displayName,
            }),
          );
        }
        await appendRelationshipEvent(tx, revision, {
          tenant,
          eventId,
          kind: "relationship-removal-undone",
          relationshipTypeId: plan.bundle.type.id,
          relationshipTypeVersionId: plan.bundle.version.id,
          route: plan.route,
          targets: {
            lineageId: plan.lineage.id,
            sourcePageId: plan.lineage.sourcePageId,
            targetPageId: plan.lineage.targetPageId,
          },
          diff: { addedActivationIds: activationIds },
        });
        if (
          activationIds.length > 0 &&
          plan.bundle.version.forwardCardinality === "one"
        ) {
          await updateSlot(tx, {
            typeId: plan.bundle.type.id,
            sourcePageId: plan.lineage.sourcePageId,
            lineageId: plan.lineage.id,
            targetPageId: plan.lineage.targetPageId,
          });
        }
        const current = await activeActivationIdsForLineages(tx, [
          plan.lineage.id,
        ]);
        results.push({
          kind: "add",
          edgeId: plan.lineage.id,
          lineageId: plan.lineage.id,
          state:
            (current.get(plan.lineage.id)?.length ?? 0) > 0
              ? "active"
              : "inactive",
          activationIds,
        });
        continue;
      }

      if (
        plan.bundle.version.forwardCardinality !== "one" ||
        plan.addedActivationIds.length !== 1 ||
        plan.displacedLineages.length > 1
      ) {
        relationshipError(
          "UNAVAILABLE",
          "The replacement recovery history is inconsistent.",
          { statusCode: 503 },
        );
      }
      const slot = await liveRelationshipLineagesForSlot(
        tx,
        plan.bundle.type.id,
        plan.lineage.sourcePageId,
      );
      const activeIds = [
        ...new Set(
          slot.lineages.flatMap((lineage) => slot.active.get(lineage.id) ?? []),
        ),
      ].sort();
      if (
        slot.lineages.length !== 1 ||
        slot.lineages[0]?.id !== plan.lineage.id ||
        JSON.stringify(activeIds) !== JSON.stringify(plan.addedActivationIds)
      ) {
        relationshipError(
          "STALE_RECOVERY",
          "The max-one relationship changed after this replacement.",
          { statusCode: 409 },
        );
      }
      const eventId = nanoid(24);
      const retiredIds = await retireRelationshipActivations(tx, {
        activationIds: plan.addedActivationIds,
        eventId,
        tenant,
        actorEmail: actor.actor.displayName,
      });
      const restored = plan.displacedLineages[0] ?? null;
      const activationIds = restored
        ? [
            await addRecoveryActivation(tx, {
              lineageId: restored.id,
              eventId,
              tenant,
              actorName: actor.actor.displayName,
            }),
          ]
        : [];
      await appendRelationshipEvent(tx, revision, {
        tenant,
        eventId,
        kind: restored
          ? "relationship-replacement-undone"
          : "relationship-add-undone",
        relationshipTypeId: plan.bundle.type.id,
        relationshipTypeVersionId: plan.bundle.version.id,
        route: restored
          ? (plan.displacedRoutes.get(restored.id) ?? plan.route)
          : plan.route,
        targets: {
          lineageId: restored?.id ?? plan.lineage.id,
          sourcePageId: plan.lineage.sourcePageId,
          targetPageId: restored?.targetPageId ?? plan.lineage.targetPageId,
          ...(restored ? { displacedLineageIds: [plan.lineage.id] } : {}),
        },
        diff: restored
          ? {
              addedActivationIds: activationIds,
              retiredActivationIds: retiredIds,
            }
          : { retiredActivationIds: retiredIds },
      });
      await updateSlot(tx, {
        typeId: plan.bundle.type.id,
        sourcePageId: plan.lineage.sourcePageId,
        lineageId: restored?.id ?? null,
        targetPageId: restored?.targetPageId ?? null,
      });
      results.push({
        kind: restored ? "replace" : "remove",
        edgeId: restored?.id ?? plan.lineage.id,
        lineageId: restored?.id ?? plan.lineage.id,
        state: restored ? "active" : "inactive",
        activationIds: restored ? activationIds : retiredIds,
        displacedEdgeIds: [plan.lineage.id],
      });
    }

    if (propertySnapshot) {
      const [projectionRow] = await tx
        .select()
        .from(schema.contentRelationshipProjections)
        .where(
          eq(
            schema.contentRelationshipProjections.propertyId,
            propertySnapshot.projection.propertyId,
          ),
        );
      const [conflictingDefinition] = await tx
        .select({ id: schema.documentPropertyDefinitions.id })
        .from(schema.documentPropertyDefinitions)
        .where(
          eq(
            schema.documentPropertyDefinitions.id,
            propertySnapshot.propertyDefinition.id,
          ),
        );
      if (
        !projectionRow ||
        !projectionRow.archivedAt ||
        conflictingDefinition ||
        projectionRow.id !== propertySnapshot.projection.id ||
        projectionRow.databaseId !== propertySnapshot.projection.databaseId ||
        projectionRow.relationshipTypeId !==
          propertySnapshot.projection.relationshipTypeId ||
        propertySnapshot.propertyDefinition.databaseId !==
          propertySnapshot.projection.databaseId ||
        propertySnapshot.propertyDefinition.type !== "relation"
      ) {
        relationshipError(
          "STALE_RECOVERY",
          "The relation Property identity is no longer available for recovery.",
          { statusCode: 409 },
        );
      }
      const selectedActivationIds = [
        ...new Set(
          propertySnapshot.removedRelationships.flatMap(
            (entry) => entry.observedActivationIds,
          ),
        ),
      ];
      if (selectedActivationIds.length) {
        const history = await tx
          .select({
            activationId: schema.contentRelationshipActivations.id,
            lineageId: schema.contentRelationshipActivations.lineageId,
            revisionId: schema.contentRelationshipEvents.revisionId,
          })
          .from(schema.contentRelationshipActivations)
          .innerJoin(
            schema.contentRelationshipActivationRetirements,
            eq(
              schema.contentRelationshipActivationRetirements.activationId,
              schema.contentRelationshipActivations.id,
            ),
          )
          .innerJoin(
            schema.contentRelationshipEvents,
            eq(
              schema.contentRelationshipEvents.id,
              schema.contentRelationshipActivationRetirements.removedEventId,
            ),
          )
          .where(
            inArray(
              schema.contentRelationshipActivations.id,
              selectedActivationIds,
            ),
          );
        const entryByActivation = new Map<string, string>();
        for (const entry of propertySnapshot.removedRelationships) {
          for (const activationId of entry.observedActivationIds) {
            entryByActivation.set(activationId, entry.edgeId);
          }
        }
        if (
          history.length !== selectedActivationIds.length ||
          history.some(
            (row) =>
              row.revisionId !== input.revisionId ||
              entryByActivation.get(row.activationId) !== row.lineageId,
          )
        ) {
          relationshipError(
            "UNAVAILABLE",
            "The relation Property recovery history is incomplete.",
            { statusCode: 503 },
          );
        }
      }
      for (const entry of propertySnapshot.removedRelationships) {
        const bundle = await loadRelationshipTypeBundle(entry.typeId, {
          allowArchived: true,
          db: tx,
        });
        if (bundle.version.forwardCardinality === "one") {
          const slot = await liveRelationshipLineagesForSlot(
            tx,
            bundle.type.id,
            entry.sourcePageId,
          );
          if (slot.lineages.some((lineage) => lineage.id !== entry.edgeId)) {
            relationshipError(
              "STALE_RECOVERY",
              "A max-one relationship changed after the Property removal.",
              { statusCode: 409 },
            );
          }
        }
      }
      await tx
        .insert(schema.documentPropertyDefinitions)
        .values(propertySnapshot.propertyDefinition);
      await tx
        .update(schema.contentRelationshipProjections)
        .set({
          alias: propertySnapshot.projection.alias,
          description: propertySnapshot.projection.description,
          editable: propertySnapshot.projection.editable ? 1 : 0,
          archivedAt: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.contentRelationshipProjections.id, projectionRow.id));
      const propertyBundle = await loadRelationshipTypeBundle(
        propertySnapshot.projection.relationshipTypeId,
        { allowArchived: true, db: tx },
      );
      await appendRelationshipEvent(tx, revision, {
        tenant,
        kind: "relationship-projection-restored",
        relationshipTypeId: propertyBundle.type.id,
        relationshipTypeVersionId: propertyBundle.version.id,
        targets: {
          propertyId: propertySnapshot.projection.propertyId,
          databaseId: propertySnapshot.projection.databaseId,
        },
        diff: {
          propertyDefinition: propertySnapshot.propertyDefinition,
          projection: propertySnapshot.projection,
        },
      });
      mergeRelationshipInvalidation(invalidation, {
        databaseIds: [propertySnapshot.projection.databaseId],
        propertyIds: [propertySnapshot.projection.propertyId],
        relationshipTypeIds: [propertySnapshot.projection.relationshipTypeId],
      });
      for (const entry of propertySnapshot.removedRelationships) {
        const [lineage] = await tx
          .select()
          .from(schema.contentRelationshipLineages)
          .where(eq(schema.contentRelationshipLineages.id, entry.edgeId));
        if (
          !lineage ||
          lineage.relationshipTypeId !== entry.typeId ||
          lineage.sourcePageId !== entry.sourcePageId ||
          lineage.targetPageId !== entry.targetPageId
        ) {
          relationshipError(
            "UNAVAILABLE",
            "A relationship lineage needed for Property recovery is unavailable.",
            { statusCode: 503 },
          );
        }
        const bundle = await loadRelationshipTypeBundle(entry.typeId, {
          allowArchived: true,
          db: tx,
        });
        const route = await resolveUndoRoute(tx, {
          bundle,
          sourcePageId: entry.sourcePageId,
          targetPageId: entry.targetPageId,
          originalRoute: entry.route,
          suppliedRoutes: input.routes,
          context,
        });
        const eventId = nanoid(24);
        const activationId = await addRecoveryActivation(tx, {
          lineageId: entry.edgeId,
          eventId,
          tenant,
          actorName: actor.actor.displayName,
        });
        await appendRelationshipEvent(tx, revision, {
          tenant,
          eventId,
          kind: "relationship-removal-undone",
          relationshipTypeId: bundle.type.id,
          relationshipTypeVersionId: bundle.version.id,
          route,
          targets: {
            lineageId: entry.edgeId,
            sourcePageId: entry.sourcePageId,
            targetPageId: entry.targetPageId,
          },
          diff: { addedActivationIds: [activationId] },
        });
        if (bundle.version.forwardCardinality === "one") {
          await updateSlot(tx, {
            typeId: bundle.type.id,
            sourcePageId: entry.sourcePageId,
            lineageId: entry.edgeId,
            targetPageId: entry.targetPageId,
          });
        }
        mergeRelationshipInvalidation(invalidation, {
          pageIds: [entry.sourcePageId, entry.targetPageId],
          databaseIds: [
            bundle.version.sourceDatabaseId,
            bundle.version.targetDatabaseId,
          ],
          relationshipTypeIds: [bundle.type.id],
        });
        results.push({
          kind: "add",
          edgeId: entry.edgeId,
          lineageId: entry.edgeId,
          state: "active",
          activationIds: [activationId],
        });
      }
    }

    await tx
      .update(schema.contentRelationshipRevisions)
      .set({
        diffJson: JSON.stringify({
          kind: "undo-relationship-revision",
          undoneRevisionId: input.revisionId,
          results,
        }),
      })
      .where(eq(schema.contentRelationshipRevisions.id, revision.revisionId));
    const receiptId = nanoid(24);
    const result: UndoContentRelationshipRevisionResult = {
      operationId: input.operationId,
      receiptId,
      revisionId: revision.revisionId,
      eventIds: revision.eventIds,
      invalidation,
      undoneRevisionId: input.revisionId,
      results,
      undo: {
        revisionId: revision.revisionId,
        recoveryToken: revision.recoveryToken,
      },
    };
    await insertRelationshipReceipt(tx, {
      id: receiptId,
      tenant,
      operationId: input.operationId,
      requestHash,
      revisionId: revision.revisionId,
      result,
      context,
    });
    return result;
  });
}

export default defineAction({
  description:
    "Safely compensate one committed canonical relationship mutation or relation Property removal using current authority and cardinality state.",
  mcpTool: true,
  schema: undoContentRelationshipRevisionInputSchema,
  run: undoContentRelationshipRevision,
});
