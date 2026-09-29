import { useFeatureFlag } from "@agent-native/core/client/feature-flags";

import { DESIGN_SYSTEM_WORKFLOWS } from "../../shared/design-flags";

export function useDesignSystemWorkflows() {
  return useFeatureFlag(DESIGN_SYSTEM_WORKFLOWS.key);
}
