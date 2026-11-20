import { defineAction } from "@agent-native/core/action";
import { and, asc, desc, eq, ilike, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { formSummarySchema } from "../shared/form-contract.js";
import {
  firstRow,
  formsAccess,
  formsErrors,
  orgScope,
  workspaceScope,
} from "./_access.js";
import { escapeLike, summarizeForms } from "./_form-store.js";

export default defineAction({
  description:
    "List forms in the current organization, optionally for one workspace, one folder or by a name substring. Excludes trashed forms.",
  schema: z.object({
    workspaceId: z.string().optional().describe("Only forms in this workspace"),
    folderId: z
      .string()
      .optional()
      .describe(
        'Only forms in this folder; "root" for forms outside every folder; omit for both',
      ),
    query: z
      .string()
      .max(200)
      .optional()
      .describe("Case-insensitive substring of the form name"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(200)
      .describe("Page size, 1 to 500; defaults to 200"),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Rows to skip; defaults to 0"),
  }),
  outputSchema: z.object({
    forms: z.array(formSummarySchema),
    total: z.number(),
  }),
  errors: formsErrors,
  http: { method: "GET" },
  run: async ({ workspaceId, folderId, query, limit, offset }) => {
    const access = formsAccess();
    const { forms, workspaces } = schema;
    const where = and(
      workspaceScope(access.orgId, access.userEmail),
      orgScope(forms, access.orgId),
      isNull(workspaces.deletedAt),
      ne(forms.status, "deleted"),
      workspaceId ? eq(forms.workspaceId, workspaceId) : undefined,
      folderId === "root" ? isNull(forms.folderId) : undefined,
      folderId && folderId !== "root"
        ? eq(forms.folderId, folderId)
        : undefined,
      query?.trim()
        ? ilike(forms.name, `%${escapeLike(query.trim())}%`)
        : undefined,
    );
    const db = getDb();
    const rows = await db
      .select({ form: forms })
      .from(forms)
      .innerJoin(workspaces, eq(workspaces.id, forms.workspaceId))
      .where(where)
      .orderBy(asc(forms.position), desc(forms.updatedAt))
      .limit(limit)
      .offset(offset);
    const count = firstRow(
      await db
        .select({ total: sql<number>`count(*)::int` })
        .from(forms)
        .innerJoin(workspaces, eq(workspaces.id, forms.workspaceId))
        .where(where),
    );
    return {
      forms: await summarizeForms(
        db,
        access.orgId,
        rows.map((row) => row.form),
      ),
      total: count?.total ?? 0,
    };
  },
});
