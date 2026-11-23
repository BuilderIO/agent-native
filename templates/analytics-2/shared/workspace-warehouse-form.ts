import { z } from "zod";

import { normalizeServiceAccountJson } from "./service-account-json.js";

export const ALL_BIGQUERY_DATASETS = "[]";

// This is the native all-members, basic warehouse profile only. Other form
// modes must retain their own backing; they must never be silently flattened
// into this profile. No UI is routed here until those caller contracts land.
const workspaceAccess = z.tuple([z.literal("workspace")]);
export const workspaceWarehouseFormSchema = z
  .object({
    requestId: z.string().uuid(),
    type: z.literal("bigquery"),
    draft: z.literal(false),
    values: z
      .object({
        name: z.string().trim().min(1).max(200),
        projectId: z.string().trim().min(1).max(200),
        serviceAccount: z
          .string()
          .min(1)
          .max(65536)
          .refine((value) => !!value.trim()),
        queryAccessGroupIds: workspaceAccess,
        viewAccessGroupIds: workspaceAccess,
        shareWithWorkspace: z.literal(true).optional(),
        description: z.string().max(4000).optional(),
        additionalProjectIds: z.literal("").optional(),
        datasetNames: z.string().max(4000).optional(),
        driveAccess: z.literal(false).optional(),
        useBQStorageAPI: z.boolean().optional(),
        customCodeFormatting: z.literal(false).optional(),
        includeForAI: z.boolean().optional(),
        hasDbtMetadata: z.literal(false).optional(),
        dbtVersion: z.literal("").optional(),
        dbtCloudHostname: z.literal("cloud.getdbt.com").optional(),
        useDbtJdbcDriver: z.literal(false).optional(),
        dbtRequireCertificateVerification: z.literal(true).optional(),
        allowWriteback: z.literal(false).optional(),
        disableTablePreviews: z.boolean().optional(),
        canQueryCanRefreshSchema: z.literal(true).optional(),
      })
      .strict(),
  })
  .strict();

export function workspaceWarehouseFormInput(
  input: z.infer<typeof workspaceWarehouseFormSchema>,
) {
  const values = input.values;
  return {
    operationId: input.requestId,
    name: values.name,
    config: {
      projectId: values.projectId,
      ...(values.datasetNames === undefined
        ? {}
        : { datasetNames: values.datasetNames }),
      ...(values.description === undefined
        ? {}
        : { descriptionJson: JSON.stringify(values.description) }),
      // The actual create form supplies true for new connections; the schema
      // catalog's false default alone is not the form's effective default.
      useBQStorageAPI: values.useBQStorageAPI ?? true,
      includeForAI: values.includeForAI ?? true,
      disableTablePreviews: values.disableTablePreviews ?? false,
    },
    secretValues: [
      { key: "BIGQUERY_PROJECT_ID", secret: values.projectId },
      {
        key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
        secret: normalizeServiceAccountJson(values.serviceAccount),
      },
    ],
  };
}
