import { defineAction } from "@agent-native/core/action";

import { queryNativeDbtSemanticMetrics } from "../server/model/dbt-semantic-metrics.js";
import {
  queryDbtSemanticMetricsInput,
  queryDbtSemanticMetricsOutput,
} from "../shared/dbt-semantic-metrics.js";

export default defineAction({
  description:
    "Run a dbt 1.6+ Semantic Layer metric query on the selected native workspace connection. Starts one metric query, polls it, and returns the first result page with its SQL, fields and rows. The token stays on the server.",
  schema: queryDbtSemanticMetricsInput,
  outputSchema: queryDbtSemanticMetricsOutput,
  http: { method: "POST" },
  readOnly: true,
  persistInBrowser: false,
  run: queryNativeDbtSemanticMetrics,
});
