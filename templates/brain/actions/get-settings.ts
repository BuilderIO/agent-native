import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { readBrainAgentGuidance } from "../server/lib/brain.js";

export default defineAction({
  description:
    "Get Brain template settings plus the effective retrieval, sanitization, citation, and distillation guidance agents should apply.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => readBrainAgentGuidance(),
});
