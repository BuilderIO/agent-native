import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
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

    const db = getDb();

    // The delete result's rows-affected shape varies by driver (and some
    // drivers do not report it at all), so SELECT the scoped grant first and
    // derive `revoked` from its existence — portable across dialects without
    // assuming RETURNING support.
    const scope = and(
      eq(schema.designLocalhostWriteGrants.designId, designId),
      eq(schema.designLocalhostWriteGrants.connectionId, connectionId),
      eq(schema.designLocalhostWriteGrants.ownerEmail, ownerEmail),
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
