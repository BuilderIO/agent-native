import { defineAction } from "@agent-native/core";

import {
  reconcileSource,
  reconcileSourceInputSchema,
} from "../server/lib/sync.js";

export default defineAction({
  description:
    "Inspect the reconciliation contract for a provider cursor/window. P1 returns the current gap instead of adding provider-specific REST wrappers.",
  schema: reconcileSourceInputSchema,
  run: reconcileSource,
});
