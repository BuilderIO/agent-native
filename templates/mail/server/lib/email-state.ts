import {
  getOAuthTokens,
  listOAuthAccountsByOwner,
  saveOAuthTokens,
} from "@agent-native/core/oauth-tokens";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
/**
 * Shared server functions for email state-change operations.
 *
 * These are the single source of truth called by both the actions surface
 * (agent) and the REST route handlers (frontend). Each function carries the
 * superset of behaviour from the two prior implementations — see reconciliation
 * notes inline.
 */
import type { EmailMessage, Label } from "@shared/types.js";

import {
  createOAuth2Client,
  gmailGetMessage,
  gmailModifyMessage,
  gmailModifyThread,
  gmailTrashThread,
  gmailUntrashThread,
} from "./google-api.js";
import { isConnected } from "./google-auth.js";
import { invalidateThreadCache } from "./thread-cache.js";

// ---------------------------------------------------------------------------
// Internal token helpers (duplicated from handlers/emails.ts to keep this
// lib self-contained and free of H3 imports)
// ---------------------------------------------------------------------------

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
}

async function refreshIfNeeded(
  accountId: string,
  tokens: StoredTokens,
): Promise<string> {
  if (
    tokens.refresh_token &&
    tokens.expiry_date &&
    tokens.expiry_date < Date.now() + 5 * 60 * 1000
  ) {
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
    const oauth = createOAuth2Client(clientId, clientSecret, "");
    const refreshed = await oauth.refreshToken(tokens.refresh_token);
    const updated = {
      ...tokens,
      access_token: refreshed.access_token,
      expiry_date: Date.now() + refreshed.expires_in * 1000,
    };
    await saveOAuthTokens(
      "google",
      accountId,
      updated as unknown as Record<string, unknown>,
    );
    return refreshed.access_token;
  }
  return tokens.access_token;
}

async function getToken(accountId: string): Promise<string | null> {
  const tokens = (await getOAuthTokens("google", accountId)) as unknown as
    | StoredTokens
    | undefined;
  if (!tokens?.access_token) return null;
  return refreshIfNeeded(accountId, tokens);
}

/**
 * Resolve an account email to a validated account owned by ownerEmail.
 * Falls back to ownerEmail when accountEmail is absent or identical.
 * Throws if the provided accountEmail is not owned by the user.
 */
export async function resolveAccountEmail(
  accountEmail: string | undefined,
  ownerEmail: string,
): Promise<string> {
  if (!accountEmail || accountEmail === ownerEmail) return ownerEmail;
  const accounts = await listOAuthAccountsByOwner("google", ownerEmail);
  if (!accounts.some((a) => a.accountId === accountEmail)) {
    throw new Error("Account not owned by current user");
  }
  return accountEmail;
}

/**
 * Get a valid access token for a single validated account.
 * Throws when no token exists or the account is not owned by the user.
 */
export async function getAccountToken(
  accountEmail: string,
  ownerEmail: string,
): Promise<string> {
  const acct = await resolveAccountEmail(accountEmail, ownerEmail);
  const token = await getToken(acct);
  if (!token) throw new Error(`No valid access token for ${acct}`);
  return token;
}

// ---------------------------------------------------------------------------
// Local-mode helpers
// ---------------------------------------------------------------------------

async function readLocalEmails(ownerEmail: string): Promise<EmailMessage[]> {
  const data = await getUserSetting(ownerEmail, "local-emails");
  if (data && Array.isArray((data as any).emails)) {
    return (data as any).emails as EmailMessage[];
  }
  return [];
}

async function writeLocalEmails(
  ownerEmail: string,
  emails: EmailMessage[],
): Promise<void> {
  await putUserSetting(ownerEmail, "local-emails", { emails });
}

async function readLocalLabels(ownerEmail: string): Promise<Label[]> {
  const data = await getUserSetting(ownerEmail, "labels");
  if (data && Array.isArray((data as any).labels)) {
    return (data as any).labels as Label[];
  }
  return [];
}

async function writeLocalLabels(
  ownerEmail: string,
  labels: Label[],
): Promise<void> {
  await putUserSetting(ownerEmail, "labels", { labels });
}

