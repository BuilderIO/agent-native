import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

export default defineAction({
  description: "Delete a todo list and all its todos.",
  schema: z.object({
    id: z.string().describe("The list ID to delete"),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail() ?? "local@localhost";
    const db = getDb();

    // Delete all todos in this list first
    await db
      .delete(schema.todos)
      .where(eq(schema.todos.listId, args.id));

    // Delete the list
    await db
      .delete(schema.todoLists)
      .where(
        and(
          eq(schema.todoLists.id, args.id),
          eq(schema.todoLists.ownerEmail, ownerEmail),
        ),
      );

    return { ok: true, id: args.id };
  },
});
