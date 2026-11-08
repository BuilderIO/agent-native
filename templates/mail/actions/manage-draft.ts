import { embedApp, isOutsideAgentCall } from "@agent-native/core";
import { defineAction, fail, NoWriteError } from "@agent-native/core/action";
import {
  readAppState,
  compareAndSetAppState,
  listAppState,
} from "@agent-native/core/application-state";
import {
  checkSaveRevision,
  countSaveOutcome,
  EXPECTED_REVISION_DESCRIPTION,
  isSameRecord,
  saveConflict,
  saveRevisionOf,
} from "@agent-native/core/save-conflict/server";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getUserSetting } from "@agent-native/core/settings";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import { composeDeepLink } from "../server/lib/compose-deep-link.js";
import { syncDraftToMailbox } from "../server/lib/draft-mailbox-sync.js";
import {
  assertGmailDraftAccount,
  deleteGmailDraft,
  saveGmailDraft,
} from "../server/lib/gmail-drafts.js";
import { GmailQuotaRefusedError } from "../server/lib/gmail-quota.js";
import {
  readLocalEmails,
  withLocalEmailMutationLock,
  writeLocalEmails,
} from "../server/lib/local-email-store.js";
import { resolveExistingSavedDraftOwnership } from "../server/lib/saved-draft-ownership.js";
import { appendSignatureToBody } from "../shared/signature.js";
import type { ComposeState } from "../shared/types.js";

// MCP Apps hosts embed the compact draft card; "Open in Mail" keeps the full
// inbox deep link.
function draftCardEmbed(draft: Pick<ComposeState, "id">, deepLink: string) {
  return {
    embed: true,
    path: `/draft?id=${encodeURIComponent(draft.id)}`,
    deepLinkUrl: deepLink,
  } as const;
}

function draftChange(
  verb: "created" | "updated",
  draft: Pick<ComposeState, "id" | "subject" | "to">,
  url: string,
) {
  const subject = draft.subject.trim();
  const recipient = draft.to.trim();
  return {
    verb,
    kind: "email-draft",
    title: (subject || recipient || draft.id).slice(0, 180),
    ...(subject && recipient ? { detail: recipient.slice(0, 500) } : {}),
    url,
  };
}

function sanitizeDraftId(id: string): string | null {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : null;
}

const DRAFT_UPDATE_FIELDS = [
  "to",
  "cc",
  "bcc",
  "subject",
  "body",
  "mode",
  "replyToId",
  "replyToThreadId",
  "accountEmail",
] as const;

const draftFields = {
  to: z.string().optional().describe("Recipient email(s)"),
  cc: z.string().optional().describe("CC email(s)"),
  bcc: z.string().optional().describe("BCC email(s)"),
  subject: z.string().optional().describe("Email subject"),
  body: z
    .string()
    .optional()
    .describe(
      "Email body in markdown. Use [text](url) for links, **bold**, *italic*, - lists, etc.",
    ),
  mode: z
    .enum(["compose", "reply", "forward"])
    .optional()
    .describe("compose, reply, or forward"),
  replyToId: z.string().optional().describe("Message ID being replied to"),
  replyToThreadId: z.string().optional().describe("Thread ID for grouping"),
  accountEmail: z
    .string()
    .optional()
    .describe("The 'from' account email address to send from"),
};

const draftId = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,64}$/)
  .describe("Draft ID");

const manageDraftSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create").describe("Create a new draft"),
    id: draftId.optional().describe("Optional caller-provided draft ID"),
    ...draftFields,
  }),
  z.object({
    action: z.literal("update").describe("Update an existing draft"),
    expectedRevision: z
      .string()
      .optional()
      .describe(
        `${EXPECTED_REVISION_DESCRIPTION} Required: the person may be typing in this draft. Read it from the create result, view-composer, or an earlier update.`,
      ),
    id: draftId.describe(
      "Existing draft ID from compose state: if the state key is `compose-{id}`, pass only `{id}`. A prior create result also provides the ID.",
    ),
    ...draftFields,
  }),
  z.object({
    action: z.literal("delete").describe("Delete one draft"),
    id: draftId,
  }),
  z.object({
    action: z
      .literal("delete-saved")
      .describe("Delete one saved mailbox draft"),
    savedDraftId: z.string().min(1).max(512).describe("Saved mailbox draft ID"),
    savedDraftBackend: z
      .enum(["gmail", "local"])
      .optional()
      .describe("Backend that owns the saved draft, when known"),
    accountEmail: z
      .string()
      .optional()
      .describe("Exact connected account that owns a Gmail draft, when known"),
  }),
  z.object({
    action: z.literal("delete-all").describe("Delete all compose drafts"),
  }),
]);

