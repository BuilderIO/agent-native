import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nowIso, parseJson } from "../server/lib/json.js";
import { serializeTemplate } from "./_helpers.js";
import {
  assertTemplateTargetLibraryAccess,
  resolveTemplateAccess,
} from "./_template-access.js";
import { templateHasPins } from "./_template-input.js";

export default defineAction({
  description: "Move an asset template between global scope and one Brand Kit.",
  schema: z.object({ id: z.string(), libraryId: z.string().nullable() }),
  run: async ({ id, libraryId }) => {
    const template = (await resolveTemplateAccess(id, "editor")).resource;
    await assertTemplateTargetLibraryAccess(libraryId);
    const pins = templateHasPins(
      parseJson<Record<string, unknown>>(template.settings, {}),
    );
    if (libraryId !== template.libraryId && pins.length) {
      throw new Error(
        `Clear pinned template settings before changing Brand Kits: ${pins.join(", ")}.`,
      );
    }
    const updates = {
      libraryId,
      ...(libraryId !== template.libraryId ? { collectionId: null } : {}),
      updatedAt: nowIso(),
    };
    await getDb()
      .update(schema.assetTemplates)
      .set(updates)
      .where(eq(schema.assetTemplates.id, id));
    return serializeTemplate({ ...template, ...updates });
  },
});
