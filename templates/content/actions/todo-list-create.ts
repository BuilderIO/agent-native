import { defineAction } from "@agent-native/core";
import { eq, sql } from "drizzle-orm";
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
  description: "Create a new todo list.",
  schema: z.object({
    title: z.string().describe("Title of the todo list"),
    description: z.string().optional().describe("Optional description"),
    color: z
      .enum(["blue", "green", "red", "purple", "orange", "pink", "teal"])
      .optional()
      .describe("Color theme for the list"),
    icon: z.string().optional().describe("Emoji icon for the list"),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail() ?? "local@localhost";
    const orgId = getRequestOrgId() ?? null;
    const db = getDb();

    const maxPos = await db
      .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
      .from(schema.todoLists)
      .where(eq(schema.todoLists.ownerEmail, ownerEmail));

    const position = (maxPos[0]?.max ?? -1) + 1;
    const now = new Date().toISOString();
    const id = nanoid();

    await db.insert(schema.todoLists).values({
      id,
      ownerEmail,
      orgId,
      title: args.title,
      description: args.description ?? "",
      color: args.color ?? "blue",
      icon: args.icon ?? null,
      position,
      createdAt: now,
      updatedAt: now,
    });

    const [list] = await db
      .select()
      .from(schema.todoLists)
      .where(eq(schema.todoLists.id, id));

    return list;
  },
});
