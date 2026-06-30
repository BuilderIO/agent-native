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

    const deleted = await db
      .delete(schema.designLocalhostWriteGrants)
      .where(
        and(
          eq(schema.designLocalhostWriteGrants.designId, designId),
          eq(schema.designLocalhostWriteGrants.connectionId, connectionId),
          eq(schema.designLocalhostWriteGrants.ownerEmail, ownerEmail),
        ),
      );

    // `deleted` shape varies by dialect; check rows affected via the object.
    const rowsAffected =
      (deleted as unknown as { rowsAffected?: number })?.rowsAffected ?? 0;

    return {
      designId,
      connectionId,
      revoked: rowsAffected > 0,
    };
  },
});
