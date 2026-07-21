import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { deleteUserContentSpace } from "./_delete-content-space.js";

export default defineAction({
  description:
    "Permanently delete a user-created Content workspace and all content inside it. Personal and organization workspaces cannot be deleted.",
  schema: z.object({
    spaceId: z.string().trim().min(1),
  }),
  run: async ({ spaceId }) => {
    const result = await deleteUserContentSpace(getDb(), spaceId);
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { success: true, ...result };
  },
});
