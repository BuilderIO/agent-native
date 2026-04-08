import { defineAction } from "@agent-native/core";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Create or update a composition. Upserts by ID — creates if new, updates if existing.",
  parameters: {
    id: { type: "string", description: "Composition ID" },
    title: { type: "string", description: "Composition title" },
    type: { type: "string", description: "Composition type" },
    data: {
      type: "string",
      description: "Composition data as JSON string",
    },
  },
  run: async (args) => {
    if (!args.id || !args.title || !args.type) {
      return { error: "Composition must have id, title, and type" };
    }

    const now = new Date().toISOString();
    const db = getDb();
    const dataStr = args.data || "{}";

    await db
      .insert(schema.compositions)
      .values({
        id: args.id,
        title: args.title,
        type: args.type,
        data: dataStr,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.compositions.id,
        set: {
          title: args.title,
          type: args.type,
          data: dataStr,
          updatedAt: now,
        },
      });

    let parsedData = {};
    try {
      parsedData = JSON.parse(dataStr);
    } catch {
      // keep empty
    }

    return {
      id: args.id,
      title: args.title,
      type: args.type,
      data: parsedData,
      createdAt: now,
      updatedAt: now,
    };
  },
});