const MAX_DELETE_ATTEMPTS = 3;

async function deletePersistedDraft(args: {
  ownerEmail: string;
  savedDraftId: string;
  savedDraftBackend?: "gmail" | "local" | undefined;
  accountEmail?: string | undefined;
}): Promise<void> {
  const ownership = await resolveExistingSavedDraftOwnership(args);

  if (ownership.backend === "gmail") {
    await deleteGmailDraft({
      ownerEmail: args.ownerEmail,
      accountEmail: ownership.accountEmail,
      draftId: args.savedDraftId,
    });
    return;
  }

  await withLocalEmailMutationLock(args.ownerEmail, async () => {
    const emails = await readLocalEmails(args.ownerEmail);
    const remaining = emails.filter(
      (email) => !(email.id === args.savedDraftId && email.isDraft),
    );
    if (remaining.length !== emails.length) {
      await writeLocalEmails(args.ownerEmail, remaining);
    }
  });
}

/**
 * Removes a compose draft and its mailbox copy, and returns whether there was a
 * draft to remove. A sync can point the draft at a new mailbox copy while this
 * runs, so the draft goes only if it's still the one read here. If it changed,
 * the copy it points at now goes too, on the next pass. The copy goes first, so
 * if the mailbox refuses, the draft is still there to delete again.
 */
async function deleteComposeDraft(id: string): Promise<boolean> {
  const key = `compose-${id}`;
  const removedCopies = new Set<string>();
  for (let attempt = 1; attempt <= MAX_DELETE_ATTEMPTS; attempt += 1) {
    const storedDraft = await readAppState(key);
    if (!storedDraft) return attempt > 1;
    const savedDraftId = storedDraft.savedDraftId;
    if (
      typeof savedDraftId === "string" &&
      savedDraftId &&
      !removedCopies.has(savedDraftId)
    ) {
      const ownerEmail = getRequestUserEmail();
      if (!ownerEmail) throw new Error("Unauthenticated");
      await deletePersistedDraft({
        ownerEmail,
        savedDraftId,
        savedDraftBackend:
          storedDraft.savedDraftBackend === "gmail" ||
          storedDraft.savedDraftBackend === "local"
            ? storedDraft.savedDraftBackend
            : undefined,
        accountEmail:
          typeof storedDraft.savedDraftAccountEmail === "string"
            ? storedDraft.savedDraftAccountEmail
            : typeof storedDraft.accountEmail === "string"
              ? storedDraft.accountEmail
              : undefined,
      });
      removedCopies.add(savedDraftId);
    }
    if (await compareAndSetAppState(key, storedDraft, null)) return true;
  }
  // Deleting a version this never read could leave behind a mailbox copy a sync
  // just made.
  const copyNote = removedCopies.size
    ? " Its mailbox copy is already gone; the draft's next save makes a new one."
    : "";
  fail(
    `Draft "${id}" kept changing while it was being deleted, so it's still there.${copyNote} Delete it again.`,
    { errorCode: "draft_busy", statusCode: 409 },
  );
}

async function readConfiguredSignature(): Promise<string | undefined> {
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) return undefined;
  const settings = await getUserSetting(ownerEmail, "mail-settings");
  const signature = (settings as any)?.signature;
  return typeof signature === "string" ? signature : undefined;
}

/**
 * Runs Gmail work up to and including this call's first write. Mail's own
 * Gmail budget refuses a request before sending it, so a refusal here saved
 * nothing. Saying so lets the agent save the draft again after the wait,
 * instead of stopping because it can't tell whether the draft saved.
 */
async function beforeFirstWrite<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof GmailQuotaRefusedError)) throw error;
    throw new NoWriteError(`The draft was not saved. ${error.message}`, {
      errorCode: error.errorCode,
      statusCode: error.statusCode,
      details: error.details,
    });
  }
}

