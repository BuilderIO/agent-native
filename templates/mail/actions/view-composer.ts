import { defineAction } from "@agent-native/core";
import {
  readAppState,
  listAppState,
} from "@agent-native/core/application-state";
import { z } from "zod";

/** Reject IDs that could escape via path traversal. */
function sanitizeDraftId(id: string): string | null {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : null;
}

export default defineAction({
  description: "See all open compose drafts in the compose panel.",
  schema: z.object({
    id: z.string().optional().describe("Specific draft ID to view (optional)"),
  }),
  http: false,
  run: async (args) => {
    if (args.id) {
      const safeId = sanitizeDraftId(args.id);
      if (!safeId) return `Error: Invalid draft ID "${args.id}"`;
      const draft = await readAppState(`compose-${safeId}`);
      if (!draft) return `No draft found with id "${safeId}"`;
      return JSON.stringify(draft, null, 2);
    }

    const items = await listAppState("compose-");
    if (items.length === 0) return "No compose drafts are open.";
    const drafts = items.map((item) => item.value);
    return JSON.stringify(drafts, null, 2);
  },
});
