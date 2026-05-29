/**
 * Bump the refresh-signal timestamp — invalidates list queries in the UI.
 *
 * Usage:
 *   pnpm action refresh-list
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Refresh list queries (calls / snippets / comments / viewers) in the UI by bumping the refresh-signal timestamp.",
  schema: z.object({}),
  http: false,
  run: async () => {
    await writeAppState("refresh-signal", { ts: Date.now() });
    return "Triggered UI refresh";
  },
});
