import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getSchedulingContext } from "../server/context.js";
import { currentUserEmail, currentOrgId } from "./_helpers.js";

export default defineAction({
  description: "Create a workflow with optional initial steps",
  schema: z.object({
    name: z.string(),
    trigger: z.enum([
      "new-booking",
      "before-event",
      "after-event",
      "reschedule",
      "cancellation",
      "no-show",
    ]),
    teamId: z.string().optional(),
    activeOnEventTypeIds: z.array(z.string()).default([]),
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
      .default([]),
  }),
  run: async (args) => {
    const { getDb, schema } = getSchedulingContext();
    const id = nanoid();
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.workflows)
      .values({
        id,
        name: args.name,
        trigger: args.trigger,
        teamId: args.teamId ?? null,
        activeOnEventTypeIds: JSON.stringify(args.activeOnEventTypeIds),
        disabled: false,
        ownerEmail: args.teamId ? null : currentUserEmail(),
        orgId: currentOrgId() ?? null,
        createdAt: now,
        updatedAt: now,
      });
    for (let i = 0; i < args.steps.length; i++) {
      const s = args.steps[i];
      await getDb()
        .insert(schema.workflowSteps)
        .values({
          id: nanoid(),
          workflowId: id,
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
    return { id };
  },
});
