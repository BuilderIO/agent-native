import {
  defineAction,
  defineActionErrors,
  isActionContractError,
} from "@agent-native/core/action";
import { z } from "zod";

import { validateDbtConfiguration } from "../server/lib/warehouse-dbt.js";
import {
  bigQueryMetadataRejection,
  validateBigQueryProjectAccess,
  validateConfiguredBigQueryDatasets,
  validateConfiguredBigQueryDatasetsWithRuntime,
  validateSubmittedServiceAccount,
} from "../server/model/data-connection-provider.js";
import {
  manager,
  resolveSavedBigQueryTestCredentials,
} from "../server/model/data-connections.js";
import { testPostgresWarehouseConnection } from "../server/model/postgres-connection.js";
import {
  dataConnectionTestSchema,
  dataConnectionTestStatus as status,
} from "../shared/data-connection-test.js";
import { postgresConnectionTestSchema } from "../shared/postgres-connection-form.js";
import { ALL_BIGQUERY_DATASETS } from "../shared/workspace-warehouse-form.js";

const errors = defineActionErrors(
  "bigquery_test_credential_rejected",
  "bigquery_test_access_denied",
  "bigquery_test_project_missing",
  "bigquery_test_rate_limited",
  "bigquery_test_timeout",
  "bigquery_test_unavailable",
  "data_connection_dataset_invalid",
  "data_connection_dataset_unverified",
  "postgres_test_endpoint_denied",
  "postgres_test_tls_unverified",
  "postgres_test_credentials_denied",
  "postgres_test_readonly_required",
  "postgres_test_timeout",
  "postgres_test_unavailable",
);

