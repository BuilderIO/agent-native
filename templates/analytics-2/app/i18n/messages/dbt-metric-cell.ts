export const dbtMetricCellMessages = {
  dbtMetricCell: {
    title: "dbt Semantic Layer",
    connection: "Connection",
    chooseConnection: "Choose a connection",
    noConnections:
      "Add a workspace connection with dbt 1.6+ enabled to query its Semantic Layer.",
    metrics: "Metrics",
    searchMetrics: "Search metrics",
    noMetrics: "No metrics found for this connection.",
    showMore: "Show more metrics",
    groupBy: "Group by",
    dimensions: "Dimensions",
    timeGrain: "Time grain",
    noTimeGrain: "No time grain",
    run: "Run",
    running: "Running…",
    duplicateAsSql: "Duplicate as SQL",
    generatedSql: "SQL",
    resultsTruncated: "Showing the first {{count}} rows.",
    noRows: "The query returned no rows.",
    chooseMetric: "Choose at least one metric to run.",
    errors: {
      notEnabled:
        "Turn on dbt 1.6+ for this connection to query its Semantic Layer.",
      unavailable:
        "This connection can’t be used for dbt metrics. Choose a connection with dbt 1.6+ turned on.",
      notIncluded:
        "This connection is not included for AI. Turn on Included for AI in the data browser, then try again.",
    },
  },
};
