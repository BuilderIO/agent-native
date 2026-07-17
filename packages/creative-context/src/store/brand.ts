import { getDbExec } from "@agent-native/core/db";
import {
  resourcePut,
  sharedResourceOwner,
} from "@agent-native/core/resources/store";
import {
  accessFilter,
  assertAccess,
  resolveAccess,
} from "@agent-native/core/sharing";
import { and, desc, eq, inArray, ne } from "drizzle-orm";

import { compilePublishedBrandContext } from "../server/brand-context.js";
import { getCreativeContext } from "../server/context.js";
import type {
  BrandDnaPayload,
  BrandDnaVersion,
  BrandProfile,
} from "../types.js";
import {
  newId,
  nowIso,
  parseJson,
  requireActor,
  sha256,
  stringifyJson,
} from "./helpers.js";

function mapProfile(row: any): BrandProfile {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    currentDnaVersionId: row.currentDnaVersionId ?? null,
    visibility: row.visibility,
    orgId: row.orgId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadDnaVersion(
  dnaVersionId: string | null | undefined,
): Promise<BrandDnaVersion | null> {
  if (!dnaVersionId) return null;
  const { getDb, schema } = getCreativeContext();
  const rows = await getDb()
    .select()
    .from(schema.brandDnaVersions)
    .where(eq(schema.brandDnaVersions.id, dnaVersionId))
    .limit(1);
  if (!rows[0]) return null;
  const evidence = await getDb()
    .select({
      itemId: schema.brandDnaEvidence.itemId,
      itemVersionId: schema.brandDnaEvidence.itemVersionId,
    })
    .from(schema.brandDnaEvidence)
    .where(eq(schema.brandDnaEvidence.dnaVersionId, dnaVersionId));
  return {
    id: rows[0].id,
    profileId: rows[0].profileId,
    versionNumber: rows[0].versionNumber,
    payload: parseJson(rows[0].payload, { summary: "" }),
    contentHash: rows[0].contentHash,
    status: rows[0].status,
    evidence,
    createdAt: rows[0].createdAt,
  };
}

async function resolveEvidenceItems(
  evidenceItemIds: string[] | undefined,
): Promise<Array<{ id: string; currentVersionId: string }>> {
  const evidenceIds = Array.from(new Set(evidenceItemIds ?? []));
  if (!evidenceIds.length) return [];
  const { getDb, schema } = getCreativeContext();
  const accessibleItems = await getDb()
    .select({
      id: schema.contextItems.id,
      currentVersionId: schema.contextItems.currentVersionId,
    })
    .from(schema.contextItems)
    .innerJoin(
      schema.contextSources,
      eq(schema.contextSources.id, schema.contextItems.sourceId),
    )
    .where(
      and(
        inArray(schema.contextItems.id, evidenceIds),
        accessFilter(schema.contextSources, schema.contextSourceShares),
        ne(schema.contextSources.upstreamAccess, "restricted"),
        ne(schema.contextSources.status, "archived"),
        eq(schema.contextItems.curationStatus, "included"),
        ne(schema.contextItems.curationRank, "ignored"),
        eq(schema.contextItems.status, "active"),
      ),
    );
  if (accessibleItems.length !== evidenceIds.length) {
    throw new Error("All brand DNA evidence items must be accessible");
  }
  return accessibleItems;
}

async function nextDnaVersionNumber(profileId: string): Promise<number> {
  const { getDb, schema } = getCreativeContext();
  const rows = await getDb()
    .select({ versionNumber: schema.brandDnaVersions.versionNumber })
    .from(schema.brandDnaVersions)
    .where(eq(schema.brandDnaVersions.profileId, profileId))
    .orderBy(desc(schema.brandDnaVersions.versionNumber))
    .limit(1);
  return Number(rows[0]?.versionNumber ?? 0) + 1;
}

export async function getBrandProfile(input: { profileId?: string }): Promise<{
  profile: BrandProfile | null;
  dna: BrandDnaVersion | null;
  versions: BrandDnaVersion[];
}> {
  const { getDb, schema } = getCreativeContext();
  let row: any | undefined;
  if (input.profileId) {
    row = (await resolveAccess("creative-context-brand", input.profileId))
      ?.resource;
  } else {
    const rows = await getDb()
      .select()
      .from(schema.brandProfiles)
      .where(accessFilter(schema.brandProfiles, schema.brandProfileShares))
      .orderBy(desc(schema.brandProfiles.updatedAt))
      .limit(1);
    row = rows[0];
  }
  if (!row) return { profile: null, dna: null, versions: [] };
  const versionRows = await getDb()
    .select({ id: schema.brandDnaVersions.id })
    .from(schema.brandDnaVersions)
    .where(eq(schema.brandDnaVersions.profileId, row.id))
    .orderBy(desc(schema.brandDnaVersions.versionNumber))
    .limit(20);
  const versions = (
    await Promise.all(
      versionRows.map((version: { id: string }) => loadDnaVersion(version.id)),
    )
  ).filter((version): version is BrandDnaVersion => Boolean(version));
  return {
    profile: mapProfile(row),
    dna: await loadDnaVersion(row.currentDnaVersionId),
    versions,
  };
}

export async function getPublishedBrandDna(
  profileId: string,
): Promise<BrandDnaVersion | null> {
  const { profile, dna } = await getBrandProfile({ profileId });
  return profile && dna?.status === "published" ? dna : null;
}

async function projectPublishedBrandContext(
  profile: BrandProfile,
  dna: BrandDnaVersion,
): Promise<void> {
  const actor = requireActor();
  const payload = dna.payload;
  const visual =
    payload.visual && typeof payload.visual === "object" ? payload.visual : {};
  const voice =
    payload.voice && typeof payload.voice === "object" ? payload.voice : {};
  const content = compilePublishedBrandContext({
    profileId: profile.id,
    dnaVersionId: dna.id,
    colors: visual.colors ?? payload.colors,
    fonts: visual.fonts ?? payload.fonts,
    numericScales: visual.numericScales ?? payload.numericScales,
    voiceDescriptors: voice.descriptors ?? payload.voiceDescriptors,
    layoutPatterns: visual.layoutPatterns ?? payload.layoutPatterns,
    logos: visual.logos ?? payload.logos,
    terminology: payload.terminology,
    exclusions: payload.constraints ?? payload.exclusions,
    inventory: payload.inventory,
  });
  const resourceOwner =
    profile.visibility === "org" && profile.orgId
      ? sharedResourceOwner(profile.orgId)
      : actor.ownerEmail;
  await resourcePut(
    resourceOwner,
    "context/brand-context.md",
    content,
    "text/markdown",
    {
      createdBy: "user",
      visibility: "workspace",
      metadata: {
        source: "creative-context",
        profileId: profile.id,
        dnaVersionId: dna.id,
      },
    },
  );
}

async function currentActorIsOrgAdmin(
  orgId: string,
  ownerEmail: string,
): Promise<boolean> {
  try {
    const result = await getDbExec().execute({
      sql: "SELECT role FROM org_members WHERE org_id = ? AND LOWER(email) = ? LIMIT 1",
      args: [orgId, ownerEmail.toLowerCase()],
    });
    const role = String(result.rows[0]?.role ?? "").toLowerCase();
    return role === "owner" || role === "admin";
  } catch {
    return false;
  }
}

export async function previewBrandProfilePromotion(profileId: string) {
  const access = await assertAccess(
    "creative-context-brand",
    profileId,
    "admin",
  );
  const actor = requireActor();
  if (
    !actor.orgId ||
    !(await currentActorIsOrgAdmin(actor.orgId, actor.ownerEmail))
  ) {
    throw new Error(
      "Brand profile promotion requires an active organization owner or admin.",
    );
  }
  const profile = mapProfile(access.resource);
  const dna = await loadDnaVersion(profile.currentDnaVersionId);
  if (!dna || dna.status !== "published") {
    throw new Error(
      "Publish a reviewed brand DNA version before promoting its profile.",
    );
  }
  return {
    profileId: profile.id,
    profileName: profile.name,
    dnaVersionId: dna.id,
    targetOrgId: actor.orgId,
  };
}

export async function promoteBrandProfileToOrg(
  profileId: string,
  confirmation: {
    profileName: string;
    dnaVersionId: string;
    targetOrgId: string;
  },
): Promise<{ profile: BrandProfile; dna: BrandDnaVersion }> {
  const preview = await previewBrandProfilePromotion(profileId);
  if (
    preview.profileName !== confirmation.profileName ||
    preview.dnaVersionId !== confirmation.dnaVersionId ||
    preview.targetOrgId !== confirmation.targetOrgId
  ) {
    throw new Error(
      "Brand profile changed after promotion preview; review and confirm it again.",
    );
  }
  const actor = requireActor();
  const { getDb, schema } = getCreativeContext();
  const timestamp = nowIso();
  await getDb().transaction(async (tx: any) => {
    await tx
      .update(schema.brandProfiles)
      .set({
        orgId: preview.targetOrgId,
        visibility: "org",
        updatedAt: timestamp,
      })
      .where(eq(schema.brandProfiles.id, profileId));
    await tx.insert(schema.brandProfileAudit).values({
      id: newId("ccba"),
      profileId,
      operation: "promote-to-org",
      actorEmail: actor.ownerEmail,
      details: stringifyJson(preview),
      ownerEmail: actor.ownerEmail,
      orgId: actor.orgId,
      createdAt: timestamp,
    });
  });
  const promoted = await getBrandProfile({ profileId });
  if (!promoted.profile || !promoted.dna) {
    throw new Error("Brand profile was not accessible after promotion.");
  }
  await projectPublishedBrandContext(promoted.profile, promoted.dna);
  return { profile: promoted.profile, dna: promoted.dna };
}

export async function findBrandProfileIdForInferenceSource(
  sourceId: string,
): Promise<string | null> {
  const { getDb, schema } = getCreativeContext();
  const rows = await getDb()
    .select({
      profileId: schema.brandProfiles.id,
      payload: schema.brandDnaVersions.payload,
    })
    .from(schema.brandDnaVersions)
    .innerJoin(
      schema.brandProfiles,
      eq(schema.brandProfiles.id, schema.brandDnaVersions.profileId),
    )
    .where(accessFilter(schema.brandProfiles, schema.brandProfileShares))
    .orderBy(desc(schema.brandDnaVersions.createdAt))
    .limit(100);
  for (const row of rows) {
    const payload = parseJson<Record<string, unknown>>(row.payload, {});
    const inference =
      payload.inference && typeof payload.inference === "object"
        ? (payload.inference as Record<string, unknown>)
        : null;
    if (inference?.sourceId === sourceId) return row.profileId;
  }
  return null;
}

export async function publishBrandDna(input: {
  profileId: string;
  proposalVersionId: string;
  confirmation: {
    proposalVersionId: string;
    contentHash: string;
  };
}): Promise<{ profile: BrandProfile; dna: BrandDnaVersion }> {
  const { getDb, schema } = getCreativeContext();
  const timestamp = nowIso();
  await assertAccess("creative-context-brand", input.profileId, "editor");
  const proposal = await loadDnaVersion(input.proposalVersionId);
  if (!proposal || proposal.status !== "proposed") {
    throw new Error(
      "Published brand DNA must be an accessible proposed version",
    );
  }
  if (proposal.profileId !== input.profileId) {
    throw new Error("Published proposal must belong to the selected profile");
  }
  if (
    input.confirmation.proposalVersionId !== proposal.id ||
    input.confirmation.contentHash !== proposal.contentHash
  ) {
    throw new Error(
      "Brand DNA changed after review; review and confirm the proposal again",
    );
  }
  await getDb().transaction(async (tx: any) => {
    await tx
      .update(schema.brandProfiles)
      .set({ currentDnaVersionId: proposal.id, updatedAt: timestamp })
      .where(eq(schema.brandProfiles.id, input.profileId));
    await tx
      .update(schema.brandDnaVersions)
      .set({ status: "published" })
      .where(eq(schema.brandDnaVersions.id, proposal.id));
  });
  const published = await getBrandProfile({ profileId: input.profileId });
  if (!published.profile || !published.dna) {
    throw new Error("Failed to publish brand DNA");
  }
  await projectPublishedBrandContext(published.profile, published.dna);
  return { profile: published.profile, dna: published.dna };
}

export async function saveBrandDnaCandidate(input: {
  profileId?: string;
  name?: string;
  description?: string | null;
  dna: BrandDnaPayload;
  evidenceItemIds?: string[];
  status: "draft" | "proposed";
}): Promise<{ profile: BrandProfile; dna: BrandDnaVersion }> {
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const timestamp = nowIso();
  let profileId = input.profileId;
  let existingProfile: BrandProfile | null = null;
  if (profileId) {
    const access = await assertAccess(
      "creative-context-brand",
      profileId,
      "editor",
    );
    existingProfile = mapProfile(access.resource);
  } else {
    if (!input.name?.trim()) {
      throw new Error("name is required when saving a new brand profile");
    }
    profileId = newId("ccb");
  }
  const accessibleItems = await resolveEvidenceItems(input.evidenceItemIds);
  const dnaVersionId = newId("ccbd");
  const payloadJson = stringifyJson(input.dna);
  const contentHash = await sha256(payloadJson);
  const versionNumber = await nextDnaVersionNumber(profileId);
  await getDb().transaction(async (tx: any) => {
    if (!input.profileId) {
      await tx.insert(schema.brandProfiles).values({
        id: profileId,
        name: input.name!.trim(),
        description: input.description ?? null,
        currentDnaVersionId: null,
        ownerEmail: actor.ownerEmail,
        orgId: actor.orgId,
        visibility: "private",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    } else if (input.name !== undefined || input.description !== undefined) {
      await tx
        .update(schema.brandProfiles)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          updatedAt: timestamp,
        })
        .where(eq(schema.brandProfiles.id, profileId));
    }
    await tx.insert(schema.brandDnaVersions).values({
      id: dnaVersionId,
      profileId,
      versionNumber,
      payload: payloadJson,
      contentHash,
      status: input.status,
      ownerEmail: actor.ownerEmail,
      orgId: actor.orgId,
      createdAt: timestamp,
    });
    if (accessibleItems.length) {
      await tx.insert(schema.brandDnaEvidence).values(
        accessibleItems.map((item) => ({
          id: newId("ccbe"),
          dnaVersionId,
          itemId: item.id,
          itemVersionId: item.currentVersionId,
          ownerEmail: actor.ownerEmail,
          orgId: actor.orgId,
          createdAt: timestamp,
        })),
      );
    }
  });
  const profile = existingProfile
    ? {
        ...existingProfile,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        updatedAt: timestamp,
      }
    : {
        id: profileId,
        name: input.name!,
        description: input.description ?? null,
        currentDnaVersionId: null,
        visibility: "private" as const,
        orgId: actor.orgId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
  const dna = await loadDnaVersion(dnaVersionId);
  if (!dna) throw new Error("Failed to save brand DNA candidate");
  return { profile, dna };
}
