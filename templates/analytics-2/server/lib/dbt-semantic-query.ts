import { fail } from "@agent-native/core/action";

import {
  createDbtSemanticClient,
  type DbtMetricSelection,
} from "./dbt-semantic-protocol.js";
import {
  resolveDbtSemanticLayerEndpoint,
  type DbtConfiguration,
} from "./warehouse-dbt.js";

export { dbtMetricQuerySelectionSchema } from "./dbt-semantic-protocol.js";

function connectionClient(config: DbtConfiguration, token: string) {
  const environmentId = config.dbtEnvironmentId;
  if (
    !config.hasDbtMetadata ||
    config.dbtVersion !== "current" ||
    !environmentId ||
    !/^[1-9][0-9]*$/.test(environmentId) ||
    !token.trim()
  )
    return fail(
      "Configure dbt 1.6+ and its connection token before querying metrics.",
      { errorCode: "dbt_semantic_configuration_invalid", statusCode: 422 },
    );
  return createDbtSemanticClient({
    endpoint: resolveDbtSemanticLayerEndpoint(config),
    environmentId,
    token,
  });
}
export async function listDbtMetricsWithToken(
  config: DbtConfiguration,
  token: string,
  options: { pageNum?: number; pageSize?: number; search?: string },
) {
  return connectionClient(config, token).listMetrics(options);
}
export async function startDbtMetricQueryWithToken(
  config: DbtConfiguration,
  token: string,
  selection: DbtMetricSelection,
) {
  return connectionClient(config, token).startQuery(selection);
}
export async function readDbtMetricQueryPageWithToken(
  config: DbtConfiguration,
  token: string,
  input: { queryId: string; pageNum: number },
) {
  return connectionClient(config, token).readQueryPage(input);
}
