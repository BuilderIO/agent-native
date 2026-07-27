import { defineAction } from "@agent-native/core";
import {
  accessFilter,
  currentAccess,
  ROLE_RANK,
  type ShareRole,
} from "@agent-native/core/sharing";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "List forms with response counts. Hides soft-deleted forms by default; pass `--archived` to list those instead.",
  schema: z.object({
    status: z
      .enum(["draft", "published", "closed"])
      .optional()
      .describe("Filter by status: draft, published, or closed"),
    archived: z.coerce
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When true, return only soft-deleted forms (the Archive). Default false.",
      ),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    // Explicit projection: the list view only needs lightweight metadata.
    // The heavy `fields` / `settings` JSON blobs are intentionally NOT
    // selected here — they can be large and are only required when opening a
    // single form (`get-form`). Keeping them out of the list query avoids
    // pulling (and JSON.parsing) every form's full schema on every list load.
    const rows = await db
      .select({
        id: schema.forms.id,
        title: schema.forms.title,
        description: schema.forms.description,
        slug: schema.forms.slug,
        status: schema.forms.status,
        visibility: schema.forms.visibility,
        ownerEmail: schema.forms.ownerEmail,
        createdAt: schema.forms.createdAt,
        updatedAt: schema.forms.updatedAt,
        deletedAt: schema.forms.deletedAt,
      })
      .from(schema.forms)
      .where(
        and(
          accessFilter(schema.forms, schema.formShares),
          args.archived
            ? isNotNull(schema.forms.deletedAt)
            : isNull(schema.forms.deletedAt),
          args.status ? eq(schema.forms.status, args.status) : undefined,
        ),
      )
      .orderBy(desc(schema.forms.updatedAt));

    // Per-form effective role for the current user. Used by the UI to hide
    // controls viewers shouldn't see (Delete, Duplicate, Publish, etc.).
    const { userEmail, orgId } = currentAccess();
    const formIds = rows.map((r) => r.id);
    const countsPromise =
      formIds.length > 0
        ? db
            .select({
              formId: schema.responses.formId,
              count: sql<number>`count(*)`,
            })
            .from(schema.responses)
            .where(
              formIds.length === 1
                ? eq(schema.responses.formId, formIds[0]!)
                : inArray(schema.responses.formId, formIds),
            )
            .groupBy(schema.responses.formId)
        : Promise.resolve([]);
    const countMap = new Map(
      (await countsPromise).map((c) => [c.formId, c.count]),
    );

    const shareRoleByForm = new Map<string, ShareRole>();
    if (formIds.length > 0 && (userEmail || orgId)) {
      const principalClauses = [];
      if (userEmail) {
        principalClauses.push(
          and(
            eq(schema.formShares.principalType, "user"),
            eq(schema.formShares.principalId, userEmail),
          ),
        );
      }
      if (orgId) {
        principalClauses.push(
          and(
            eq(schema.formShares.principalType, "org"),
            eq(schema.formShares.principalId, orgId),
          ),
        );
      }
      const shareRows = await db
        .select({
          resourceId: schema.formShares.resourceId,
          role: schema.formShares.role,
        })
        .from(schema.formShares)
        .where(
          and(
            inArray(schema.formShares.resourceId, formIds),
            or(...principalClauses),
          ),
        );
      for (const s of shareRows as Array<{
        resourceId: string;
        role: ShareRole;
      }>) {
        const existing = shareRoleByForm.get(s.resourceId);
        if (!existing || ROLE_RANK[s.role] > ROLE_RANK[existing]) {
          shareRoleByForm.set(s.resourceId, s.role);
        }
      }
    }

    return rows.map((r) => {
      let role: "owner" | ShareRole = "viewer";
      if (userEmail && r.ownerEmail === userEmail) {
        role = "owner";
      } else {
        const shareRole = shareRoleByForm.get(r.id);
        if (shareRole) role = shareRole;
        // otherwise visible via org/public visibility — viewer is correct
      }
      return {
        id: r.id,
        title: r.title,
        description: r.description ?? undefined,
        slug: r.slug,
        status: r.status,
        visibility: r.visibility,
        ownerEmail: r.ownerEmail,
        role,
        responseCount: countMap.get(r.id) ?? 0,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        deletedAt: r.deletedAt ?? null,
      };
    });
  },
});
