import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import type { FormField, FormSettings } from "../shared/types.js";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export default defineAction({
  description: "Update an existing form.",
  parameters: {
    id: { type: "string", description: "Form ID (required)" },
    title: { type: "string", description: "New title" },
    description: { type: "string", description: "New description" },
    slug: { type: "string", description: "New URL slug" },
    fields: { type: "string", description: "JSON array of form fields" },
    settings: { type: "string", description: "JSON object of form settings" },
    status: {
      type: "string",
      description: "New status",
      enum: ["draft", "published", "closed"],
    },
  },
  run: async (args) => {
    if (!args.id) {
      throw new Error("--id is required");
    }

    const db = getDb();
    const existing = await db
      .select()
      .from(schema.forms)
      .where(eq(schema.forms.id, args.id))
      .get();

    if (!existing) {
      throw new Error(`Form ${args.id} not found`);
    }

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (args.title !== undefined) {
      updates.title = args.title;
      if (args.slug === undefined) {
        const idSuffix = args.id.slice(0, 6);
        updates.slug = slugify(args.title || "untitled") + "-" + idSuffix;
      }
    }
    if (args.description !== undefined) updates.description = args.description;
    if (args.slug !== undefined) updates.slug = args.slug;
    if (args.fields !== undefined) {
      if (typeof args.fields === "string") {
        try {
          JSON.parse(args.fields);
          updates.fields = args.fields;
        } catch {
          throw new Error("--fields must be valid JSON");
        }
      } else {
        updates.fields = JSON.stringify(args.fields);
      }
    }
    if (args.settings !== undefined) {
      if (typeof args.settings === "string") {
        try {
          JSON.parse(args.settings);
          updates.settings = args.settings;
        } catch {
          throw new Error("--settings must be valid JSON");
        }
      } else {
        updates.settings = JSON.stringify(args.settings);
      }
    }
    if (args.status !== undefined) updates.status = args.status;

    await db
      .update(schema.forms)
      .set(updates)
      .where(eq(schema.forms.id, args.id));

    const row = await db
      .select()
      .from(schema.forms)
      .where(eq(schema.forms.id, args.id))
      .get();

    return {
      id: row!.id,
      title: row!.title,
      description: row!.description ?? undefined,
      slug: row!.slug,
      fields: JSON.parse(row!.fields) as FormField[],
      settings: JSON.parse(row!.settings) as FormSettings,
      status: row!.status,
      createdAt: row!.createdAt,
      updatedAt: row!.updatedAt,
    };
  },
});
