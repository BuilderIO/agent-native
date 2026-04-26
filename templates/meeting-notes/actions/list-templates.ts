/**
 * List note enhancement templates.
 *
 * Usage:
 *   pnpm action list-templates
 */

import { defineAction } from "@agent-native/core";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getActiveOrganizationId } from "../server/lib/meetings.js";

export default defineAction({
  description:
    "List note enhancement templates for the current organization. Includes built-in templates and user-created ones.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const db = getDb();
    const orgId = await getActiveOrganizationId();

    let rows;
    if (orgId) {
      rows = await db
        .select()
        .from(schema.meetingTemplates)
        .where(eq(schema.meetingTemplates.organizationId, orgId))
        .orderBy(asc(schema.meetingTemplates.name));
    } else {
      rows = await db
        .select()
        .from(schema.meetingTemplates)
        .orderBy(asc(schema.meetingTemplates.name));
    }

    return {
      templates: rows.map((t) => ({
        id: t.id,
        name: t.name,
        prompt: t.prompt,
        isBuiltIn: Boolean(t.isBuiltIn),
        createdAt: t.createdAt,
      })),
    };
  },
});
