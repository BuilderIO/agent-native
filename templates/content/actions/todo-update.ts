import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

export default defineAction({
  description: "Update a todo item — title, notes, priority, due date, or completed status.",
  schema: z.object({
    id: z.string().describe("The todo ID to update"),
    title: z.string().optional().describe("New title"),
    notes: z.string().optional().describe("New notes"),
    completed: z.boolean().optional().describe("Mark as completed or not"),
    priority: z
      .enum(["none", "low", "medium", "high"])
      .optional()
      .describe("New priority"),
    dueDate: z.string().nullable().optional().describe("New due date (ISO YYYY-MM-DD) or null to clear"),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail() ?? "local@localhost";
    const db = getDb();
    const now = new Date().toISOString();

    const updates: Record<string, unknown> = { updatedAt: now };
    if (args.title !== undefined) updates.title = args.title;
    if (args.notes !== undefined) updates.notes = args.notes;
    if (args.completed !== undefined) updates.completed = args.completed ? 1 : 0;
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.dueDate !== undefined) updates.dueDate = args.dueDate;

    await db
      .update(schema.todos)
      .set(updates)
      .where(
        and(
          eq(schema.todos.id, args.id),
          eq(schema.todos.ownerEmail, ownerEmail),
        ),
      );

    const [todo] = await db
      .select()
      .from(schema.todos)
      .where(eq(schema.todos.id, args.id));

    return { ...todo, completed: Boolean(todo.completed) };
  },
});
