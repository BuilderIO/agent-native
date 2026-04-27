import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

export default defineAction({
  description: "Delete all completed todos from a list.",
  schema: z.object({
    listId: z.string().describe("The list to clear completed todos from"),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail() ?? "local@localhost";
    const db = getDb();

    await db
      .delete(schema.todos)
      .where(
        and(
          eq(schema.todos.listId, args.listId),
          eq(schema.todos.ownerEmail, ownerEmail),
          eq(schema.todos.completed, 1),
        ),
      );

    return { ok: true, listId: args.listId };
  },
});
