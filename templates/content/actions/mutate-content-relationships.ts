import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  mutateContentRelationshipsInputSchema,
  type MutateContentRelationshipsInput,
  type MutateContentRelationshipsResult,
  type RelationshipChange,
  type RelationshipInvalidation,
  type RelationshipMutationResultItem,
} from "../shared/relationships.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import { nanoid } from "./_property-utils.js";
import {
  authorizeRelationshipRoute,
  type AuthorizedRelationshipRoute,
} from "./_relationship-authority.js";
import {
  activeActivationIdsForLineages,
  appendRelationshipEvent,
  createRelationshipRevision,
  emptyRelationshipInvalidation,
  insertRelationshipReceipt,
  loadRelationshipDatabase,
  loadRelationshipTypeBundle,
  lockRelationshipCardinalitySlots,
  lockRelationshipOperation,
  lockRelationshipLineages,
  lockRelationshipTypes,
  mergeRelationshipInvalidation,
  relationshipActorContext,
  relationshipError,
  relationshipRequestHash,
  requireRelationshipDocumentAccess,
  replayRelationshipReceipt,
  retireRelationshipActivations,
  type RelationshipDb,
  type RelationshipTypeBundle,
} from "./_relationship-core.js";

type ChangePlan = {
  change: RelationshipChange;
  bundle: RelationshipTypeBundle;
  sourcePageId: string;
  targetPageId: string;
  edgeId?: string;
};

