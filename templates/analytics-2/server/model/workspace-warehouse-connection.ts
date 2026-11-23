import {
  isActionContractError,
  type ActionContractError,
} from "@agent-native/core/action";
import {
  createWorkspaceCredentialActions,
  type WorkspaceCredentialActions,
  type WorkspaceCredentialServiceOptions,
} from "@agent-native/core/workspace-connections";

import { ANALYTICS_CONTROL_IDS as controls } from "../../shared/analytics-control-ids.js";
import {
  warehouseDbtConfiguration,
  WORKSPACE_WAREHOUSE_DBT_TOKEN,
} from "../../shared/workspace-warehouse-dbt.js";
import { readWorkspaceWarehouseDescription } from "../../shared/workspace-warehouse-description.js";
import {
  ALL_BIGQUERY_DATASETS,
  workspaceWarehouseFormSchema,
} from "../../shared/workspace-warehouse-form.js";
import { requireCurrentWorkspaceCapability } from "../lib/analytics-capabilities.js";
import { createBigQueryCredentialValidator } from "./bigquery-credential-validation.js";
import { validateConfiguredBigQueryDatasets } from "./data-connection-provider.js";
import { validateDbtConfiguration } from "./data-dbt.js";

const validateCredentials = createBigQueryCredentialValidator({
  appId: "analytics-2",
});

// This registration supports only the native all-members workspace profile.
// Personal, project-scoped, and fine-grained group grants use their own paths.
export function createWorkspaceWarehouseActions(
  beforeUpdateCommit?: WorkspaceCredentialServiceOptions["beforeUpdateCommit"],
  onValidationFailure?: (error: ActionContractError) => void,
): WorkspaceCredentialActions {
  return createWorkspaceCredentialActions({
    appId: "analytics-2",
    provider: {
      id: "bigquery",
      label: "BigQuery",
      credentialKeys: [
        { key: "BIGQUERY_PROJECT_ID", label: "Project ID", required: true },
        {
          key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
          label: "Service account",
          required: true,
          preserveWhitespace: true,
        },
        {
          key: WORKSPACE_WAREHOUSE_DBT_TOKEN,
          label: "Service token",
          required: false,
        },
      ],
      configurationFields: [
        { key: "warehouseEditOperation", label: "Warehouse form operation" },
        { key: "projectId", label: "Project ID" },
        { key: "datasetNames", label: "Datasets" },
        { key: "descriptionJson", label: "Description" },
        { key: "useBQStorageAPI", label: "Use BigQuery Storage API" },
        { key: "includeForAI", label: "Include schema data for AI" },
        { key: "disableTablePreviews", label: "Disable table previews" },
        { key: "hasDbtMetadata", label: "dbt" },
        { key: "dbtVersion", label: "Version" },
        { key: "dbtAccountId", label: "Account ID" },
        { key: "dbtProjectId", label: "Project ID" },
        { key: "dbtEnvironmentId", label: "Environment ID" },
        { key: "dbtCloudHostname", label: "Access URL" },
        { key: "dbtCredentialKey", label: "Service token reference" },
      ],
    },
    validateCredentials: async (input) => {
      const project = input.config.projectId;
      const credentialProject = input.secretValues.find(
        (value) => value.key === "BIGQUERY_PROJECT_ID",
      )?.secret;
      if (
        (project !== undefined &&
          (typeof project !== "string" || project !== credentialProject)) ||
        ["useBQStorageAPI", "includeForAI", "disableTablePreviews"].some(
          (key) =>
            input.config[key] !== undefined &&
            typeof input.config[key] !== "boolean",
        )
      )
        throw new Error("The warehouse connection could not be validated.");
      const datasetNames =
        workspaceWarehouseFormSchema.shape.values.shape.datasetNames.parse(
          input.config.datasetNames,
        );
      if (input.config.descriptionJson !== undefined)
        readWorkspaceWarehouseDescription(input.config.descriptionJson);
      const dbt = warehouseDbtConfiguration.parse(input.config);
      try {
        await validateCredentials({
          ...input,
          secretValues: input.secretValues.filter(
            (value) => value.key !== WORKSPACE_WAREHOUSE_DBT_TOKEN,
          ),
        });
      } catch (error) {
        if (
          isActionContractError(error) &&
          [
            "data_connection_rejected",
            "data_connection_auth_rejected",
            "data_connection_provider_error",
          ].includes(error.errorCode)
        )
          onValidationFailure?.(error);
        throw error;
      }
      input.signal.throwIfAborted();
      if (
        datasetNames !== undefined &&
        datasetNames !== ALL_BIGQUERY_DATASETS
      ) {
        const key = input.secretValues.find(
          (value) => value.key === "GOOGLE_APPLICATION_CREDENTIALS_JSON",
        )?.secret;
        if (!credentialProject || !key)
          throw new Error("The warehouse connection could not be validated.");
        try {
          await validateConfiguredBigQueryDatasets(
            credentialProject,
            key,
            datasetNames,
            input.signal,
          );
        } catch (error) {
          if (
            isActionContractError(error) &&
            [
              "data_connection_dataset_invalid",
              "data_connection_dataset_unverified",
            ].includes(error.errorCode)
          )
            onValidationFailure?.(error);
          throw error;
        }
      }
      if (dbt.hasDbtMetadata === true) {
        const token =
          input.secretValues.find(
            (value) => value.key === WORKSPACE_WAREHOUSE_DBT_TOKEN,
          )?.secret ?? "";
        try {
          await validateDbtConfiguration(dbt, token, input.signal);
        } catch (error) {
          if (
            isActionContractError(error) &&
            error.errorCode.startsWith("data_dbt_")
          )
            onValidationFailure?.(error);
          throw error;
        }
        input.signal.throwIfAborted();
      }
    },
    validationTimeoutMs: 30000,
    allowDraftEdits: true,
    ...(beforeUpdateCommit ? { beforeUpdateCommit } : {}),
  });
}
export const workspaceWarehouseActions = createWorkspaceWarehouseActions();

