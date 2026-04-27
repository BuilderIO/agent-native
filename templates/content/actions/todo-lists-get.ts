import { defineAction } from "@agent-native/core";
import { eq, asc, sql } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

export default defineAction({
  description: "Get all todo lists for the current user, with todo counts.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const ownerEmail = getRequestUserEmail() ?? "local@localhost";
    const db = getDb();

    const lists = await db
      .select()
      .from(schema.todoLists)
      .where(eq(schema.todoLists.ownerEmail, ownerEmail))
      .orderBy(asc(schema.todoLists.position));

    // For each list, get todo counts
    const listsWithCounts = await Promise.all(
      lists.map(async (list) => {
        const [counts] = await db
          .select({
            total: sql<number>`COUNT(*)`,
            completed: sql<number>`SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END)`,
          })
          .from(schema.todos)
          .where(eq(schema.todos.listId, list.id));

        return {
          ...list,
          totalCount: Number(counts?.total ?? 0),
          completedCount: Number(counts?.completed ?? 0),
        };
      }),
    );

    return { lists: listsWithCounts };
  },
});
