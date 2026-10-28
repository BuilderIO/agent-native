import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import {
  findBrowserSaveAttempt,
  readBrowserSaveAttempt,
} from "./_browser-document-save-attempt.js";
import { assertDocumentMutationAccess } from "./_document-mutation-access.js";

export default defineAction({
  description:
    "Look up a confirmed browser document save attempt for the current editor.",
  agentTool: false,
  schema: z.object({
    id: z.string().min(1).describe("Document ID"),
    browserSaveAttemptId: z
      .string()
      .min(1)
      .max(200)
      .describe("Browser save attempt ID returned by update-document"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    await assertDocumentMutationAccess(args.id, "editor", "id");
    const actorEmail = getRequestUserEmail();
    if (!actorEmail) {
      throw new ActionContractError(
        "Browser save lookup requires an authenticated user.",
        { errorCode: "BROWSER_SAVE_ACTOR_REQUIRED", statusCode: 401 },
      );
    }
    const stored = await findBrowserSaveAttempt({
      db: getDb(),
      documentId: args.id,
      actorEmail: actorEmail.toLowerCase(),
      orgId: getRequestOrgId() ?? "",
      attemptId: args.browserSaveAttemptId,
    });
    if (!stored) return { found: false as const };
    const receipt = readBrowserSaveAttempt(stored);
    return "kind" in receipt
      ? {
          found: true as const,
          preservationRequired: {
            reason: receipt.reason,
            checkpointId: receipt.checkpointId,
            revision: receipt.revision,
            updatedAt: receipt.updatedAt,
          },
        }
      : { found: true as const, browserSaveAttempt: receipt };
  },
});
