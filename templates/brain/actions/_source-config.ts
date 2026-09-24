import { fail } from "@agent-native/core/action";

import {
  describeSourceConfigIssues,
  validateSourceConfig,
} from "../shared/source-config-validation.js";

/**
 * Rejects a source config whose provider list fields cannot address anything
 * real. Without this the row is written happily and only fails later, during
 * sync, as a permanent "needs sync"/"error" card with no way back to the typo.
 */
export function assertValidSourceConfig(
  provider: string,
  config: Record<string, unknown>,
) {
  const issues = validateSourceConfig(provider, config);
  if (!issues.length) return;
  fail(describeSourceConfigIssues(issues), {
    errorCode: "invalid_source_config",
    details: { issues },
  });
}
