import { registerRequiredSecret } from "@agent-native/core/secrets";

/**
 * The one vault slot that holds the workspace's user-supplied dbt Service
 * token. Registering it makes Settings able to write and clear the same slot
 * the dbt actions read, while `required: false` keeps it out of first-run
 * setup and leaves every existing key untouched.
 */
export const DBT_SERVICE_TOKEN_KEY = "ANALYTICS_WAREHOUSE_DBT_SERVICE_TOKEN";

const DBT_CLOUD_API_DOCS_URL =
  "https://docs.getdbt.com/docs/dbt-cloud-apis/service-tokens";

export function registerDbtCredential(): void {
  registerRequiredSecret({
    key: DBT_SERVICE_TOKEN_KEY,
    label: "dbt Service token",
    description:
      "Connect Analytics 2 to dbt metadata. The token is stored in the shared vault and scoped to the organization.",
    docsUrl: DBT_CLOUD_API_DOCS_URL,
    scope: "org",
    kind: "api-key",
    required: false,
    usedFor: [
      {
        appId: "analytics-2",
        feature: "dbt metadata requests",
        effectWhenRemoved:
          "dbt table metadata stops loading until an organization Service token is saved again.",
      },
    ],
  });
}

registerDbtCredential();

// Nitro calls each `server/plugins/` file's default export at boot; the
// registration above also runs when this module is imported directly.
export default () => {
  registerDbtCredential();
};
