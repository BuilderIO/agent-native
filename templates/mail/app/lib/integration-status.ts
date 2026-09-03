export const MAIL_INTEGRATION_PROVIDERS = [
  "apollo",
  "hubspot",
  "gong",
  "pylon",
] as const;

export type MailIntegrationProvider =
  (typeof MAIL_INTEGRATION_PROVIDERS)[number];

export type MailIntegrationStatuses = Record<MailIntegrationProvider, boolean>;

export const MAIL_INTEGRATION_STATUS_QUERY_KEY = [
  "mail-integration-statuses",
] as const;

export const EMPTY_MAIL_INTEGRATION_STATUSES: MailIntegrationStatuses = {
  apollo: false,
  hubspot: false,
  gong: false,
  pylon: false,
};

export function mailIntegrationProviderFromAppStateKey(
  key: string | undefined,
): MailIntegrationProvider | "*" | null {
  if (key === "*") return "*";
  return (
    MAIL_INTEGRATION_PROVIDERS.find((provider) => provider === key) ?? null
  );
}
