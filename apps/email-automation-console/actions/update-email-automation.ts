import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, schema } from "../server/db/index.js";
import {
  DEFAULT_AUTOMATION,
  DEFAULT_AUTOMATION_SLUG,
  automationResponse,
  findAutomation,
  requireOwnerEmail,
} from "../server/lib/email-automation.js";

export default defineAction({
  description:
    "Update the daily digest automation configuration. Pass only fields that changed; the schedule is preserved unless explicitly changed.",
  schema: z.object({
    id: z.string().optional().describe("Persisted automation id, if known"),
    name: z.string().trim().min(1).max(120).optional(),
    schedule: z.string().trim().min(1).max(120).optional(),
    recipient: z.string().email().max(320).optional(),
    prompt: z.string().trim().min(1).max(4000).optional(),
  }),
  run: async (args) => {
    const ownerEmail = requireOwnerEmail();
    const existing = await findAutomation(ownerEmail, args.id);
    const now = new Date().toISOString();

    if (!existing) {
      const created = await db()
        .insert(schema.emailAutomations)
        .values({
          id: crypto.randomUUID(),
          ownerEmail,
          slug: DEFAULT_AUTOMATION_SLUG,
          name: args.name ?? DEFAULT_AUTOMATION.name,
          schedule: args.schedule ?? DEFAULT_AUTOMATION.schedule,
          recipient: args.recipient ?? DEFAULT_AUTOMATION.recipient,
          prompt: args.prompt ?? DEFAULT_AUTOMATION.prompt,
          updatedAt: now,
        })
        .onConflictDoNothing({
          target: [
            schema.emailAutomations.ownerEmail,
            schema.emailAutomations.slug,
          ],
        })
        .returning();
      if (created[0]) return automationResponse(created[0]);

      // Another first save won the unique insert race. Read its row so both
      // callers return the same durable default automation.
      return automationResponse(await findAutomation(ownerEmail));
    }

    const updated = await db()
      .update(schema.emailAutomations)
      .set({
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.schedule !== undefined ? { schedule: args.schedule } : {}),
        ...(args.recipient !== undefined ? { recipient: args.recipient } : {}),
        ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.emailAutomations.id, existing.id),
          eq(schema.emailAutomations.ownerEmail, ownerEmail),
        ),
      )
      .returning();
    return automationResponse(updated[0] ?? existing);
  },
});
