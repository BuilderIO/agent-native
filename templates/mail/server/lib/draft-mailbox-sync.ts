import {
  compareAndSetAppState,
  readAppState,
} from "@agent-native/core/application-state";
import { isSameRecord } from "@agent-native/core/save-conflict/server";

import {
  ALIAS_PREFIX,
  expandAliasTokens,
  unresolvedAliasIds,
} from "../../shared/alias-tokens.js";
import { DRAFT_MAILBOX_BUSY_ERROR_CODE } from "../../shared/draft-mailbox.js";
import type { ComposeState } from "../../shared/types.js";
import { readAliases } from "./aliases.js";
import { deleteGmailDraft, saveGmailDraft } from "./gmail-drafts.js";
import { GmailQuotaCooldownError } from "./gmail-quota.js";
import { isConnected } from "./google-auth.js";
import {
  createLocalSavedDraft,
  deleteLocalSavedDraft,
  updateLocalSavedDraft,
} from "./local-email-drafts.js";
import { resolveExistingSavedDraftOwnership } from "./saved-draft-ownership.js";

export type SavedDraftRef = {
  draftId: string;
  backend: "gmail" | "local";
  accountEmail?: string;
};

/** Where a compose draft's mailbox copy stands after a sync. */
export type MailboxSync =
  /** The mailbox copy matches `draft`, which is how Mail stores the draft now. */
  | {
      status: "synced";
      draft: ComposeState;
      savedDraft: SavedDraftRef;
      leftoverDraftIds?: string[];
    }
  /** Mail's copy is stored; the mailbox copy catches up on a later save. */
  | {
      status: "pending";
      errorCode: string;
      message: string;
      retryAfterMs?: number;
      /**
       * A copy this sync made and pointed Mail's copy at before it stopped,
       * so the caller can update or delete that copy rather than lose track
       * of it.
       */
      savedDraft?: SavedDraftRef;
      leftoverDraftIds?: string[];
    }
  /** There's no mailbox to save to. */
  | { status: "unavailable" }
  /** Mail no longer stores the draft, so nothing was copied. */
  | { status: "gone" };

// Each attempt writes the mailbox once. A sync that runs out says pending: its
// last write may have landed after a newer save's sync had finished, leaving
// the copy a step behind until the draft's next save. Running out takes three
// more saves landing while this sync writes.
const MAX_SYNC_ATTEMPTS = 3;

// What the mailbox copy is built from. A change to anything else, such as
// whether the composer is inline, doesn't make the copy stale.
const MAILBOX_FIELDS = [
  "to",
  "cc",
  "bcc",
  "subject",
  "body",
  "attachments",
  "replyToId",
  "replyToThreadId",
  "accountEmail",
  "savedDraftId",
  "savedDraftBackend",
  "savedDraftAccountEmail",
] as const;

function sameMailboxCopy(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  return MAILBOX_FIELDS.every((key) => isSameRecord(a[key], b[key]));
}

type WrittenCopy = SavedDraftRef & { created: boolean };

/**
 * The draft names a group that no longer exists. Copying it without that
 * group's people would leave them off the mailbox copy unnoticed, so it isn't
 * copied until the group is fixed, as the composer's own save refuses it.
 */
class UnknownAliasError extends Error {
  readonly errorCode = "draft_alias_unknown";
}

/** Group tokens become their addresses: a mailbox draft can't hold a group. */
async function mailboxRecipients(ownerEmail: string, draft: ComposeState) {
  const recipients = { to: draft.to || "", cc: draft.cc, bcc: draft.bcc };
  const { to, cc, bcc } = recipients;
  if (![to, cc, bcc].some((field) => field?.includes(ALIAS_PREFIX))) {
    return recipients;
  }
  const aliases = await readAliases(ownerEmail);
  const unknown = [to, cc ?? "", bcc ?? ""].flatMap((field) =>
    unresolvedAliasIds(field, aliases),
  );
  if (unknown.length > 0) {
    throw new UnknownAliasError(
      `The draft's recipients include groups that no longer exist: ${unknown.join(", ")}`,
    );
  }
  return {
    to: expandAliasTokens(to, aliases),
    cc: cc === undefined ? undefined : expandAliasTokens(cc, aliases),
    bcc: bcc === undefined ? undefined : expandAliasTokens(bcc, aliases),
  };
}

