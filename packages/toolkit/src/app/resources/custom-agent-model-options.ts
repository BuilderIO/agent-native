import { CURRENT_BUILDER_CLAUDE_MODEL_OPTIONS } from "@agent-native/core/agent/model-config";
import {
  getModelOptionLabel,
  type ModelEngineConfig,
} from "@agent-native/core/agent/model-version";
import { loadChatModelCatalog } from "@agent-native/core/client/use-chat-models";
import { useEffect, useState } from "react";

export interface CustomAgentModelOption {
  value: string;
  label: string;
}

export interface CustomAgentModelOptionLabels {
  defaultModel: string;
  builderFallback: string;
}

export type CustomAgentModelEngineLoadState =
  | "idle"
  | "loading"
  | "available"
  | "unavailable";

export function useCustomAgentModelEngine(
  suppliedEngine: ModelEngineConfig | null | undefined,
  enabled: boolean,
): {
  engine: ModelEngineConfig | null;
  state: CustomAgentModelEngineLoadState;
} {
  const [loaded, setLoaded] = useState<{
    engine: ModelEngineConfig | null;
    state: CustomAgentModelEngineLoadState;
  }>({ engine: null, state: "idle" });

  useEffect(() => {
    if (suppliedEngine !== undefined || !enabled) return;
    let cancelled = false;
    setLoaded({ engine: null, state: "loading" });
    void loadChatModelCatalog()
      .then((catalog) => {
        if (cancelled) return;
        const engine =
          catalog.state === "available" ? catalog.currentModelEngine : null;
        setLoaded({
          engine,
          state: engine ? "available" : "unavailable",
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error(
          "[agent-resources] model catalog could not be loaded",
          error,
        );
        setLoaded({ engine: null, state: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, suppliedEngine]);

  if (suppliedEngine !== undefined) {
    return {
      engine: suppliedEngine,
      state: suppliedEngine ? "available" : "unavailable",
    };
  }
  return loaded;
}

export function getCustomAgentModelOptions(
  engine: ModelEngineConfig | null | undefined,
  labels: CustomAgentModelOptionLabels,
): CustomAgentModelOption[] {
  const selectableModels = engine?.selectableModels ?? engine?.supportedModels;
  const models =
    engine?.name === "builder"
      ? CURRENT_BUILDER_CLAUDE_MODEL_OPTIONS.filter((option) =>
          selectableModels?.includes(option.value),
        ).map((option) => option.value)
      : (selectableModels ?? []);

  return [
    { value: "inherit", label: labels.defaultModel },
    ...[...new Set(models)].map((value) => ({
      value,
      label: getModelOptionLabel(value),
    })),
  ];
}
