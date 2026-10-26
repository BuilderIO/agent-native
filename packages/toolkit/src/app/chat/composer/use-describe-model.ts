import {
  describeModelForEngine,
  type ModelDescription,
} from "@agent-native/core/agent/model-catalog";
import { useActionQuery } from "@agent-native/core/client/use-action";
import { useCallback, useMemo } from "react";

interface DescribeModelsResponse {
  models?: ModelDescription[];
}

const LIVE_ENGINES = ["anthropic", "ai-sdk:anthropic"] as const;
// Matches the server's cache: the provider list changes rarely.
const LIVE_STALE_MS = 60 * 60 * 1000;

function useLiveDescriptions(engine: string, enabled: boolean) {
  const query = useActionQuery(
    "describe-models",
    enabled ? { engine } : undefined,
    { enabled, staleTime: LIVE_STALE_MS },
  ) as { data?: DescribeModelsResponse };
  return query.data?.models;
}

/**
 * The catalog description, with the provider's own window and effort levels
 * for engines whose model list the server reads (Anthropic). Until that read
 * answers, or when it fails, rows use the catalog.
 */
export function useDescribeModel(
  engines: readonly string[],
): (model: string, engine?: string) => ModelDescription {
  const anthropic = useLiveDescriptions(
    LIVE_ENGINES[0],
    engines.includes(LIVE_ENGINES[0]),
  );
  const aiSdkAnthropic = useLiveDescriptions(
    LIVE_ENGINES[1],
    engines.includes(LIVE_ENGINES[1]),
  );
  const live = useMemo(() => {
    const byKey = new Map<string, ModelDescription>();
    for (const [engine, models] of [
      [LIVE_ENGINES[0], anthropic],
      [LIVE_ENGINES[1], aiSdkAnthropic],
    ] as const) {
      for (const description of models ?? []) {
        byKey.set(`${engine}\u0000${description.modelId}`, description);
      }
    }
    return byKey;
  }, [aiSdkAnthropic, anthropic]);
  return useCallback(
    (model: string, engine?: string) =>
      (engine ? live.get(`${engine}\u0000${model}`) : undefined) ??
      describeModelForEngine(model, engine),
    [live],
  );
}
