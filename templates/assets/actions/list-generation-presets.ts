import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import listTemplates from "./list-templates.js";

export default defineAction({
  description:
    "Deprecated — use list-templates. List reusable generation presets for a library.",
  schema: z.object({
    libraryId: z.string(),
    collectionId: z.string().optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ libraryId, collectionId }) => {
    const result = await listTemplates.run({
      libraryId,
      collectionId,
      scope: "all",
    });
    return { count: result.count, presets: result.templates };
  },
});
