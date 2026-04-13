import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listOverview } from "../server/lib/dispatcher-store.js";

export default defineAction({
  description:
    "Get the dispatcher overview metrics, recent activity, and approval settings.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    return listOverview();
  },
});
