import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { verifyKnowledge } from "../server/lib/intelligence.js";
import { verificationSchema } from "../shared/intelligence.js";

export default defineAction({
  mcpTool: true,
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  description:
    "Record an editor's explicit human attestation to verify, deprecate or clear verification of a structured intelligence record. Requires attested=true; later content edits invalidate verification.",
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
        "Must be true after the human explicitly chooses the verification state.",
      ),
  }),
  outputSchema: z.object({ verification: verificationSchema }),
  run: verifyKnowledge,
});
