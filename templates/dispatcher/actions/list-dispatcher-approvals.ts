import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listApprovalRequests } from "../server/lib/dispatcher-store.js";

export default defineAction({
  description: "List pending and historical dispatcher approval requests.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => listApprovalRequests(),
});
