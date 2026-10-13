import {
  fetchAgentEngineConfiguredState,
  useAgentEngineConfigured,
} from "@agent-native/core/client/agent-chat";
import { useChatModels } from "@agent-native/core/client/agent-chat";
import {
  DEFAULT_REASONING_EFFORT,
  getReasoningEffortOptionsForModel,
  reasoningEffortLabel,
  resolveReasoningEffortSelection,
} from "@agent-native/core/shared";
import type { ComposerRuntimeAdapters } from "@agent-native/toolkit/composer/runtime-adapters";

export const coreComposerModelAdapters: NonNullable<
  ComposerRuntimeAdapters["models"]
> = {
  useChatModels,
  useAgentEngineConfigured,
  fetchAgentEngineConfiguredState,
  reasoning: {
    defaultEffort: DEFAULT_REASONING_EFFORT,
    getOptionsForModel: getReasoningEffortOptionsForModel,
    label: reasoningEffortLabel,
    resolve: resolveReasoningEffortSelection,
  },
};
