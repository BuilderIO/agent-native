import { defineAction } from "@agent-native/core";
import { and, eq, asc } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

export default defineAction({
  description: "Get all todos for a specific list.",
  schema: z.object({
    listId: z.string().describe("The list ID to fetch todos for"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const ownerEmail = getRequestUserEmail() ?? "local@localhost";
    const db = getDb();

    const todos = await db
      .select()
      .from(schema.todos)
      .where(
        and(
          eq(schema.todos.listId, args.listId),
          eq(schema.todos.ownerEmail, ownerEmail),
        ),
      )
      .orderBy(asc(schema.todos.position), asc(schema.todos.createdAt));

    return {
      todos: todos.map((t) => ({
        ...t,
        completed: Boolean(t.completed),
      })),
    };
  },
});
