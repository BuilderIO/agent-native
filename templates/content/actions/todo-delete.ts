import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

export default defineAction({
  description: "Delete a todo item.",
  schema: z.object({
    id: z.string().describe("The todo ID to delete"),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail() ?? "local@localhost";
    const db = getDb();

    await db
      .delete(schema.todos)
      .where(
        and(
          eq(schema.todos.id, args.id),
          eq(schema.todos.ownerEmail, ownerEmail),
        ),
      );

    return { ok: true, id: args.id };
  },
});
