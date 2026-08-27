import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { serializeTemplate } from "./_helpers.js";
import { resolveTemplateAccess } from "./_template-access.js";

export default defineAction({
  description: "Get an accessible reusable asset template.",
  schema: z.object({ id: z.string() }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ id }) => {
    const access = await resolveTemplateAccess(id, "viewer");
    const template = access.resource;
    const [library] = template.libraryId
      ? await getDb()
          .select({ title: schema.assetLibraries.title })
          .from(schema.assetLibraries)
          .where(eq(schema.assetLibraries.id, template.libraryId))
          .limit(1)
      : [null];
    return serializeTemplate({
      ...template,
      accessRole: access.role,
      libraryTitle: library?.title ?? null,
    });
  },
});
