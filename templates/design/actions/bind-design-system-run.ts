import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { designSystemAuthoring } from "../server/lib/design-system-authoring.js";

export default defineAction({
  description:
    "Bind an actual persisted native run to its design-system conversation. Verifies caller and thread access and derives run status server-side; a completed clarification turn awaits input without claiming system readiness.",
  schema: z.object({
    id: z.string().min(1).describe("Design system ID"),
    runId: z
      .string()
      .min(1)
      .describe("Actual native run ID from the existing chat lifecycle"),
  }),
  agentTool: false,
  run: (args) => designSystemAuthoring.bindRun(args),
});
