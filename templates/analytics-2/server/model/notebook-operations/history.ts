import { fail } from "@agent-native/core/action";
import { and, desc, eq, gte, isNull, lt, lte, ne, or } from "drizzle-orm";
import { z } from "zod";

import { projectVersionSchema } from "../../../app/lib/model/project-version-contracts.js";
import type {
  NotebookHistoryInput,
  NotebookHistoryItem,
} from "../../../shared/notebook-history.js";
import { notebookEventSchema } from "../../../shared/notebook-operations.js";
import { notebookEventCursorSchema } from "../../../shared/notebook-snapshot-contract.js";
import { getDb, schema } from "../../db/index.js";
import { nowIso } from "../clock.js";
import { ensureAnalyticsDatabase } from "../database.js";
import { StoredDataError } from "../json-column.js";
import { canEditProject, projectAccessLevel } from "../project-grant-access.js";
import type { WorkspaceScope } from "../scope.js";
import { groupNotebookHistory } from "./history-projection.js";
import { notebookUnavailable, projectScopeFilter } from "./store.js";

const { notebookEvents, projects, projectVersions } = schema;
const eventWindow = 1000;
const autosaveLifetime = 30 * 24 * 60 * 60 * 1000;
const cursorSchema = z.strictObject({
  projectId: z.string(),
  filter: z.enum(["all", "versions"]),
  eventSeq: notebookEventCursorSchema,
  asOf: z.iso.datetime(),
  before: z.strictObject({ at: z.string(), id: z.string() }),
});

function readCursor(input: NotebookHistoryInput) {
  if (!input.cursor) return null;
  try {
    const cursor = cursorSchema.parse(
      JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")),
    );
    if (cursor.projectId === input.projectId && cursor.filter === input.filter)
      return cursor;
  } catch (error) {
    if (!(error instanceof SyntaxError || error instanceof z.ZodError))
      throw error;
  }
  return fail("That notebook history page is invalid.", {
    statusCode: 400,
    errorCode: "notebook_history_cursor_invalid",
  });
}

function itemKey(item: NotebookHistoryItem) {
  return {
    at: item.kind === "edits" ? item.endedAt : item.version.createdAt,
    id: item.id,
  };
}

function compareHistoryKeys(
  a: ReturnType<typeof itemKey>,
  b: ReturnType<typeof itemKey>,
) {
  const left = a.at === b.at ? a.id : a.at;
  const right = a.at === b.at ? b.id : b.at;
  return left < right ? -1 : Number(left > right);
}

export async function listNotebookHistory(
  scope: WorkspaceScope,
  input: NotebookHistoryInput,
) {
  const { projectId, filter, limit } = input;
  const cursor = readCursor(input);
  await ensureAnalyticsDatabase();
  return getDb().transaction(async (tx) => {
    const [project] = await tx
      .select()
      .from(projects)
      .where(projectScopeFilter(scope, projectId))
      .limit(1)
      .for("share");
    if (!project) notebookUnavailable();
    const access = await projectAccessLevel(scope, project, [], tx);
    if (access === null) notebookUnavailable();
    const canManageVersions = project.ownerEmail === scope.ownerEmail;
    const asOf = cursor?.asOf ?? nowIso();
    const anchor = cursor ? BigInt(cursor.eventSeq) : project.notebookEventSeq;
    if (anchor > project.notebookEventSeq) {
      fail("That notebook history page is invalid.", {
        statusCode: 400,
        errorCode: "notebook_history_cursor_invalid",
      });
    }
    const before = cursor?.before;
    const autosaveCutoff = new Date(
      Date.parse(asOf) - autosaveLifetime,
    ).toISOString();
    const versions = await tx
      .select({
        id: projectVersions.id,
        number: projectVersions.number,
        kind: projectVersions.kind,
        name: projectVersions.name,
        createdAt: projectVersions.createdAt,
        createdBy: projectVersions.createdBy,
      })
      .from(projectVersions)
      .where(
        and(
          eq(projectVersions.projectId, projectId),
          canManageVersions
            ? or(
                ne(projectVersions.kind, "autosave"),
                eq(projectVersions.id, project.workingVersionId),
                gte(projectVersions.archivedAt, autosaveCutoff),
                and(
                  isNull(projectVersions.archivedAt),
                  gte(projectVersions.createdAt, autosaveCutoff),
                ),
              )
            : eq(projectVersions.kind, "published"),
          before
            ? or(
                lt(projectVersions.createdAt, before.at),
                before.id.startsWith("version:")
                  ? and(
                      eq(projectVersions.createdAt, before.at),
                      lt(
                        projectVersions.id,
                        before.id.slice("version:".length),
                      ),
                    )
                  : undefined,
              )
            : undefined,
        ),
      )
      .orderBy(desc(projectVersions.createdAt), desc(projectVersions.id))
      .limit(limit + 1);
    const rows =
      filter === "all" && canEditProject(access)
        ? await tx
            .select({
              event: notebookEvents.event,
              seq: notebookEvents.eventSeq,
            })
            .from(notebookEvents)
            .where(
              and(
                eq(notebookEvents.projectId, projectId),
                lte(notebookEvents.eventSeq, anchor),
              ),
            )
            .orderBy(desc(notebookEvents.eventSeq))
            .limit(eventWindow)
        : [];
    const editsTruncated =
      filter === "all" &&
      canEditProject(access) &&
      BigInt(rows.length) < anchor;
    const events = rows
      .reverse()
      .map(({ seq, event }) => {
        const parsed = notebookEventSchema.parse(event);
        if (parsed.sequence !== seq.toString())
          throw new StoredDataError("The notebook history could not be read.");
        return parsed;
      })
      .sort(
        (a, b) =>
          Date.parse(a.receipt.committedAt) - Date.parse(b.receipt.committedAt),
      );
    const items: NotebookHistoryItem[] = versions.map((row) => ({
      kind: "version",
      id: `version:${row.id}`,
      version: projectVersionSchema.parse({
        ...row,
        isWorking: row.id === project.workingVersionId,
        isPublished: row.id === project.publishedVersionId,
      }),
    }));
    items.push(
      ...groupNotebookHistory(events, editsTruncated).filter(
        (item) => !before || compareHistoryKeys(itemKey(item), before) < 0,
      ),
    );
    items.sort((a, b) => compareHistoryKeys(itemKey(b), itemKey(a)));
    const page = items.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor:
        items.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                projectId,
                filter,
                eventSeq: anchor.toString(),
                asOf,
                before: itemKey(last),
              }),
            ).toString("base64url")
          : null,
      editsTruncated,
      canManageVersions,
    };
  });
}
