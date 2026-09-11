import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, gte, inArray, ne, or } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { nanoid, nowIso } from "./brain.js";
import type { BrainAudienceAssignment } from "./search-index-contracts.js";

export const SLACK_PRIVATE_AUDIENCE_TTL_MS = 15 * 60 * 1000;

export function isAudienceMembershipFresh(
  kind: BrainAudienceAssignment["kind"],
  lastSyncedAt: string,
  nowMs = Date.now(),
) {
  return (
    kind !== "slack-private-channel" ||
    Date.parse(lastSyncedAt) >= nowMs - SLACK_PRIVATE_AUDIENCE_TTL_MS
  );
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function computeAudienceAclHash(
  kind: BrainAudienceAssignment["kind"],
  principals: string[],
) {
  const principalKey = Array.from(new Set(principals)).sort().join(",");
  return sha256(`${kind}:${principalKey}`);
}

export function audienceMembershipNeedsReplace(
  previousAclHash: string | undefined,
  nextAclHash: string,
) {
  return previousAclHash !== nextAclHash;
}

export async function computeCaptureAudienceId(input: {
  sourceId: string;
  kind: BrainAudienceAssignment["kind"];
  upstreamRefHash: string | null;
  aclHash: string;
}) {
  const partitionKey = input.upstreamRefHash ?? input.aclHash;
  const identityHash = await sha256(
    `${input.sourceId}:${input.kind}:${partitionKey}`,
  );
  return `aud_${identityHash.slice(0, 24)}`;
}

type BrainDb = ReturnType<typeof getDb>;

interface CaptureAudienceInput {
  captureId: string;
  source: typeof schema.brainSources.$inferSelect;
  kind?: BrainAudienceAssignment["kind"];
  memberEmails?: string[];
  upstreamRefHash?: string | null;
}

interface DeferredAudienceInvalidation {
  captureId: string;
  sourceId: string;
  previousAclHash: string;
  aclHash: string;
}

async function flushAudienceInvalidations(
  invalidations: DeferredAudienceInvalidation[],
) {
  if (!invalidations.length) return;
  const [{ enqueueCaptureInvalidation }, { invalidateDerivedForCapture }] =
    await Promise.all([import("./ingest-queue.js"), import("./brain.js")]);
  for (const invalidation of invalidations) {
    await invalidateDerivedForCapture(invalidation.captureId);
    await enqueueCaptureInvalidation({
      captureId: invalidation.captureId,
      sourceId: invalidation.sourceId,
      reason: "access-changed",
      previous: { aclHash: invalidation.previousAclHash },
      next: { aclHash: invalidation.aclHash },
    });
  }
}

export async function ensureCaptureAudience(
  input: CaptureAudienceInput,
): Promise<BrainAudienceAssignment> {
  const db = getDb();
  const invalidations: DeferredAudienceInvalidation[] = [];
  const assignment = await db.transaction((tx) =>
    ensureCaptureAudienceMutation(
      input,
      tx as unknown as BrainDb,
      invalidations,
    ),
  );
  await flushAudienceInvalidations(invalidations);
  return assignment;
}

async function ensureCaptureAudienceMutation(
  input: CaptureAudienceInput,
  db: BrainDb,
  invalidations: DeferredAudienceInvalidation[],
): Promise<BrainAudienceAssignment> {
  const now = nowIso();
  const kind =
    input.kind ??
    (input.source.visibility === "private" ? "restricted" : "org");
  let members = Array.from(
    new Set((input.memberEmails ?? []).map(normalizeEmail).filter(Boolean)),
  ).sort();
  if (input.source.visibility === "private" && kind !== "org") {
    members = [normalizeEmail(input.source.ownerEmail)];
  }
  const principalKey =
    kind === "org" ? `org:${input.source.orgId ?? "local"}` : members.join(",");
  const aclHash = await computeAudienceAclHash(kind, [principalKey]);
  const upstreamRefHash = input.upstreamRefHash
    ? await sha256(input.upstreamRefHash)
    : null;
  const audienceId = await computeCaptureAudienceId({
    sourceId: input.source.id,
    kind,
    upstreamRefHash,
    aclHash,
  });
  const [previousAudience] = await db
    .select({ aclHash: schema.brainAudiences.aclHash })
    .from(schema.brainAudiences)
    .where(eq(schema.brainAudiences.id, audienceId))
    .limit(1);

  await db
    .insert(schema.brainAudiences)
    .values({
      id: audienceId,
      sourceId: input.source.id,
      kind,
      upstreamRefHash,
      aclHash,
      membershipState: "current",
      lastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.brainAudiences.id,
      set: {
        sourceId: input.source.id,
        kind,
        upstreamRefHash,
        aclHash,
        membershipState: "current",
        lastSyncedAt: now,
        updatedAt: now,
      },
    });

  if (kind === "org" && input.source.orgId) {
    members.splice(0, members.length);
    await upsertAudienceMember(
      {
        audienceId,
        principalType: "org",
        principalId: input.source.orgId,
        syncedAt: now,
      },
      db,
    );
  } else if (kind === "org") {
    await upsertAudienceMember(
      {
        audienceId,
        principalType: "user",
        principalId: normalizeEmail(input.source.ownerEmail),
        syncedAt: now,
      },
      db,
    );
  } else if (
    audienceMembershipNeedsReplace(previousAudience?.aclHash, aclHash)
  ) {
    await replaceAudienceUserMembersMutation(
      audienceId,
      members.map((email) => ({ email })),
      { previousAclHash: previousAudience?.aclHash },
      db,
      invalidations,
    );
  }

  await db
    .delete(schema.brainCaptureAudiences)
    .where(eq(schema.brainCaptureAudiences.captureId, input.captureId));
  await db
    .insert(schema.brainCaptureAudiences)
    .values({
      id: nanoid(),
      captureId: input.captureId,
      audienceId,
      aclHash,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.brainCaptureAudiences.captureId,
        schema.brainCaptureAudiences.audienceId,
      ],
      set: { aclHash },
    });

  return { audienceId, aclHash, kind };
}

