import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { resolveAccess } from "@agent-native/core/sharing";
import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "Get a design system by ID. Returns full design system data including colors, typography, spacing, and assets.",
  schema: z.object({
    id: z.string().describe("Design system ID"),
  }),
  readOnly: true,
  run: async ({ id }) => {
    const access = await resolveAccess("design-system", id);
    if (!access) {
      return "Error: Design system not found";
    }

    const row = access.resource;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      data: row.data ? JSON.parse(row.data) : null,
      assets: row.assets ? JSON.parse(row.assets) : null,
      isDefault: row.isDefault,
      visibility: row.visibility,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },
});
