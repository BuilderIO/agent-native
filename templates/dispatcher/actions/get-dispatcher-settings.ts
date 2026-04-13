import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getApprovalPolicy } from "../server/lib/dispatcher-store.js";

export default defineAction({
  description: "Get dispatcher approval settings for the current organization.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => getApprovalPolicy(),
});
