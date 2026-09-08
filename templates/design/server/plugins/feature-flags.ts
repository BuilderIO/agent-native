import { createFeatureFlagsPlugin } from "@agent-native/core/server";

import { DESIGN_REVIEW_PANEL } from "../../shared/design-flags.js";
import { FULL_APP_BUILDING } from "../../shared/full-app.js";

export default createFeatureFlagsPlugin({
  flags: [FULL_APP_BUILDING, DESIGN_REVIEW_PANEL],
});
