import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

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
import setOrganizationBigQueryConnection, {
  validateOrganizationBigQuerySaveInput,
} from "./set-organization-bigquery-connection.js";

const MAX_DBT_TOKEN_LENGTH = 65_536;

/** A framework-raised failure with its own status stays as it is. */
function isTypedActionFailure(error: unknown): error is Error & {
  errorCode: string;
  statusCode: number;
} {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { errorCode?: unknown; statusCode?: unknown };
  return (
    typeof candidate.errorCode === "string" &&
    typeof candidate.statusCode === "number" &&
    candidate.statusCode >= 400 &&
    candidate.statusCode <= 599
  );
}

function saveFailure(error: unknown): never {
  if (isTypedActionFailure(error)) throw error;
  return fail(
    "The workspace BigQuery and dbt connection could not be saved, so nothing was changed. Retry shortly.",
    { errorCode: "dbt_connection_save_failed", statusCode: 503 },
  );
}

const connectionSchema = z.object({
  connectionName: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe("The name a person gave the workspace BigQuery connection."),
  connectionDescription: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .describe("What the workspace BigQuery connection is for."),
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(63)
    .describe("Google Cloud project ID that holds the datasets to query."),
  serviceAccountJson: z
    .string()
    .max(131_072)
    .describe(
      "The exact contents of the service account JSON key file. Never echoed back.",
    ),
});

/**
 * Saves the workspace BigQuery connection and its dbt settings as one
 * operation. The warehouse half is delegated to the public
 * `set-organization-bigquery-connection` action; the dbt Service token goes to
 * its own registered organization-scoped vault slot, never into the config.
 */
export default defineAction({
  description:
    "Save the workspace BigQuery connection together with its dbt metadata settings and optional dbt Service token. Never returns the service account key or the dbt token.",
  schema: z.object({
    connection: connectionSchema,
    dbt: dbtConfigurationSchema,
    dbtToken: z
      .string()
      .max(MAX_DBT_TOKEN_LENGTH)
      .optional()
      .describe(
        "A dbt Service token. Omit it to keep the token the workspace already stores. Never echoed back.",
      ),
    expectedRevision: z
      .number()
      .int()
      .min(0)
      .describe(
        "The dbt configuration revision this form was opened at, so a concurrent save is refused instead of overwritten.",
      ),
  }),
  http: { method: "POST" },
  // Strict: the token and key are not part of this result shape.
  outputSchema: z
    .object({
      action: z.literal("save"),
      credentialReadiness: z.enum(["missing", "partial", "configured"]),
      projectId: z.string().min(1),
      connectionName: z.string().min(1),
      changed: z.literal(true),
      dbtRevision: z.number().int().min(0),
    })
    .strict(),
  readOnly: false,
  // Private: this action writes a service account key and a dbt Service token,
  // so no agent, MCP caller or CLI may reach it, and no input is recorded.
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  persistInChatHistory: false,
  persistInBrowser: false,
  audit: {
    recordInputs: false,
  },
  run: async ({ connection, dbt, dbtToken, expectedRevision }, ctx) => {
    // Scope and role first: nothing below this block reads the vault, the
    // settings store or a provider until the caller is the active workspace's
    // BigQuery curator.
    const orgId = await requireSemanticOrg();
    const userEmail = requireDbtUserEmail();
    const active = requireExactDbtRequestContext({ orgId, userEmail });
    await requireBigQueryModelCurator(active);

    // The warehouse payload is validated first, with the original action's own
    // rules: a bad project or key is refused before the dbt vault or provider
    // is touched.
    const warehouse = validateOrganizationBigQuerySaveInput(connection);

    const suppliedToken = dbtToken?.trim();
    const dbtEnabled = dbt.hasDbtMetadata;
    const config = dbtConfigurationSchema.parse(dbt);

    // The token and the dbt configuration are validated before any write. A
    // disabled dbt configuration never reads the stored token at all.
    let token: string | undefined;
    if (dbtEnabled) {
      token = suppliedToken || (await readDbtServiceToken(active.orgId));
      try {
        await validateDbtConfiguration(sanitizeDbtConfiguration(config), token);
      } catch (error) {
        if (isTypedActionFailure(error)) throw error;
        return fail(
          "The dbt settings could not be verified, so nothing was changed. Check the dbt configuration and Service token and try again.",
          { errorCode: "dbt_configuration_not_verified", statusCode: 503 },
        );
      }
    }

    try {
      return await withOrganizationDbtTransaction(async (transaction) => {
        // The revision compare-and-swap is the first write: a stale form is
        // refused before the warehouse credentials or the token change.
        const dbtRevision = await commitDbtConfigRevision({
          orgId: active.orgId,
          config,
          expectedRevision,
          transaction,
        });

        const saved = await setOrganizationBigQueryConnection.run(
          {
            action: "save",
            projectId: warehouse.projectId,
            serviceAccountJson: warehouse.serviceAccountJson,
            connectionName: warehouse.connectionName,
            connectionDescription: warehouse.connectionDescription,
          },
          // The caller's action context is passed through unchanged.
          ctx,
        );

        // The action's return type spans its remove branch too; read the
        // values instead of asserting them.
        const projectId = saved.projectId;
        const connectionName = saved.connectionName;
        if (typeof projectId !== "string" || typeof connectionName !== "string")
          return fail(
            "The workspace BigQuery connection saved without a usable project and name, so nothing was kept. Retry the save.",
            { errorCode: "bigquery_connection_unusable", statusCode: 503 },
          );

        if (dbtEnabled && suppliedToken)
          await writeDbtServiceToken({
            orgId: active.orgId,
            token: suppliedToken,
          });

        return {
          action: "save" as const,
          credentialReadiness: saved.credentialReadiness,
          projectId,
          connectionName,
          changed: true,
          dbtRevision,
        };
      });
    } catch (error) {
      return saveFailure(error);
    }
  },
});
