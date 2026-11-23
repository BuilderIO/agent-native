import { defineAction, isActionContractError } from "@agent-native/core/action";
import { getRequestContext } from "@agent-native/core/server";
import {
  WorkspaceCredentialError,
  type WorkspaceCredentialServiceOptions,
} from "@agent-native/core/workspace-connections";
import { z } from "zod";

import { afterDataCommit } from "../server/model/data-change-events.js";
import {
  acquireConnectionGuard,
  metadataOptions,
} from "../server/model/data-connection-mutations.js";
import { getDataConnectionForm } from "../server/model/data-connections.js";
import {
  assertConnectionWritable,
  readConnectionAnnotationOverride,
  writeDataResourceMetadata,
} from "../server/model/data-resource-metadata.js";
import { updatePostgresWarehouseConnection } from "../server/model/postgres-connection.js";
import {
  nativeWarehouseDatasetConfig,
  runNativeBigQueryWarehouseForm,
} from "../server/model/workspace-warehouse-connection.js";
import {
  warehouseEditOperation,
  workspaceWarehouseEditFormInput,
  workspaceWarehouseEditFormSchema,
} from "../server/model/workspace-warehouse-edit-form.js";
import { postgresConnectionUpdateSchema } from "../shared/postgres-connection-form.js";

export default defineAction({
  description:
    "Validate and update the basic workspace warehouse form through private native credentials.",
  schema: z.discriminatedUnion("type", [
    workspaceWarehouseEditFormSchema,
    postgresConnectionUpdateSchema,
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
  run: async (input) => {
    const ctx = getRequestContext();
    if (!ctx?.userEmail || !ctx.orgId || ctx.orgScope === "personal")
      throw new WorkspaceCredentialError("forbidden");
    const scope = { ownerEmail: ctx.userEmail, orgId: ctx.orgId };
    const { connectionId, requestId } = input;
    const warehouseEditOperationId = requestId
      ? warehouseEditOperation(scope, requestId)
      : "-";
    const confirmed = async () => {
      if (!requestId || input.type !== "bigquery") return false;
      try {
        const form = await getDataConnectionForm(connectionId, requestId);
        return form.connection.type === input.type;
      } catch (error) {
        if (
          isActionContractError(error) &&
          error.errorCode === "data_connection_edit_unconfirmed"
        )
          return false;
        throw error;
      }
    };
    if (await confirmed()) return { connectionId };
    const beforeUpdateCommit: WorkspaceCredentialServiceOptions["beforeUpdateCommit"] =
      async ({ connectionId, transaction }) => {
        await acquireConnectionGuard(scope, connectionId, transaction);
        const options = metadataOptions(transaction);
        await assertConnectionWritable(scope, connectionId, options);
        const submittedDescription =
          input.type === "postgres"
            ? input.description
            : input.values.description;
        const submittedAi =
          input.type === "postgres"
            ? input.includeForAI
            : input.values.includeForAI;
        const descriptionBaseline = input.canonicalDescription;
        const aiBaseline = input.canonicalAiPolicy;
        // Both annotations share a single revision. Conflicting opened
        // baselines cannot authorize a combined write.
        if (
          descriptionBaseline &&
          aiBaseline &&
          descriptionBaseline.revision !== aiBaseline.revision
        )
          throw new WorkspaceCredentialError("conflict");
        const descriptionDirty =
          submittedDescription !== undefined &&
          (!descriptionBaseline ||
            submittedDescription !== descriptionBaseline.description);
        const usage =
          submittedAi === undefined
            ? undefined
            : submittedAi
              ? "included"
              : "excluded";
        const aiDirty =
          usage !== undefined && (!aiBaseline || usage !== aiBaseline.usage);
        if (!descriptionDirty && !aiDirty) return;
        const current = await readConnectionAnnotationOverride(
          scope,
          connectionId,
          options,
        );
        if (
          (descriptionDirty &&
            !descriptionBaseline &&
            current?.descriptionInitialized) ||
          (aiDirty && !aiBaseline && current?.aiUsageInitialized)
        )
          throw new WorkspaceCredentialError("conflict");
        const revision = current?.revision ?? 0;
        if (
          (descriptionDirty &&
            descriptionBaseline &&
            descriptionBaseline.revision !== revision) ||
          (aiDirty && aiBaseline && aiBaseline.revision !== revision)
        )
          throw new WorkspaceCredentialError("conflict");
        await writeDataResourceMetadata(
          scope,
          connectionId,
          { kind: "connection", id: connectionId },
          {
            ...(descriptionDirty ? { description: submittedDescription } : {}),
            ...(aiDirty ? { aiUsage: usage } : {}),
          },
          options,
        );
      };
    if (input.type === "postgres")
      return afterDataCommit(() =>
        updatePostgresWarehouseConnection(input, beforeUpdateCommit),
      );
    const edit = workspaceWarehouseEditFormInput(input);
    try {
      return await afterDataCommit(async () =>
        runNativeBigQueryWarehouseForm(
          ({ update }) =>
            update.run(
              {
                ...edit,
                config: {
                  ...nativeWarehouseDatasetConfig(edit.config),
                  warehouseEditOperation: warehouseEditOperationId,
                },
              },
              {
                caller: "frontend",
              },
            ),
          beforeUpdateCommit,
        ),
      );
    } catch (error) {
      if (
        isActionContractError(error) &&
        error.errorCode === "workspace_credential_conflict" &&
        (await confirmed())
      )
        return { connectionId };
      throw error;
    }
  },
});
