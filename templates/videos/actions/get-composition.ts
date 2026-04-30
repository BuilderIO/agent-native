import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { resolveAccess } from "@agent-native/core/sharing";
import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description: "Get a single composition by ID",
  schema: z.object({
    id: z.string().optional().describe("Composition ID"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    if (!args.id) {
      return { error: "Composition id is required" };
    }

    const access = await resolveAccess("composition", args.id);
    if (!access) {
      return { error: "Composition not found" };
    }

    const row = access.resource;
    return {
      id: row.id,
      title: row.title,
      type: row.type,
      data: JSON.parse(row.data),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      ownerEmail: row.ownerEmail,
      orgId: row.orgId,
      visibility: row.visibility,
    };
  },
});
