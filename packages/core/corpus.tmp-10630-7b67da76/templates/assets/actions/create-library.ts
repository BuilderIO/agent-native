import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { seedDefaultGenerationPresets } from "../server/lib/generation-presets.js";
import { nowIso, stringifyJson } from "../server/lib/json.js";
import { serializeLibrary } from "./_helpers.js";

export default defineAction({
  description:
    "Create an asset library. Libraries contain uploaded images/videos, references, style guidance, generated candidates, and saved assets.",
  schema: z.object({
    title: z.string().min(1).describe("Library name"),
    description: z.string().optional().describe("Optional library description"),
    customInstructions: z
      .string()
      .optional()
      .describe("Optional custom generation instructions for this library"),
    styleDescription: z
      .string()
      .optional()
      .describe("Optional initial style brief text"),
    palette: z
      .array(z.string())
      .optional()
      .describe("Optional brand palette as hex colors"),
  }),
  run: async ({
    title,
    description,
    customInstructions,
    styleDescription,
    palette,
  }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const now = nowIso();
    const row = {
      id: nanoid(),
      title,
      description: description ?? null,
      customInstructions: customInstructions ?? "",
      styleBrief: stringifyJson({
        description: styleDescription ?? "",
        palette: palette ?? [],
      }),
      settings: "{}",
      ownerEmail,
      orgId: getRequestOrgId(),
      createdAt: now,
      updatedAt: now,
    };
    const db = getDb();
    await db.insert(schema.assetLibraries).values(row);
    await seedDefaultGenerationPresets({ db, libraryId: row.id, now });
    return serializeLibrary(row);
  },
});
