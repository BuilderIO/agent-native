import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { getDb, schema } from "../server/db/index.js";
import { nowIso, stringifyJson } from "../server/lib/json.js";
import { serializeLibrary } from "./_helpers.js";
import {
  DEFAULT_LIBRARY_PRESET_VERSION,
  getLibraryPreset,
} from "../shared/library-presets.js";

export default defineAction({
  description:
    "Create an editable asset library from a built-in style preset, such as tactile 3D, storybook painting, clay studio, or paper-cut collage.",
  schema: z.object({
    presetId: z.string().min(1).describe("Built-in library preset ID"),
    title: z
      .string()
      .min(1)
      .optional()
      .describe("Optional custom name for the new library"),
    description: z
      .string()
      .optional()
      .describe("Optional custom description for the new library"),
  }),
  run: async ({ presetId, title, description }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    const preset = getLibraryPreset(presetId);
    if (!preset) {
      throw new Error(`Unknown asset library preset: ${presetId}`);
    }

    const now = nowIso();
    const row = {
      id: nanoid(),
      title: title?.trim() || preset.title,
      description: description?.trim() || preset.description,
      customInstructions: preset.customInstructions,
      styleBrief: stringifyJson(preset.styleBrief),
      settings: stringifyJson({
        source: "default-library-preset",
        presetId: preset.id,
        presetVersion: DEFAULT_LIBRARY_PRESET_VERSION,
        tags: preset.tags,
        samplePrompts: preset.samplePrompts,
      }),
      ownerEmail,
      orgId: getRequestOrgId(),
      createdAt: now,
      updatedAt: now,
    };

    await getDb().insert(schema.assetLibraries).values(row);

    return {
      ...serializeLibrary(row),
      referenceCount: 0,
      generatedCount: 0,
      videoCount: 0,
      preset,
    };
  },
});
