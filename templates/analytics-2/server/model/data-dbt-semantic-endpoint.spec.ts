import { expect, it } from "vitest";

import { dbtAccessUrls } from "./data-dbt-access-url.js";

it.each([
  ["cloud.getdbt.com", "semantic-layer.cloud.getdbt.com"],
  ["metadata.cloud.getdbt.com", "semantic-layer.cloud.getdbt.com"],
  ["semantic-layer.emea.dbt.com", "semantic-layer.emea.dbt.com"],
  ["au.dbt.com", "semantic-layer.au.dbt.com"],
  ["cloud.qa-account.getdbt.com", "semantic-layer.cloud.qa-account.getdbt.com"],
  [
    "metadata.cloud.qa-account.getdbt.com",
    "semantic-layer.cloud.qa-account.getdbt.com",
  ],
  ["qa-account.metadata.eu1.dbt.com", "qa-account.semantic-layer.eu1.dbt.com"],
  ["metadata.us1.dbt.com", "metadata.semantic-layer.us1.dbt.com"],
  [
    "alpha-metadata.metadata.jp1.dbt.com",
    "alpha-metadata.semantic-layer.jp1.dbt.com",
  ],
  ["semantic-layer.us2.dbt.com", "semantic-layer.semantic-layer.us2.dbt.com"],
])(
  "resolves %s structurally without altering an account label",
  (input, host) => {
    expect(dbtAccessUrls(input).semantic).toBe(`https://${host}/api/graphql`);
  },
);
