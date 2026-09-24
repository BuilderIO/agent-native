import { defineAction } from "@agent-native/core/action";
import { roleSatisfies } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  APPROVE_ROLE,
  DRAFT_ROLE,
  assertCanDraft,
} from "../server/lib/library-access.js";

export default defineAction({
  description:
    "Report what the current user may do in a brand kit: draft generations, or also approve them by saving into the kit. Call this before offering to save a candidate.",
  schema: z.object({
    libraryId: z.string().describe("Brand kit (asset library) ID"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ libraryId }) => {
    const access = await assertCanDraft(libraryId);
    return {
      libraryId,
      role: access.role,
      canDraft: roleSatisfies(access.role, DRAFT_ROLE),
      canApprove: access.canApprove,
      approveRole: APPROVE_ROLE,
    };
  },
});
