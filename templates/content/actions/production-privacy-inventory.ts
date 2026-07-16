import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  buildProductionPrivacyInventory,
  requirePrivacyInventoryOperator,
  type ProductionPrivacyInventory,
} from "../server/lib/privacy-inventory.js";

export default defineAction({
  description:
    "Return the deployment security administrator's aggregate-only Content privacy inventory.",
  schema: z.object({}).strict(),
  http: { method: "GET" },
  requiresAuth: true,
  operatorOnly: {
    tokenEnv: "AGENT_NATIVE_PRIVACY_INVENTORY_ADMIN_TOKEN",
    adminEmailsEnv: "AGENT_NATIVE_PRIVACY_INVENTORY_ADMIN_EMAILS",
  },
  readOnly: true,
  agentTool: false,
  toolCallable: false,
  audit: {
    onRead: true,
    required: true,
    recordInputs: false,
    target: () => ({ type: "deployment-privacy-inventory", id: "v1" }),
    summary: (_args, result) => {
      const inventory = result as ProductionPrivacyInventory | undefined;
      return inventory
        ? `Privacy inventory v${inventory.schemaVersion} ${inventory.authorizationClass} ${inventory.generatedAt} sha256:${inventory.evidence.outputHash}`
        : "Privacy inventory access denied";
    },
  },
  run: async (_args, ctx) => {
    requirePrivacyInventoryOperator({
      userEmail: ctx?.userEmail,
      operatorAuthorized: ctx?.operatorAuthorized,
    });
    return buildProductionPrivacyInventory();
  },
});
