import { and, eq, gt, lte } from "drizzle-orm";
import { type z } from "zod";

import { notebookMessages } from "../../../app/i18n/messages/notebook.js";
import { notebookEventSchema } from "../../../shared/notebook-operations.js";
import { notebookEventCursorSchema } from "../../../shared/notebook-snapshot-contract.js";
import { getDb, schema } from "../../db/index.js";
import { ensureAnalyticsDatabase } from "../database.js";
import { StoredDataError } from "../json-column.js";
import type { WorkspaceScope } from "../scope.js";
import { lockNotebookProject, notebookPending, snapshotRef } from "./store.js";

const { notebookEvents } = schema;

export async function listNotebookChanges(
  scope: WorkspaceScope,
  projectId: string,
  after: z.infer<typeof notebookEventCursorSchema>,
  limit: number,
) {
  await ensureAnalyticsDatabase();
  return getDb().transaction(async (tx) => {
    const project = await lockNotebookProject(scope, projectId, tx, "share");
    if (project.notebookVersionId !== project.workingVersionId)
      return notebookPending;
    const head = snapshotRef(scope, project).eventSeq;
    const expired = { status: "expired", cursor: head } as const;
    const requested = BigInt(after);
    if (requested > project.notebookEventSeq) return expired;
    const rows = await tx
      .select()
      .from(notebookEvents)
      .where(
        and(
          eq(notebookEvents.projectId, projectId),
          gt(notebookEvents.eventSeq, requested),
          lte(notebookEvents.eventSeq, project.notebookEventSeq),
        ),
      )
      .orderBy(notebookEvents.eventSeq)
      .limit(limit + 1);
    if (rows.some((row, i) => row.eventSeq !== requested + BigInt(i + 1)))
      return expired;
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit).map((row) => {
      const event = notebookEventSchema.parse(row.event);
      if (event.sequence !== row.eventSeq.toString()) {
        throw new StoredDataError(notebookMessages.notebook.savedContentFailed);
      }
      return event;
    });
    const cursor = events.at(-1)?.sequence ?? after;
    if (!hasMore && cursor !== head) return expired;
    return { status: "ok" as const, events, cursor, hasMore };
  });
}
