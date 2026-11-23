import { and, eq, isNull, or, sql } from "@agent-native/core/db/schema";

import type { ArchiveSettings } from "../../app/lib/model/archive-settings-contracts.js";
import { getDb, schema } from "../db/index.js";
import { ensureAnalyticsDatabase } from "./database.js";

const { collections, projectCollections, projects } = schema;
const DAY_MS = 86_400_000;

export async function archiveStaleProjects(
  orgId: string,
  settings: ArchiveSettings,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = (days: number) =>
    new Date(now.getTime() - days * DAY_MS).toISOString();
  const rules = [
    settings.noEditArchiveCadence === null
      ? undefined
      : sql`coalesce(${projects.userUpdatedAt}, ${projects.updatedAt}) < ${cutoff(settings.noEditArchiveCadence)}`,
    settings.noViewArchiveCadence === null
      ? undefined
      : sql`coalesce(${projects.lastOpenedAt}, ${projects.createdAt}) < ${cutoff(settings.noViewArchiveCadence)}`,
  ].filter((rule) => rule !== undefined);
  if (rules.length === 0) return 0;
  await ensureAnalyticsDatabase();
  const archived = await getDb()
    .update(projects)
    .set({ archivedAt: now.toISOString() })
    .where(
      and(
        eq(projects.orgId, orgId),
        isNull(projects.archivedAt),
        isNull(projects.trashedAt),
        sql`not exists (
          select 1
          from ${projectCollections}
          inner join ${collections}
            on ${collections.id} = ${projectCollections.collectionId}
          where ${projectCollections.projectId} = ${projects.id}
            and ${collections.trashedAt} is null
        )`,
        or(...rules),
      ),
    )
    .returning({ id: projects.id });
  return archived.length;
}
