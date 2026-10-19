import { createFeatureFlagsPlugin } from "@agent-native/core/server";

import { DESIGN_SYSTEM_WORKFLOWS } from "../../shared/design-flags.js";

export default createFeatureFlagsPlugin({ flags: [DESIGN_SYSTEM_WORKFLOWS] });
