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
import {
  getActiveOrganizationId,
  getCurrentOwnerEmail,
} from "../server/lib/meetings.js";

export default defineAction({
  description:
    "List note enhancement templates for the current organization. Includes built-in templates and user-created ones.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const db = getDb();
    const orgId = await getActiveOrganizationId();

    // When the caller has an active org, list that org's templates. When they
    // don't (brand new user with no membership yet), fall back to ONLY their
    // own templates -- never list other tenants' rows. The previous behavior
    // ("no orgId means list everything") leaked another tenant's templates.
    let rows;
    if (orgId) {
      // guard:allow-unscoped — explicitly tenanted via organization_id (a
      // tenant FK distinct from the ownable's `org_id`). The orgId is
      // resolved server-side from org_members for the request email.
      rows = await db
        .select()
        .from(schema.meetingTemplates)
        .where(eq(schema.meetingTemplates.organizationId, orgId))
        .orderBy(asc(schema.meetingTemplates.name));
    } else {
      const email = getCurrentOwnerEmail();
      rows = await db
        .select()
        .from(schema.meetingTemplates)
        .where(eq(schema.meetingTemplates.ownerEmail, email))
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
