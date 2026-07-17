import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";

import { assertContextItemSqlTextLimits } from "../connectors/normalize.js";
import { reassembleNativeCreativeArtifact } from "../native-artifact-reassembly.js";
import { nativeCreativeArtifactFromMetadata } from "../native-artifact.js";
import { getCreativeContext } from "../server/context.js";
import type { CreativeContextSuggestion } from "../types.js";
import {
  getCreativeContextItem,
  getCreativeContextItemByExternalId,
} from "./content.js";
import { ingestItems } from "./content.js";
import {
  newId,
  nowIso,
  parseJson,
  requireActor,
  sha256,
  stringifyJson,
} from "./helpers.js";
import { createContextSource, listContextSources } from "./sources.js";

function mapSuggestion(row: any): CreativeContextSuggestion {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    profileId: row.profileId ?? null,
    itemId: row.itemId,
    itemVersionId: row.itemVersionId,
    reason: row.reason ?? null,
    payload: parseJson(row.payload, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listCreativeContextSuggestions(
  input: {
    kind?: CreativeContextSuggestion["kind"];
    status?: CreativeContextSuggestion["status"];
    limit?: number;
  } = {},
): Promise<CreativeContextSuggestion[]> {
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const predicates = [
    eq(schema.contextSuggestions.ownerEmail, actor.ownerEmail),
  ];
  if (input.kind) {
    predicates.push(eq(schema.contextSuggestions.kind, input.kind));
  }
  if (input.status) {
    predicates.push(eq(schema.contextSuggestions.status, input.status));
  }
  const rows = await getDb()
    .select()
    .from(schema.contextSuggestions)
    .where(and(...predicates))
    .orderBy(desc(schema.contextSuggestions.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 100));
  return rows.map(mapSuggestion);
}

async function loadOwnedSuggestion(
  suggestionId: string,
  kind: CreativeContextSuggestion["kind"],
) {
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const rows = await getDb()
    .select()
    .from(schema.contextSuggestions)
    .where(
      and(
        eq(schema.contextSuggestions.id, suggestionId),
        eq(schema.contextSuggestions.kind, kind),
        eq(schema.contextSuggestions.ownerEmail, actor.ownerEmail),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error("Suggestion not found or not accessible");
  if (row.profileId) {
    await assertAccess(
      "creative-context-brand",
      row.profileId,
      "editor",
      undefined,
      { skipResourceBody: true },
    );
  }
  return row;
}

export async function proposeCreativeContextSuggestion(input: {
  kind: CreativeContextSuggestion["kind"];
  profileId?: string;
  itemId: string;
  itemVersionId?: string;
  reason?: string;
  payload?: Record<string, unknown>;
}): Promise<CreativeContextSuggestion> {
  if (input.profileId) {
    await assertAccess(
      "creative-context-brand",
      input.profileId,
      "editor",
      undefined,
      { skipResourceBody: true },
    );
  }
  const detail = await getCreativeContextItem(
    input.itemId,
    input.itemVersionId,
  );
  if (!detail) throw new Error("Suggestion item not found or not accessible");
  const { getDb, schema } = getCreativeContext();
  const actor = requireActor();
  const existing = await getDb()
    .select()
    .from(schema.contextSuggestions)
    .where(
      and(
        eq(schema.contextSuggestions.kind, input.kind),
        eq(schema.contextSuggestions.itemId, detail.item.id),
        eq(schema.contextSuggestions.itemVersionId, detail.version.id),
        eq(schema.contextSuggestions.ownerEmail, actor.ownerEmail),
      ),
    )
    .orderBy(desc(schema.contextSuggestions.createdAt))
    .limit(1);
  if (existing[0] && existing[0].status !== "rejected") {
    return mapSuggestion(existing[0]);
  }
  const timestamp = nowIso();
  const payload = { ...(input.payload ?? {}) };
  if (input.kind === "layout-template") delete payload.projectionItemId;
  const row = {
    id: newId("ccsg"),
    kind: input.kind,
    status: "proposed" as const,
    profileId: input.profileId ?? null,
    itemId: input.itemId,
    itemVersionId: detail.version.id,
    reason: input.reason ?? null,
    payload: stringifyJson(payload),
    createdAt: timestamp,
    updatedAt: timestamp,
    ownerEmail: actor.ownerEmail,
    orgId: actor.orgId,
  };
  await getDb().insert(schema.contextSuggestions).values(row);
  return mapSuggestion(row);
}

export async function updateCreativeContextSuggestion(input: {
  suggestionId: string;
  kind: CreativeContextSuggestion["kind"];
  status: CreativeContextSuggestion["status"];
}): Promise<CreativeContextSuggestion> {
  const { getDb, schema } = getCreativeContext();
  const row = await loadOwnedSuggestion(input.suggestionId, input.kind);
  const updatedAt = nowIso();
  await getDb()
    .update(schema.contextSuggestions)
    .set({ status: input.status, updatedAt })
    .where(eq(schema.contextSuggestions.id, input.suggestionId));
  return mapSuggestion({ ...row, status: input.status, updatedAt });
}

export async function decideCanonicalLogoSuggestion(input: {
  suggestionId: string;
  decision: "confirm" | "reject";
}): Promise<CreativeContextSuggestion> {
  const row = await loadOwnedSuggestion(input.suggestionId, "canonical-logo");
  if (input.decision === "confirm") {
    const adapter = getCreativeContext().projections?.canonicalLogo;
    if (!adapter) {
      throw new Error(
        "Canonical-logo projection is not configured for this app; keep the proposal pending",
      );
    }
    await adapter.apply({
      profileId: row.profileId ?? null,
      itemId: row.itemId,
      itemVersionId: row.itemVersionId,
      payload: parseJson(row.payload, {}),
    });
  }
  return updateCreativeContextSuggestion({
    suggestionId: input.suggestionId,
    kind: "canonical-logo",
    status: input.decision === "confirm" ? "confirmed" : "rejected",
  });
}

const PROMOTED_LAYOUT_SOURCE = "Promoted layout templates";

export async function resolveLayoutProjectionItemId(
  suggestionId: string,
  candidateId: unknown,
): Promise<string | null> {
  if (typeof candidateId !== "string" || !candidateId) return null;
  const detail = await getCreativeContextItem(candidateId);
  if (!detail || detail.item.kind !== "layout_template") return null;
  const provenance = detail.item.provenance as Record<string, unknown>;
  return provenance.promotedFromSuggestionId === suggestionId
    ? detail.item.id
    : null;
}

async function loadCompiledLayoutSource(itemId: string, itemVersionId: string) {
  const detail = await getCreativeContextItem(itemId, itemVersionId);
  if (!detail) throw new Error("Layout source version is no longer accessible");
  const artifact = nativeCreativeArtifactFromMetadata(detail.version.metadata);
  if (
    !artifact ||
    artifact.app !== "slides" ||
    artifact.format !== "slides-html"
  ) {
    throw new Error(
      "Layout promotion requires a compiled Slides-native Creative Context item",
    );
  }
  const compiled = await reassembleNativeCreativeArtifact({
    root: detail,
    app: "slides",
    format: "slides-html",
    resolveChild: getCreativeContextItemByExternalId,
  });
  return { detail, compiled };
}

export async function applyLayoutTemplateSuggestion(input: {
  suggestionId: string;
  operation: "promote" | "demote" | "reject";
}): Promise<CreativeContextSuggestion> {
  const row = await loadOwnedSuggestion(input.suggestionId, "layout-template");
  const payload = parseJson<Record<string, unknown>>(row.payload, {});
  if (input.operation === "reject") {
    return updateCreativeContextSuggestion({
      suggestionId: input.suggestionId,
      kind: "layout-template",
      status: "rejected",
    });
  }
  const adapter = getCreativeContext().projections?.layoutTemplate;
  if (!adapter) {
    throw new Error(
      "Layout-template projection is not configured for this app; keep the proposal pending",
    );
  }
  let projectionItemId = await resolveLayoutProjectionItemId(
    row.id,
    payload.projectionItemId,
  );
  const source =
    input.operation === "promote"
      ? await loadCompiledLayoutSource(row.itemId, row.itemVersionId)
      : null;
  const projectionItem = source
    ? {
        externalId: `layout-template:${row.id}`,
        kind: "layout_template",
        title: source!.detail.item.title,
        content: source!.compiled.html,
        summary: source!.detail.version.summary ?? undefined,
        mimeType: "text/html",
        contentHash: await sha256(
          `${row.id}:${source!.detail.version.id}:${source!.compiled.html}`,
        ),
        upstreamAccess: "available" as const,
        curationStatus: "included" as const,
        curationRank: "canonical" as const,
        provenance: {
          ...source!.detail.item.provenance,
          promotedFromSuggestionId: row.id,
          promotedFromItemId: source!.detail.item.id,
          promotedFromItemVersionId: source!.detail.version.id,
        },
        metadata: {
          promotedFromSuggestionId: row.id,
          nativeArtifact: {
            ...source!.compiled.artifact,
            childExternalIds: undefined,
            manifest: undefined,
          },
        },
        edges: source!.compiled.evidence.map((evidence) => ({
          relation: "derived-from",
          toItemId: evidence.itemId,
          toItemVersionId: evidence.itemVersionId,
        })),
      }
    : null;
  if (projectionItem) {
    assertContextItemSqlTextLimits(projectionItem);
  }
  if (input.operation === "promote" && !projectionItemId) {
    const sources = await listContextSources({ kind: "manual", limit: 100 });
    let projectionSource = sources.sources.find(
      (candidate) => candidate.name === PROMOTED_LAYOUT_SOURCE,
    );
    if (!projectionSource) {
      projectionSource = await createContextSource({
        name: PROMOTED_LAYOUT_SOURCE,
        kind: "manual",
        config: { purpose: "layout-template-projections" },
        upstreamAccess: "available",
      });
    }
    const ingested = await ingestItems({
      sourceId: projectionSource.id,
      items: [projectionItem!],
    });
    projectionItemId = ingested.itemIds[0] ?? null;
    if (!projectionItemId) throw new Error("Failed to promote layout template");
  }
  if (input.operation === "promote") {
    await adapter.promote({
      suggestionId: row.id,
      itemId: row.itemId,
      itemVersionId: row.itemVersionId,
      projectionItemId: projectionItemId!,
      htmlSnapshot: source!.compiled.html,
    });
  } else {
    const { getDb, schema } = getCreativeContext();
    const actor = requireActor();
    if (projectionItemId) {
      await getDb()
        .update(schema.contextItems)
        .set({ status: "deprecated", updatedAt: nowIso() })
        .where(
          and(
            eq(schema.contextItems.id, projectionItemId),
            eq(schema.contextItems.ownerEmail, actor.ownerEmail),
          ),
        );
    }
    await adapter.demote({ suggestionId: row.id, projectionItemId });
  }
  const { getDb, schema } = getCreativeContext();
  const updatedAt = nowIso();
  const status = input.operation === "promote" ? "promoted" : "demoted";
  const updatedPayload = stringifyJson({ ...payload, projectionItemId });
  await getDb()
    .update(schema.contextSuggestions)
    .set({ status, payload: updatedPayload, updatedAt })
    .where(eq(schema.contextSuggestions.id, row.id));
  return mapSuggestion({
    ...row,
    status,
    payload: updatedPayload,
    updatedAt,
  });
}
