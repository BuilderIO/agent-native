import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { syncDraftToMailbox } from "../server/lib/draft-mailbox-sync.js";

const savedDraft = z.object({
  draftId: z.string(),
  backend: z.enum(["gmail", "local"]),
  accountEmail: z.string().optional(),
});

export default defineAction({
  description:
    "Copy a compose draft, as Mail stores it, to its mailbox draft in Gmail or the local mailbox.",
  schema: z.object({
    id: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,64}$/)
      .describe("Compose draft ID"),
  }),
  // A MailboxSync from server/lib/draft-mailbox-sync.ts, without the synced draft.
  outputSchema: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("synced"),
      savedDraft,
    }),
    z.object({
      status: z.literal("pending"),
      errorCode: z.string(),
      message: z.string(),
      retryAfterMs: z.number().optional(),
      savedDraft: savedDraft.optional(),
      leftoverDraftIds: z.array(z.string()).optional(),
    }),
    z.object({ status: z.literal("unavailable") }),
    z.object({ status: z.literal("gone") }),
  ]),
  // The composer runs this after its own save lands; agents' saves sync inside manage-draft.
  agentTool: false,
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");
    const sync = await syncDraftToMailbox({
      ownerEmail,
      id: args.id,
      localFallback: true,
    });
    if (sync.status !== "synced") return sync;
    return { status: sync.status, savedDraft: sync.savedDraft };
  },
});
