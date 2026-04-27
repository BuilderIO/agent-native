import { defineAction } from "@agent-native/core";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server/request-context";
import { z } from "zod";

function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

export default defineAction({
  description: "Create a new todo item in a list.",
  schema: z.object({
    listId: z.string().describe("The list to add the todo to"),
    title: z.string().describe("The todo title/text"),
    notes: z.string().optional().describe("Optional longer notes or details"),
    priority: z
      .enum(["none", "low", "medium", "high"])
      .optional()
      .describe("Priority level"),
    dueDate: z.string().optional().describe("Due date in ISO format (YYYY-MM-DD)"),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail() ?? "local@localhost";
    const orgId = getRequestOrgId() ?? null;
    const db = getDb();

    const maxPos = await db
      .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
      .from(schema.todos)
      .where(
        and(
          eq(schema.todos.listId, args.listId),
          eq(schema.todos.ownerEmail, ownerEmail),
        ),
      );

    const position = (maxPos[0]?.max ?? -1) + 1;
    const now = new Date().toISOString();
    const id = nanoid();

    await db.insert(schema.todos).values({
      id,
      listId: args.listId,
      ownerEmail,
      orgId,
      title: args.title,
      notes: args.notes ?? "",
      completed: 0,
      priority: args.priority ?? "none",
      dueDate: args.dueDate ?? null,
      position,
      createdAt: now,
      updatedAt: now,
    });

    const [todo] = await db
      .select()
      .from(schema.todos)
      .where(eq(schema.todos.id, id));

    return { ...todo, completed: Boolean(todo.completed) };
  },
});
