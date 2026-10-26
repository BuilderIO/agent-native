import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { convertPageToLiveCopyIfDue } from "../server/live-copy/backfill.js";
import { LIVE_BODY_SWITCH_BLOCKERS } from "../server/live-copy/eligibility.js";
import { assertDocumentMutationAccess } from "./_document-mutation-access.js";

const page = z.object({ id: z.string() });

// `LiveBodyBackfillOutcome`, with the page's id.
const outcome = z.union([
  page.extend({ status: z.literal("converted") }),
  page.extend({ status: z.literal("current") }),
  page.extend({
    status: z.literal("skipped"),
    reason: z.enum([
      "no_page",
      "trashed",
      "flag_off",
      "local_file",
      "opted_out",
    ]),
  }),
  page.extend({
    status: z.literal("skipped"),
    reason: z.literal("ineligible"),
    blockers: z.array(z.enum(LIVE_BODY_SWITCH_BLOCKERS)),
  }),
  page.extend({
    status: z.literal("deferred"),
    reason: z.enum(["live_edits", "rebaseline_blocked", "base_changed"]),
  }),
  page.extend({
    status: z.literal("deferred"),
    reason: z.literal("live_copy_refused"),
    code: z.enum([
      "not_live_copy",
      "not_seeded",
      "write_refused",
      "read_refused",
      "malformed_state",
      "unsupported_content",
      "state_too_large",
      "derive_refused",
      "derive_failed",
      "build_refused",
      "build_failed",
      "version_conflict",
    ]),
    detail: z.string().optional(),
  }),
  page.extend({
    status: z.literal("deferred"),
    reason: z.literal("gate_moved"),
    gate: z.enum([
      "no_page",
      "not_switched",
      "local_file",
      "live_copy_behind",
      "stored_body_behind",
      "flag_off",
    ]),
  }),
]);

export default defineAction({
  description:
    "Switch one page to its live copy when the backfill rollout has reached its owner and every writer that reaches it can write through the copy. The editor calls it once a page it can edit has loaded.",
  uiOnly: true,
  agentTool: false,
  toolCallable: false,
  mcpTool: false,
  schema: z.object({
    id: z.string().min(1).describe("Document ID"),
  }),
  outputSchema: outcome,
  run: async (args, ctx) => {
    await assertDocumentMutationAccess(args.id, "editor", "id");
    try {
      return {
        id: args.id,
        ...(await convertPageToLiveCopyIfDue(args.id, { ctx })),
      };
    } catch (error) {
      console.error(
        `[convert-page-to-live-copy-if-due] page ${args.id} failed:`,
        error,
      );
      throw new ActionContractError(
        `Page ${args.id} couldn't switch to its live copy: ${error instanceof Error ? error.message : String(error)}`,
        {
          errorCode: "LIVE_BODY_BACKFILL_FAILED",
          statusCode: 500,
          details: { documentId: args.id },
        },
      );
    }
  },
});