async function assertRelationshipReceiptAccessible(
  db: RelationshipDb,
  result: MutateContentRelationshipsResult,
  context?: ActionRunContext,
): Promise<void> {
  const edgeIds = [
    ...new Set(
      result.results.flatMap((item) => [
        item.edgeId,
        ...(item.displacedEdgeIds ?? []),
      ]),
    ),
  ];
  const lineages = edgeIds.length
    ? await db
        .select()
        .from(schema.contentRelationshipLineages)
        .where(inArray(schema.contentRelationshipLineages.id, edgeIds))
    : [];
  if (lineages.length !== edgeIds.length) {
    relationshipError(
      "UNAVAILABLE",
      "The committed relationship receipt is incomplete.",
      { statusCode: 503 },
    );
  }
  const bundles = new Map<string, RelationshipTypeBundle>();
  for (const lineage of lineages) {
    let bundle = bundles.get(lineage.relationshipTypeId);
    if (!bundle) {
      bundle = await loadRelationshipTypeBundle(lineage.relationshipTypeId, {
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
      bundles.set(lineage.relationshipTypeId, bundle);
    }
    await Promise.all([
      requireRelationshipDocumentAccess(lineage.sourcePageId, "viewer", {
        db,
        context,
      }),
      requireRelationshipDocumentAccess(lineage.targetPageId, "viewer", {
        db,
        context,
      }),
    ]);
  }
}

function deduplicateChanges(
  changes: RelationshipChange[],
): RelationshipChange[] {
  const seenAdds = new Set<string>();
  return changes.filter((change) => {
    if (change.kind !== "add") return true;
    const key = `${change.typeId}\u0000${change.sourcePageId}\u0000${change.targetPageId}`;
    if (seenAdds.has(key)) return false;
    seenAdds.add(key);
    return true;
  });
}

async function planChanges(
  changes: RelationshipChange[],
  db: RelationshipDb,
): Promise<ChangePlan[]> {
  const removeIds = changes.flatMap((change) =>
    change.kind === "remove" ? [change.edgeId] : [],
  );
  const removeRows = removeIds.length
    ? await db
        .select()
        .from(schema.contentRelationshipLineages)
        .where(inArray(schema.contentRelationshipLineages.id, removeIds))
    : [];
  const removeById = new Map(
    removeRows.map((lineage) => [lineage.id, lineage]),
  );
  const typeIds = [
    ...new Set(
      changes.map((change) => {
        if (change.kind !== "remove") return change.typeId;
        const lineage = removeById.get(change.edgeId);
        if (!lineage) {
          relationshipError(
            "INVALID_TARGET",
            "The requested relationship edge is unavailable.",
            { statusCode: 404 },
          );
        }
        return lineage.relationshipTypeId;
      }),
    ),
  ];
  const bundles = new Map<string, RelationshipTypeBundle>();
  for (const typeId of typeIds) {
    const onlyRemovals = changes.every((change) => {
      if (change.kind !== "remove") return change.typeId !== typeId;
      return removeById.get(change.edgeId)?.relationshipTypeId === typeId;
    });
    bundles.set(
      typeId,
      await loadRelationshipTypeBundle(typeId, {
        allowArchived: onlyRemovals,
        db,
      }),
    );
  }
  return changes.map((change) => {
    if (change.kind === "remove") {
      const lineage = removeById.get(change.edgeId);
      if (!lineage) {
        relationshipError(
          "INVALID_TARGET",
          "The requested relationship edge is unavailable.",
          { statusCode: 404 },
        );
      }
      return {
        change,
        bundle: bundles.get(lineage.relationshipTypeId)!,
        sourcePageId: lineage.sourcePageId,
        targetPageId: lineage.targetPageId,
        edgeId: lineage.id,
      };
    }
    const bundle = bundles.get(change.typeId)!;
    if (bundle.version.id !== change.typeVersionId) {
      relationshipError(
        "TYPE_UNAVAILABLE",
        "The relationship type version changed; refresh before editing.",
        { statusCode: 409 },
      );
    }
    return {
      change,
      bundle,
      sourcePageId: change.sourcePageId,
      targetPageId: change.targetPageId,
    };
  });
}

function validateBatchShape(plans: ChangePlan[]): void {
  const spaces = new Set(plans.map((plan) => plan.bundle.type.spaceId));
  const tenants = new Set(
    plans.map((plan) =>
      plan.bundle.type.orgId
        ? `org:${plan.bundle.type.orgId}`
        : `owner:${plan.bundle.type.ownerEmail.toLowerCase()}`,
    ),
  );
  if (spaces.size !== 1 || tenants.size !== 1) {
    relationshipError(
      "INVALID_TARGET",
      "One relationship mutation cannot cross Content spaces or tenants.",
    );
  }
  const oneTargets = new Map<string, Set<string>>();
  for (const plan of plans) {
    if (
      plan.change.kind === "remove" ||
      plan.bundle.version.forwardCardinality !== "one"
    ) {
      continue;
    }
    const key = `${plan.bundle.type.id}\u0000${plan.sourcePageId}`;
    const targets = oneTargets.get(key) ?? new Set<string>();
    targets.add(plan.targetPageId);
    oneTargets.set(key, targets);
  }
  if ([...oneTargets.values()].some((targets) => targets.size > 1)) {
    relationshipError(
      "CARDINALITY_VIOLATION",
      "A max-one relationship batch cannot choose multiple targets for one source Page.",
      { statusCode: 409 },
    );
  }
}

async function liveLineagesForSlot(
  tx: RelationshipDb,
  typeId: string,
  sourcePageId: string,
) {
  const lineages = await tx
    .select()
    .from(schema.contentRelationshipLineages)
    .where(
      and(
        eq(schema.contentRelationshipLineages.relationshipTypeId, typeId),
        eq(schema.contentRelationshipLineages.sourcePageId, sourcePageId),
      ),
    );
  const activeByLineage = await activeActivationIdsForLineages(
    tx,
    lineages.map((lineage) => lineage.id),
  );
  const deletedTargets = lineages.length
    ? await tx
        .select({ pageId: schema.contentRelationshipEndpointStates.pageId })
        .from(schema.contentRelationshipEndpointStates)
        .where(
          and(
            inArray(
              schema.contentRelationshipEndpointStates.pageId,
              lineages.map((lineage) => lineage.targetPageId),
            ),
            isNotNull(
              schema.contentRelationshipEndpointStates.permanentlyDeletedAt,
            ),
          ),
        )
    : [];
  const deletedTargetIds = new Set(deletedTargets.map((row) => row.pageId));
  return lineages.filter(
    (lineage) =>
      (activeByLineage.get(lineage.id)?.length ?? 0) > 0 &&
      !deletedTargetIds.has(lineage.targetPageId),
  );
}

async function getOrCreateLineage(
  tx: RelationshipDb,
  plan: ChangePlan,
  actorEmail: string,
) {
  const candidateId = nanoid(24);
  await tx
    .insert(schema.contentRelationshipLineages)
    .values({
      id: candidateId,
      ownerEmail: plan.bundle.type.ownerEmail,
      orgId: plan.bundle.type.orgId,
      spaceId: plan.bundle.type.spaceId,
      relationshipTypeId: plan.bundle.type.id,
      sourcePageId: plan.sourcePageId,
      targetPageId: plan.targetPageId,
      createdBy: actorEmail,
    })
    .onConflictDoNothing();
  const [lineage] = await tx
    .select()
    .from(schema.contentRelationshipLineages)
    .where(
      and(
        eq(
          schema.contentRelationshipLineages.relationshipTypeId,
          plan.bundle.type.id,
        ),
        eq(schema.contentRelationshipLineages.sourcePageId, plan.sourcePageId),
        eq(schema.contentRelationshipLineages.targetPageId, plan.targetPageId),
      ),
    );
  if (!lineage) {
    relationshipError(
      "UNAVAILABLE",
      "The relationship lineage was not committed.",
      {
        statusCode: 503,
      },
    );
  }
  await lockRelationshipLineages(tx, [lineage.id]);
  return lineage;
}

async function validateObservation(
  tx: RelationshipDb,
  args: {
    token: string;
    kind: "edge" | "slot";
    edgeId?: string;
    typeId: string;
    sourcePageId: string;
    activationIds?: string[];
    context?: ActionRunContext;
  },
) {
  const actor = relationshipActorContext(args.context);
  const [observation] = await tx
    .select()
    .from(schema.contentRelationshipObservations)
    .where(eq(schema.contentRelationshipObservations.token, args.token));
  if (
    !observation ||
    observation.callerScope !== actor.callerScope ||
    observation.kind !== args.kind ||
    observation.edgeId !== (args.edgeId ?? null) ||
    observation.relationshipTypeId !== args.typeId ||
    observation.sourcePageId !== args.sourcePageId ||
    observation.expiresAt <= new Date().toISOString()
  ) {
    relationshipError(
      "STALE_SELECTION",
      "The relationship observation is stale or does not match this edit.",
      { statusCode: 409 },
    );
  }
  let observedIds: string[];
  try {
    observedIds = JSON.parse(observation.activationIdsJson) as string[];
  } catch {
    relationshipError(
      "UNAVAILABLE",
      "The relationship observation is unreadable.",
      {
        statusCode: 503,
      },
    );
  }
  observedIds = [...new Set(observedIds!)].sort();
  if (
    args.activationIds &&
    JSON.stringify([...new Set(args.activationIds)].sort()) !==
      JSON.stringify(observedIds)
  ) {
    relationshipError(
      "STALE_SELECTION",
      "The removal does not match the observed relationship activations.",
      { statusCode: 409 },
    );
  }
  return observedIds;
}

async function mutateContentRelationships(
  input: MutateContentRelationshipsInput,
  context?: ActionRunContext,
): Promise<MutateContentRelationshipsResult> {
  const changes = deduplicateChanges(input.changes);
  const db = getDb();
  let plans = await planChanges(changes, db);
  validateBatchShape(plans);
  const preflightRoutes: AuthorizedRelationshipRoute[] = [];
  for (const plan of plans) {
    preflightRoutes.push(
      await authorizeRelationshipRoute({
        db,
        bundle: plan.bundle,
        sourcePageId: plan.sourcePageId,
        targetPageId: plan.targetPageId,
        route: plan.change.route,
        operation: plan.change.kind,
        context,
      }),
    );
  }
  const requestHash = relationshipRequestHash({ ...input, changes });
  const actor = relationshipActorContext(context);
  const firstBundle = plans[0]!.bundle;
  const tenant = {
    ownerEmail: firstBundle.type.ownerEmail,
    orgId: firstBundle.type.orgId,
    spaceId: firstBundle.type.spaceId,
  };

  return db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as RelationshipDb;
    await lockRelationshipOperation(tx, {
      tenant,
      operationId: input.operationId,
      context,
    });
    const databaseIds = [
      ...new Set([
        ...preflightRoutes.flatMap((route) => route.databaseIds),
        ...plans.flatMap((plan) =>
          plan.change.kind === "remove"
            ? []
            : [
                plan.bundle.version.sourceDatabaseId,
                plan.bundle.version.targetDatabaseId,
              ],
        ),
      ]),
    ].sort();
    for (const databaseId of databaseIds) {
      await lockContentDatabaseMutation(tx, databaseId);
    }
    await lockRelationshipTypes(
      tx,
      plans.map((plan) => plan.bundle.type.id),
    );
    plans = await planChanges(changes, tx);
    for (const plan of plans) {
      await authorizeRelationshipRoute({
        db: tx,
        bundle: plan.bundle,
        sourcePageId: plan.sourcePageId,
        targetPageId: plan.targetPageId,
        route: plan.change.route,
        operation: plan.change.kind,
        context,
      });
    }
    await lockRelationshipLineages(
      tx,
      plans.flatMap((plan) => (plan.edgeId ? [plan.edgeId] : [])),
    );
    await lockRelationshipCardinalitySlots(
      tx,
      plans
        .filter((plan) => plan.bundle.version.forwardCardinality === "one")
        .map((plan) => ({
          ownerEmail: plan.bundle.type.ownerEmail,
          orgId: plan.bundle.type.orgId,
          spaceId: plan.bundle.type.spaceId,
          relationshipTypeId: plan.bundle.type.id,
          sourcePageId: plan.sourcePageId,
        })),
    );
    const replayed =
      await replayRelationshipReceipt<MutateContentRelationshipsResult>(tx, {
        spaceId: tenant.spaceId,
        operationId: input.operationId,
        requestHash,
        context,
      });
    if (replayed) {
      await assertRelationshipReceiptAccessible(tx, replayed, context);
      return replayed;
    }

    const revision = await createRelationshipRevision(tx, {
      tenant,
      operationId: input.operationId,
      operation: "mutate-relationships",
      diff: { requestedChanges: changes },
      context,
    });
    const results: RelationshipMutationResultItem[] = [];
    const invalidation: RelationshipInvalidation =
      emptyRelationshipInvalidation();

    for (const plan of plans) {
      mergeRelationshipInvalidation(invalidation, {
        pageIds: [plan.sourcePageId, plan.targetPageId],
        databaseIds: [
          plan.bundle.version.sourceDatabaseId,
          plan.bundle.version.targetDatabaseId,
        ],
        relationshipTypeIds: [plan.bundle.type.id],
      });
      if (plan.change.kind === "add") {
        if (plan.bundle.version.forwardCardinality === "one") {
          const occupied = await liveLineagesForSlot(
            tx,
            plan.bundle.type.id,
            plan.sourcePageId,
          );
          if (
            occupied.some(
              (lineage) => lineage.targetPageId !== plan.targetPageId,
            )
          ) {
            relationshipError(
              "CARDINALITY_VIOLATION",
              "This max-one relationship already has a target; use replace with a fresh observation.",
              { statusCode: 409 },
            );
          }
        }
        const lineage = await getOrCreateLineage(
          tx,
          plan,
          actor.actor.displayName,
        );
        const eventId = nanoid(24);
        const activationId = nanoid(24);
        await appendRelationshipEvent(tx, revision, {
          tenant,
          eventId,
          kind: "relationship-added",
          relationshipTypeId: plan.bundle.type.id,
          relationshipTypeVersionId: plan.bundle.version.id,
          route: plan.change.route,
          targets: {
            lineageId: lineage.id,
            sourcePageId: lineage.sourcePageId,
            targetPageId: lineage.targetPageId,
          },
          diff: { addedActivationIds: [activationId] },
        });
        await tx.insert(schema.contentRelationshipActivations).values({
          id: activationId,
          ownerEmail: tenant.ownerEmail,
          orgId: tenant.orgId,
          spaceId: tenant.spaceId,
          lineageId: lineage.id,
          addedEventId: eventId,
          createdBy: actor.actor.displayName,
        });
        if (plan.bundle.version.forwardCardinality === "one") {
          await tx
            .update(schema.contentRelationshipCardinalitySlots)
            .set({
              lineageId: lineage.id,
              targetPageId: lineage.targetPageId,
              updatedAt: new Date().toISOString(),
            })
            .where(
              and(
                eq(
                  schema.contentRelationshipCardinalitySlots.relationshipTypeId,
                  plan.bundle.type.id,
                ),
                eq(
                  schema.contentRelationshipCardinalitySlots.sourcePageId,
                  plan.sourcePageId,
                ),
              ),
            );
        }
        results.push({
          kind: "add",
          edgeId: lineage.id,
          lineageId: lineage.id,
          state: "active",
          activationIds: [activationId],
        });
        continue;
      }

      if (plan.change.kind === "remove") {
        const observedIds = await validateObservation(tx, {
          token: plan.change.observationToken,
          kind: "edge",
          edgeId: plan.edgeId,
          typeId: plan.bundle.type.id,
          sourcePageId: plan.sourcePageId,
          activationIds: plan.change.observedActivationIds,
          context,
        });
        const eventId = nanoid(24);
        const retiredIds = await retireRelationshipActivations(tx, {
          activationIds: observedIds,
          eventId,
          tenant,
          actorEmail: actor.actor.displayName,
        });
        await appendRelationshipEvent(tx, revision, {
          tenant,
          eventId,
          kind: "relationship-removed",
          relationshipTypeId: plan.bundle.type.id,
          relationshipTypeVersionId: plan.bundle.version.id,
          route: plan.change.route,
          targets: {
            lineageId: plan.edgeId,
            sourcePageId: plan.sourcePageId,
            targetPageId: plan.targetPageId,
          },
          diff: { retiredActivationIds: retiredIds },
        });
        const remaining = await activeActivationIdsForLineages(tx, [
          plan.edgeId!,
        ]);
        if ((remaining.get(plan.edgeId!)?.length ?? 0) === 0) {
          await tx
            .update(schema.contentRelationshipCardinalitySlots)
            .set({
              lineageId: null,
              targetPageId: null,
              updatedAt: new Date().toISOString(),
            })
            .where(
              and(
                eq(
                  schema.contentRelationshipCardinalitySlots.relationshipTypeId,
                  plan.bundle.type.id,
                ),
                eq(
                  schema.contentRelationshipCardinalitySlots.sourcePageId,
                  plan.sourcePageId,
                ),
                eq(
                  schema.contentRelationshipCardinalitySlots.lineageId,
                  plan.edgeId!,
                ),
              ),
            );
        }
        results.push({
          kind: "remove",
          edgeId: plan.edgeId!,
          lineageId: plan.edgeId!,
          state:
            (remaining.get(plan.edgeId!)?.length ?? 0) > 0
              ? "active"
              : "inactive",
          activationIds: retiredIds,
        });
        continue;
      }

      if (plan.bundle.version.forwardCardinality !== "one") {
        relationshipError(
          "UNSUPPORTED_CONFIGURATION",
          "Replace is supported only for max-one relationships.",
        );
      }
      await validateObservation(tx, {
        token: plan.change.observedSlotToken,
        kind: "slot",
        typeId: plan.bundle.type.id,
        sourcePageId: plan.sourcePageId,
        context,
      });
      const occupied = await liveLineagesForSlot(
        tx,
        plan.bundle.type.id,
        plan.sourcePageId,
      );
      const displaced = occupied.filter(
        (lineage) => lineage.targetPageId !== plan.targetPageId,
      );
      for (const lineage of displaced) {
        try {
          await authorizeRelationshipRoute({
            db: tx,
            bundle: plan.bundle,
            sourcePageId: lineage.sourcePageId,
            targetPageId: lineage.targetPageId,
            route: plan.change.route,
            operation: "remove",
            context,
          });
        } catch {
          relationshipError(
            "ROUTE_NOT_AUTHORIZED",
            "The max-one relationship cannot be replaced through this route.",
            { statusCode: 403 },
          );
        }
      }
      const eventId = nanoid(24);
      const displacedActivationIds = (
        await Promise.all(
          displaced.map(async (lineage) => {
            const current = await activeActivationIdsForLineages(tx, [
              lineage.id,
            ]);
            return retireRelationshipActivations(tx, {
              activationIds: current.get(lineage.id) ?? [],
              eventId,
              tenant,
              actorEmail: actor.actor.displayName,
            });
          }),
        )
      ).flat();
      const lineage = await getOrCreateLineage(
        tx,
        plan,
        actor.actor.displayName,
      );
      const activationId = nanoid(24);
      await appendRelationshipEvent(tx, revision, {
        tenant,
        eventId,
        kind: "relationship-replaced",
        relationshipTypeId: plan.bundle.type.id,
        relationshipTypeVersionId: plan.bundle.version.id,
        route: plan.change.route,
        targets: {
          lineageId: lineage.id,
          sourcePageId: lineage.sourcePageId,
          targetPageId: lineage.targetPageId,
          displacedLineageIds: displaced.map((entry) => entry.id),
        },
        diff: {
          addedActivationIds: [activationId],
          retiredActivationIds: displacedActivationIds,
        },
      });
      await tx.insert(schema.contentRelationshipActivations).values({
        id: activationId,
        ownerEmail: tenant.ownerEmail,
        orgId: tenant.orgId,
        spaceId: tenant.spaceId,
        lineageId: lineage.id,
        addedEventId: eventId,
        createdBy: actor.actor.displayName,
      });
      await tx
        .update(schema.contentRelationshipCardinalitySlots)
        .set({
          lineageId: lineage.id,
          targetPageId: lineage.targetPageId,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(
              schema.contentRelationshipCardinalitySlots.relationshipTypeId,
              plan.bundle.type.id,
            ),
            eq(
              schema.contentRelationshipCardinalitySlots.sourcePageId,
              plan.sourcePageId,
            ),
          ),
        );
      results.push({
        kind: "replace",
        edgeId: lineage.id,
        lineageId: lineage.id,
        state: "active",
        activationIds: [activationId],
        displacedEdgeIds: displaced.map((entry) => entry.id),
      });
    }

    await tx
      .update(schema.contentRelationshipRevisions)
      .set({
        diffJson: JSON.stringify({ requestedChanges: changes, results }),
      })
      .where(eq(schema.contentRelationshipRevisions.id, revision.revisionId));
    const receiptId = nanoid(24);
    const result: MutateContentRelationshipsResult = {
      operationId: input.operationId,
      receiptId,
      revisionId: revision.revisionId,
      eventIds: revision.eventIds,
      results,
      invalidation,
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
    "Atomically add, remove, or replace canonical typed relationships using explicit authorized routes and observations.",
  mcpTool: true,
  schema: mutateContentRelationshipsInputSchema,
  run: mutateContentRelationships,
});