/**
 * Writes `draft` to its mailbox copy, making one when it has none, and returns
 * that copy, or null when there's no mailbox to write to. Without
 * `localFallback`, an owner with no Gmail account gets no copy.
 */
async function writeMailboxCopy(
  ownerEmail: string,
  draft: ComposeState,
  localFallback: boolean,
): Promise<WrittenCopy | null> {
  const content = {
    ...(await mailboxRecipients(ownerEmail, draft)),
    subject: draft.subject || "",
    body: draft.body || "",
    // All of them, so a removed attachment leaves the copy too.
    attachments: draft.attachments ?? [],
    replyToId: draft.replyToId,
    replyToThreadId: draft.replyToThreadId,
  };

  if (draft.savedDraftId) {
    const ownership = await resolveExistingSavedDraftOwnership({
      ownerEmail,
      savedDraftId: draft.savedDraftId,
      savedDraftBackend: draft.savedDraftBackend,
      accountEmail: draft.savedDraftAccountEmail ?? draft.accountEmail,
    });
    if (ownership.backend === "local") {
      const updated = await updateLocalSavedDraft({
        ownerEmail,
        draftId: draft.savedDraftId,
        ...content,
        cc: content.cc ?? "",
        bcc: content.bcc ?? "",
      });
      if (updated) {
        return {
          draftId: draft.savedDraftId,
          backend: "local",
          created: false,
        };
      }
      const draftId = await createLocalSavedDraft({ ownerEmail, ...content });
      return { draftId, backend: "local", created: true };
    }
    // A Gmail draft deleted outside Mail comes back as a new one, as `created`.
    const saved = await saveGmailDraft({
      ownerEmail,
      accountEmail: ownership.accountEmail,
      draftId: draft.savedDraftId,
      ...content,
      replyHeadersOptional: true,
    });
    if (!saved) throw new Error("Could not save the existing Gmail draft.");
    return {
      draftId: saved.draftId,
      backend: "gmail",
      accountEmail: saved.accountEmail,
      created: saved.created,
    };
  }

  const saved = await saveGmailDraft({
    ownerEmail,
    accountEmail: draft.accountEmail,
    ...content,
    replyHeadersOptional: true,
  });
  if (saved) {
    return {
      draftId: saved.draftId,
      backend: "gmail",
      accountEmail: saved.accountEmail,
      created: true,
    };
  }
  if (!localFallback) return null;
  if (await isConnected(ownerEmail)) {
    throw new Error("Gmail is connected but couldn't save this draft.");
  }
  const draftId = await createLocalSavedDraft({ ownerEmail, ...content });
  return { draftId, backend: "local", created: true };
}

function withCopy(draft: ComposeState, copy: SavedDraftRef): ComposeState {
  const next: ComposeState = {
    ...draft,
    savedDraftId: copy.draftId,
    savedDraftBackend: copy.backend,
  };
  if (copy.accountEmail) {
    next.savedDraftAccountEmail = copy.accountEmail;
    next.accountEmail = copy.accountEmail;
  } else {
    delete next.savedDraftAccountEmail;
  }
  return next;
}

function refOf(copy: SavedDraftRef): SavedDraftRef {
  return {
    draftId: copy.draftId,
    backend: copy.backend,
    ...(copy.accountEmail ? { accountEmail: copy.accountEmail } : {}),
  };
}

/**
 * Removes a copy no stored draft points at, and returns whether it did. The
 * caller reports one it couldn't remove rather than failing over it.
 */
async function discardCopy(
  ownerEmail: string,
  copy: SavedDraftRef,
): Promise<boolean> {
  try {
    if (copy.backend === "gmail") {
      await deleteGmailDraft({
        ownerEmail,
        accountEmail: copy.accountEmail,
        draftId: copy.draftId,
      });
    } else {
      await deleteLocalSavedDraft({ ownerEmail, draftId: copy.draftId });
    }
    return true;
  } catch (error) {
    console.error(
      `[draft-mailbox-sync] couldn't remove unused ${copy.backend} draft ${copy.draftId}:`,
      error,
    );
    return false;
  }
}

