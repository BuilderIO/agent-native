import { z } from "zod";
import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { eq, and, or, isNull } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Delete a Knowledge Q&A session owned by the current user.",
  schema: z.object({ id: z.string() }),
  http: { method: "DELETE" },
  run: async ({ id }) => {
    const db = getDb();
    const userEmail = getRequestUserEmail() ?? null;

    await db
      .delete(schema.askSessions)
      .where(
        and(
          eq(schema.askSessions.id, id),
          userEmail
            ? or(
                eq(schema.askSessions.userEmail, userEmail),
                isNull(schema.askSessions.userEmail),
              )
            : undefined,
        ),
      );

    return { ok: true };
  },
});