/**
 * Removes a Gmail draft this call saved when no Mail draft points at it, and
 * returns whether it did. The caller is already failing with the error that
 * matters, so a failed cleanup is logged rather than thrown in its place, and
 * the caller names the draft left in Gmail.
 */
async function discardUnstoredGmailDraft(
  gmailDraft: GmailDraftRef,
): Promise<boolean> {
  try {
    await deleteGmailDraft(gmailDraft);
    return true;
  } catch (error) {
    console.error("[manage-draft] unstored Gmail draft cleanup failed:", error);
    return false;
  }
}

type GmailDraftRef = {
  ownerEmail: string;
  accountEmail: string;
  draftId: string;
};

/**
 * Stores a compose draft only while its key still holds `expected` (null for a
 * new draft), and returns whether it did. The write can commit before it
 * throws, so a throw rereads the key, and finding this draft there counts as
 * stored. Anything else means it wasn't: the Gmail draft this call made, if
 * any, is removed and the error rethrown. If that Gmail draft can't be removed,
 * the error names it instead. If the reread fails too, the outcome is unknown,
 * so that Gmail draft stays (Mail may point at it) and the error says to check
 * before trying again.
 */
async function storeComposeDraft(
  draft: ComposeState,
  expected: Record<string, unknown> | null,
  newGmailDraft: GmailDraftRef | null,
): Promise<boolean> {
  const key = `compose-${draft.id}`;
  try {
    return await compareAndSetAppState(key, expected, draft);
  } catch (error) {
    let stored: Record<string, unknown> | null;
    try {
      stored = await readAppState(key);
    } catch {
      console.error(
        `[manage-draft] draft ${draft.id} write and reread both failed:`,
        error,
      );
      const kept = newGmailDraft
        ? `, so it kept the Gmail draft it saved (${newGmailDraft.draftId})`
        : "";
      fail(
        `Mail couldn't confirm whether draft "${draft.id}" was stored${kept}. Check for draft "${draft.id}" before ${expected ? "trying again" : "creating it again"}.`,
        {
          errorCode: "draft_store_unconfirmed",
          statusCode: 503,
          details: {
            draftId: draft.id,
            ...(newGmailDraft ? { gmailDraftId: newGmailDraft.draftId } : {}),
          },
        },
      );
    }
    // A draft ID this call made belongs to it alone. Without one, only the
    // exact draft this call wrote counts as stored.
    const ownDraftId = expected ? newGmailDraft?.draftId : draft.savedDraftId;
    const stillOurs = ownDraftId
      ? stored?.savedDraftId === ownDraftId
      : isSameRecord(stored, draft);
    if (stillOurs) return true;
    if (newGmailDraft && !(await discardUnstoredGmailDraft(newGmailDraft))) {
      console.error(`[manage-draft] draft ${draft.id} write failed:`, error);
      fail(
        `Mail couldn't store draft "${draft.id}" or remove the Gmail draft it saved (${newGmailDraft.draftId}), which stays in Gmail's drafts.`,
        {
          errorCode: "draft_store_failed",
          statusCode: 503,
          details: {
            draftId: draft.id,
            leftoverGmailDraftId: newGmailDraft.draftId,
          },
        },
      );
    }
    throw error;
  }
}

/**
 * The draft as stored now, or `known` if it's gone or can't be read. `unconfirmed`
 * means it couldn't be read, so `known` may not be the newest version.
 */
async function latestStoredDraft(
  id: string,
  known: ComposeState,
): Promise<{ draft: ComposeState; unconfirmed: boolean }> {
  try {
    const stored = await readAppState(`compose-${id}`);
    return {
      draft: stored ? (stored as unknown as ComposeState) : known,
      unconfirmed: false,
    };
  } catch (error) {
    console.error(`[manage-draft] draft ${id} reread failed:`, error);
    return { draft: known, unconfirmed: true };
  }
}

/**
 * Brings the mailbox copy of a draft this call stored up to date, and returns
 * the update result for the draft as stored after that. Mail's copy is already
 * saved, so a mailbox failure doesn't fail the update: the result says the copy
 * is pending, and the next save of the draft brings it up to date.
 */
