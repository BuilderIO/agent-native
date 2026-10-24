import { and, eq, inArray, like } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import type {
  BuilderCmsPublicationTransitionIntent,
  BuilderEntryStatusChoice,
  BuilderEntryStatusPick,
  DocumentPropertyValue,
} from "../shared/api.js";
import { bulkChunkSizeForColumnCount, chunks } from "./_batch-utils.js";
import {
  BUILDER_CMS_HAS_AUTOSAVES_KEY,
  builderCmsSourceRowIdentityState,
} from "./_builder-cms-source-adapter.js";
import {
  BUILDER_CMS_PUBLICATION_INTENT_KEY,
  builderCmsEntryStatus,
  readBuilderCmsPublicationIntent,
  readBuilderCmsUnpublishedChanges,
  withBuilderCmsPublicationIntent,
} from "./_builder-cms-unpublished-changes.js";
import { builderCmsWriteSettingsFromJson } from "./_builder-cms-write-settings.js";
import { writeBuilderStatusValues } from "./_builder-status-property.js";
import { lockDatabaseMemberships } from "./_database-membership-lock.js";

type Db = Pick<ReturnType<typeof getDb>, "select">;

export type BuilderEntryStatusTarget = Awaited<
  ReturnType<typeof builderEntryStatusTargets>
>[number];

export type BuilderEntryStatusPickResult =
  | { ok: true; transition: BuilderCmsPublicationTransitionIntent | null }
  | {
      ok: false;
      reason: "unknown_state" | "builder_editor_changes" | "not_builder_status";
    };

export function parseBuilderEntrySourceValues(
  sourceValuesJson: string,
): Record<string, DocumentPropertyValue> | null {
  try {
    const parsed = JSON.parse(sourceValuesJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, DocumentPropertyValue>)
      : null;
  } catch {
    // coercion-ok: callers treat null as an unreadable row, not an empty one.
    return null;
  }
}

/**
 * What picking a status for a Builder entry stages. Picking Builder's own
 * status clears a staged change. Published isn't offered while Builder's
 * editor holds changes, even alongside Content's own: Content can't see them,
 * so it can't review what a publish would do with them.
 */
export function builderEntryStatusPick(
  sourceValues: Record<string, DocumentPropertyValue>,
  status: BuilderEntryStatusPick,
): BuilderEntryStatusPickResult {
  const current = builderCmsEntryStatus(sourceValues);
  if (!current) return { ok: false, reason: "unknown_state" };
  if (status === "unpublished_changes") {
    return current === "unpublished_changes"
      ? { ok: true, transition: null }
      : { ok: false, reason: "not_builder_status" };
  }
  if (status === "draft") {
    return { ok: true, transition: current === "draft" ? null : "unpublish" };
  }
  if (current === "published") return { ok: true, transition: null };
  if (
    sourceValues[BUILDER_CMS_HAS_AUTOSAVES_KEY] === true ||
    (current === "unpublished_changes" &&
      readBuilderCmsUnpublishedChanges(sourceValues).state !== "pending")
  ) {
    return { ok: false, reason: "builder_editor_changes" };
  }
  return { ok: true, transition: "publish" };
}

/** A page's rows in the collection's Builder sources, with each source's settings. */
export async function builderEntryStatusTargets(
  db: Db,
  args: { databaseId: string; documentId: string },
) {
  return db
    .select({
      row: {
        id: schema.contentDatabaseSourceRows.id,
        sourceId: schema.contentDatabaseSourceRows.sourceId,
        databaseItemId: schema.contentDatabaseSourceRows.databaseItemId,
        documentId: schema.contentDatabaseSourceRows.documentId,
        sourceRowId: schema.contentDatabaseSourceRows.sourceRowId,
        sourceQualifiedId: schema.contentDatabaseSourceRows.sourceQualifiedId,
        provenance: schema.contentDatabaseSourceRows.provenance,
        sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
      },
      source: {
        id: schema.contentDatabaseSources.id,
        capabilitiesJson: schema.contentDatabaseSources.capabilitiesJson,
        metadataJson: schema.contentDatabaseSources.metadataJson,
      },
    })
    .from(schema.contentDatabaseSourceRows)
    .innerJoin(
      schema.contentDatabaseSources,
      eq(
        schema.contentDatabaseSources.id,
        schema.contentDatabaseSourceRows.sourceId,
      ),
    )
    .where(
      and(
        eq(schema.contentDatabaseSources.databaseId, args.databaseId),
        eq(schema.contentDatabaseSources.sourceType, "builder-cms"),
        eq(schema.contentDatabaseSourceRows.documentId, args.documentId),
      ),
    );
}