/**
 * Points the stored draft at a copy this sync made, only while the draft is
 * still what the copy was written from. A write that throws may have landed,
 * so the key is read again: finding the copy there counts as adopted, and
 * anything else as not. If that read throws too, the outcome is unknown, so
 * the error stands and the copy stays, since Mail may point at it.
 */
async function adoptCopy(
  key: string,
  stored: Record<string, unknown>,
  next: ComposeState,
): Promise<boolean> {
  try {
    return await compareAndSetAppState(key, stored, next);
  } catch (error) {
    const latest = await readAppState(key);
    if (latest?.savedDraftId === next.savedDraftId) return true;
    console.error(`[draft-mailbox-sync] ${key} write failed:`, error);
    return false;
  }
}

/**
 * Brings a compose draft's mailbox copy (Gmail's draft, or a local one) up to
 * date with the draft as Mail stores it. Mail's copy is the one that sends, so
 * the mailbox follows it, never the reverse: a caller stores its change first,
 * then syncs. A Gmail write can't be made conditional, so after writing, this
 * reads the draft again and writes again if it changed meanwhile: a sync
 * reports synced only after a write of the draft as stored when it read it
 * back. Whichever save stores last has its sync run after, so overlapping
 * saves end with the copy on the newest draft, short of the attempt limit.
 *
 * It doesn't throw: a failure leaves Mail's copy stored and says the mailbox
 * copy is pending, for the next save to bring up to date.
 */
export async function syncDraftToMailbox(args: {
  ownerEmail: string;
  id: string;
  /** For an owner with no Gmail account, keep a local mailbox draft instead. */
  localFallback?: boolean;
}): Promise<MailboxSync> {
  const key = `compose-${args.id}`;
  const leftovers: string[] = [];
  const leftover = () =>
    leftovers.length ? { leftoverDraftIds: [...leftovers] } : {};
  let adopted: SavedDraftRef | undefined;
  const pendingCopy = () => ({
    ...(adopted ? { savedDraft: adopted } : {}),
    ...leftover(),
  });
  try {
    for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt += 1) {
      const stored = await readAppState(key);
      if (!stored) return { status: "gone" };
      const draft = stored as unknown as ComposeState;
      const copy = await writeMailboxCopy(
        args.ownerEmail,
        draft,
        args.localFallback === true,
      );
      if (!copy) return { status: "unavailable" };

      let written: Record<string, unknown> = stored;
      if (copy.created) {
        const next = withCopy(draft, copy);
        if (!(await adoptCopy(key, stored, next))) {
          // Another save changed the draft, and may have made its own copy.
          if (!(await discardCopy(args.ownerEmail, copy))) {
            leftovers.push(copy.draftId);
          }
          continue;
        }
        written = next;
        adopted = refOf(copy);
      }

      const latest = await readAppState(key);
      if (!latest) return { status: "gone" };
      if (sameMailboxCopy(latest, written)) {
        return {
          status: "synced",
          draft: latest as unknown as ComposeState,
          savedDraft: refOf(copy),
          ...leftover(),
        };
      }
    }
    return {
      status: "pending",
      errorCode: DRAFT_MAILBOX_BUSY_ERROR_CODE,
      message:
        "The draft kept changing while its mailbox copy was saved; the next save brings that copy up to date.",
      ...pendingCopy(),
    };
  } catch (error) {
    if (error instanceof UnknownAliasError) {
      return {
        status: "pending",
        errorCode: error.errorCode,
        message: error.message,
        ...pendingCopy(),
      };
    }
    if (error instanceof GmailQuotaCooldownError) {
      return {
        status: "pending",
        errorCode: error.errorCode,
        message: error.message,
        retryAfterMs: error.retryAfterMs,
        ...pendingCopy(),
      };
    }
    console.error(`[draft-mailbox-sync] draft ${args.id}:`, error);
    return {
      status: "pending",
      errorCode: "draft_mailbox_save_failed",
      message: error instanceof Error ? error.message : String(error),
      ...pendingCopy(),
    };
  }
}
