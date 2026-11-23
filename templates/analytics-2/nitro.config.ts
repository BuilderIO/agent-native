// The demo worker and BigQuery SDK need their package files at runtime.
export default {
  traceDeps: ["@electric-sql/pglite*", "@google-cloud/bigquery-storage*"],
  rolldownConfig: { external: ["@google-cloud/bigquery-storage"] },
};
