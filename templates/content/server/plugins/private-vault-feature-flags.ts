import { createFeatureFlagsPlugin } from "@agent-native/core/server";

import { CONTENT_PRIVATE_VAULT_FEATURE_FLAGS } from "../../shared/private-vault-feature-flags.js";

export default createFeatureFlagsPlugin({
  flags: CONTENT_PRIVATE_VAULT_FEATURE_FLAGS,
});