export async function upsertAudienceMember(
  input: {
    audienceId: string;
    principalType: "user" | "org";
    principalId: string;
    upstreamPrincipalHash?: string | null;
    syncedAt: string;
  },
  db = getDb(),
) {
  const now = nowIso();
  await db
    .insert(schema.brainAudienceMembers)
    .values({
      id: nanoid(),
      ...input,
      upstreamPrincipalHash: input.upstreamPrincipalHash ?? null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.brainAudienceMembers.audienceId,
        schema.brainAudienceMembers.principalType,
        schema.brainAudienceMembers.principalId,
      ],
      set: {
        upstreamPrincipalHash: input.upstreamPrincipalHash ?? null,
        status: "active",
        syncedAt: input.syncedAt,
        updatedAt: now,
      },
    });
}

export async function ensureEvidenceIntersectionAudience(input: {
  captureIds: string[];
  sourceId: string;
}): Promise<BrainAudienceAssignment> {
  const captureIds = Array.from(new Set(input.captureIds));
  if (!captureIds.length) {
    throw new Error("Evidence is required to derive a Brain audience");
  }
  const db = getDb();
  const assignments = await db
    .select({
      captureId: schema.brainCaptureAudiences.captureId,
      audienceId: schema.brainCaptureAudiences.audienceId,
      aclHash: schema.brainCaptureAudiences.aclHash,
      kind: schema.brainAudiences.kind,
      sourceId: schema.brainRawCaptures.sourceId,
      sourceOrgId: schema.brainSources.orgId,
      sourceOwnerEmail: schema.brainSources.ownerEmail,
    })
    .from(schema.brainCaptureAudiences)
    .innerJoin(
      schema.brainAudiences,
      eq(schema.brainAudiences.id, schema.brainCaptureAudiences.audienceId),
    )
    .innerJoin(
      schema.brainRawCaptures,
      eq(schema.brainRawCaptures.id, schema.brainCaptureAudiences.captureId),
    )
    .innerJoin(
      schema.brainSources,
      eq(schema.brainSources.id, schema.brainRawCaptures.sourceId),
    )
    .where(inArray(schema.brainCaptureAudiences.captureId, captureIds));
  if (
    new Set(assignments.map((assignment) => assignment.captureId)).size !==
    captureIds.length
  ) {
    throw new Error("Every evidence capture must have a current audience");
  }
  const tenantKey = assertSingleEvidenceTenant(assignments);
  const audienceIds = Array.from(
    new Set(assignments.map((assignment) => assignment.audienceId)),
  );
  if (audienceIds.length === 1) {
    const assignment = assignments[0]!;
    return {
      audienceId: assignment.audienceId,
      aclHash: assignment.aclHash,
      kind: assignment.kind as BrainAudienceAssignment["kind"],
    };
  }
  const members = await db
    .select({
      audienceId: schema.brainAudienceMembers.audienceId,
      principalType: schema.brainAudienceMembers.principalType,
      principalId: schema.brainAudienceMembers.principalId,
    })
    .from(schema.brainAudienceMembers)
    .where(
      and(
        inArray(schema.brainAudienceMembers.audienceId, audienceIds),
        eq(schema.brainAudienceMembers.status, "active"),
      ),
    );
  const nonOrgAudienceIds = assignments
    .filter((assignment) => assignment.kind !== "org")
    .map((assignment) => assignment.audienceId);
  const restrictedSets = Array.from(new Set(nonOrgAudienceIds)).map(
    (audienceId) =>
      new Set(
        members
          .filter(
            (member) =>
              member.audienceId === audienceId &&
              member.principalType === "user",
          )
          .map((member) => normalizeEmail(member.principalId)),
      ),
  );
  let principalType: "user" | "org";
  let principals: string[];
  let kind: BrainAudienceAssignment["kind"];
  if (restrictedSets.length) {
    principalType = "user";
    principals = [...restrictedSets[0]!].filter((principal) =>
      restrictedSets.every((set) => set.has(principal)),
    );
    kind = "restricted";
  } else {
    principalType = "org";
    principals = Array.from(
      new Set(
        members
          .filter((member) => member.principalType === "org")
          .map((member) => member.principalId),
      ),
    );
    if (principals.length > 1) principals = [];
    kind = "org";
  }
  if (!principals.length) {
    throw new Error("Evidence audiences have no common members");
  }
  const aclHash = await computeAudienceAclHash(kind, principals);
  const identityHash = await sha256(
    `evidence:${tenantKey}:${audienceIds.sort().join(",")}`,
  );
  const audienceId = `aud_${identityHash.slice(0, 24)}`;
  const now = nowIso();
  await db
    .insert(schema.brainAudiences)
    .values({
      id: audienceId,
      sourceId: input.sourceId,
      kind,
      upstreamRefHash: null,
      aclHash,
      membershipState: "current",
      lastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.brainAudiences.id,
      set: {
        aclHash,
        membershipState: "current",
        lastSyncedAt: now,
        updatedAt: now,
      },
    });
  await db
    .delete(schema.brainAudienceDependencies)
    .where(eq(schema.brainAudienceDependencies.audienceId, audienceId));
  for (const dependsOnAudienceId of audienceIds) {
    await db
      .insert(schema.brainAudienceDependencies)
      .values({
        id: nanoid(),
        audienceId,
        dependsOnAudienceId,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.brainAudienceDependencies.audienceId,
          schema.brainAudienceDependencies.dependsOnAudienceId,
        ],
        set: { dependsOnAudienceId },
      });
  }
  await db
    .delete(schema.brainAudienceSourceDependencies)
    .where(eq(schema.brainAudienceSourceDependencies.audienceId, audienceId));
  const evidenceSourceIds = Array.from(
    new Set(assignments.map((assignment) => assignment.sourceId)),
  );
  for (const sourceId of evidenceSourceIds) {
    await db
      .insert(schema.brainAudienceSourceDependencies)
      .values({ id: nanoid(), audienceId, sourceId, createdAt: now })
      .onConflictDoUpdate({
        target: [
          schema.brainAudienceSourceDependencies.audienceId,
          schema.brainAudienceSourceDependencies.sourceId,
        ],
        set: { sourceId },
      });
  }
  for (const principalId of principals) {
    await upsertAudienceMember({
      audienceId,
      principalType,
      principalId,
      syncedAt: now,
    });
  }
  return { audienceId, aclHash, kind };
}

