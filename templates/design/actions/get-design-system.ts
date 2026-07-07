import { defineAction } from "@agent-native/core";
import {
  hydrateBuilderDesignSystemReference,
  parseBuilderDesignSystemProxyReference,
} from "@agent-native/core/server";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "Get a design system by ID. Returns full design system data including colors, typography, spacing, and assets.",
  schema: z.object({
    id: z.string().describe("Design system ID"),
  }),
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id }) => {
    const access = await resolveAccess("design-system", id);
    if (!access) {
      throw new Error("Design system not found");
    }

    const row = access.resource;
    const builderReference = parseBuilderDesignSystemProxyReference(row.data);
    const builder = builderReference
      ? await hydrateBuilderDesignSystemReference(builderReference).catch(
          (error) => ({
            ...builderReference,
            docs: [],
            tokenValues: {},
            docCount: 0,
            warning:
              error instanceof Error
                ? error.message
                : "Builder design-system docs could not be loaded.",
          }),
        )
      : null;

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      data: row.data ?? null,
      assets: row.assets ?? null,
      customInstructions: row.customInstructions ?? "",
      isDefault: row.isDefault,
      visibility: row.visibility,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      builder,
    };
  },
});
