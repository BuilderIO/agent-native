import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { saveRevisionOf } from "@agent-native/core/save-conflict/server";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { composeDeepLink } from "../server/lib/compose-deep-link.js";
import { getConnectedAccountsWithErrors } from "../server/lib/google-auth.js";
import { readSettings } from "../server/lib/mail-settings.js";
import type {
  ComposeState,
  DraftCardThread,
  EmailMessage,
} from "../shared/types.js";
import getEmail from "./get-email.js";
import getThread from "./get-thread.js";

const NO_THREAD: DraftCardThread = { messages: [], status: "none" };

// get-email and get-thread need the exact account; a mailbox without Google is
// "local". With several accounts and none on the draft, there's no telling.
async function draftAccount(
  draft: ComposeState,
  ownerEmail: string,
): Promise<string | undefined> {
  const account = draft.savedDraftAccountEmail ?? draft.accountEmail;
  if (account) return account;
  const { accounts } = await getConnectedAccountsWithErrors(ownerEmail);
  if (accounts.length === 0) return "local";
  return accounts.length === 1 ? accounts[0] : undefined;
}

async function lookupThreadId(
  accountEmail: string,
  messageId: string,
): Promise<string | undefined> {
  try {
    const email = (await getEmail.run({ accountEmail, id: messageId })) as {
      threadId?: string;
    };
    return email.threadId;
    // coercion-ok: with no lookup the caller tries the message's ID as the thread's, and reports the thread unavailable if that fails too.
  } catch {
    return undefined;
  }
}

// The card's session reads only what the card shows: attachments by name, and
// no labels or unsubscribe links.
function cardMessage(message: EmailMessage): EmailMessage {
  const { unsubscribe: _unsubscribe, attachments, ...shown } = message;
  return {
    ...shown,
    labelIds: [],
    ...(attachments && {
      attachments: attachments.map(({ url: _url, ...rest }) => rest),
    }),
  };
}

// Agents often pass only the message a reply answers. The draft's thread comes
// from the stored draft, never from the caller, so the card can't ask for
// another conversation.
async function readDraftThread(
  draft: ComposeState,
  ownerEmail: string,
): Promise<DraftCardThread> {
  if (draft.mode === "compose" || !draft.replyToId) return NO_THREAD;
  try {
    const accountEmail = await draftAccount(draft, ownerEmail);
    if (!accountEmail) return { messages: [], status: "unavailable" };
    // A thread often shares its first message's ID, which is worth trying
    // when the lookup finds nothing.
    const threadId =
      draft.replyToThreadId ??
      (await lookupThreadId(accountEmail, draft.replyToId)) ??
      draft.replyToId;
    const messages = (await getThread.run({
      accountEmail,
      id: threadId,
    })) as EmailMessage[];
    const shown = messages
      .filter((message) => !message.isDraft)
      .map(cardMessage);
    return {
      messages: shown,
      status: shown.length > 0 ? "ready" : "unavailable",
    };
  } catch (error) {
    // The draft is still worth showing without its conversation.
    console.error(`[get-draft-card] thread read failed:`, error);
    return { messages: [], status: "unavailable" };
  }
}

export default defineAction({
  description:
    "Read what the Mail card shows for one draft: the draft, the conversation it answers, and the signature.",
  schema: z.object({
    id: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,64}$/)
      .describe("Draft ID"),
  }),
  outputSchema: z.union([
    z.object({ draft: z.null() }),
    z.object({
      // The stored draft and the provider's messages; see shared/types.ts.
      draft: z.looseObject({ id: z.string() }),
      revision: z.string(),
      accounts: z.array(z.object({ email: z.string() })),
      thread: z.object({
        messages: z.array(z.looseObject({ id: z.string() })),
        status: z.enum(["none", "ready", "unavailable"]),
      }),
      settings: z.object({
        signature: z.string().optional(),
        imagePolicy: z.enum(["show", "block-trackers", "block-all"]).optional(),
      }),
      deepLink: z.string(),
    }),
  ]),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  toolCallable: false,
  run: async ({ id }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");
    const stored = await readAppState(`compose-${id}`);
    if (!stored) return { draft: null };
    // A queued draft keeps who asked for it and why, which the card doesn't show.
    const {
      queuedDraftRequesterEmail: _requester,
      queuedDraftContext: _context,
      ...draft
    } = stored as unknown as ComposeState;
    const [thread, settings] = await Promise.all([
      readDraftThread(draft, ownerEmail),
      readSettings(ownerEmail),
    ]);
    const account = draft.savedDraftAccountEmail ?? draft.accountEmail;
    return {
      draft,
      // Of the stored draft, which is what manage-draft checks a save against.
      revision: saveRevisionOf(stored),
      // A saved draft keeps its account, so the card has no From picker.
      accounts: account ? [{ email: account }] : [],
      thread,
      // Outside a chat the card's images follow the user's setting.
      settings: {
        signature: settings.signature,
        imagePolicy: settings.imagePolicy,
      },
      deepLink: composeDeepLink(draft),
    };
  },
});
