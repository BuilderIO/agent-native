import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { verifyKnowledge } from "../server/lib/intelligence.js";
import {
  verificationReminderDaysSchema,
  verificationSchema,
} from "../shared/intelligence.js";

export default defineAction({
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  description:
    "Record an editor's explicitly requested attestation to verify, deprecate or clear verification of a structured intelligence record. Call only after the user directly requests that state; never initiate verification autonomously. Records the authenticated request principal and date. Requires attested=true; later content edits invalidate verification.",
  schema: z.object({
    expectedRevision: z
      .string()
      .min(1)
      .describe(
        "The current knowledge revision from list-intelligence; changes require renewed review.",
      ),
    knowledgeId: z
      .string()
      .min(1)
      .describe("Knowledge record whose current evidence the editor reviewed."),
    state: z
      .enum(["verified", "deprecated", "unverified"])
      .describe("Attestation state: verified, deprecated, or unverified."),
    attested: z
      .literal(true)
      .describe(
        "Must be true only after the user directly requests the specified verification state. Never infer permission or initiate attestation autonomously.",
      ),
    remindInDays: verificationReminderDaysSchema
      .optional()
      .describe(
        "Optional verification reminder interval in days (7, 14, 30, 90, 180, or 365) when verifying.",
      ),
  }),
  outputSchema: z.object({ verification: verificationSchema }),
  run: verifyKnowledge,
});
