import {
  defineAction,
  isActionContractError,
  type ActionRunContext,
} from "@agent-native/core/action";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  prepareContentRelationshipRemovalInputSchema,
  type PrepareContentRelationshipRemovalInput,
  type PrepareContentRelationshipRemovalResult,
  type RelationshipRouteRef,
  relationshipRouteRefSchema,
} from "../shared/relationships.js";
import { nanoid } from "./_property-utils.js";
import { authorizeRelationshipRoute } from "./_relationship-authority.js";
import {
  activeActivationIdsForLineages,
  loadRelationshipDatabase,
  loadRelationshipTypeBundle,
  relationshipActorContext,
  relationshipError,
} from "./_relationship-core.js";
import { availableRelationshipRoutes } from "./_relationship-read.js";

const REMOVAL_SELECTION_TTL_MS = 15 * 60 * 1_000;
const MAX_REMOVAL_SELECTION = 100;

export const relationshipRemovalSelectionEntrySchema = z
  .object({
    edgeId: z.string().min(1),
    typeId: z.string().min(1),
    typeVersionId: z.string().min(1),
    sourcePageId: z.string().min(1),
    targetPageId: z.string().min(1),
    observedActivationIds: z.array(z.string().min(1)).min(1).max(100),
    route: relationshipRouteRefSchema,
  })
  .strict();
export type RelationshipRemovalSelectionEntry = z.infer<
  typeof relationshipRemovalSelectionEntrySchema
>;

function projectionRoute(
  projection: typeof schema.contentRelationshipProjections.$inferSelect,
  sourcePageId: string,
  targetPageId: string,
): RelationshipRouteRef {
  return projection.direction === "inverse"
    ? {
        kind: "inverse-property",
        propertyId: projection.propertyId,
        targetPageId,
      }
    : {
        kind: "forward-property",
        propertyId: projection.propertyId,
        sourcePageId,
      };
}

