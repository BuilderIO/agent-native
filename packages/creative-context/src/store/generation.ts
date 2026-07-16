import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";

import { getCreativeContext } from "../server/context.js";
import {
  assertGenerationArtifactAccessProof,
  type GenerationArtifactAccessProof,
} from "../server/generation-artifact-access.js";
import type {
  CreativeContextGenerationRecord,
  CreativeContextElementProvenance,
  CreativeContextReuseLabel,
} from "../types.js";
import {
  newId,
  nowIso,
  parseJson,
  requireActor,
  stringifyJson,
} from "./helpers.js";

export function assertGenerationCreativeContextInvariants(input: {
  contextMode: "off" | "auto" | "pinned";
  contextPackId: string | null;
  reuseLabels: readonly CreativeContextReuseLabel[];
  elementProvenance: readonly CreativeContextElementProvenance[];
}): void {
  if (input.contextMode === "off" && input.contextPackId) {
    throw new Error("Creative context off records cannot reference a pack");
  }
  if (input.contextMode === "pinned" && !input.contextPackId) {
    throw new Error("Pinned creative context records require a context pack");
  }

  const references = [
    ...input.reuseLabels.map((label) => ({
      influence: label.influence ?? "reference-conditioned",
      itemId: label.itemId,
      itemVersionId: label.itemVersionId,
    })),
    ...input.elementProvenance,
  ];
  for (const reference of references) {
    const hasItemId = Boolean(reference.itemId);
    const hasItemVersionId = Boolean(reference.itemVersionId);
    if (hasItemId !== hasItemVersionId) {
      throw new Error(
        "Creative context provenance must provide both itemId and itemVersionId",
      );
    }
    if (reference.influence !== "generated" && !hasItemId) {
      throw new Error(
        "Only generated creative context provenance may omit item references",
      );
    }
    if (!input.contextPackId && hasItemId) {
      throw new Error(
        "Creative context provenance cannot reference items without a context pack",
      );
    }
    if (
      input.contextMode === "off" &&
      (reference.influence !== "generated" || hasItemId)
    ) {
      throw new Error(
        "Creative context off records may contain only generated provenance without item references",
      );
    }
  }
}

export async function recordGenerationCreativeContext(
  input: {
    appId: string;
    artifactType: string;
    artifactId: string;
    contextMode: "off" | "auto" | "pinned";
    contextPackId: string | null;
    reuseLabels: CreativeContextReuseLabel[];
    elementProvenance?: CreativeContextElementProvenance[];
  },
  options: {
    db?: any;
    artifactAccess?: GenerationArtifactAccessProof;
  } = {},
): Promise<CreativeContextGenerationRecord> {
  const elementProvenance =
    input.elementProvenance ??
    input.reuseLabels.map((label, index) => ({
      elementId: label.elementId ?? `reference:${index + 1}`,
      influence: label.influence ?? ("reference-conditioned" as const),
      ...(label.itemId ? { itemId: label.itemId } : {}),
      ...(label.itemVersionId ? { itemVersionId: label.itemVersionId } : {}),
      label: label.label,
    }));
  assertGenerationCreativeContextInvariants({
    contextMode: input.contextMode,
    contextPackId: input.contextPackId,
    reuseLabels: input.reuseLabels,
    elementProvenance,
  });
  if (input.contextPackId) {
    await assertAccess(
      "creative-context-pack",
      input.contextPackId,
      "viewer",
      undefined,
      { skipResourceBody: true },
    );
  }
  if (input.contextPackId) {
    const { getDb, schema } = getCreativeContext();
    const db = options.db ?? getDb();
    const members = await db
      .select({
        itemId: schema.contextPackMembers.itemId,
        itemVersionId: schema.contextPackMembers.itemVersionId,
      })
      .from(schema.contextPackMembers)
      .where(eq(schema.contextPackMembers.packId, input.contextPackId));
    const allowed = new Set(
      members.map((member: any) => `${member.itemId}:${member.itemVersionId}`),
    );
    for (const entry of elementProvenance) {
      if (
        (entry.itemId || entry.itemVersionId) &&
        (!entry.itemId ||
          !entry.itemVersionId ||
          !allowed.has(`${entry.itemId}:${entry.itemVersionId}`))
      ) {
        throw new Error(
          "Element provenance references must belong to the recorded context pack",
        );
      }
    }
  }
  const { getDb, schema } = getCreativeContext();
  const db = options.db ?? getDb();
  const actor = requireActor();
  if (options.artifactAccess) {
    assertGenerationArtifactAccessProof(
      input,
      options.artifactAccess,
      "editor",
    );
  }
  const row = {
    id: newId("ccgr"),
    appId: input.appId,
    artifactType: input.artifactType,
    artifactId: input.artifactId,
    contextMode: input.contextMode,
    contextPackId: input.contextPackId,
    elementProvenance: stringifyJson(elementProvenance),
    createdAt: nowIso(),
    ownerEmail: actor.ownerEmail,
    orgId: options.artifactAccess ? actor.orgId : null,
  };
  await db.insert(schema.generationRecords).values(row);
  await getCreativeContext().projections?.generation?.record({
    appId: input.appId,
    artifactType: input.artifactType,
    artifactId: input.artifactId,
    contextPackId: input.contextPackId,
    elementProvenance,
  });
  return {
    ...row,
    elementProvenance: parseJson(row.elementProvenance, []),
  };
}

export async function getGenerationCreativeContext(
  input: {
    appId: string;
    artifactType: string;
    artifactId: string;
  },
  options: {
    artifactAccess?: GenerationArtifactAccessProof;
  } = {},
): Promise<CreativeContextGenerationRecord | null> {
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  if (options.artifactAccess && !actor.orgId) {
    throw new Error(
      "Collaborative generation context reads require an organization",
    );
  }
  if (options.artifactAccess) {
    assertGenerationArtifactAccessProof(
      input,
      options.artifactAccess,
      "viewer",
    );
  }
  const actorScope = options.artifactAccess
    ? eq(schema.generationRecords.orgId, actor.orgId!)
    : eq(schema.generationRecords.ownerEmail, actor.ownerEmail);
  const rows = await getDb()
    .select()
    .from(schema.generationRecords)
    .where(
      and(
        eq(schema.generationRecords.appId, input.appId),
        eq(schema.generationRecords.artifactType, input.artifactType),
        eq(schema.generationRecords.artifactId, input.artifactId),
        actorScope,
      ),
    )
    .orderBy(desc(schema.generationRecords.createdAt))
    .limit(1);
  const row = rows[0];
  return row
    ? {
        id: row.id,
        appId: row.appId,
        artifactType: row.artifactType,
        artifactId: row.artifactId,
        contextMode: row.contextMode,
        contextPackId: row.contextPackId ?? null,
        elementProvenance: parseJson(row.elementProvenance, []),
        createdAt: row.createdAt,
      }
    : null;
}
