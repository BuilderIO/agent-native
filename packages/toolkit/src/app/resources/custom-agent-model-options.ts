import { CURRENT_BUILDER_CLAUDE_MODEL_OPTIONS } from "@agent-native/core/agent/model-config";
import {
  getModelOptionLabel,
  type ModelEngineConfig,
} from "@agent-native/core/agent/model-version";

export interface CustomAgentModelOption {
  value: string;
  label: string;
}

export function getCustomAgentModelOptions(
  engine?: ModelEngineConfig | null,
): CustomAgentModelOption[] {
  const models =
    engine?.name === "builder"
      ? CURRENT_BUILDER_CLAUDE_MODEL_OPTIONS.filter((option) =>
          engine.supportedModels.includes(option.value),
        ).map((option) => option.value)
      : (engine?.supportedModels ?? []);

  return [
    { value: "inherit", label: "Default model" },
    ...[...new Set(models)].map((value) => ({
      value,
      label: getModelOptionLabel(value),
    })),
  ];
}
