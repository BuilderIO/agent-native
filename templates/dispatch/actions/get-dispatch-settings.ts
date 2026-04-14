import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getApprovalPolicy } from "../server/lib/dispatch-store.js";

export default defineAction({
  description: "Get dispatch approval settings for the current organization.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => getApprovalPolicy(),
});
