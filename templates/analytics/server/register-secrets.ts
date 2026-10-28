import { registerRequiredSecret } from "@agent-native/core/secrets";

import { DBT_SEMANTIC_LAYER_TOKEN_KEY } from "./lib/dbt-connection.js";
import { SIGMA_DIRECT_CREDENTIALS_KEY } from "./lib/sigma-connection.js";

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

for (const secret of [
  {
    key: SIGMA_DIRECT_CREDENTIALS_KEY,
    label: "Sigma client credentials",
    description:
      "Client ID, secret, and optional API region for the Analytics-only Sigma connection. Stored together, encrypted, and scoped to the organization.",
    docsUrl:
      "https://help.sigmacomputing.com/reference/generate-client-credentials",
    effectWhenRemoved:
      "Sigma workbooks cannot be browsed in Analytics until credentials are saved again.",
  },
]) {
  registerRequiredSecret({
    ...secret,
    scope: "org",
    kind: "api-key",
    usedFor: [
      {
        appId: "analytics",
        feature: "Sigma workbook import",
        effectWhenRemoved: secret.effectWhenRemoved,
      },
    ],
    required: false,
  });
}
