import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listCaptureHosts } from "../server/lib/motion-capture.js";
import { captureHostSchema } from "./lib/capture-schemas.js";

export default defineAction({
  mcpTool: true,
  description:
    "List your connected Clips recorders. Choose an explicitly armed host before starting capture. Requested FPS is not achieved FPS.",
  schema: z.object({}),
  outputSchema: z.object({ hosts: z.array(captureHostSchema) }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async () => ({ hosts: await listCaptureHosts() }),
});
