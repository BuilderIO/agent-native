import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listApprovalRequests } from "../server/lib/dispatch-store.js";

export default defineAction({
  description: "List pending and historical dispatch approval requests.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => listApprovalRequests(),
});