function recomputeUnreadCounts(
  emails: EmailMessage[],
  labels: Label[],
): Label[] {
  return labels.map((label) => {
    const active = emails.filter(
      (e) => !e.isArchived && !e.isTrashed && e.labelIds.includes(label.id),
    );
    return {
      ...label,
      unreadCount: active.filter((e) => !e.isRead).length,
      totalCount: active.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

export interface ArchiveEmailInput {
  /** Message ID to archive */
  id: string;
  ownerEmail: string;
  /**
   * Preferred account to use. When absent the primary account for ownerEmail
   * is used. When the preferred account doesn't own the message the call falls
   * through to the other connected accounts so the agent's multi-account loop
   * behaviour is preserved.
   */
  accountEmail?: string;
  /** Optional label name/id to remove in addition to INBOX (label-view UX). */
  removeLabel?: string;
  /** Caller-supplied threadId to skip the gmailGetMessage round-trip. */
  threadId?: string;
}

export interface ArchiveEmailResult {
  id: string;
  threadId: string;
  isArchived: true;
}

/**
 * Archive an email thread by message ID.
 *
 * Reconciliation notes:
 * - cache invalidation (handler ✓, action ✗) → always invalidate so thread
 *   views don't show stale data after archiving.
 * - removeLabel support (handler ✓, action ✗) → preserved; required for
 *   label-view archive UI.
 * - accountEmail scoping (handler ✓, action looped all) → try the requested
 *   account first, fall through to other accounts so agent multi-ID behaviour
 *   is preserved.
 * - local-mode: update entire thread (handler behaviour) and recompute label
 *   counts, matching the handler's richer approach.
 */
export async function archiveEmail(
  input: ArchiveEmailInput,
): Promise<ArchiveEmailResult> {
  const {
    id,
    ownerEmail,
    accountEmail,
    removeLabel,
    threadId: hintThreadId,
  } = input;

  if (!(await isConnected(ownerEmail))) {
    const emails = await readLocalEmails(ownerEmail);
    const target = emails.find((e) => e.id === id);
    if (!target) throw new Error(`Email ${id} not found`);
    const threadId = target.threadId || target.id;
    const updated = emails.map((e) => {
      if ((e.threadId || e.id) !== threadId) return e;
      return {
        ...e,
        isArchived: true,
        labelIds: e.labelIds.filter((l) => l !== "inbox"),
      };
    });
    await writeLocalEmails(ownerEmail, updated);
    await writeLocalLabels(
      ownerEmail,
      recomputeUnreadCounts(updated, await readLocalLabels(ownerEmail)),
    );
    return { id, threadId, isArchived: true };
  }

  // Try accountEmail-scoped account first, then fall through to other accounts
  // for multi-identity agent scenarios.
  const accounts = await listOAuthAccountsByOwner("google", ownerEmail);
  if (accounts.length === 0) throw new Error("No Google account connected");

  const preferred = accountEmail
    ? accounts.find((a) => a.accountId === accountEmail)
    : undefined;
  const ordered = preferred
    ? [preferred, ...accounts.filter((a) => a !== preferred)]
    : accounts;

  let lastErr: Error | undefined;
  for (const account of ordered) {
    const token = await getToken(account.accountId);
    if (!token) continue;
    try {
      let resolvedThreadId = hintThreadId;
      let labelIds: string[] | undefined;
      // Fetch message when threadId unknown or removeLabel resolution is needed
      if (!resolvedThreadId || removeLabel) {
        const msg = await gmailGetMessage(token, id, "minimal");
        resolvedThreadId = resolvedThreadId || msg.threadId;
        labelIds = msg.labelIds;
      }
      if (!resolvedThreadId) throw new Error("Thread not found");
      const removeLabels = ["INBOX"];
      if (removeLabel) {
        const labelId = labelIds?.find(
          (l) =>
            l === removeLabel || l.toLowerCase() === removeLabel.toLowerCase(),
        );
        if (labelId && !removeLabels.includes(labelId)) {
          removeLabels.push(labelId);
        }
      }
      await gmailModifyThread(token, resolvedThreadId, undefined, removeLabels);
      // Invalidate so thread-view doesn't serve cached pre-archive messages
      invalidateThreadCache(ownerEmail, resolvedThreadId);
      return { id, threadId: resolvedThreadId, isArchived: true };
    } catch (err: any) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("Archive failed");
}

// ---------------------------------------------------------------------------
// Unarchive
// ---------------------------------------------------------------------------

export interface UnarchiveEmailInput {
  id: string;
  ownerEmail: string;
  accountEmail?: string;
}

export interface UnarchiveEmailResult {
  id: string;
  threadId: string;
  isArchived: false;
}

/**
 * Restore an archived email back to INBOX.
 *
 * Reconciliation notes:
 * - cache invalidation (handler ✓) → always invalidate.
 * - local-mode: restore entire thread + recompute label counts.
 */
export async function unarchiveEmail(
  input: UnarchiveEmailInput,
): Promise<UnarchiveEmailResult> {
  const { id, ownerEmail, accountEmail } = input;

  if (!(await isConnected(ownerEmail))) {
    const emails = await readLocalEmails(ownerEmail);
    const target = emails.find((e) => e.id === id);
    if (!target) throw new Error(`Email ${id} not found`);
    const threadId = target.threadId || target.id;
    const updated = emails.map((e) => {
      if ((e.threadId || e.id) !== threadId) return e;
      return {
        ...e,
        isArchived: false,
        labelIds: e.labelIds.includes("inbox")
          ? e.labelIds
          : ["inbox", ...e.labelIds],
      };
    });
    await writeLocalEmails(ownerEmail, updated);
    await writeLocalLabels(
      ownerEmail,
      recomputeUnreadCounts(updated, await readLocalLabels(ownerEmail)),
    );
    return { id, threadId, isArchived: false };
  }

  const token = await getAccountToken(accountEmail ?? ownerEmail, ownerEmail);
  const msg = await gmailGetMessage(token, id, "minimal");
  await gmailModifyThread(token, msg.threadId, ["INBOX"]);
  invalidateThreadCache(ownerEmail, msg.threadId);
  return { id, threadId: msg.threadId, isArchived: false };
}

// ---------------------------------------------------------------------------
// Star / unstar
// ---------------------------------------------------------------------------

export interface ToggleStarInput {
  id: string;
  ownerEmail: string;
  isStarred: boolean;
  accountEmail?: string;
  /** Caller-supplied threadId used for cache invalidation without extra fetch. */
  threadId?: string;
}

export interface ToggleStarResult {
  id: string;
  threadId?: string;
  isStarred: boolean;
}

/**
 * Star or unstar a single message.
 *
 * Reconciliation notes:
 * - cache invalidation (handler ✓, action ✗) → always invalidate when a
 *   threadId is known so the thread view reflects the star change.
 * - accountEmail scoping (handler ✓, action looped all) → try preferred
 *   account, fall through to other connected accounts.
 * - local-mode: update per-message isStarred.
 */
export async function toggleStar(
  input: ToggleStarInput,
): Promise<ToggleStarResult> {
  const {
    id,
    ownerEmail,
    isStarred,
    accountEmail,
    threadId: hintThreadId,
  } = input;

  if (!(await isConnected(ownerEmail))) {
    const emails = await readLocalEmails(ownerEmail);
    const idx = emails.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error(`Email ${id} not found`);
    emails[idx] = { ...emails[idx], isStarred };
    await writeLocalEmails(ownerEmail, emails);
    return { id, threadId: emails[idx].threadId, isStarred };
  }

  const accounts = await listOAuthAccountsByOwner("google", ownerEmail);
  if (accounts.length === 0) throw new Error("No Google account connected");

  const preferred = accountEmail
    ? accounts.find((a) => a.accountId === accountEmail)
    : undefined;
  const ordered = preferred
    ? [preferred, ...accounts.filter((a) => a !== preferred)]
    : accounts;

  let lastErr: Error | undefined;
  for (const account of ordered) {
    const token = await getToken(account.accountId);
    if (!token) continue;
    try {
      const updated = (await gmailModifyMessage(
        token,
        id,
        isStarred ? ["STARRED"] : undefined,
        isStarred ? undefined : ["STARRED"],
      )) as { threadId?: string };
      const resolvedThreadId = hintThreadId || updated.threadId;
      if (resolvedThreadId) {
        invalidateThreadCache(ownerEmail, resolvedThreadId);
      }
      return { id, threadId: resolvedThreadId, isStarred };
    } catch (err: any) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("Toggle star failed");
}

// ---------------------------------------------------------------------------
// Trash
// ---------------------------------------------------------------------------

export interface TrashEmailInput {
  id: string;
  ownerEmail: string;
  accountEmail?: string;
}

export interface TrashEmailResult {
  id: string;
  threadId: string;
  isTrashed: true;
}

/**
 * Move an email's thread to trash.
 *
 * Reconciliation notes:
 * - cache invalidation (handler ✓, action ✗) → always invalidate.
 * - local-mode: mark entire thread as trashed + recompute label counts
 *   (handler behaviour, richer than action's per-message update).
 * - accountEmail scoping (handler ✓, action looped all) → try preferred
 *   account, fall through.
 */
export async function trashEmail(
  input: TrashEmailInput,
): Promise<TrashEmailResult> {
  const { id, ownerEmail, accountEmail } = input;

  if (!(await isConnected(ownerEmail))) {
    const emails = await readLocalEmails(ownerEmail);
    const target = emails.find((e) => e.id === id);
    if (!target) throw new Error(`Email ${id} not found`);
    const threadId = target.threadId || target.id;
    const updated = emails.map((e) => {
      if ((e.threadId || e.id) !== threadId) return e;
      return { ...e, isTrashed: true, isArchived: false };
    });
    await writeLocalEmails(ownerEmail, updated);
    await writeLocalLabels(
      ownerEmail,
      recomputeUnreadCounts(updated, await readLocalLabels(ownerEmail)),
    );
    return { id, threadId, isTrashed: true };
  }

  const accounts = await listOAuthAccountsByOwner("google", ownerEmail);
  if (accounts.length === 0) throw new Error("No Google account connected");

  const preferred = accountEmail
    ? accounts.find((a) => a.accountId === accountEmail)
    : undefined;
  const ordered = preferred
    ? [preferred, ...accounts.filter((a) => a !== preferred)]
    : accounts;

  let lastErr: Error | undefined;
  for (const account of ordered) {
    const token = await getToken(account.accountId);
    if (!token) continue;
    try {
      const msg = await gmailGetMessage(token, id, "minimal");
      await gmailTrashThread(token, msg.threadId);
      invalidateThreadCache(ownerEmail, msg.threadId);
      return { id, threadId: msg.threadId, isTrashed: true };
    } catch (err: any) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("Trash failed");
}

// ---------------------------------------------------------------------------
// Untrash
// ---------------------------------------------------------------------------

export interface UntrashEmailInput {
  id: string;
  ownerEmail: string;
  accountEmail?: string;
}

export interface UntrashEmailResult {
  id: string;
  threadId: string;
  isTrashed: false;
}

/**
 * Restore an email from trash.
 *
 * Reconciliation notes:
 * - cache invalidation (handler ✓) → always invalidate.
 * - local-mode: restore entire thread + recompute label counts.
 */
export async function untrashEmail(
  input: UntrashEmailInput,
): Promise<UntrashEmailResult> {
  const { id, ownerEmail, accountEmail } = input;

  if (!(await isConnected(ownerEmail))) {
    const emails = await readLocalEmails(ownerEmail);
    const target = emails.find((e) => e.id === id);
    if (!target) throw new Error(`Email ${id} not found`);
    const threadId = target.threadId || target.id;
    const updated = emails.map((e) => {
      if ((e.threadId || e.id) !== threadId) return e;
      return {
        ...e,
        isTrashed: false,
        labelIds: e.labelIds.includes("inbox")
          ? e.labelIds
          : ["inbox", ...e.labelIds],
      };
    });
    await writeLocalEmails(ownerEmail, updated);
    await writeLocalLabels(
      ownerEmail,
      recomputeUnreadCounts(updated, await readLocalLabels(ownerEmail)),
    );
    return { id, threadId, isTrashed: false };
  }

  const token = await getAccountToken(accountEmail ?? ownerEmail, ownerEmail);
  const msg = await gmailGetMessage(token, id, "minimal");
  await gmailUntrashThread(token, msg.threadId);
  invalidateThreadCache(ownerEmail, msg.threadId);
  return { id, threadId: msg.threadId, isTrashed: false };
}

// ---------------------------------------------------------------------------
// Mark read / unread (per-message)
// ---------------------------------------------------------------------------

export interface MarkReadInput {
  id: string;
  ownerEmail: string;
  isRead: boolean;
  accountEmail?: string;
}

export interface MarkReadResult {
  id: string;
  isRead: boolean;
}

/**
 * Mark a single message read or unread.
 *
 * Reconciliation notes:
 * - cache invalidation: message-level modify does not change the thread
 *   message list, so no thread cache invalidation is needed here.
 * - local-mode: recompute label unread counts (handler behaviour, not in
 *   action).
 * - accountEmail scoping (handler ✓, action looped all) → try preferred
 *   account, fall through.
 */
export async function markRead(input: MarkReadInput): Promise<MarkReadResult> {
  const { id, ownerEmail, isRead, accountEmail } = input;

  if (!(await isConnected(ownerEmail))) {
    const emails = await readLocalEmails(ownerEmail);
    const idx = emails.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error(`Email ${id} not found`);
    emails[idx] = { ...emails[idx], isRead };
    await writeLocalEmails(ownerEmail, emails);
    await writeLocalLabels(
      ownerEmail,
      recomputeUnreadCounts(emails, await readLocalLabels(ownerEmail)),
    );
    return { id, isRead };
  }

  const accounts = await listOAuthAccountsByOwner("google", ownerEmail);
  if (accounts.length === 0) throw new Error("No Google account connected");

  const preferred = accountEmail
    ? accounts.find((a) => a.accountId === accountEmail)
    : undefined;
  const ordered = preferred
    ? [preferred, ...accounts.filter((a) => a !== preferred)]
    : accounts;

  let lastErr: Error | undefined;
  for (const account of ordered) {
    const token = await getToken(account.accountId);
    if (!token) continue;
    try {
      await gmailModifyMessage(
        token,
        id,
        isRead ? undefined : ["UNREAD"],
        isRead ? ["UNREAD"] : undefined,
      );
      return { id, isRead };
    } catch (err: any) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("Mark read failed");
}

// ---------------------------------------------------------------------------
// Mark thread read (all messages in a thread)
// ---------------------------------------------------------------------------

export interface MarkThreadReadInput {
  threadId: string;
  ownerEmail: string;
  isRead: boolean;
  accountEmail?: string;
}

export interface MarkThreadReadResult {
  threadId: string;
  isRead: boolean;
}

/**
 * Mark all messages in a thread read or unread.
 *
 * Reconciliation notes:
 * - This operation existed only as a REST route (no action twin). Extracted
 *   here so the action surface can call it too.
 * - cache invalidation (handler ✓) → always invalidate.
 * - local-mode: recompute label unread counts.
 */
export async function markThreadRead(
  input: MarkThreadReadInput,
): Promise<MarkThreadReadResult> {
  const { threadId, ownerEmail, isRead, accountEmail } = input;

  if (!(await isConnected(ownerEmail))) {
    const emails = await readLocalEmails(ownerEmail);
    let changed = false;
    const updated = emails.map((e) => {
      if ((e.threadId || e.id) !== threadId || e.isRead === isRead) return e;
      changed = true;
      return { ...e, isRead };
    });
    if (changed) {
      await writeLocalEmails(ownerEmail, updated);
      await writeLocalLabels(
        ownerEmail,
        recomputeUnreadCounts(updated, await readLocalLabels(ownerEmail)),
      );
    }
    return { threadId, isRead };
  }

  const token = await getAccountToken(accountEmail ?? ownerEmail, ownerEmail);
  await gmailModifyThread(
    token,
    threadId,
    isRead ? undefined : ["UNREAD"],
    isRead ? ["UNREAD"] : undefined,
  );
  invalidateThreadCache(ownerEmail, threadId);
  return { threadId, isRead };
}
