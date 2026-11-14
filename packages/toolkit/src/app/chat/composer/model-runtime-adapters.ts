import { describeModelForEngine } from "@agent-native/core/agent/model-catalog";
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

import { useDescribeModel } from "./use-describe-model.js";

export const coreComposerModelAdapters: NonNullable<
  ComposerRuntimeAdapters["models"]
> = {
  useChatModels,
  useAgentEngineConfigured,
  fetchAgentEngineConfiguredState,
  describe: describeModelForEngine,
  useDescribeModel,
  reasoning: {
    defaultEffort: DEFAULT_REASONING_EFFORT,
    getOptionsForModel: getReasoningEffortOptionsForModel,
    label: reasoningEffortLabel,
    resolve: resolveReasoningEffortSelection,
  },
};
