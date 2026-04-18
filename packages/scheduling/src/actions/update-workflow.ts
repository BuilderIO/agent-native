import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { getSchedulingContext } from "../server/context.js";

export default defineAction({
  description:
    "Update workflow name/trigger/active-event-types, or replace its steps",
  schema: z.object({
    id: z.string(),
    name: z.string().optional(),
    trigger: z
      .enum([
        "new-booking",
        "before-event",
        "after-event",
        "reschedule",
        "cancellation",
        "no-show",
      ])
      .optional(),
    disabled: z.boolean().optional(),
    activeOnEventTypeIds: z.array(z.string()).optional(),
    steps: z
      .array(
        z.object({
          action: z.enum([
            "email-host",
            "email-attendee",
            "email-address",
            "sms-attendee",
            "sms-host",
            "sms-number",
            "webhook",
          ]),
          offsetMinutes: z.number().default(0),
          sendTo: z.string().optional(),
          emailSubject: z.string().optional(),
          emailBody: z.string().optional(),
          smsBody: z.string().optional(),
          webhookUrl: z.string().optional(),
          template: z.string().optional(),
        }),
      )
      .optional(),
  }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const now = new Date().toISOString();
    const set: any = { updatedAt: now };
    if (args.name != null) set.name = args.name;
    if (args.trigger != null) set.trigger = args.trigger;
    if (args.disabled != null) set.disabled = args.disabled;
    if (args.activeOnEventTypeIds != null)
      set.activeOnEventTypeIds = JSON.stringify(args.activeOnEventTypeIds);
    await getDb()
      .update(schema.workflows)
      .set(set)
      .where(eq(schema.workflows.id, args.id));
    if (args.steps) {
      await getDb()
        .delete(schema.workflowSteps)
        .where(eq(schema.workflowSteps.workflowId, args.id));
      for (let i = 0; i < args.steps.length; i++) {
        const s = args.steps[i];
        await getDb()
          .insert(schema.workflowSteps)
          .values({
            id: nanoid(),
            workflowId: args.id,
            order: i,
            action: s.action,
            offsetMinutes: s.offsetMinutes,
            sendTo: s.sendTo ?? null,
            emailSubject: s.emailSubject ?? null,
            emailBody: s.emailBody ?? null,
            smsBody: s.smsBody ?? null,
            webhookUrl: s.webhookUrl ?? null,
            template: s.template ?? null,
            createdAt: now,
          });
      }
    }
    return { ok: true };
  },
});
