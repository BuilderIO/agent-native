import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { ensureInboxFresh } from "../server/lib/inbox-sync.js";

export default defineAction({
  description:
    "Refresh the email list displayed in the UI. Triggers the UI to refetch, and pulls new inbox mail from Gmail immediately instead of waiting for the normal freshness window. Call this after any backend change (archive, trash, star, mark-read, send, etc.).",
  schema: z.object({}),
  http: false,
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (ownerEmail) {
      // Best-effort: a slow/failed Gmail resync must never block the UI
      // refresh signal below.
      await ensureInboxFresh(ownerEmail, {
        maxAgeMs: 0,
        budgetMs: 4_000,
      }).catch(() => {});
    }
    await writeAppState("refresh-signal", { ts: Date.now() });
    return "Triggered UI refresh";
  },
});
