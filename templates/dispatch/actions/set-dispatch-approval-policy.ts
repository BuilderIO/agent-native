import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getApprovalPolicy,
  setApprovalPolicy,
} from "../server/lib/dispatch-store.js";

export default defineAction({
  description: "Enable or disable dispatch approval flow for durable changes.",
  schema: z.object({
    enabled: z.boolean(),
    approverEmails: z.array(z.string().email()).default([]),
  }),
  run: async ({ enabled, approverEmails }) => {
    const current = await getApprovalPolicy();
    if (
      current.enabled === enabled &&
      JSON.stringify(current.approverEmails) === JSON.stringify(approverEmails)
    ) {
      return current;
    }
    return setApprovalPolicy({ enabled, approverEmails });
  },
});
