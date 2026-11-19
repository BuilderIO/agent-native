import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  listPersonalMemories,
  personalMemorySchema,
  personalErrors,
} from "../server/lib/personal-intelligence.js";

export default defineAction({
  description:
    "Read your explicitly saved private work preferences and context.",
  schema: z.object({}),
  outputSchema: z.object({ memories: z.array(personalMemorySchema) }),
  errors: personalErrors,
  http: { method: "GET" },
  readOnly: true,
  mcpTool: true,
  run: async () => listPersonalMemories(),
});
