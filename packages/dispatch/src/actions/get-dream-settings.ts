import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDreamSettings } from "../server/lib/dreams-store.js";

export default defineAction({
  description:
    "Read recurring Dispatch dream settings, including schedule, source scope, timeout, and minimum candidate threshold.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => getDreamSettings(),
});
