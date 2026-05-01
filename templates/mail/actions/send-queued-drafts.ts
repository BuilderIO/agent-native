import { defineAction } from "@agent-native/core";
import { z } from "zod";
import sendEmailAction from "./send-email.js";
import {
  listQueuedDrafts,
  markQueuedDraftSent,
  requireQueuedDraft,
  type QueuedEmailDraft,
} from "../server/lib/queued-drafts.js";

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

async function sendOne(draft: QueuedEmailDraft) {
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
  const updated = await markQueuedDraftSent(draft.id, sentMessageId);
  return {
    id: draft.id,
    status: "sent" as const,
    sentMessageId,
    draft: updated,
  };
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
    let drafts: QueuedEmailDraft[] = [];

    if (args.all) {
      drafts = (
        await listQueuedDrafts({
          scope: "review",
          status: "active",
          limit: args.limit ?? 50,
        })
      ).filter(
        (draft) => draft.status === "queued" || draft.status === "in_review",
      );
    } else {
      if (!args.id) throw new Error("Provide id, or set all=true.");
      const { draft } = await requireQueuedDraft(args.id, { ownerOnly: true });
      drafts = [draft];
    }

    if (drafts.length === 0) {
      return {
        sent: [],
        failed: [],
        message: "No active queued drafts to send.",
      };
    }

    const sent: Array<Awaited<ReturnType<typeof sendOne>>> = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const draft of drafts) {
      try {
        sent.push(await sendOne(draft));
      } catch (err) {
        failed.push({
          id: draft.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { sent, failed };
  },
});
