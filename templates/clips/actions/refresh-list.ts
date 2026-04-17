/**
 * Trigger the UI to refetch library / transcripts / comments / viewers lists.
 *
 * Most mutating actions call this automatically. Call it manually when you've
 * written data through a path that bypasses the action layer (rare).
 *
 * Usage:
 *   pnpm action refresh-list
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Refresh the recording / transcript / comments / viewers lists in the UI by bumping the refresh-signal timestamp.",
  http: false,
  run: async () => {
    await writeAppState("refresh-signal", { ts: Date.now() });
    return "Triggered UI refresh";
  },
});
