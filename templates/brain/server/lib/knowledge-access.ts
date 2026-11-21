import { isActionContractError } from "@agent-native/core/action";
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
import { and, eq, inArray } from "drizzle-orm";

import { isGoogleSourceProvider } from "../../shared/google-source-config.js";
import { getDb, schema } from "../db/index.js";
import {
  checkKnowledgeProvenance,
  evidenceCaptureIds,
} from "./knowledge-provenance.js";

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
    if (!row.intelligenceKind) {
      try {
        const sourceIds = new Set<string>();
        const captureIds = new Set(row.captureId ? [row.captureId] : []);
        const cited = evidenceCaptureIds(row.evidenceJson);
        if (!cited.readable) return null;
        for (const captureId of cited.captureIds) captureIds.add(captureId);
        if (!captureIds.size)
          return row.provenanceJson === null ? undefined : null;
        const {
          assertDerivedAudienceAccess,
          getAccessibleCapture,
          getAccessibleSource,
        } = await import("./brain.js");
        await assertDerivedAudienceAccess(row);
        const liveContent = new Map<string, string>();
        for (const captureId of captureIds) {
          const accessible = await getAccessibleCapture(captureId);
          if (!accessible) return null;
          liveContent.set(captureId, accessible.capture.content);
          sourceIds.add(accessible.capture.sourceId);
        }
        if (!(await checkKnowledgeProvenance(row, liveContent)).current)
          return null;
        if (row.sourceId) sourceIds.add(row.sourceId);
        for (const sourceId of sourceIds) await getAccessibleSource(sourceId);
        return undefined;
      } catch (error) {
        if (
          error instanceof ForbiddenError ||
          (isActionContractError(error) && error.statusCode === 403)
        )
          return null;
        throw error;
      }
    }
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
  if (change.kind === "visibility" && change.visibility === "private") return;
  if (!row.intelligenceKind) {
    const sourceIds = new Set(row.sourceId ? [row.sourceId] : []);
    const captureIds = new Set(row.captureId ? [row.captureId] : []);
    let evidence: unknown;
    try {
      evidence = JSON.parse(row.evidenceJson);
    } catch {
      throw new ForbiddenError(
        "Knowledge evidence is unavailable for sharing.",
      );
    }
    if (!Array.isArray(evidence))
      throw new ForbiddenError(
        "Knowledge evidence is unavailable for sharing.",
      );
    for (const entry of evidence) {
      if (!entry || typeof entry !== "object") continue;
      if (
        "sourceId" in entry &&
        typeof entry.sourceId === "string" &&
        entry.sourceId
      )
        sourceIds.add(entry.sourceId);
      if (
        "captureId" in entry &&
        typeof entry.captureId === "string" &&
        entry.captureId
      )
        captureIds.add(entry.captureId);
    }
    if (captureIds.size) {
      const { getAccessibleCapture } = await import("./brain.js");
      for (const captureId of captureIds) {
        const accessible = await getAccessibleCapture(captureId);
        if (!accessible)
          throw new ForbiddenError(
            "Knowledge evidence is unavailable for sharing.",
          );
        sourceIds.add(accessible.capture.sourceId);
      }
    }
    if (!sourceIds.size) return;
    const sources = await getDb()
      .select({
        id: schema.brainSources.id,
        provider: schema.brainSources.provider,
      })
      .from(schema.brainSources)
      .where(
        and(
          inArray(schema.brainSources.id, Array.from(sourceIds)),
          accessFilter(
            schema.brainSources,
            schema.brainSourceShares,
            currentAccess(),
          ),
        ),
      );
    if (sources.some((source) => isGoogleSourceProvider(source.provider))) {
      throw new ForbiddenError(
        "Knowledge from personal connected sources cannot be shared beyond its source audiences.",
      );
    }
    if (sources.length !== sourceIds.size)
      throw new ForbiddenError(
        "Knowledge evidence is unavailable for sharing.",
      );
    return;
  }
  throw new ForbiddenError(
    "Evidence-backed intelligence cannot be shared beyond its source audiences.",
  );
};
