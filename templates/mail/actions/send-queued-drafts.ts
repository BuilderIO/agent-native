import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  claimQueuedDraftForSending,
  listQueuedDrafts,
  markQueuedDraftSent,
  releaseQueuedDraftClaim,
  type QueuedEmailDraft,
} from "../server/lib/queued-drafts.js";
import sendEmailAction from "./send-email.js";

function extractSentMessageId(result: unknown): string | undefined {
  if (result && typeof result === "object" && "id" in result) {
    return String((result as { id: unknown }).id);
  }
  if (typeof result !== "string") return undefined;
  try {
    const parsed = JSON.parse(result);
    if (parsed?.id) return String(parsed.id);
  } catch {}
  return result.match(/\bid:\s*([^)]+)/)?.[1]?.trim();
}

type SendOutcome =
  | {
      outcome: "sent";
      id: string;
      sentMessageId?: string;
      draft: QueuedEmailDraft;
    }
  | { outcome: "skipped"; id: string; reason: string }
  | { outcome: "failed"; id: string; error: string };

async function sendOne(id: string): Promise<SendOutcome> {
  const claim = await claimQueuedDraftForSending(id);
  if (!claim.claimed) {
    if (claim.reason === "sent") {
      return { outcome: "skipped", id, reason: "Already sent." };
    }
    if (claim.reason === "sending") {
      return {
        outcome: "skipped",
        id,
        reason: "Already being sent by another request.",
      };
    }
    return { outcome: "skipped", id, reason: "No longer active." };
  }

  const { ctx, draft, claimId, priorStatus } = claim;
  try {
    const result = await (sendEmailAction as any).run({
      to: draft.to,
      cc: draft.cc || undefined,
      bcc: draft.bcc || undefined,
      subject: draft.subject,
      body: draft.body,
      account: draft.accountEmail || undefined,
    });

    if (typeof result === "string" && result.startsWith("Error")) {
      throw new Error(result);
    }

    const sentMessageId = extractSentMessageId(result);
    const updated = await markQueuedDraftSent(id, ctx, claimId, sentMessageId);
    return { outcome: "sent", id, sentMessageId, draft: updated };
  } catch (err) {
    // Release the claim so the draft goes back to a sendable state instead
    // of being stuck as "sending" forever after a failed send attempt.
    await releaseQueuedDraftClaim(id, ctx, claimId, priorStatus);
    return {
      outcome: "failed",
      id,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export default defineAction({
  description:
    "Send one queued email draft, or send all active queued drafts assigned to the current user.",
  schema: z.object({
    id: z.string().optional().describe("Queued draft ID to send"),
    all: z.coerce
      .boolean()
      .optional()
      .describe("Send all active queued drafts assigned to me"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Maximum drafts to send when all=true"),
  }),
  run: async (args) => {
    let ids: string[] = [];

    if (args.all) {
      const drafts = await listQueuedDrafts({
        scope: "review",
        status: "active",
        limit: args.limit ?? 50,
      });
      ids = drafts
        .filter(
          (draft: QueuedEmailDraft) =>
            draft.status === "queued" || draft.status === "in_review",
        )
        .map((draft: QueuedEmailDraft) => draft.id);
    } else {
      if (!args.id) throw new Error("Provide id, or set all=true.");
      ids = [args.id];
    }

    if (ids.length === 0) {
      return {
        sent: [],
        failed: [],
        message: "No active queued drafts to send.",
      };
    }

    const sent: Array<Extract<SendOutcome, { outcome: "sent" }>> = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const id of ids) {
      const result = await sendOne(id);
      if (result.outcome === "sent") {
        sent.push(result);
      } else if (result.outcome === "failed") {
        failed.push({ id: result.id, error: result.error });
      }
      // "skipped" (already sent / already sending / no longer active)
      // reports cleanly by simply not appearing in either list — re-running
      // an already-sent draft is a clean no-op, not an error.
    }

    return { sent, failed };
  },
});
