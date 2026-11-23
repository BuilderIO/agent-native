import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { postgresWarehouseActions } from "../server/model/postgres-connection.js";
import { workspaceWarehouseActions } from "../server/model/workspace-warehouse-connection.js";

export default defineAction({
  description:
    "Recover this manager's workspace warehouse connection save by its operation ID.",
  schema: z.strictObject({
    operationId: z.string().trim().min(1).max(200),
    provider: z.enum(["bigquery", "postgres"]).optional(),
  }),
  outputSchema: z
    .object({ connectionId: z.string().min(1) })
    .strict()
    .nullable(),
  requiresSignedInBrowser: true,
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  persistInBrowser: false,
  persistInChatHistory: false,
  audit: { recordInputs: false },
  http: { method: "GET" },
  readOnly: true,
  run: ({ operationId, provider }, context) =>
    (provider === "postgres"
      ? postgresWarehouseActions
      : workspaceWarehouseActions
    ).recover.run({ operationId }, context),
});
