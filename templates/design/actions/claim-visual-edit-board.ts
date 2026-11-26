import { defineAction, fail } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";

import { claimVisualEditBoard } from "../server/lib/visual-edit-board-claim.js";

export default defineAction({
  description:
    "Move a board built signed out with open-visual-edit into the signed-in user's account, as a private design. Needs the claim secret that only the opening page holds; the design ID alone is never enough. Repeating the claim as the same user succeeds without changes.",
  schema: z.object({
    designId: z.string().min(1).describe("Board design ID."),
    claimSecret: z
      .string()
      .min(32)
      .max(256)
      .describe(
        "Claim secret the opening page received from open-visual-edit.",
      ),
  }),
  outputSchema: z.object({
    designId: z.string(),
    claimed: z.literal(true),
    alreadyOwned: z.boolean(),
  }),
  agentTool: false,
  mcpTool: false,
  run: async ({ designId, claimSecret }) => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) {
      fail("Sign in to save this board to your account.", {
        errorCode: "visual_edit_board_claim_requires_account",
        statusCode: 401,
      });
    }
    return claimVisualEditBoard({
      designId,
      claimSecret,
      userEmail,
      orgId: getRequestOrgId() ?? null,
    });
  },
});