export default defineAction({
  description:
    "Check warehouse access with private credentials in the signed-in connection form.",
  schema: z.union([dataConnectionTestSchema, postgresConnectionTestSchema]),
  outputSchema: z.union([
    z.strictObject({ verified: z.literal(true) }),
    z.strictObject({
      testId: z.string().uuid(),
      provider: z.literal("postgres"),
      verifiedAt: z.iso.datetime(),
      checkedSchemas: z.number().int().nonnegative(),
      catalogAccess: z.literal("listed"),
    }),
  ]),
  errors,
  http: { method: "POST" },
  readOnly: true,
  changeEvents: false,
  uiOnly: true,
  requiresSignedInBrowser: true,
  maxBodyBytes: 128 * 1024,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  persistInChatHistory: false,
  persistInBrowser: false,
  audit: { recordInputs: false },
  run: async (input) => {
    if ("form" in input) {
      const signal = AbortSignal.timeout(10_000);
      try {
        const { checkedSchemas } = await testPostgresWarehouseConnection(
          input.form,
          input.connectionId,
          signal,
        );
        signal.throwIfAborted();
        return {
          testId: input.testId,
          provider: "postgres" as const,
          verifiedAt: new Date().toISOString(),
          checkedSchemas,
          catalogAccess: "listed" as const,
        };
      } catch (error) {
        if (isActionContractError(error)) throw error;
        if (signal.aborted)
          errors.fail(
            "The PostgreSQL connection test timed out.",
            "postgres_test_timeout",
            {
              statusCode: status.timedOut,
            },
          );
        const code = error instanceof Error ? error.message : undefined;
        switch (code) {
          case "warehouse_endpoint_not_allowed":
            return errors.fail(
              "The PostgreSQL host or port is not allowed.",
              "postgres_test_endpoint_denied",
              {
                statusCode: 422,
                details: { field: "host" },
              },
            );
          case "warehouse_tls_unverified":
            return errors.fail(
              "The PostgreSQL server certificate could not be verified.",
              "postgres_test_tls_unverified",
              {
                statusCode: 422,
                details: { field: "host" },
              },
            );
          case "warehouse_query_denied":
            return errors.fail(
              "PostgreSQL rejected the username or password.",
              "postgres_test_credentials_denied",
              {
                statusCode: 422,
                details: { field: "password" },
              },
            );
          case "warehouse_read_only_role_required":
            return errors.fail(
              "Connect with a read-only PostgreSQL user.",
              "postgres_test_readonly_required",
              {
                statusCode: 422,
                details: { field: "username" },
              },
            );
          case undefined:
          default:
            return errors.fail(
              "PostgreSQL access could not be verified. Try again.",
              "postgres_test_unavailable",
              {
                statusCode: status.unavailable,
              },
            );
        }
      }
    }
    const {
      connectionId,
      projectId,
      serviceAccount,
      driveAccess,
      datasetNames,
    } = input;
    await manager();
    const needSavedServiceAccount = !serviceAccount;
    const needSavedDbtToken =
      input.hasDbtMetadata === true &&
      !input.dbtToken?.trim() &&
      Boolean(connectionId);
    const hasConfiguredDatasets =
      datasetNames !== undefined &&
      datasetNames !== ALL_BIGQUERY_DATASETS &&
      datasetNames.split(",").some((name) => name.trim());
    const signal = AbortSignal.timeout(10_000);
    let saved:
      | Awaited<ReturnType<typeof resolveSavedBigQueryTestCredentials>>
      | undefined;
    try {
      if (connectionId && (needSavedServiceAccount || needSavedDbtToken)) {
        saved = await resolveSavedBigQueryTestCredentials(connectionId, {
          driveAccess,
          resolveServiceAccount: needSavedServiceAccount,
          resolveDbtToken: needSavedDbtToken,
        });
      }
      if (serviceAccount) {
        if (hasConfiguredDatasets)
          await validateConfiguredBigQueryDatasets(
            projectId,
            serviceAccount,
            datasetNames,
            signal,
          );
        else
          await validateSubmittedServiceAccount(projectId, serviceAccount, {
            driveAccess,
            signal,
          });
      } else {
        const runtime = saved?.runtime;
        if (!runtime)
          return errors.fail(
            "Google rejected the BigQuery service account key.",
            "bigquery_test_credential_rejected",
            { statusCode: status.credentialRejected },
          );
        if (hasConfiguredDatasets)
          await validateConfiguredBigQueryDatasetsWithRuntime(
            runtime,
            projectId,
            datasetNames,
            signal,
          );
        else await validateBigQueryProjectAccess(runtime, projectId, signal);
      }
      signal.throwIfAborted();
    } catch (error) {
      if (
        isActionContractError(error) &&
        [
          "data_connection_dataset_invalid",
          "data_connection_dataset_unverified",
          "data_connection_not_found",
          "data_connection_credentials_required",
          "data_connection_draft_credentials_denied",
          "data_connection_integration_credentials_unreadable",
          "data_connection_unavailable",
        ].includes(error.errorCode)
      )
        throw error;
      if (signal.aborted)
        errors.fail(
          "The BigQuery connection test timed out.",
          "bigquery_test_timeout",
          {
            statusCode: status.timedOut,
          },
        );
      const rejection = bigQueryMetadataRejection(error);
      if (
        rejection?.providerStatus === 401 ||
        (isActionContractError(error) &&
          (error.errorCode === "data_connection_auth_rejected" ||
            error.errorCode === "data_connection_invalid_credentials"))
      )
        errors.fail(
          "Google rejected the BigQuery service account key.",
          "bigquery_test_credential_rejected",
          { statusCode: status.credentialRejected },
        );
      if (
        rejection?.providerStatus === 429 ||
        rejection?.providerReason === "rateLimitExceeded" ||
        rejection?.providerReason === "quotaExceeded"
      )
        errors.fail(
          "BigQuery rejected the test because of a quota or rate limit.",
          "bigquery_test_rate_limited",
          { statusCode: status.rateLimited },
        );
      if (rejection?.providerStatus === 403)
        errors.fail(
          "BigQuery denied access to the project’s dataset list.",
          "bigquery_test_access_denied",
          { statusCode: status.accessDenied },
        );
      if (rejection?.providerStatus === 404)
        errors.fail(
          "BigQuery could not find the project.",
          "bigquery_test_project_missing",
          { statusCode: status.projectMissing },
        );
      errors.fail(
        "BigQuery could not complete the dataset access check.",
        "bigquery_test_unavailable",
        { statusCode: status.unavailable },
      );
    }
    if (input.hasDbtMetadata === true) {
      const dbtToken = input.dbtToken?.trim()
        ? input.dbtToken
        : (saved?.dbtToken ?? "");
      await validateDbtConfiguration(input, dbtToken);
    }
    return { verified: true as const };
  },
});
