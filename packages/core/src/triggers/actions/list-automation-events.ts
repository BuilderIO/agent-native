import { z } from "zod";

import { defineAction } from "../../action.js";
import { listEvents } from "../../event-bus/index.js";

export default defineAction({
  description: "List event types available to the automation builder.",
  agentTool: false,
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  schema: z.object({}),
  run: async () =>
    listEvents().map((event) => ({
      name: event.name,
      description: event.description,
    })),
});
