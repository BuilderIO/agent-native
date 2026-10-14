import { useFeatureFlagState } from "@agent-native/core/client/feature-flags";

import { DESIGN_SYSTEM_WORKFLOWS } from "../../shared/design-flags";

export function useDesignSystemWorkflows() {
  return useDesignSystemWorkflowsState().enabled;
}

export function useDesignSystemWorkflowsState() {
  return useFeatureFlagState(DESIGN_SYSTEM_WORKFLOWS.key);
}
