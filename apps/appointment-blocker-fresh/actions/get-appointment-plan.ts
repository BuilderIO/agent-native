import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import { appointmentPlanSchema } from "../app/lib/appointment-plan";

export default defineAction({
  description:
    "Read the current appointment blocking plan, including buffered windows, conflict-check status, and approval state.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  outputSchema: appointmentPlanSchema.nullable(),
  run: async () => {
    const plan = await readAppState("appointment-plan");
    return plan ? appointmentPlanSchema.parse(plan) : null;
  },
});
