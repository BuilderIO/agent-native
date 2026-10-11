import { registerRequiredSecret } from "@agent-native/core/secrets";

import { DBT_SEMANTIC_LAYER_TOKEN_KEY } from "./lib/dbt-connection.js";

registerRequiredSecret({
  key: DBT_SEMANTIC_LAYER_TOKEN_KEY,
  label: "dbt Cloud service token",
  description:
    "Optional dbt service token with Semantic Layer Only and Metadata Only permissions. Analytics uses it to query governed dbt metrics.",
  docsUrl: "https://docs.getdbt.com/docs/dbt-apis/service-tokens",
  scope: "org",
  kind: "api-key",
  usedFor: [
    {
      appId: "analytics",
      feature: "dbt Semantic Layer metrics",
      effectWhenRemoved: "dbt Semantic Layer metric queries stop.",
    },
  ],
  required: false,
});