export function assertSingleEvidenceTenant(
  assignments: Array<{
    sourceOrgId: string | null;
    sourceOwnerEmail: string;
  }>,
) {
  const tenantKeys = new Set(
    assignments.map((assignment) =>
      assignment.sourceOrgId
        ? `org:${assignment.sourceOrgId}`
        : `owner:${normalizeEmail(assignment.sourceOwnerEmail)}`,
    ),
  );
  if (tenantKeys.size !== 1) {
    throw new Error("Evidence audiences must belong to the same tenant");
  }
  return Array.from(tenantKeys)[0]!;
}

export async function replaceAudienceUserMembers(
  audienceId: string,
  members: Array<{ email: string; upstreamPrincipalHash?: string }>,
  options: { previousAclHash?: string } = {},
) {
  const db = getDb();
  const invalidations: DeferredAudienceInvalidation[] = [];
  const result = await db.transaction((tx) =>
    replaceAudienceUserMembersMutation(
      audienceId,
      members,
      options,
      tx as unknown as BrainDb,
      invalidations,
    ),
  );
  await flushAudienceInvalidations(invalidations);
  return result;
}

async function replaceAudienceUserMembersMutation(
  audienceId: string,
  members: Array<{ email: string; upstreamPrincipalHash?: string }>,
  options: { previousAclHash?: string },
  db: BrainDb,
  invalidations: DeferredAudienceInvalidation[],
) {
  const now = nowIso();
  const emails = Array.from(
    new Set(members.map((member) => normalizeEmail(member.email))),
  ).sort();
  const [audience] = await db
    .select({
      kind: schema.brainAudiences.kind,
      aclHash: schema.brainAudiences.aclHash,
      sourceId: schema.brainAudiences.sourceId,
    })
    .from(schema.brainAudiences)
    .where(eq(schema.brainAudiences.id, audienceId))
    .limit(1);
  if (!audience) throw new Error(`Audience not found: ${audienceId}`);
  await db
    .update(schema.brainAudienceMembers)
    .set({ status: "revoked", updatedAt: now })
    .where(
      and(
        eq(schema.brainAudienceMembers.audienceId, audienceId),
        eq(schema.brainAudienceMembers.principalType, "user"),
      ),
    );
  for (const email of emails) {
    const member = members.find(
      (candidate) => normalizeEmail(candidate.email) === email,
    );
    await upsertAudienceMember(
      {
        audienceId,
        principalType: "user",
        principalId: email,
        upstreamPrincipalHash: member?.upstreamPrincipalHash,
        syncedAt: now,
      },
      db,
    );
  }
  const aclHash = await computeAudienceAclHash(
    audience.kind as BrainAudienceAssignment["kind"],
    emails,
  );
  await db
    .update(schema.brainAudiences)
    .set({
      aclHash,
      membershipState: "current",
      lastSyncedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.brainAudiences.id, audienceId));
  const previousAclHash = options.previousAclHash ?? audience.aclHash;
  if (previousAclHash !== aclHash) {
    const captures = await db
      .select({ captureId: schema.brainCaptureAudiences.captureId })
      .from(schema.brainCaptureAudiences)
      .where(eq(schema.brainCaptureAudiences.audienceId, audienceId));
    const captureIds = captures.map((capture) => capture.captureId);
    await db
      .update(schema.brainCaptureAudiences)
      .set({ aclHash })
      .where(eq(schema.brainCaptureAudiences.audienceId, audienceId));
    if (captureIds.length) {
      await db
        .update(schema.brainRawCaptures)
        .set({ audienceAclHash: aclHash, updatedAt: now })
        .where(inArray(schema.brainRawCaptures.id, captureIds));
      for (const captureId of captureIds) {
        invalidations.push({
          captureId,
          sourceId: audience.sourceId,
          previousAclHash,
          aclHash,
        });
      }
    }
  }
  return { audienceId, aclHash, members: emails.length };
}