/** Why a page's Builder status can't be changed from Content, or null when it can. */
export function builderEntryStatusLockedReason(
  target: BuilderEntryStatusTarget,
):
  | "publication_transitions_off"
  | "unmatched_entry"
  | "unreadable_row"
  | "unknown_state"
  | null {
  if (
    !builderCmsWriteSettingsFromJson(target.source).allowPublicationTransitions
  ) {
    return "publication_transitions_off";
  }
  if (
    builderCmsSourceRowIdentityState({ row: target.row }).isSyntheticFixture
  ) {
    return "unmatched_entry";
  }
  const sourceValues = parseBuilderEntrySourceValues(
    target.row.sourceValuesJson,
  );
  if (!sourceValues) return "unreadable_row";
  return builderCmsEntryStatus(sourceValues) ? null : "unknown_state";
}

/**
 * The statuses a page's Builder entry can be given from Content, or null
 * while its status is read-only. A page in more than one Builder source has
 * no single entry to change, so it stays read-only too.
 */
export function builderEntryStatusChoices(
  targets: BuilderEntryStatusTarget[],
): BuilderEntryStatusChoice[] | null {
  if (targets.length !== 1) return null;
  const [target] = targets;
  if (builderEntryStatusLockedReason(target)) return null;
  const sourceValues = parseBuilderEntrySourceValues(
    target.row.sourceValuesJson,
  );
  if (!sourceValues) return null;
  return (["published", "draft", "unpublished_changes"] as const).map(
    (status) => ({
      status,
      available: builderEntryStatusPick(sourceValues, status).ok,
    }),
  );
}

/**
 * Drops every staged publish and unpublish in a source and rewrites those
 * rows' statuses. Run it when the source stops allowing publication
 * changes, so turning them back on doesn't bring old picks back.
 */
export async function clearStagedBuilderPublicationChanges(args: {
  sourceId: string;
  now: string;
}) {
  await getDb().transaction(async (tx) => {
    const staged = await tx
      .select({
        id: schema.contentDatabaseSourceRows.id,
        databaseItemId: schema.contentDatabaseSourceRows.databaseItemId,
      })
      .from(schema.contentDatabaseSourceRows)
      .where(
        and(
          eq(schema.contentDatabaseSourceRows.sourceId, args.sourceId),
          like(
            schema.contentDatabaseSourceRows.sourceValuesJson,
            `%"${BUILDER_CMS_PUBLICATION_INTENT_KEY}"%`,
          ),
        ),
      );
    if (staged.length === 0) return;
    await lockDatabaseMemberships(
      tx,
      staged.map((row) => row.databaseItemId),
    );
    // The setting is saved before this runs, so it can be turned back on and
    // a new pick staged first. Staging takes the same locks in this order.
    const [source] = await tx
      .select({
        capabilitiesJson: schema.contentDatabaseSources.capabilitiesJson,
        metadataJson: schema.contentDatabaseSources.metadataJson,
      })
      .from(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.id, args.sourceId))
      .for("share");
    if (
      source &&
      builderCmsWriteSettingsFromJson(source).allowPublicationTransitions
    ) {
      return;
    }
    const rows: Array<{
      id: string;
      documentId: string;
      sourceValuesJson: string;
    }> = [];
    for (const chunk of chunks(
      staged.map((row) => row.id),
      bulkChunkSizeForColumnCount(1),
    )) {
      rows.push(
        ...(await tx
          .select({
            id: schema.contentDatabaseSourceRows.id,
            documentId: schema.contentDatabaseSourceRows.documentId,
            sourceValuesJson: schema.contentDatabaseSourceRows.sourceValuesJson,
          })
          .from(schema.contentDatabaseSourceRows)
          .where(inArray(schema.contentDatabaseSourceRows.id, chunk))),
      );
    }
    const cleared: Array<{
      documentId: string;
      sourceValues: Record<string, DocumentPropertyValue>;
    }> = [];
    for (const row of rows) {
      const sourceValues = parseBuilderEntrySourceValues(row.sourceValuesJson);
      if (
        !sourceValues ||
        readBuilderCmsPublicationIntent(sourceValues).state === "none"
      ) {
        continue;
      }
      const next = withBuilderCmsPublicationIntent(sourceValues, null);
      await tx
        .update(schema.contentDatabaseSourceRows)
        .set({ sourceValuesJson: JSON.stringify(next), updatedAt: args.now })
        .where(eq(schema.contentDatabaseSourceRows.id, row.id));
      cleared.push({ documentId: row.documentId, sourceValues: next });
    }
    await writeBuilderStatusValues(tx, {
      sourceId: args.sourceId,
      rows: cleared,
      now: args.now,
    });
  });
}
