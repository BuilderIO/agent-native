/**
 * Read global, server-controlled feature flags (e.g. desktop capture
 * pipeline toggles) so they can change without a redeploy. The desktop app
 * polls this using the same session cookie/bearer token it already sends to
 * other actions (e.g. `list-meetings`).
 *
 * Usage:
 *   pnpm action get-feature-flags
 */

import { defineAction } from "@agent-native/core";
import { getSetting } from "@agent-native/core/settings";
import { z } from "zod";

import {
  FEATURE_FLAGS_KEY,
  withFeatureFlagDefaults,
} from "../shared/feature-flags.js";

export default defineAction({
  description:
    "Get global server-controlled feature flags (e.g. desktop capture pipeline toggles). Returns defaults for any flag never explicitly set.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const stored = await getSetting(FEATURE_FLAGS_KEY);
    return withFeatureFlagDefaults(stored);
  },
});