export async function runNativeBigQueryWarehouseForm<T>(
  run: (actions: WorkspaceCredentialActions) => T | Promise<T>,
  beforeUpdateCommit?: WorkspaceCredentialServiceOptions["beforeUpdateCommit"],
) {
  let validationFailure: ActionContractError | undefined;
  const actions = createWorkspaceWarehouseActions(
    beforeUpdateCommit,
    (error) => {
      validationFailure = error;
    },
  );
  try {
    return await run(actions);
  } catch (error) {
    if (
      validationFailure &&
      isActionContractError(error) &&
      error.errorCode === "workspace_credential_validation_failed"
    )
      throw validationFailure;
    throw error;
  }
}

export function nativeWarehouseDatasetConfig(
  config: Record<string, string | boolean | number> | undefined,
) {
  return typeof config?.datasetNames === "string" &&
    config.datasetNames.split(",").every((name) => !name.trim())
    ? { ...config, datasetNames: ALL_BIGQUERY_DATASETS }
    : config;
}

// Static action discovery recognizes default factory calls, not typed aliases.
export function createWorkspaceWarehouseCreateAction() {
  const action = workspaceWarehouseActions.create;
  return {
    ...action,
    run: async (...[input, context]: Parameters<typeof action.run>) => {
      await requireCurrentWorkspaceCapability(
        controls.bigQueryConnectionCreate,
      );
      return runNativeBigQueryWarehouseForm(({ create }) =>
        create.run(
          { ...input, config: nativeWarehouseDatasetConfig(input.config) },
          context,
        ),
      );
    },
  };
}

export function createWorkspaceWarehouseRecoverAction() {
  return workspaceWarehouseActions.recover;
}

export function createWorkspaceWarehouseArchiveAction() {
  return workspaceWarehouseActions.archive;
}
