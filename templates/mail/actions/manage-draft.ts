import { embedApp, isOutsideAgentCall } from "@agent-native/core";
import { defineAction, fail, NoWriteError } from "@agent-native/core/action";
import {
  readAppState,
  compareAndSetAppState,
  deleteAppState,
  deleteAppStateByPrefix,
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
import {
  deleteGmailDraft,
  saveGmailDraft,
} from "../server/lib/gmail-drafts.js";
import { GmailQuotaRefusedError } from "../server/lib/gmail-quota.js";
import { updateLocalSavedDraft } from "../server/lib/local-email-drafts.js";
import {
  readLocalEmails,
  withLocalEmailMutationLock,
  writeLocalEmails,
} from "../server/lib/local-email-store.js";
import { attachmentFromUpload } from "../server/lib/media-upload.js";
import { resolveExistingSavedDraftOwnership } from "../server/lib/saved-draft-ownership.js";
import { appendSignatureToBody } from "../shared/signature.js";
import type { ComposeAttachment, ComposeState } from "../shared/types.js";

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
  attachments: z
    .array(
      z.object({
        filename: z
          .string()
          .min(1)
          .max(255)
          .describe("The `filename` from the upload's `attachment` object"),
        originalName: z
          .string()
          .min(1)
          .max(255)
          .optional()
          .describe("Name the recipient sees"),
        mimeType: z.string().max(255).optional().describe("File type"),
      }),
    )
    .max(25)
    .optional()
    .describe(
      "Files on the draft. Pass the `attachment` object from the finished create-attachment-upload PUT. This replaces the draft's whole list, so on update include the files to keep; [] removes them all.",
    ),
};

type DraftAttachmentHandle = NonNullable<
  z.infer<z.ZodObject<typeof draftFields>>["attachments"]
>[number];

/** Files already on the draft keep their entry, which holds forwarded Gmail parts. */
async function resolveDraftAttachments(
  handles: DraftAttachmentHandle[],
  ownerEmail: string | null | undefined,
  current: ComposeAttachment[] = [],
): Promise<ComposeAttachment[]> {
  if (!ownerEmail) throw new Error("Unauthenticated");
  const attachments: ComposeAttachment[] = [];
  // Forwarded parts keep their display name, so two can share a filename.
  const unmatched = [...current];
  for (const handle of handles) {
    const match = unmatched.findIndex(
      (existing) => existing.filename === handle.filename,
    );
    const attachment =
      match >= 0
        ? unmatched.splice(match, 1)[0]
        : await attachmentFromUpload(ownerEmail, handle);
    if (!attachment)
      fail(
        `Attachment "${handle.filename}" isn't an upload Mail has for this account. Finish its create-attachment-upload PUT, then use the returned attachment object.`,
        { errorCode: "draft_attachment_not_found", statusCode: 400 },
      );
    attachments.push(attachment);
  }
  return attachments;
}

function hasSameAttachments(
  current: unknown,
  handles: DraftAttachmentHandle[],
): boolean {
  const filenames = Array.isArray(current)
    ? current.map((attachment) => attachment?.filename)
    : [];
  return isSameRecord(
    filenames,
    handles.map((handle) => handle.filename),
  );
}

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

