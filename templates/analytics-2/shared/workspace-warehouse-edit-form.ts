import { z } from "zod";

import { normalizeServiceAccountJson } from "./service-account-json.js";
import {
  warehouseDbtConfiguration,
  warehouseDbtFields,
  WORKSPACE_WAREHOUSE_DBT_TOKEN,
} from "./workspace-warehouse-dbt.js";
import { workspaceWarehouseFormSchema } from "./workspace-warehouse-form.js";

// The edit profile has the same basic/all-members contract as creation.
// An omitted or empty credential field keeps the stored encrypted value.
const editValuesSchema = workspaceWarehouseFormSchema.shape.values
  .omit({
    serviceAccount: true,
    hasDbtMetadata: true,
    dbtVersion: true,
    dbtCloudHostname: true,
  })
  .extend({
    ...warehouseDbtFields,
    dbtToken: z.string().max(16384).optional(),
    serviceAccount: z
      .string()
      .max(65536)
      .refine((value) => value === "" || !!value.trim())
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.hasDbtMetadata !== true && value.dbtToken?.trim())
      context.addIssue({
        code: "custom",
        message: "Enable dbt before adding a Service token.",
      });
    const result = warehouseDbtConfiguration.safeParse({
      ...value,
      ...(value.hasDbtMetadata === true
        ? { dbtCredentialKey: WORKSPACE_WAREHOUSE_DBT_TOKEN }
        : {}),
    });
    if (!result.success)
      context.addIssue({
        code: "custom",
        message: "Enter a dbt version and its required connection details.",
      });
  });

export const workspaceWarehouseEditFormSchema = workspaceWarehouseFormSchema
  .omit({ requestId: true, values: true })
  .extend({
    draft: z.boolean(),
    requestId: z.string().uuid().optional(),
    connectionId: z.string().trim().min(1).max(200),
    revision: z.string().trim().min(1).max(200),
    canonicalDescription: z
      .object({
        description: z.string().max(4000),
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    canonicalAiPolicy: z
      .object({
        usage: z.enum(["included", "excluded"]),
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    values: editValuesSchema,
  })
  .strict();

export function workspaceWarehouseEditFormInput(
  input: z.infer<typeof workspaceWarehouseEditFormSchema>,
) {
  const values = input.values;
  const config: Record<string, string | boolean> = {
    projectId: values.projectId,
    ...(values.description === undefined
      ? {}
      : { descriptionJson: JSON.stringify(values.description) }),
  };
  // Missing edit fields retain existing configuration. Explicit false is a
  // submitted choice and must never be replaced by a creation default.
  for (const key of [
    "datasetNames",
    "useBQStorageAPI",
    "includeForAI",
    "disableTablePreviews",
  ] as const) {
    const value = values[key];
    if (value !== undefined) config[key] = value;
  }
  for (const key of Object.keys(
    warehouseDbtFields,
  ) as (keyof typeof warehouseDbtFields)[]) {
    const value = values[key];
    if (typeof value === "boolean") config[key] = value;
    else if (typeof value === "string" && value.trim())
      config[key] = value.trim();
  }
  if (values.hasDbtMetadata === true)
    config.dbtCredentialKey = WORKSPACE_WAREHOUSE_DBT_TOKEN;
  const secretValues = [
    { key: "BIGQUERY_PROJECT_ID", secret: values.projectId },
  ];
  if (values.serviceAccount !== undefined && values.serviceAccount !== "") {
    secretValues.push({
      key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      secret: normalizeServiceAccountJson(values.serviceAccount),
    });
  }
  if (values.hasDbtMetadata === true && values.dbtToken?.trim())
    secretValues.push({
      key: WORKSPACE_WAREHOUSE_DBT_TOKEN,
      secret: values.dbtToken,
    });
  return {
    connectionId: input.connectionId,
    revision: input.revision,
    draft: input.draft,
    name: values.name,
    config,
    secretValues,
  };
}
