import {
  deleteOrgSetting,
  getOrgSetting,
  putOrgSetting,
} from "@agent-native/core/settings";

/**
 * The name and description a person gave the workspace's BigQuery connection.
 * They live beside the credential rather than inside it, so the key file stays
 * exactly the key file.
 */
export const ORGANIZATION_BIGQUERY_DETAILS_SETTING_KEY =
  "organization-bigquery-connection-details";

export interface OrganizationBigQueryDetails {
  connectionName: string;
  connectionDescription: string;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function getOrganizationBigQueryDetails({
  orgId,
}: {
  orgId: string;
}): Promise<OrganizationBigQueryDetails | null> {
  const stored = await getOrgSetting(
    orgId,
    ORGANIZATION_BIGQUERY_DETAILS_SETTING_KEY,
  );
  if (!stored) return null;
  return {
    connectionName: readString(stored.connectionName).trim(),
    connectionDescription: readString(stored.connectionDescription).trim(),
  };
}

export async function saveOrganizationBigQueryDetails({
  orgId,
  connectionName,
  connectionDescription,
}: {
  orgId: string;
  connectionName: string;
  connectionDescription: string;
}): Promise<OrganizationBigQueryDetails> {
  const details: OrganizationBigQueryDetails = {
    connectionName: connectionName.trim(),
    connectionDescription: connectionDescription.trim(),
  };
  await putOrgSetting(orgId, ORGANIZATION_BIGQUERY_DETAILS_SETTING_KEY, {
    ...details,
  });
  return details;
}

export async function deleteOrganizationBigQueryDetails(
  orgId: string,
): Promise<void> {
  await deleteOrgSetting(orgId, ORGANIZATION_BIGQUERY_DETAILS_SETTING_KEY);
}
