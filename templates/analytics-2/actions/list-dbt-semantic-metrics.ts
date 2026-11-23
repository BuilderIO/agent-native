import { defineAction } from "@agent-native/core/action";

import { listNativeDbtSemanticMetrics } from "../server/model/dbt-semantic-metrics.js";
import {
  listDbtSemanticMetricsInput,
  dbtSemanticMetricsOutput,
} from "../shared/dbt-semantic-metrics.js";

export default defineAction({
  description:
    "Read-only: list a page of dbt 1.6+ Semantic Layer metrics and dimensions using the selected native workspace connection. Agent callers also require the connection AI policy; a frontend read does not. Continue through totalPages; listing does not execute a metric query.",
  schema: listDbtSemanticMetricsInput,
  outputSchema: dbtSemanticMetricsOutput,
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: listNativeDbtSemanticMetrics,
});
