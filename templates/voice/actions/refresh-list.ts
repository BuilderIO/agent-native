/**
 * Trigger the UI to refetch dictation lists and other data.
 *
 * Most mutating actions call this automatically. Call it manually when you've
 * written data through a path that bypasses the action layer (rare).
 *
 * Usage:
 *   pnpm action refresh-list
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Refresh the dictation / snippet / dictionary / stats lists in the UI by bumping the refresh-signal timestamp.",
  schema: z.object({}),
  http: false,
  run: async () => {
    await writeAppState("refresh-signal", { ts: Date.now() });
    return "Triggered UI refresh";
  },
});