export async function listAccessibleAudienceIds(sourceIds?: string[]) {
  const userEmail = getRequestUserEmail()?.trim().toLowerCase();
  const orgId = getRequestOrgId();
  if (!userEmail && !orgId) return [];
  const principalFilter = or(
    userEmail
      ? and(
          eq(schema.brainAudienceMembers.principalType, "user"),
          eq(schema.brainAudienceMembers.principalId, userEmail),
        )
      : undefined,
    orgId
      ? and(
          eq(schema.brainAudienceMembers.principalType, "org"),
          eq(schema.brainAudienceMembers.principalId, orgId),
        )
      : undefined,
  );
  if (!principalFilter) return [];
  const slackFreshnessCutoff = new Date(
    Date.now() - SLACK_PRIVATE_AUDIENCE_TTL_MS,
  ).toISOString();
  const rows = await getDb()
    .selectDistinct({
      id: schema.brainAudiences.id,
      sourceId: schema.brainAudiences.sourceId,
    })
    .from(schema.brainAudiences)
    .innerJoin(
      schema.brainAudienceMembers,
      eq(schema.brainAudienceMembers.audienceId, schema.brainAudiences.id),
    )
    .where(
      and(
        eq(schema.brainAudiences.membershipState, "current"),
        or(
          ne(schema.brainAudiences.kind, "slack-private-channel"),
          gte(schema.brainAudiences.lastSyncedAt, slackFreshnessCutoff),
        ),
        eq(schema.brainAudienceMembers.status, "active"),
        principalFilter,
      ),
    );
  if (!rows.length) return [];
  const dependencies = await getDb()
    .select({
      audienceId: schema.brainAudienceDependencies.audienceId,
      dependsOnAudienceId: schema.brainAudienceDependencies.dependsOnAudienceId,
    })
    .from(schema.brainAudienceDependencies)
    .where(
      inArray(
        schema.brainAudienceDependencies.audienceId,
        rows.map((row) => row.id),
      ),
    );
  const sourceDependencies = await getDb()
    .select({
      audienceId: schema.brainAudienceSourceDependencies.audienceId,
      sourceId: schema.brainAudienceSourceDependencies.sourceId,
    })
    .from(schema.brainAudienceSourceDependencies)
    .where(
      inArray(
        schema.brainAudienceSourceDependencies.audienceId,
        rows.map((row) => row.id),
      ),
    );
  const dependencySourceIds = Array.from(
    new Set(sourceDependencies.map((dependency) => dependency.sourceId)),
  );
  const accessibleDependencySourceIds = dependencySourceIds.length
    ? (
        await getDb()
          .select({ id: schema.brainSources.id })
          .from(schema.brainSources)
          .where(
            and(
              inArray(schema.brainSources.id, dependencySourceIds),
              accessFilter(schema.brainSources, schema.brainSourceShares),
            ),
          )
      ).map((source) => source.id)
    : [];
  const accessibleIds = filterAudienceIdsByDependencies(
    rows.map((row) => row.id),
    dependencies,
    sourceDependencies,
    accessibleDependencySourceIds,
  );
  return rows
    .filter(
      (row) =>
        accessibleIds.has(row.id) &&
        (!sourceIds?.length || sourceIds.includes(row.sourceId)),
    )
    .map((row) => row.id);
}

export function filterAudienceIdsByDependencies(
  candidateIds: string[],
  dependencies: Array<{
    audienceId: string;
    dependsOnAudienceId: string;
  }>,
  sourceDependencies: Array<{ audienceId: string; sourceId: string }> = [],
  accessibleSourceIds: string[] = [],
) {
  const accessibleIds = new Set(candidateIds);
  const accessibleSources = new Set(accessibleSourceIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const dependency of dependencies) {
      if (
        accessibleIds.has(dependency.audienceId) &&
        !accessibleIds.has(dependency.dependsOnAudienceId)
      ) {
        accessibleIds.delete(dependency.audienceId);
        changed = true;
      }
    }
    for (const dependency of sourceDependencies) {
      if (
        accessibleIds.has(dependency.audienceId) &&
        !accessibleSources.has(dependency.sourceId)
      ) {
        accessibleIds.delete(dependency.audienceId);
        changed = true;
      }
    }
  }
  return accessibleIds;
}
