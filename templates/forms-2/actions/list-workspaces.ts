import { defineAction } from "@agent-native/core/action";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { workspaceWithFormsSchema } from "../shared/form-contract.js";
import {
  ensureDefaultWorkspace,
  formsAccess,
  formsErrors,
  orgScope,
  workspaceScope,
} from "./_access.js";
import { summarizeForms } from "./_form-store.js";

export default defineAction({
  description:
    "List the workspaces in the current organization with form counts, their folders and, when formLimit is above 0, each workspace's first forms outside folders. Creates the default workspace on the first call.",
  schema: z.object({
    formLimit: z
      .number()
      .int()
      .min(0)
      .max(50)
      .default(0)
      .describe("Forms to include per workspace, 0 to 50; defaults to 0"),
  }),
  outputSchema: z.object({ workspaces: z.array(workspaceWithFormsSchema) }),
  errors: formsErrors,
  http: { method: "GET" },
  run: async ({ formLimit }) => {
    const access = formsAccess();
    await ensureDefaultWorkspace(access);
    const db = getDb();
    const { workspaces, forms, folders } = schema;
    const rows = await db
      .select()
      .from(workspaces)
      .where(
        and(
          workspaceScope(access.orgId, access.userEmail),
          isNull(workspaces.deletedAt),
        ),
      )
      .orderBy(asc(workspaces.position), asc(workspaces.createdAt))
      .limit(200);
    const ids = rows.map((row) => row.id);
    const counts = new Map<string, number>();
    if (ids.length) {
      const grouped = await db
        .select({
          workspaceId: forms.workspaceId,
          count: sql<number>`count(*)::int`,
        })
        .from(forms)
        .where(
          and(
            orgScope(forms, access.orgId),
            inArray(forms.workspaceId, ids),
            ne(forms.status, "deleted"),
          ),
        )
        .groupBy(forms.workspaceId);
      for (const row of grouped) counts.set(row.workspaceId, row.count);
    }
    const foldersByWorkspace = new Map<
      string,
      { id: string; name: string; position: number; formCount: number }[]
    >();
    if (ids.length) {
      const folderRows = await db
        .select()
        .from(folders)
        .where(
          and(
            orgScope(folders, access.orgId),
            inArray(folders.workspaceId, ids),
            isNull(folders.deletedAt),
          ),
        )
        .orderBy(asc(folders.position), asc(folders.createdAt));
      const folderCounts = new Map<string, number>();
      if (folderRows.length) {
        const grouped = await db
          .select({
            folderId: forms.folderId,
            count: sql<number>`count(*)::int`,
          })
          .from(forms)
          .where(
            and(
              orgScope(forms, access.orgId),
              inArray(
                forms.folderId,
                folderRows.map((row) => row.id),
              ),
              ne(forms.status, "deleted"),
            ),
          )
          .groupBy(forms.folderId);
        for (const row of grouped)
          if (row.folderId) folderCounts.set(row.folderId, row.count);
      }
      for (const row of folderRows)
        foldersByWorkspace.set(row.workspaceId, [
          ...(foldersByWorkspace.get(row.workspaceId) ?? []),
          {
            id: row.id,
            name: row.name,
            position: row.position,
            formCount: folderCounts.get(row.id) ?? 0,
          },
        ]);
    }
    const result = [];
    for (const row of rows) {
      const formRows =
        formLimit > 0
          ? await db
              .select()
              .from(forms)
              .where(
                and(
                  orgScope(forms, access.orgId),
                  eq(forms.workspaceId, row.id),
                  isNull(forms.folderId),
                  ne(forms.status, "deleted"),
                ),
              )
              .orderBy(asc(forms.position), desc(forms.updatedAt))
              .limit(formLimit)
          : [];
      result.push({
        id: row.id,
        name: row.name,
        position: row.position,
        formCount: counts.get(row.id) ?? 0,
        folders: foldersByWorkspace.get(row.id) ?? [],
        forms: await summarizeForms(db, access.orgId, formRows),
      });
    }
    return { workspaces: result };
  },
});
