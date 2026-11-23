import { z } from "zod";

export const WORKSPACE_WAREHOUSE_DBT_TOKEN = "WAREHOUSE_DBT_SERVICE_TOKEN";

export const warehouseDbtFields = {
  hasDbtMetadata: z.boolean().optional(),
  dbtVersion: z.enum(["", "current", "legacy"]).optional(),
  dbtAccountId: z.string().trim().max(200).optional(),
  dbtProjectId: z.string().trim().max(200).optional(),
  dbtEnvironmentId: z.string().trim().max(200).optional(),
  dbtCloudHostname: z.string().trim().max(253).optional(),
};

export const warehouseDbtConfiguration = z
  .object({
    ...warehouseDbtFields,
    dbtCredentialKey: z.literal(WORKSPACE_WAREHOUSE_DBT_TOKEN).optional(),
  })
  .superRefine((value, context) => {
    if (value.hasDbtMetadata !== true) return;
    const valid =
      value.dbtCredentialKey === WORKSPACE_WAREHOUSE_DBT_TOKEN &&
      (value.dbtVersion === "current"
        ? !!value.dbtCloudHostname && !!value.dbtEnvironmentId
        : value.dbtVersion === "legacy" &&
          !!value.dbtAccountId &&
          !!value.dbtProjectId);
    if (!valid)
      context.addIssue({
        code: "custom",
        message: "Enter a dbt version and its required connection details.",
      });
  });

export const memberVisibleDbtConfigFields = [
  "hasDbtMetadata",
  "dbtVersion",
] as const;

export function memberVisibleDbtConfig<
  T extends { hasDbtMetadata: boolean; dbtVersion: "current" | "legacy" },
>(config: T): { hasDbtMetadata: boolean; dbtVersion: "current" | "legacy" } {
  return {
    hasDbtMetadata: config.hasDbtMetadata,
    dbtVersion: config.dbtVersion,
  };
}
