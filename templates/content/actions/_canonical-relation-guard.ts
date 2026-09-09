import { ActionContractError } from "@agent-native/core/action";
import { eq, inArray, or } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { parsePropertyOptions } from "../shared/properties.js";

type PropertyDefinitionWithOptions = {
  optionsJson?: string | null;
};

export function isCanonicalRelationProjection(
  definition: PropertyDefinitionWithOptions,
) {
  return Boolean(
    parsePropertyOptions(definition.optionsJson).relation?.relationshipTypeId,
  );
}

export function assertNotCanonicalRelationProjection(
  definition: PropertyDefinitionWithOptions,
  message = "Use mutate-content-relationships for canonical relationship values.",
) {
  if (!isCanonicalRelationProjection(definition)) return;
  throw new ActionContractError(message, {
    errorCode: "USE_RELATIONSHIP_MUTATION",
  });
}

export async function assertNotCanonicalRelationDefinition(
  db: ReturnType<typeof getDb>,
  definition: PropertyDefinitionWithOptions & { id: string },
) {
  assertNotCanonicalRelationProjection(definition);
  const [projection] = await db
    .select({ id: schema.contentRelationshipProjections.id })
    .from(schema.contentRelationshipProjections)
    .where(eq(schema.contentRelationshipProjections.propertyId, definition.id));
  if (projection) {
    throw new ActionContractError(
      "The Relation Property metadata is inconsistent; use the relationship configuration Actions.",
      {
        errorCode: "UNAVAILABLE",
        statusCode: 503,
      },
    );
  }
}

export async function assertRowsHaveNoCanonicalRelationships(
  db: ReturnType<typeof getDb>,
  pageIds: string[],
) {
  if (!pageIds.length) return;
  const lineages = await db
    .select({ id: schema.contentRelationshipLineages.id })
    .from(schema.contentRelationshipLineages)
    .where(
      or(
        inArray(schema.contentRelationshipLineages.sourcePageId, pageIds),
        inArray(schema.contentRelationshipLineages.targetPageId, pageIds),
      ),
    );
  if (!lineages.length) return;
  const { activeActivationIdsForLineages } =
    await import("./_relationship-core.js");
  const active = await activeActivationIdsForLineages(
    db,
    lineages.map((lineage) => lineage.id),
  );
  if ([...active.values()].some((ids) => ids.length > 0)) {
    throw new ActionContractError(
      "These Pages cannot be duplicated with the current access and configuration.",
      {
        errorCode: "UNSUPPORTED_CONFIGURATION",
      },
    );
  }
}
