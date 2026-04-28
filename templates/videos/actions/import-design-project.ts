import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { resolveAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "Import a design system from an existing design system for cloning/forking. " +
    "Returns the design system's tokens and assets so the agent can create a " +
    "new design system based on it.",
  schema: z.object({
    designSystemId: z.string().describe("Design system ID to import/fork from"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ designSystemId }) => {
    const access = await resolveAccess("design-system", designSystemId);
    if (!access) {
      return "Error: Design system not found";
    }

    const row = access.resource;
    return {
      source: "design-system" as const,
      sourceId: row.id,
      sourceTitle: row.title,
      extractedTokens: {
        cssCustomProperties: {},
        colors: [],
        fonts: [],
        googleFontsLinks: [],
        borderRadius: [],
        spacing: [],
      },
      existingDesignSystem: {
        id: row.id,
        title: row.title,
        data: row.data ? JSON.parse(row.data) : null,
        assets: row.assets ? JSON.parse(row.assets) : null,
      },
    };
  },
});
