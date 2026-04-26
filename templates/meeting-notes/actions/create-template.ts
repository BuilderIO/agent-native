/**
 * Create a custom note enhancement template.
 *
 * Usage:
 *   pnpm action create-template --name="Standup" --prompt="Structure as: Yesterday, Today, Blockers"
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  nanoid,
  requireActiveOrganizationId,
} from "../server/lib/meetings.js";

export default defineAction({
  description:
    "Create a custom note enhancement template. Templates define how the AI structures enhanced notes.",
  schema: z.object({
    name: z.string().describe("Template name"),
    prompt: z
      .string()
      .describe(
        "Prompt that tells the AI how to structure enhanced notes using this template",
      ),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();
    const id = nanoid();
    const now = new Date().toISOString();
    const organizationId = await requireActiveOrganizationId();

    await db.insert(schema.meetingTemplates).values({
      id,
      organizationId,
      name: args.name.trim(),
      prompt: args.prompt,
      isBuiltIn: false,
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    console.log(`Created template "${args.name}" (${id})`);
    return { id, name: args.name };
  },
});