async function updatedDraftResult(
  id: string,
  draft: ComposeState,
  message: string,
) {
  const ownerEmail = getRequestUserEmail();
  const sync = ownerEmail
    ? await syncDraftToMailbox({ ownerEmail, id })
    : ({ status: "unavailable" } as const);
  const { draft: current, unconfirmed } =
    sync.status === "synced"
      ? { draft: sync.draft, unconfirmed: false }
      : await latestStoredDraft(id, draft);
  const deepLink = composeDeepLink(current);
  const note =
    sync.status === "pending"
      ? ` Its copy in the mailbox's drafts isn't updated yet: ${sync.message} Mail's copy is the one that sends.`
      : sync.status === "gone"
        ? " It has since been deleted."
        : "";
  const leftovers =
    "leftoverDraftIds" in sync && sync.leftoverDraftIds
      ? ` A spare copy Mail made (${sync.leftoverDraftIds.join(", ")}) couldn't be removed and stays in the mailbox's drafts.`
      : "";
  const staleness = unconfirmed
    ? " Mail couldn't read the draft back, so this shows what this update stored; a newer save may have landed since."
    : "";
  return {
    id,
    draft: current,
    deepLink,
    ...draftCardEmbed(current, deepLink),
    revision: saveRevisionOf(current),
    mailboxSync:
      sync.status === "synced"
        ? {
            status: sync.status,
            ...(sync.leftoverDraftIds
              ? { leftoverDraftIds: sync.leftoverDraftIds }
              : {}),
          }
        : sync,
    message: `${message}.${note}${leftovers}${staleness}`,
    change: draftChange("updated", current, deepLink),
  };
}

