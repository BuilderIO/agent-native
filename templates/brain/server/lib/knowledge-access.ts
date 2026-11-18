import {
  runWithRequestContext,
  type RequestContext,
} from "@agent-native/core/server/request-context";
import {
  accessFilter,
  currentAccess,
  ForbiddenError,
  type AccessContext,
  type ShareableResourceRegistration,
} from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

function knowledgeId(resource: unknown) {
  if (!resource || typeof resource !== "object" || !("id" in resource))
    return null;
  return typeof resource.id === "string" ? resource.id : null;
}

function targetRequestContext(ctx: AccessContext): RequestContext {
  return {
    ...(ctx.userEmail ? { userEmail: ctx.userEmail } : {}),
    ...(ctx.orgId ? { orgId: ctx.orgId } : { orgScope: "personal" }),
    ...(ctx.authCapability ? { authCapability: ctx.authCapability } : {}),
    ...(ctx.federationMembershipValidated === undefined
      ? {}
      : { federationMembershipValidated: ctx.federationMembershipValidated }),
    a2aIdentityAssurance: "org-member",
  };
}

async function scopedKnowledge(id: string, ctx: AccessContext) {
  const rows = await getDb()
    .select()
    .from(schema.brainKnowledge)
    .where(
      and(
        eq(schema.brainKnowledge.id, id),
        accessFilter(schema.brainKnowledge, schema.brainKnowledgeShares, ctx),
      ),
    )
    .limit(1);
  return rows.find((row) => row.id === id);
}

export async function resolveKnowledgeEvidenceAccess(
  resource: unknown,
  ctx: AccessContext,
): Promise<null | undefined> {
  const id = knowledgeId(resource);
  if (!id) return null;
  return runWithRequestContext(targetRequestContext(ctx), async () => {
    const row = await scopedKnowledge(id, ctx);
    if (!row) return null;
    if (!row.intelligenceKind) return undefined;
    if (!ctx.userEmail || !row.audienceId) return null;
    const [{ listAccessibleAudienceIds }, { filterCurrentKnowledgeRows }] =
      await Promise.all([
        import("./audiences.js"),
        import("./intelligence.js"),
      ]);
    if (!(await listAccessibleAudienceIds()).includes(row.audienceId))
      return null;
    const current = await filterCurrentKnowledgeRows([row], {
      includeDeprecated: true,
    });
    return current.some((record) => record.id === id) ? undefined : null;
  });
}

export const assertKnowledgeSharingChange: NonNullable<
  ShareableResourceRegistration["assertSharingChange"]
> = async ({ resource, change }) => {
  const id = knowledgeId(resource);
  const row = id ? await scopedKnowledge(id, currentAccess()) : undefined;
  if (!row) throw new ForbiddenError("Knowledge is unavailable.");
  if (!row.intelligenceKind) return;
  if (change.kind === "visibility" && change.visibility === "private") return;
  throw new ForbiddenError(
    "Evidence-backed intelligence cannot be shared beyond its source audiences.",
  );
};