async function prepareContentRelationshipRemoval(
  input: PrepareContentRelationshipRemovalInput,
  context?: ActionRunContext,
): Promise<PrepareContentRelationshipRemovalResult> {
  const db = getDb();
  let property:
    | typeof schema.contentRelationshipProjections.$inferSelect
    | null = null;
  let lineages: Array<typeof schema.contentRelationshipLineages.$inferSelect>;
  if (input.selection.kind === "property") {
    const [projection] = await db
      .select()
      .from(schema.contentRelationshipProjections)
      .where(
        and(
          eq(
            schema.contentRelationshipProjections.propertyId,
            input.selection.propertyId,
          ),
          isNull(schema.contentRelationshipProjections.archivedAt),
        ),
      );
    if (!projection) {
      relationshipError(
        "NOT_ACCESSIBLE",
        "The requested relation Property is not accessible.",
        { statusCode: 404 },
      );
    }
    await loadRelationshipDatabase(projection.databaseId, "admin", db, context);
    property = projection;
    const memberships = await db
      .select({ documentId: schema.contentDatabaseItems.documentId })
      .from(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.databaseId, projection.databaseId));
    const anchorIds = memberships.map((membership) => membership.documentId);
    lineages = anchorIds.length
      ? await db
          .select()
          .from(schema.contentRelationshipLineages)
          .where(
            and(
              eq(
                schema.contentRelationshipLineages.relationshipTypeId,
                projection.relationshipTypeId,
              ),
              projection.direction === "inverse"
                ? inArray(
                    schema.contentRelationshipLineages.targetPageId,
                    anchorIds,
                  )
                : inArray(
                    schema.contentRelationshipLineages.sourcePageId,
                    anchorIds,
                  ),
            ),
          )
      : [];
  } else {
    lineages = await db
      .select()
      .from(schema.contentRelationshipLineages)
      .where(
        inArray(schema.contentRelationshipLineages.id, input.selection.edgeIds),
      );
    if (lineages.length !== new Set(input.selection.edgeIds).size) {
      relationshipError(
        "NOT_ACCESSIBLE",
        "A requested relationship edge is not accessible.",
        { statusCode: 404 },
      );
    }
  }
  if (input.filter?.typeId) {
    lineages = lineages.filter(
      (lineage) => lineage.relationshipTypeId === input.filter!.typeId,
    );
  }
  if (input.filter?.oppositePageId) {
    lineages = lineages.filter(
      (lineage) =>
        lineage.sourcePageId === input.filter!.oppositePageId ||
        lineage.targetPageId === input.filter!.oppositePageId,
    );
  }
  if (input.filter?.direction && property) {
    const desiredDirection = input.filter.direction;
    lineages = lineages.filter(() =>
      desiredDirection === "both"
        ? true
        : property!.direction === "forward"
          ? desiredDirection === "outgoing"
          : desiredDirection === "incoming",
    );
  }
  const activeByLineage = await activeActivationIdsForLineages(
    db,
    lineages.map((lineage) => lineage.id),
  );
  const selected: RelationshipRemovalSelectionEntry[] = [];
  const selectedTenants = new Set<string>();
  for (const lineage of lineages.sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    const activationIds = activeByLineage.get(lineage.id) ?? [];
    if (activationIds.length === 0) continue;
    const bundle = await loadRelationshipTypeBundle(
      lineage.relationshipTypeId,
      {
        allowArchived: true,
        db,
      },
    );
    selectedTenants.add(
      `${bundle.type.spaceId}\u0000${bundle.type.orgId ?? ""}\u0000${bundle.type.ownerEmail.toLowerCase()}`,
    );
    let route: RelationshipRouteRef | undefined;
    if (property) {
      const candidate = projectionRoute(
        property,
        lineage.sourcePageId,
        lineage.targetPageId,
      );
      try {
        await authorizeRelationshipRoute({
          db,
          bundle,
          sourcePageId: lineage.sourcePageId,
          targetPageId: lineage.targetPageId,
          route: candidate,
          operation: "remove",
          context,
        });
        route = candidate;
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
        continue;
      }
    } else {
      route = (
        await availableRelationshipRoutes(db, {
          bundle,
          sourcePageId: lineage.sourcePageId,
          targetPageId: lineage.targetPageId,
          context,
        })
      )[0];
    }
    if (!route) continue;
    selected.push({
      edgeId: lineage.id,
      typeId: lineage.relationshipTypeId,
      typeVersionId: bundle.version.id,
      sourcePageId: lineage.sourcePageId,
      targetPageId: lineage.targetPageId,
      observedActivationIds: activationIds,
      route,
    });
  }
  if (
    input.selection.kind === "edges" &&
    selected.length !== new Set(input.selection.edgeIds).size
  ) {
    relationshipError(
      "NOT_ACCESSIBLE",
      "A requested relationship edge is not accessible.",
      { statusCode: 404 },
    );
  }
  if (selected.length > MAX_REMOVAL_SELECTION) {
    relationshipError(
      "LIMIT_EXCEEDED",
      `The removal selection exceeds ${MAX_REMOVAL_SELECTION} accessible relationships. Narrow the filter and try again.`,
    );
  }
  const firstBundle = selected[0]
    ? await loadRelationshipTypeBundle(selected[0].typeId, {
        allowArchived: true,
        db,
      })
    : property
      ? await loadRelationshipTypeBundle(property.relationshipTypeId, {
          allowArchived: true,
          db,
        })
      : null;
  if (!firstBundle) {
    relationshipError(
      "INVALID_TARGET",
      "An edge selection must contain at least one live accessible relationship.",
    );
  }
  if (selectedTenants.size > 1) {
    relationshipError(
      "INVALID_TARGET",
      "One removal selection cannot cross Content spaces.",
    );
  }
  const actor = relationshipActorContext(context);
  const selectionReceipt = nanoid(32);
  const recoveryToken = nanoid(32);
  const expiresAt = new Date(
    Date.now() + REMOVAL_SELECTION_TTL_MS,
  ).toISOString();
  await db.insert(schema.contentRelationshipRemovalSelections).values({
    token: selectionReceipt,
    ownerEmail: firstBundle.type.ownerEmail,
    orgId: firstBundle.type.orgId,
    spaceId: firstBundle.type.spaceId,
    callerScope: actor.callerScope,
    propertyId: property?.propertyId ?? null,
    selectionJson: JSON.stringify(selected),
    recoveryToken,
    expiresAt,
  });
  return {
    selectionReceipt,
    selectedCount: selected.length,
    edges: selected.map((entry) => ({
      edgeId: entry.edgeId,
      observedActivationIds: entry.observedActivationIds,
    })),
    expiresAt,
    recoveryToken,
  };
}

export default defineAction({
  description:
    "Freeze an exact caller-accessible relationship activation selection before a destructive relation Property removal.",
  mcpTool: true,
  schema: prepareContentRelationshipRemovalInputSchema,
  run: prepareContentRelationshipRemoval,
});
