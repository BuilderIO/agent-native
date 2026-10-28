import { fail } from "@agent-native/core/action";
import { eq, inArray } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";

type ScopeResource = {
  ownerEmail: string;
  spaceId: string | null;
};

function invalidScope(): never {
  fail("Purge plan or scope token is invalid", {
    errorCode: "invalid_scope",
    statusCode: 404,
  });
}

export async function resolveTrashPurgeProvenance(
  resources: ReadonlyArray<ScopeResource>,
): Promise<{ orgId: string | null; spaceId: string | null }> {
  const spaceIds = [...new Set(resources.map((item) => item.spaceId))];
  if (spaceIds.some((spaceId) => !spaceId)) invalidScope();
  const spaces = await getDb()
    .select()
    .from(schema.contentSpaces)
    .where(inArray(schema.contentSpaces.id, spaceIds as string[]));
  if (spaces.length !== spaceIds.length) invalidScope();

  const spaceById = new Map(spaces.map((space) => [space.id, space]));
  const provenance = new Set<string>();
  for (const resource of resources) {
    const space = spaceById.get(resource.spaceId!);
    if (!space || space.archivedAt) invalidScope();
    if (
      !space.orgId &&
      space.ownerEmail.toLowerCase() !== resource.ownerEmail.toLowerCase()
    ) {
      invalidScope();
    }
    provenance.add(
      space.orgId
        ? `org:${space.orgId}`
        : `personal:${space.ownerEmail.toLowerCase()}`,
    );
  }
  if (provenance.size !== 1) invalidScope();

  for (const spaceId of spaceIds as string[]) {
    try {
      await resolveContentSpaceAccess(spaceId, "editor");
    } catch {
      invalidScope();
    }
  }
  return {
    orgId: spaces[0]!.orgId,
    spaceId: spaces.length === 1 ? spaces[0]!.id : null,
  };
}

export async function assertTrashPurgePlanAuthority(planId: string) {
  const db = getDb();
  const [plan] = await db
    .select()
    .from(schema.contentTrashPurgePlans)
    .where(eq(schema.contentTrashPurgePlans.id, planId))
    .limit(1);
  if (!plan) invalidScope();
  const resources = await db
    .select({
      ownerEmail: schema.contentTrashPurgePlanItems.ownerEmail,
      spaceId: schema.contentTrashPurgePlanItems.spaceId,
    })
    .from(schema.contentTrashPurgePlanItems)
    .where(eq(schema.contentTrashPurgePlanItems.planId, planId));
  const provenance = await resolveTrashPurgeProvenance(resources);
  if (provenance.orgId !== plan.orgId) invalidScope();
  return plan;
}
