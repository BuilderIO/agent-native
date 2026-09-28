import type { ComposerRuntimeAdapters } from "@agent-native/toolkit/composer/runtime-adapters";

import {
  DEFAULT_REASONING_EFFORT,
  getReasoningEffortOptionsForModel,
  reasoningEffortLabel,
  resolveReasoningEffortSelection,
} from "../../shared/reasoning-effort.js";
import {
  fetchAgentEngineConfiguredState,
  useAgentEngineConfigured,
} from "../use-agent-engine-configured.js";
import { useChatModels } from "../use-chat-models.js";

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
