import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { requireOrganizationBigQueryCredentials } from "../server/lib/org-bigquery-credentials.js";
import {
  commitDbtConfigRevision,
  dbtConfigurationSchema,
  readDbtServiceToken,
  requireDbtUserEmail,
  requireExactDbtRequestContext,
  sanitizeDbtConfiguration,
  withOrganizationDbtTransaction,
  writeDbtServiceToken,
} from "../server/lib/org-bigquery-dbt.js";
import { validateDbtConfiguration } from "../server/lib/warehouse-dbt.js";
import {
  requireBigQueryModelCurator,
  requireSemanticOrg,
} from "./_semantic-helpers.js";

function rethrowTypedFailure(error: unknown): void {
  if (
    error instanceof Error &&
    "errorCode" in error &&
    typeof error.errorCode === "string" &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    error.statusCode >= 400 &&
    error.statusCode <= 599
  )
    throw error;
}

export default defineAction({
  description:
    "Update dbt metadata settings on the configured workspace BigQuery connection without changing its project, service account key or connection details. A blank dbt token preserves the stored token. Requires an active workspace admin or owner.",
  schema: z
    .object({
      dbt: dbtConfigurationSchema,
      dbtToken: z.string().max(65_536).optional(),
      expectedRevision: z.number().int().min(0),
      expectedOrgId: z.string().trim().min(1).max(512),
    })
    .strict(),
  http: { method: "POST" },
  outputSchema: z
    .object({
      changed: z.literal(true),
      dbtRevision: z.number().int().min(0),
      dbtEnabled: z.boolean(),
    })
    .strict(),
  readOnly: false,
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  persistInChatHistory: false,
  persistInBrowser: false,
  audit: { recordInputs: false },
  run: async ({ dbt, dbtToken, expectedRevision, expectedOrgId }) => {
    const orgId = await requireSemanticOrg();
    const userEmail = requireDbtUserEmail();
    const active = requireExactDbtRequestContext({ orgId, userEmail });
    if (active.orgId !== expectedOrgId) {
      fail(
        "The workspace changed while this connection was being edited. Reopen the connection.",
        {
          errorCode: "dbt_org_context_mismatch",
          statusCode: 403,
        },
      );
    }
    await requireBigQueryModelCurator(active);
    await requireOrganizationBigQueryCredentials(active);

    const config = dbtConfigurationSchema.parse(dbt);
    const suppliedToken = dbtToken?.trim();
    if (config.hasDbtMetadata) {
      const token = suppliedToken || (await readDbtServiceToken(active.orgId));
      try {
        await validateDbtConfiguration(sanitizeDbtConfiguration(config), token);
      } catch (error) {
        rethrowTypedFailure(error);
        fail(
          "The dbt settings could not be verified, so nothing was changed. Check the dbt configuration and Service token and try again.",
          {
            errorCode: "dbt_configuration_not_verified",
            statusCode: 503,
          },
        );
      }
    }

    try {
      return await withOrganizationDbtTransaction(async (transaction) => {
        const dbtRevision = await commitDbtConfigRevision({
          orgId: active.orgId,
          config,
          expectedRevision,
          transaction,
        });
        if (config.hasDbtMetadata && suppliedToken) {
          await writeDbtServiceToken({
            orgId: active.orgId,
            token: suppliedToken,
          });
        }
        return {
          changed: true as const,
          dbtRevision,
          dbtEnabled: config.hasDbtMetadata,
        };
      });
    } catch (error) {
      rethrowTypedFailure(error);
      return fail(
        "The dbt settings could not be saved, so nothing was changed. Retry shortly.",
        {
          errorCode: "dbt_settings_save_failed",
          statusCode: 503,
        },
      );
    }
  },
});
