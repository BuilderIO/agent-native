export const ORGANIZATION_BIGQUERY_SOURCE_ID = "__analytics_2_org_source__";

export type OrganizationBigQueryCredentialReadiness =
  | "missing"
  | "partial"
  | "configured"
  | "unavailable";
