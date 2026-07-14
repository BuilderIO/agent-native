import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import {
  AGENT_CLIENT_ID,
  deleteCollabState,
  loadAwarenessRowsStrict,
  releaseDoc,
} from "@agent-native/core/collab";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

export default defineAction({
  description:
    "Reset a closed document's persisted collaboration snapshot so the next editor can reseed it from canonical SQL content.",
  schema: z.object({
    id: z.string().min(1).describe("Document ID to reset"),
  }),
  agentTool: false,
  run: async ({ id }) => {
    await assertAccess("document", id, "editor");

    const activeHumans = (await loadAwarenessRowsStrict(id)).filter(
      (entry) => entry.clientId !== AGENT_CLIENT_ID,
    );
    if (activeHumans.length > 0) {
      throw new Error(
        "Close every editor for this document and wait for collaboration presence to expire before resetting it.",
      );
    }

    releaseDoc(id);
    await deleteCollabState(id);
    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      id,
      reset: true,
      message:
        "Collaboration state reset. The next editor will reseed from canonical document content.",
    };
  },
});
