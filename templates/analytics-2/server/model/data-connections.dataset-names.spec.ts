import { describe, expect, it } from "vitest";

import { ALL_BIGQUERY_DATASETS } from "../../shared/workspace-warehouse-form.js";
import {
  configuredDatasetNames,
  configuredDatasetPage,
} from "./data-connections.js";

// oracle-change: configured dataset names now restrict browsing on every listing instead of standing in for a project-listing 403, so the refusal-fallback predicate and its tests are gone
describe("configured datasets on a dataset-scoped BigQuery connection", () => {
  it("reads the comma-separated names, trims them and keeps the order once", () => {
    expect(
      configuredDatasetNames({
        datasetNames: " analytics_dbt , reporting,,analytics_dbt , ",
      }),
    ).toEqual(["analytics_dbt", "reporting"]);
  });

  it("reads nothing when the connection names no datasets", () => {
    expect(configuredDatasetNames({})).toEqual([]);
    expect(configuredDatasetNames({ datasetNames: "" })).toEqual([]);
    expect(configuredDatasetNames({ datasetNames: "  ,  , " })).toEqual([]);
    expect(configuredDatasetNames({ datasetNames: 42 })).toEqual([]);
  });

  it("reads the all-datasets choice as no restriction", () => {
    expect(
      configuredDatasetNames({ datasetNames: ALL_BIGQUERY_DATASETS }),
    ).toEqual([]);
  });

  it("shapes the named datasets as schema rows the data browser opens", () => {
    const page = configuredDatasetPage("builder-3b0a2", [
      "analytics_dbt",
      "reporting",
    ]);
    expect(page.nextPageToken).toBeUndefined();
    expect(page.items).toEqual([
      {
        id: "schema:builder-3b0a2:analytics_dbt",
        name: "analytics_dbt",
        kind: "schema",
        hasChildren: true,
      },
      {
        id: "schema:builder-3b0a2:reporting",
        name: "reporting",
        kind: "schema",
        hasChildren: true,
      },
    ]);
  });
});
