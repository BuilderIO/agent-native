import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { eq, and, asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

const schema = z.object({
  operation: z
    .enum(["list", "create", "update", "delete"])
    .default("list")
    .describe("Snippet operation to perform"),
  id: z.string().optional().describe("Snippet ID (for update/delete)"),
  name: z
    .string()
    .optional()
    .describe("Short name shown in the compose slash menu"),
  body: z
    .string()
    .optional()
    .describe("Snippet text inserted into the compose body"),
});

export default defineAction({
  description:
    "List, create, update, or delete reusable email snippets (canned responses) that can be inserted into a compose draft from the slash menu.",
  schema,
  run: async (args) => {
    const { db, schema: dbSchema } = await import("../server/db/index.js");

    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    switch (args.operation) {
      case "list": {
        const rows = await db
          .select()
          .from(dbSchema.snippets)
          .where(eq(dbSchema.snippets.ownerEmail, ownerEmail))
          .orderBy(asc(dbSchema.snippets.name));
        return { ok: true as const, snippets: rows };
      }

      case "create": {
        if (!args.name?.trim() || !args.body?.trim()) {
          throw new Error("name and body are required to create a snippet");
        }

        const now = Date.now();
        const snippet = {
          id: nanoid(12),
          ownerEmail,
          name: args.name.trim(),
          body: args.body,
          createdAt: now,
          updatedAt: now,
        };

        await db.insert(dbSchema.snippets).values(snippet);
        return { ok: true as const, snippet };
      }

      case "update": {
        if (!args.id) throw new Error("id is required to update a snippet");

        const updates: Record<string, unknown> = { updatedAt: Date.now() };
        if (args.name !== undefined) {
          if (!args.name.trim()) throw new Error("name cannot be empty");
          updates.name = args.name.trim();
        }
        if (args.body !== undefined) updates.body = args.body;

        const [snippet] = await db
          .update(dbSchema.snippets)
          .set(updates)
          .where(
            and(
              eq(dbSchema.snippets.id, args.id),
              eq(dbSchema.snippets.ownerEmail, ownerEmail),
            ),
          )
          .returning();

        if (!snippet) throw new Error("snippet not found");
        return { ok: true as const, snippet };
      }

      case "delete": {
        if (!args.id) throw new Error("id is required to delete a snippet");

        await db
          .delete(dbSchema.snippets)
          .where(
            and(
              eq(dbSchema.snippets.id, args.id),
              eq(dbSchema.snippets.ownerEmail, ownerEmail),
            ),
          );

        return { ok: true as const, id: args.id };
      }

      default:
        throw new Error(`Unknown operation "${args.operation}"`);
    }
  },
});
