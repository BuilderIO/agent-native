import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nowIso, parseJson, stringifyJson } from "../server/lib/json.js";
import { serializeTemplate } from "./_helpers.js";
import {
  assertTemplateTargetLibraryAccess,
  resolveTemplateAccess,
} from "./_template-access.js";
import { templateHasPins } from "./_template-input.js";

export default defineAction({
  description: "Copy an asset template into global scope or a Brand Kit.",
  schema: z.object({
    id: z.string(),
    libraryId: z.string().nullable().optional(),
    title: z.string().min(1).optional(),
    dropPins: z.boolean().optional(),
  }),
  run: async ({ id, libraryId, title, dropPins }) => {
    const source = (await resolveTemplateAccess(id, "viewer")).resource;
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Not authenticated");
    const targetLibraryId =
      libraryId === undefined ? source.libraryId : libraryId;
    await assertTemplateTargetLibraryAccess(targetLibraryId);
    const settings = parseJson<Record<string, unknown>>(source.settings, {});
    const pins = templateHasPins(settings);
    if (!targetLibraryId && pins.length && !dropPins)
      throw new Error(
        `Copying this template globally requires dropPins: true (${pins.join(", ")}).`,
      );
    const copiedSettings =
      !targetLibraryId && pins.length
        ? {
            ...settings,
            includeLogo: false,
            skeletonSpec: null,
            presetReferences: Array.isArray(settings.presetReferences)
              ? settings.presetReferences.map((entry: any) => ({
                  ...entry,
                  assetIds: [],
                }))
              : settings.presetReferences,
          }
        : settings;
    if (
      targetLibraryId &&
      source.libraryId &&
      source.libraryId !== targetLibraryId &&
      pins.length
    ) {
      throw new Error(
        "Copying pinned templates into another Brand Kit is not supported until its pinned assets are copied.",
      );
    }
    const now = nowIso();
    const row = {
      ...source,
      id: nanoid(),
      libraryId: targetLibraryId ?? null,
      collectionId:
        targetLibraryId === source.libraryId ? source.collectionId : null,
      title: title ?? `${source.title} (copy)`,
      settings: stringifyJson(copiedSettings),
      ownerEmail,
      orgId: getRequestOrgId(),
      visibility: "private" as const,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().insert(schema.assetTemplates).values(row);
    return serializeTemplate(row);
  },
});
