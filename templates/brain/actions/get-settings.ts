import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { readBrainSettings } from "../server/lib/brain.js";

export default defineAction({
  description: "Get Brain template settings.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => ({ settings: await readBrainSettings() }),
});
