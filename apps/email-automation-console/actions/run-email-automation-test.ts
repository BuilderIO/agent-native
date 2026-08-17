import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { db, schema } from "../server/db/index.js";
import {
  buildPreview,
  DEFAULT_AUTOMATION,
  findAutomation,
  requireOwnerEmail,
  runResponse,
} from "../server/lib/email-automation.js";

export default defineAction({
  description:
    "Run the daily digest automation now against the saved configuration. This MVP creates a durable, styled preview and explicitly sends no email; use it to iterate safely before connecting a real delivery action.",
  schema: z.object({
    automationId: z
      .string()
      .optional()
      .describe("Persisted automation id, if known"),
  }),
  run: async ({ automationId }) => {
    const ownerEmail = requireOwnerEmail();
    const automation = await findAutomation(ownerEmail, automationId);
    const config = automation ?? {
      ...DEFAULT_AUTOMATION,
      id: "unsaved-daily-digest",
    };
    const preview = buildPreview(config.prompt);
    const createdAt = new Date().toISOString();
    const created = await db()
      .insert(schema.emailAutomationRuns)
      .values({
        id: crypto.randomUUID(),
        ownerEmail,
        automationId: config.id,
        recipient: config.recipient,
        status: "preview_ready",
        stage: "preview_created",
        errorMessage: null,
        subject: preview.subject,
        previewIntro: preview.intro,
        previewItems: JSON.stringify(preview.items),
        promptSnapshot: config.prompt,
        createdAt,
        completedAt: createdAt,
      })
      .returning();
    const run = created[0];
    if (!run) throw new Error("The test run could not be saved.");

    return {
      ...runResponse(run),
      message: "Preview created. No email was sent.",
    };
  },
});
