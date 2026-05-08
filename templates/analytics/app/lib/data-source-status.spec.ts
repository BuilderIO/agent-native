import { describe, expect, it } from "vitest";
import { dataSources } from "./data-sources";
import { isSourceConfigured } from "./data-source-status";

describe("data source status", () => {
  it("does not require the optional BigQuery app events alias", () => {
    const bigquery = dataSources.find((source) => source.id === "bigquery");

    expect(bigquery).toBeTruthy();
    expect(
      isSourceConfigured(bigquery!, [
        {
          key: "GOOGLE_APPLICATION_CREDENTIALS_JSON",
          label: "Google Cloud",
          required: false,
          configured: true,
        },
        {
          key: "BIGQUERY_PROJECT_ID",
          label: "BigQuery Project ID",
          required: false,
          configured: true,
        },
        {
          key: "ANALYTICS_BIGQUERY_EVENTS_TABLE",
          label: "BigQuery Events Table",
          required: false,
          configured: false,
        },
      ]),
    ).toBe(true);
  });
});
