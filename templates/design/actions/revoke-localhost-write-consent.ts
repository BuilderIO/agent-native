import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Revoke a previously granted localhost write-consent for a design + connection. " +
    "After revocation the agent can no longer write local files until the user re-grants consent. " +
    "Requires editor access on the design.",
  schema: z.object({
    designId: z.string().describe("Design ID."),
    connectionId: z
      .string()
      .describe("Localhost connection ID whose grant should be revoked."),
  }),
  run: async ({ designId, connectionId }) => {
    await assertAccess("design", designId, "editor");

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() ?? null;

    const db = getDb();

    // Select the scoped grant before deleting it so the result is explicit even
    // when the delete matches no row.
    const scope = and(
      eq(schema.designLocalhostWriteGrants.designId, designId),
      eq(schema.designLocalhostWriteGrants.connectionId, connectionId),
      eq(schema.designLocalhostWriteGrants.ownerEmail, ownerEmail),
      orgId
        ? eq(schema.designLocalhostWriteGrants.orgId, orgId)
        : isNull(schema.designLocalhostWriteGrants.orgId),
    );

    const [grant] = await db
      .select({ id: schema.designLocalhostWriteGrants.id })
      .from(schema.designLocalhostWriteGrants)
      .where(scope)
      .limit(1);

    await db.delete(schema.designLocalhostWriteGrants).where(scope);

    return {
      designId,
      connectionId,
      revoked: Boolean(grant),
    };
  },
});
