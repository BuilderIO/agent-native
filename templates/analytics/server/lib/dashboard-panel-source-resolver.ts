import type { CredentialContext } from "@agent-native/core/credentials";
import {
  createPanelSourceResolverRegistry,
  type PanelSourceRequest,
  type PanelSourceResolver,
  type PanelSourceResult,
} from "@agent-native/core/dashboard-storage";
import type { MissingKeyResponse } from "@agent-native/core/server";

import {
  DASHBOARD_PANEL_SOURCES,
  type DashboardPanelQueryResult,
  type DashboardPanelSource,
  runDashboardPanelQuery,
} from "./dashboard-panel-query";

type AnalyticsPanelSourceResolver = PanelSourceResolver<
  DashboardPanelSource,
  CredentialContext
>;

type AnalyticsPanelSourceRequest = PanelSourceRequest<DashboardPanelSource> & {
  timeoutMs?: number;
};

function createResolver(
  source: DashboardPanelSource,
): AnalyticsPanelSourceResolver {
  return {
    source,
    resolve: async (request, context) => {
      const timeoutMs = (request as AnalyticsPanelSourceRequest).timeoutMs;
      return (await runDashboardPanelQuery({
        source: request.source,
        query: request.query,
        ctx: context,
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      })) as DashboardPanelQueryResult | MissingKeyResponse;
    },
  };
}

export const analyticsPanelSourceResolvers =
  DASHBOARD_PANEL_SOURCES.map(createResolver);

const registry = createPanelSourceResolverRegistry<
  DashboardPanelSource,
  CredentialContext
>({ resolvers: analyticsPanelSourceResolvers });

export async function resolveAnalyticsPanelSource(
  request: AnalyticsPanelSourceRequest,
  context: CredentialContext,
): Promise<PanelSourceResult | MissingKeyResponse> {
  return registry.resolve(request, context) as Promise<
    PanelSourceResult | MissingKeyResponse
  >;
}
