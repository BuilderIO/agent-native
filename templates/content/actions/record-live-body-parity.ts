import { defineAction } from "@agent-native/core/action";
import { isFeatureFlagEnabled } from "@agent-native/core/feature-flags";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { countOutcome } from "@agent-native/core/tracking";
import { z } from "zod";

import { LIVE_BODY_SHADOW_FLAG } from "../shared/feature-flags.js";
import { LIVE_BODY_PARITY_OUTCOMES } from "../shared/live-body.js";
import { assertDocumentMutationAccess } from "./_document-mutation-access.js";

function bucket(value: number, bounds: readonly number[]): string {
  const bound = bounds.find((limit) => value < limit);
  return bound === undefined ? `${bounds[bounds.length - 1]}+` : `<${bound}`;
}

export default defineAction({
  description:
    "Count how the page body built from the live copy compared with what the editor saved.",
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  schema: z.object({
    id: z.string().min(1).describe("Document ID"),
    outcome: z.enum(LIVE_BODY_PARITY_OUTCOMES).describe("Comparison outcome"),
    ms: z.number().min(0).max(600_000).describe("Time the comparison took"),
    bytes: z
      .number()
      .int()
      .min(0)
      .max(1_000_000_000)
      .describe("Size of the live copy compared"),
    mismatch: z
      .object({
        block: z.number().int().min(0),
        liveBlockType: z.string().max(100),
        savedBlockType: z.string().max(100),
        at: z.number().int().min(0),
      })
      .optional()
      .describe("Where a mismatch starts"),
  }),
  run: async (args) => {
    await assertDocumentMutationAccess(args.id, "editor", "id");
    const enabled = await isFeatureFlagEnabled(LIVE_BODY_SHADOW_FLAG, {
      userEmail: getRequestUserEmail(),
      orgId: getRequestOrgId(),
    });
    if (!enabled) return { recorded: false as const };
    countOutcome("content_live_body_parity_counts", {
      outcome: args.outcome,
      ms: bucket(args.ms, [10, 50, 100, 250]),
      kb: bucket(args.bytes / 1024, [10, 50, 256]),
    });
    if (args.outcome === "mismatch")
      console.warn("[content] live body differs from the editor save", {
        documentId: args.id,
        ...args.mismatch,
      });
    if (args.outcome === "lossy")
      console.warn(
        "[content] building the live body dropped content the schema rejects",
        { documentId: args.id },
      );
    return { recorded: true as const };
  },
});
