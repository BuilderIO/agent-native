export const dbtMetadataMessages = {
  dbtMetadata: {
    label: "dbt metadata",
    tableSource: "Table Source",
    table: "table",
    model: "Model",
    source: "Source",
    viewDocs: "View dbt docs",
    lastRefreshed: "Last Refreshed",
    viewJob: "View job",
    lastExecuted: "Last executed on {{date}}",
    lastRefreshedAt: "Last refreshed {{date}}",
    tests: "Tests",
    allTestsSkipped: "All tests skipped",
    noTests: "No tests",
    fresh: "Source table data is fresh",
    freshnessThreshold:
      "{{severity}}: This data source has not been updated in more than {{elapsed}}.",
    severityWarning: "Warning",
    severityError: "Error",
    readError:
      "There was a problem fetching dbt metadata for this {{tableType}}.",
    retry: "Try again",
    columnDescription: "dbt description",
    testStatus: {
      pass: "Passed",
      fail: "Failed",
      error: "Errored",
      warn: "Warning",
      skipped: "Skipped",
      unknown: "Unknown",
    },
  },
};
