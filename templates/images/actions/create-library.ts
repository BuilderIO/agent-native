import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getDb, schema } from "../server/db/index.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { nowIso, stringifyJson } from "../server/lib/json.js";
import { serializeLibrary } from "./_helpers.js";

export default defineAction({
  description:
    "Create a brand image library. Libraries contain reference images, style guidance, generated candidates, and saved assets.",
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
    await getDb().insert(schema.imageLibraries).values(row);
    return serializeLibrary(row);
  },
});