export default defineAction({
  searchHints: [
    "reply",
    "write an email",
    "compose",
    "forward",
    "respond to an email",
  ],
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  description:
    "Manage compose drafts: use `create` for a new draft even if another " +
    "compose draft is open; use `update` to revise a specific existing draft " +
    "with its raw compose ID (`compose-{id}` is the app-state key, so pass " +
    "only `{id}`; a prior create result also provides the ID). Use `delete` " +
    "with only the raw compose ID (not the `compose-{id}` app-state key), " +
    "`delete-saved` with `savedDraftId` for a saved mailbox draft, or " +
    "`delete-all` to remove all compose drafts. To start a new reply, call " +
    "`create` with mode=reply, replyToId, to, subject, and body. " +
    "Send the draft's `revision` back as `expectedRevision` on `update`; if " +
    "the draft changed since, redo your edit on the current value it returns. " +
    "Outside agents require human approval to delete drafts.",
  schema: manageDraftSchema,
  needsApproval: (args, ctx) =>
    isOutsideAgentCall(ctx) &&
    args.action !== "create" &&
    args.action !== "update",
  allowPersistentApproval: false,
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Review email draft",
      description:
        "Review and edit the generated draft next to the conversation it answers. Sending and deleting open in Mail.",
      iframeTitle: "Agent-Native Mail",
      openLabel: "Open in Mail",
      // A chat card's app document is 560px tall, under the shell's 44px bar.
      height: 604,
    }),
  },
  run: async (args, ctx) => {
    const action = args.action;

    if (action === "delete-all") {
      const ownerEmail = getRequestUserEmail();
      if (!ownerEmail) throw new Error("Unauthenticated");
      const storedDrafts = await listAppState("compose-");
      let count = 0;
      for (const { key } of storedDrafts) {
        if (await deleteComposeDraft(key.slice("compose-".length))) count += 1;
      }
      return `Deleted ${count} draft(s)`;
    }

    if (action === "delete") {
      const safeId = sanitizeDraftId(args.id);
      if (!safeId)
        fail(`Invalid draft ID "${args.id}"`, {
          errorCode: "draft_invalid_id",
        });
      if (!(await deleteComposeDraft(safeId))) {
        fail(`Draft "${safeId}" not found`, {
          errorCode: "draft_not_found",
          statusCode: 404,
        });
      }
      return `Deleted draft ${safeId}`;
    }

    if (action === "delete-saved") {
      const ownerEmail = getRequestUserEmail();
      if (!ownerEmail) throw new Error("Unauthenticated");
      await deletePersistedDraft({
        ownerEmail,
        savedDraftId: args.savedDraftId,
        savedDraftBackend: args.savedDraftBackend,
        accountEmail: args.accountEmail,
      });
      return {
        id: args.savedDraftId,
        message: `Deleted saved draft ${args.savedDraftId}`,
      };
    }

    if (action === "create") {
      const rawId = args.id || `draft-${Date.now()}`;
      const id = sanitizeDraftId(rawId);
      if (!id)
        fail(`Invalid draft ID "${rawId}"`, {
          errorCode: "draft_invalid_id",
        });
      if (await readAppState(`compose-${id}`))
        fail(`Draft "${id}" already exists; use update to revise it.`, {
          errorCode: "draft_already_exists",
          statusCode: 409,
        });
      const signature = await readConfiguredSignature();
      const ownerEmail = getRequestUserEmail();
      const body = appendSignatureToBody(args.body || "", signature);
      const savedGmailDraft = ownerEmail
        ? await beforeFirstWrite(() =>
            saveGmailDraft({
              ownerEmail,
              accountEmail: args.accountEmail,
              to: args.to || "",
              cc: args.cc,
              bcc: args.bcc,
              subject: args.subject || "",
              body,
              replyToId: args.replyToId,
              replyToThreadId: args.replyToThreadId,
            }),
          )
        : null;
      const draft: ComposeState = {
        id,
        to: args.to || "",
        subject: args.subject || "",
        body,
        mode: args.mode || "compose",
        ...(savedGmailDraft
          ? {
              savedDraftId: savedGmailDraft.draftId,
              savedDraftBackend: "gmail",
              savedDraftAccountEmail: savedGmailDraft.accountEmail,
            }
          : {}),
      };
      if (args.cc) draft.cc = args.cc;
      if (args.bcc) draft.bcc = args.bcc;
      if (args.replyToId) draft.replyToId = args.replyToId;
      if (args.replyToThreadId) draft.replyToThreadId = args.replyToThreadId;
      const accountEmail = savedGmailDraft?.accountEmail ?? args.accountEmail;
      if (accountEmail) draft.accountEmail = accountEmail;
      const newGmailDraft =
        savedGmailDraft?.created && ownerEmail
          ? {
              ownerEmail,
              accountEmail: savedGmailDraft.accountEmail,
              draftId: savedGmailDraft.draftId,
            }
          : null;
      if (!(await storeComposeDraft(draft, null, newGmailDraft))) {
        const leftover =
          newGmailDraft && !(await discardUnstoredGmailDraft(newGmailDraft))
            ? newGmailDraft.draftId
            : null;
        const leftoverNote = leftover
          ? ` The Gmail draft this call saved (${leftover}) couldn't be removed and stays in Gmail's drafts.`
          : "";
        fail(
          `Draft "${id}" already exists; use update to revise it.${leftoverNote}`,
          {
            errorCode: "draft_already_exists",
            statusCode: 409,
            ...(leftover
              ? { details: { draftId: id, leftoverGmailDraftId: leftover } }
              : {}),
          },
        );
      }
      track(
        "draft_created",
        {
          app_name: "mail",
          template_name: "mail",
          output_id: id,
          output_type: "draft",
          draft_mode: args.mode || "compose",
          has_recipients: Boolean(args.to?.trim()),
          agent_assisted: ctx?.caller !== "frontend",
        },
        ctx,
      );
      const deepLink = composeDeepLink(draft);
      return {
        id,
        draft,
        deepLink,
        ...draftCardEmbed(draft, deepLink),
        revision: saveRevisionOf(draft),
        message: `Created draft ${id}`,
        change: draftChange("created", draft, deepLink),
      };
    }

    if (action === "update") {
      const safeId = sanitizeDraftId(args.id);
      if (!safeId)
        fail(`Invalid draft ID "${args.id}"`, {
          errorCode: "draft_invalid_id",
        });
      const storedDraft = await readAppState(`compose-${safeId}`);
      if (!storedDraft)
        fail(`Draft "${safeId}" not found`, {
          errorCode: "draft_not_found",
          statusCode: 404,
        });
      if (typeof storedDraft !== "object" || Array.isArray(storedDraft)) {
        throw new Error(`Draft "${safeId}" has invalid stored data`);
      }
      const changes: Partial<
        Record<(typeof DRAFT_UPDATE_FIELDS)[number], unknown>
      > = args;
      const decision = checkSaveRevision({
        record: "draft",
        expectedRevision: args.expectedRevision,
        requireRevision: true,
        current: { value: storedDraft, revision: saveRevisionOf(storedDraft) },
        isSameSave: (current) =>
          DRAFT_UPDATE_FIELDS.every(
            (key) =>
              changes[key] === undefined ||
              isSameRecord(current[key], changes[key]),
          ),
      });
      if (decision === "already_applied") {
        // A retry also retries the mailbox copy an earlier attempt left behind.
        return updatedDraftResult(
          safeId,
          storedDraft as unknown as ComposeState,
          `Draft ${safeId} already has this update`,
        );
      }
      const draft = { ...storedDraft } as unknown as ComposeState;
      for (const key of [
        "id",
        "to",
        "cc",
        "bcc",
        "subject",
        "body",
        "mode",
        "replyToId",
        "replyToThreadId",
        "savedDraftId",
        "savedDraftBackend",
        "savedDraftAccountEmail",
        "accountEmail",
      ] as const) {
        const value = draft[key];
        if (value !== undefined && typeof value !== "string") {
          throw new Error(`Draft "${safeId}" has invalid ${key}`);
        }
      }
      if (
        draft.attachments !== undefined &&
        !Array.isArray(draft.attachments)
      ) {
        throw new Error(`Draft "${safeId}" has invalid attachments`);
      }
      const ownerEmail = getRequestUserEmail();
      const savedDraftBackend = draft.savedDraftBackend;
      if (
        savedDraftBackend !== undefined &&
        savedDraftBackend !== "gmail" &&
        savedDraftBackend !== "local"
      ) {
        throw new Error(`Draft "${safeId}" has invalid saved draft backend`);
      }
      let ownership:
        | Awaited<ReturnType<typeof resolveExistingSavedDraftOwnership>>
        | undefined;
      if (draft.savedDraftId) {
        if (!ownerEmail) throw new Error("Unauthenticated");
        const savedDraftId = draft.savedDraftId;
        ownership = await beforeFirstWrite(() =>
          resolveExistingSavedDraftOwnership({
            ownerEmail,
            savedDraftId,
            savedDraftBackend,
            accountEmail: draft.savedDraftAccountEmail ?? draft.accountEmail,
          }),
        );
      }
      if (
        ownership?.backend === "gmail" &&
        args.accountEmail !== undefined &&
        args.accountEmail !== ownership.accountEmail
      ) {
        fail(`Cannot change the account for existing draft "${safeId}"`, {
          errorCode: "draft_account_change",
          statusCode: 400,
        });
      }
      if (!ownership && args.accountEmail) {
        // Checked now: the sync runs after this is stored, and only says pending.
        if (!ownerEmail) throw new Error("Unauthenticated");
        await assertGmailDraftAccount(args.accountEmail, ownerEmail);
      }
      for (const key of DRAFT_UPDATE_FIELDS) {
        if ((args as any)[key] !== undefined)
          (draft as any)[key] = (args as any)[key];
      }
      if (ownership) {
        // Stored, so the mailbox sync needn't look the owner up again.
        draft.savedDraftBackend = ownership.backend;
        if (ownership.backend === "gmail") {
          draft.savedDraftAccountEmail = ownership.accountEmail;
          draft.accountEmail = ownership.accountEmail;
        } else {
          delete draft.savedDraftAccountEmail;
        }
      } else if (args.accountEmail === undefined) {
        // With no mailbox copy yet, the sync makes one in the default account.
        delete draft.accountEmail;
      }

      // Mail's copy is stored first, and only over the revision checked above.
      // The mailbox copy then follows what Mail stores, so a save that loses
      // here has written nothing anywhere.
      if (!(await storeComposeDraft(draft, storedDraft, null))) {
        const latest = await readAppState(`compose-${safeId}`);
        throw saveConflict(
          "draft",
          latest,
          latest ? saveRevisionOf(latest) : null,
        );
      }
      countSaveOutcome("draft", "written");
      return updatedDraftResult(safeId, draft, `Updated draft ${safeId}`);
    }

    return fail(`Unknown action "${String(action)}"`, {
      errorCode: "draft_action_invalid",
    });
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const draft = (result as { draft?: ComposeState }).draft;
    const id = (result as { id?: string }).id;
    if (!draft || !id) return null;
    return {
      url: composeDeepLink(draft),
      label: "Open draft in Mail",
      view: "inbox",
    };
  },
});
