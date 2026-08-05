import { defineAction } from "@agent-native/core/action";
import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { z } from "zod";

import { appointmentPlanSchema } from "../app/lib/appointment-plan";

export default defineAction({
  description:
    "Record explicit approval for the prepared work-calendar blocks after conflict review. This local test app does not fabricate an external calendar write; it returns the exact approved windows for a connected-calendar agent to create privately without invitations.",
  schema: z.object({
    planId: z.string().min(1),
    confirmed: z
      .literal(true)
      .describe("The user explicitly approved the reviewed blocks"),
  }),
  outputSchema: appointmentPlanSchema,
  run: async ({ planId }) => {
    const stored = await readAppState("appointment-plan");
    if (!stored) throw new Error("No appointment plan is ready to apply.");
    const plan = appointmentPlanSchema.parse(stored);
    if (plan.planId !== planId)
      throw new Error("The selected appointment plan is stale.");
    if (plan.conflictCheck.status === "not_checked") {
      throw new Error(
        "Run the external-attendee conflict check before approval.",
      );
    }
    const updated = appointmentPlanSchema.parse({
      ...plan,
      status: "approved",
      approvedAt: new Date().toISOString(),
    });
    await writeAppState("appointment-plan", updated);
    return updated;
  },
});
