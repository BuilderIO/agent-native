import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { readBrainScreen } from "../server/lib/brain.js";

export default defineAction({
  description:
    "See what the user is currently looking at in Brain, including selected source/capture/knowledge and recent lists.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async () => readBrainScreen(),
});
