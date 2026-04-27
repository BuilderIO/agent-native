import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

export default defineAction({
  description: "Update a todo list's title, description, color, or icon.",
  schema: z.object({
    id: z.string().describe("The list ID to update"),
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    color: z
      .enum(["blue", "green", "red", "purple", "orange", "pink", "teal"])
      .optional()
      .describe("New color theme"),
    icon: z.string().optional().describe("New emoji icon"),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail() ?? "local@localhost";
    const db = getDb();
    const now = new Date().toISOString();

    const updates: Record<string, unknown> = { updatedAt: now };
    if (args.title !== undefined) updates.title = args.title;
    if (args.description !== undefined) updates.description = args.description;
    if (args.color !== undefined) updates.color = args.color;
    if (args.icon !== undefined) updates.icon = args.icon;

    await db
      .update(schema.todoLists)
      .set(updates)
      .where(
        and(
          eq(schema.todoLists.id, args.id),
          eq(schema.todoLists.ownerEmail, ownerEmail),
        ),
      );

    const [list] = await db
      .select()
      .from(schema.todoLists)
      .where(eq(schema.todoLists.id, args.id));

    return list;
  },
});