async function deletePersistedDraft(args: {
  ownerEmail: string;
  savedDraftId: string;
  savedDraftBackend?: "gmail" | "local";
  accountEmail?: string;
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
      for (const { value } of storedDrafts) {
        const savedDraftId = value.savedDraftId;
        if (typeof savedDraftId !== "string" || !savedDraftId) continue;
        await deletePersistedDraft({
          ownerEmail,
          savedDraftId,
          savedDraftBackend:
            value.savedDraftBackend === "gmail" ||
            value.savedDraftBackend === "local"
              ? value.savedDraftBackend
              : undefined,
          accountEmail:
            typeof value.savedDraftAccountEmail === "string"
              ? value.savedDraftAccountEmail
              : typeof value.accountEmail === "string"
                ? value.accountEmail
                : undefined,
        });
      }
      const count = await deleteAppStateByPrefix("compose-");
      return `Deleted ${count} draft(s)`;
    }

    if (action === "delete") {
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
      const savedDraftId = storedDraft.savedDraftId;
      if (typeof savedDraftId === "string" && savedDraftId) {
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
      }
      const deleted = await deleteAppState(`compose-${safeId}`);
      if (!deleted)
        fail(`Draft "${safeId}" not found`, {
          errorCode: "draft_not_found",
          statusCode: 404,
        });
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
      const attachments = args.attachments
        ? await resolveDraftAttachments(args.attachments, ownerEmail)
        : undefined;
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
              attachments,
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
      if (attachments?.length) draft.attachments = attachments;
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
          ) &&
          (args.attachments === undefined ||
            hasSameAttachments(current.attachments, args.attachments)),
      });
      if (decision === "already_applied") {
        const draft = storedDraft as unknown as ComposeState;
        const deepLink = composeDeepLink(draft);
        return {
          id: safeId,
          draft,
          deepLink,
          ...draftCardEmbed(draft, deepLink),
          revision: saveRevisionOf(draft),
          message: `Draft ${safeId} already has this update`,
          change: draftChange("updated", draft, deepLink),
        };
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
      for (const key of DRAFT_UPDATE_FIELDS) {
        if ((args as any)[key] !== undefined)
          (draft as any)[key] = (args as any)[key];
      }
      if (args.attachments !== undefined) {
        draft.attachments = await resolveDraftAttachments(
          args.attachments,
          ownerEmail,
          draft.attachments,
        );
      }
      const accountEmail =
        ownership?.backend === "gmail"
          ? ownership.accountEmail
          : (args.accountEmail ??
            (draft.savedDraftId ? draft.accountEmail : undefined));
      if (!draft.savedDraftId && args.accountEmail === undefined) {
        delete draft.accountEmail;
      }
      if (ownership?.backend === "local" && ownerEmail) {
        await updateLocalSavedDraft({
          ownerEmail,
          draftId: draft.savedDraftId!,
          to: draft.to || "",
          cc: draft.cc ?? "",
          bcc: draft.bcc ?? "",
          subject: draft.subject || "",
          body: draft.body || "",
          replyToId: draft.replyToId,
          replyToThreadId: draft.replyToThreadId,
        });
        draft.savedDraftBackend = "local";
        delete draft.savedDraftAccountEmail;
      }

      // A local draft was saved above and skips this, so this save is still
      // the call's first write.
      const savedGmailDraft =
        ownership?.backend === "gmail" || !ownership
          ? ownerEmail
            ? await beforeFirstWrite(() =>
                saveGmailDraft({
                  ownerEmail,
                  accountEmail,
                  draftId:
                    ownership?.backend === "gmail"
                      ? draft.savedDraftId
                      : undefined,
                  to: draft.to || "",
                  cc: draft.cc,
                  bcc: draft.bcc,
                  subject: draft.subject || "",
                  body: draft.body || "",
                  attachments: draft.attachments,
                  replyToId: draft.replyToId,
                  replyToThreadId: draft.replyToThreadId,
                }),
              )
            : null
          : null;
      if (ownership?.backend === "gmail" && !savedGmailDraft) {
        throw new Error("Could not save the existing Gmail draft.");
      }
      if (savedGmailDraft) {
        draft.savedDraftId = savedGmailDraft.draftId;
        draft.savedDraftBackend = "gmail";
        draft.savedDraftAccountEmail = savedGmailDraft.accountEmail;
        draft.accountEmail = savedGmailDraft.accountEmail;
      }
      const newGmailDraft =
        savedGmailDraft?.created && ownerEmail
          ? {
              ownerEmail,
              accountEmail: savedGmailDraft.accountEmail,
              draftId: savedGmailDraft.draftId,
            }
          : null;
      // The revision was checked before Gmail. This catches a save in between.
      if (!(await storeComposeDraft(draft, storedDraft, newGmailDraft))) {
        // Nothing points at a Gmail draft this call made, and a redo makes another.
        const discarded =
          !newGmailDraft || (await discardUnstoredGmailDraft(newGmailDraft));
        const latest = await readAppState(`compose-${safeId}`);
        throw saveConflict(
          "draft",
          latest,
          latest ? saveRevisionOf(latest) : null,
          discarded
            ? undefined
            : { leftoverGmailDraftId: newGmailDraft.draftId },
        );
      }
      countSaveOutcome("draft", "written");
      const deepLink = composeDeepLink(draft);
      return {
        id: safeId,
        draft,
        deepLink,
        ...draftCardEmbed(draft, deepLink),
        revision: saveRevisionOf(draft),
        message: `Updated draft ${safeId}`,
        change: draftChange("updated", draft, deepLink),
      };
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
