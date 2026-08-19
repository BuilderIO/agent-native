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
  type UnsupportedBackendResponse,
} from "./dashboard-panel-query";

type AnalyticsPanelSourceFailure =
  | MissingKeyResponse
  | UnsupportedBackendResponse;

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
      })) as DashboardPanelQueryResult | AnalyticsPanelSourceFailure;
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
): Promise<PanelSourceResult | AnalyticsPanelSourceFailure> {
  return registry.resolve(request, context) as Promise<
    PanelSourceResult | AnalyticsPanelSourceFailure
  >;
}
