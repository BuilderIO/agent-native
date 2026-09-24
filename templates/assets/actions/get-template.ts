import { defineAction } from "@agent-native/core/action";
import { resolveAccess } from "@agent-native/core/sharing";
import { z } from "zod";

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
    const libraryAccess = template.libraryId
      ? await resolveAccess("asset-library", template.libraryId)
      : null;
    return serializeTemplate({
      ...template,
      accessRole: access.role,
      libraryTitle: libraryAccess?.resource.title ?? null,
    });
  },
});
