import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getGrantedDispatchMcpAppTask } from "../server/lib/mcp-gateway.js";

export default defineAction({
  description:
    "Poll a durable Dispatch ask_app task and return its current status or final response.",
  schema: z.object({
    app: z.string().describe("Granted app id returned by ask_app."),
    taskId: z.string().describe("The durable task id returned by ask_app."),
  }),
  readOnly: true,
  parallelSafe: true,
  run: async ({ app, taskId }) => getGrantedDispatchMcpAppTask(app, taskId),
});
