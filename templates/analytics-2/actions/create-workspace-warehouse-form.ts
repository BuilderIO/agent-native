import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { createPostgresWarehouseConnection } from "../server/model/postgres-connection.js";
import { createWorkspaceWarehouseCreateAction } from "../server/model/workspace-warehouse-connection.js";
import {
  workspaceWarehouseFormInput,
  workspaceWarehouseFormSchema,
} from "../server/model/workspace-warehouse-form.js";
import { postgresConnectionCreateSchema } from "../shared/postgres-connection-form.js";

export default defineAction({
  description:
    "Validate and create the basic workspace warehouse form through private native credentials.",
  schema: z.discriminatedUnion("type", [
    workspaceWarehouseFormSchema,
    postgresConnectionCreateSchema,
  ]),
  outputSchema: z.object({ connectionId: z.string().min(1) }).strict(),
  http: { method: "POST" },
  uiOnly: true,
  requiresSignedInBrowser: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  persistInBrowser: false,
  persistInChatHistory: false,
  audit: { recordInputs: false },
  maxBodyBytes: 128 * 1024,
  run: (input) =>
    input.type === "postgres"
      ? createPostgresWarehouseConnection(input)
      : createWorkspaceWarehouseCreateAction().run(
          workspaceWarehouseFormInput(input),
          {
            caller: "frontend",
          },
        ),
});
