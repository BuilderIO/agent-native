import {
  getOAuthTokens,
  listOAuthAccountsByOwner,
  saveOAuthTokens,
} from "@agent-native/core/oauth-tokens";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { isInboxScopedAppLabel } from "@shared/gmail-labels.js";
import type { EmailMessage, Label } from "@shared/types.js";

import type { BulkMarkReadResult } from "./bulk-mark-read.js";
import {
  createOAuth2Client,
  gmailGetMessage,
  gmailModifyMessage,
  gmailModifyThread,
  gmailTrashThread,
  gmailUntrashThread,
} from "./google-api.js";
import {
  getClientForConnectedAccount,
  getConnectedAccountsWithErrors,
  getOAuth2Credentials,
  isConnected,
} from "./google-auth.js";
import { syncInboxLabelDelta } from "./inbox-store-sync.js";
import {
  findAccountForMessage,
  findAccountForThread,
  findThreadIdsByMessageIds,
} from "./inbox-store.js";
import {
  readLocalEmails,
  withLocalEmailMutationLock,
  writeLocalEmails,
} from "./local-email-store.js";
import { invalidateThreadCache } from "./thread-cache.js";

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
    const { clientId, clientSecret } = await getOAuth2Credentials(accountId);
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

async function getToken(
  accountId: string,
  ownerEmail: string,
): Promise<string | null> {
  const tokens = (await getOAuthTokens("google", accountId)) as unknown as
    | StoredTokens
    | undefined;
  if (tokens?.access_token) return refreshIfNeeded(accountId, tokens);
  const managed = await getClientForConnectedAccount(ownerEmail, accountId);
  return managed && managed.email.toLowerCase() === accountId.toLowerCase()
    ? managed.accessToken
    : null;
}

export async function resolveAccountEmail(
  accountEmail: string | undefined,
  ownerEmail: string,
): Promise<string> {
  if (!accountEmail || accountEmail === ownerEmail) return ownerEmail;
  const accounts = await listOAuthAccountsByOwner("google", ownerEmail);
  const oauthAccount = accounts.find(
    (account) => account.accountId.toLowerCase() === accountEmail.toLowerCase(),
  );
  if (oauthAccount) return oauthAccount.accountId;
  const { accounts: connected, errors } =
    await getConnectedAccountsWithErrors(ownerEmail);
  if (
    connected.some(
      (email) => email.toLowerCase() === accountEmail.toLowerCase(),
    )
  ) {
    return accountEmail;
  }
  if (errors.length > 0) {
    throw new Error(errors.map(({ error }) => error).join("; "));
  }
  throw new Error("Account not owned by current user");
}

export async function getAccountToken(
  accountEmail: string,
  ownerEmail: string,
): Promise<string> {
  const acct = await resolveAccountEmail(accountEmail, ownerEmail);
  const token = await getToken(acct, ownerEmail);
  if (!token) throw new Error(`No valid access token for ${acct}`);
  return token;
}

export async function resolveMutationAccount(
  ownerEmail: string,
  accountEmail: string | undefined,
  ctx: { threadId?: string; messageId?: string } = {},
): Promise<string> {
  if (accountEmail) return accountEmail;

  if (ctx.threadId) {
    const found = await findAccountForThread(ownerEmail, ctx.threadId);
    if (found) return found;
  }
  if (ctx.messageId) {
    const found = await findAccountForMessage(ownerEmail, ctx.messageId);
    if (found) return found;
  }

  const accounts = await listOAuthAccountsByOwner("google", ownerEmail);
  if (accounts.length === 1) return accounts[0].accountId;
  if (accounts.length === 0) {
    const { accounts: connected, errors } =
      await getConnectedAccountsWithErrors(ownerEmail);
    if (connected.length === 1) return connected[0];
    if (connected.length === 0 && errors.length > 0) {
      throw new Error(errors.map(({ error }) => error).join("; "));
    }
  }

  throw new Error(
    `Cannot determine which connected account owns thread ${
      ctx.threadId ?? ctx.messageId ?? "unknown"
    }; pass accountEmail`,
  );
}

export async function resolveMutationAccounts<
  T extends { id: string; threadId?: string; accountEmail?: string },
>(
  ownerEmail: string,
  targets: readonly T[],
): Promise<{
  resolved: Array<T & { accountEmail: string }>;
  unresolved: Array<{ id: string; error: string }>;
}> {
  const resolved: Array<T & { accountEmail: string }> = [];
  const unresolved: Array<{ id: string; error: string }> = [];
  for (const target of targets) {
    try {
      const accountEmail = await resolveMutationAccount(
        ownerEmail,
        target.accountEmail,
        { threadId: target.threadId, messageId: target.id },
      );
      resolved.push({ ...target, accountEmail });
    } catch (err: any) {
      unresolved.push({
        id: target.id,
        error: err?.message ?? "Could not resolve connected account",
      });
    }
  }
  return { resolved, unresolved };
}

async function listMutableAccounts(
  ownerEmail: string,
): Promise<Array<{ accountId: string }>> {
  const accounts = await listOAuthAccountsByOwner("google", ownerEmail);
  if (accounts.length > 0) return accounts;
  const { accounts: connected, errors } =
    await getConnectedAccountsWithErrors(ownerEmail);
  if (connected.length === 0 && errors.length > 0) {
    throw new Error(errors.map(({ error }) => error).join("; "));
  }
  return connected.map((accountId) => ({
    accountId,
  }));
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
    const inboxScoped = label.id === "inbox" || isInboxScopedAppLabel(label.id);
    const active = emails.filter(
      (e) =>
        !e.isTrashed &&
        (!inboxScoped || !e.isArchived) &&
        e.labelIds.includes(label.id),
    );
    return {
      ...label,
      unreadCount: active.filter((e) => !e.isRead).length,
      totalCount: active.length,
    };
  });
}

export interface ArchiveEmailInput {
  id: string;
  ownerEmail: string;
  accountEmail?: string;
  removeLabel?: string;
  threadId?: string;
}

export interface ArchiveEmailResult {
  id: string;
  threadId: string;
  isArchived: true;
}

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
    return withLocalEmailMutationLock(ownerEmail, async () => {
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
    });
  }

  const accounts = await listMutableAccounts(ownerEmail);
  if (accounts.length === 0) throw new Error("No Google account connected");

  const preferred = accountEmail
    ? accounts.find((a) => a.accountId === accountEmail)
    : undefined;
  const ordered = preferred
    ? [preferred, ...accounts.filter((a) => a !== preferred)]
    : accounts;

  let lastErr: Error | undefined;
  for (const account of ordered) {
    const token = await getToken(account.accountId, ownerEmail);
    if (!token) continue;
    try {
      let resolvedThreadId = hintThreadId;
      let labelIds: string[] | undefined;
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
      const updated = (await gmailModifyThread(
        token,
        resolvedThreadId,
        undefined,
        removeLabels,
      )) as { historyId?: string } | undefined;
      invalidateThreadCache(ownerEmail, resolvedThreadId);
      await syncInboxLabelDelta(
        ownerEmail,
        account.accountId,
        [resolvedThreadId],
        {
          remove: removeLabels,
          providerHistoryId: updated?.historyId,
        },
      );
      return { id, threadId: resolvedThreadId, isArchived: true };
    } catch (err: any) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("Archive failed");
}

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

export async function unarchiveEmail(
  input: UnarchiveEmailInput,
): Promise<UnarchiveEmailResult> {
  const { id, ownerEmail, accountEmail } = input;

  if (!(await isConnected(ownerEmail))) {
    return withLocalEmailMutationLock(ownerEmail, async () => {
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
    });
  }

  const resolvedAccount = await resolveMutationAccount(
    ownerEmail,
    accountEmail,
    { messageId: id },
  );
  const token = await getAccountToken(resolvedAccount, ownerEmail);
  const msg = await gmailGetMessage(token, id, "minimal");
  const updated = (await gmailModifyThread(token, msg.threadId, ["INBOX"])) as
    | { historyId?: string }
    | undefined;
  invalidateThreadCache(ownerEmail, msg.threadId);
  await syncInboxLabelDelta(ownerEmail, resolvedAccount, [msg.threadId], {
    add: ["INBOX"],
    providerHistoryId: updated?.historyId,
  });
  return { id, threadId: msg.threadId, isArchived: false };
}

export interface ToggleStarInput {
  id: string;
  ownerEmail: string;
  isStarred: boolean;
  accountEmail?: string;
  threadId?: string;
}

export interface ToggleStarResult {
  id: string;
  threadId?: string;
  isStarred: boolean;
}

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
    return withLocalEmailMutationLock(ownerEmail, async () => {
      const emails = await readLocalEmails(ownerEmail);
      const idx = emails.findIndex((e) => e.id === id);
      if (idx === -1) throw new Error(`Email ${id} not found`);
      emails[idx] = { ...emails[idx], isStarred };
      await writeLocalEmails(ownerEmail, emails);
      return { id, threadId: emails[idx].threadId, isStarred };
    });
  }

  const accounts = await listMutableAccounts(ownerEmail);
  if (accounts.length === 0) throw new Error("No Google account connected");

  const preferred = accountEmail
    ? accounts.find((a) => a.accountId === accountEmail)
    : undefined;
  const ordered = preferred
    ? [preferred, ...accounts.filter((a) => a !== preferred)]
    : accounts;

  let lastErr: Error | undefined;
  for (const account of ordered) {
    const token = await getToken(account.accountId, ownerEmail);
    if (!token) continue;
    try {
      const updated = (await gmailModifyMessage(
        token,
        id,
        isStarred ? ["STARRED"] : undefined,
        isStarred ? undefined : ["STARRED"],
      )) as { historyId?: string; threadId?: string } | undefined;
      const resolvedThreadId = hintThreadId || updated?.threadId;
      if (resolvedThreadId) {
        invalidateThreadCache(ownerEmail, resolvedThreadId);
        await syncInboxLabelDelta(
          ownerEmail,
          account.accountId,
          [resolvedThreadId],
          {
            add: isStarred ? ["STARRED"] : undefined,
            remove: isStarred ? undefined : ["STARRED"],
            scope: "message",
            messageIds: [id],
            providerHistoryId: updated?.historyId,
          },
        );
      }
      return { id, threadId: resolvedThreadId, isStarred };
    } catch (err: any) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("Toggle star failed");
}

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

export async function trashEmail(
  input: TrashEmailInput,
): Promise<TrashEmailResult> {
  const { id, ownerEmail, accountEmail } = input;

  if (!(await isConnected(ownerEmail))) {
    return withLocalEmailMutationLock(ownerEmail, async () => {
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
    });
  }

  const accounts = await listMutableAccounts(ownerEmail);
  if (accounts.length === 0) throw new Error("No Google account connected");

  const preferred = accountEmail
    ? accounts.find((a) => a.accountId === accountEmail)
    : undefined;
  const ordered = preferred
    ? [preferred, ...accounts.filter((a) => a !== preferred)]
    : accounts;

  let lastErr: Error | undefined;
  for (const account of ordered) {
    const token = await getToken(account.accountId, ownerEmail);
    if (!token) continue;
    try {
      const msg = await gmailGetMessage(token, id, "minimal");
      const updated = (await gmailTrashThread(token, msg.threadId)) as
        | { historyId?: string }
        | undefined;
      invalidateThreadCache(ownerEmail, msg.threadId);
      await syncInboxLabelDelta(ownerEmail, account.accountId, [msg.threadId], {
        add: ["TRASH"],
        remove: ["INBOX"],
        providerHistoryId: updated?.historyId,
      });
      return { id, threadId: msg.threadId, isTrashed: true };
    } catch (err: any) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("Trash failed");
}

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

export async function untrashEmail(
  input: UntrashEmailInput,
): Promise<UntrashEmailResult> {
  const { id, ownerEmail, accountEmail } = input;

  if (!(await isConnected(ownerEmail))) {
    return withLocalEmailMutationLock(ownerEmail, async () => {
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
    });
  }

  const resolvedAccount = await resolveMutationAccount(
    ownerEmail,
    accountEmail,
    { messageId: id },
  );
  const token = await getAccountToken(resolvedAccount, ownerEmail);
  const msg = await gmailGetMessage(token, id, "minimal");
  const updated = (await gmailUntrashThread(token, msg.threadId)) as
    | { historyId?: string }
    | undefined;
  invalidateThreadCache(ownerEmail, msg.threadId);
  await syncInboxLabelDelta(ownerEmail, resolvedAccount, [msg.threadId], {
    remove: ["TRASH"],
    providerHistoryId: updated?.historyId,
  });
  return { id, threadId: msg.threadId, isTrashed: false };
}

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

export async function markRead(input: MarkReadInput): Promise<MarkReadResult> {
  const { id, ownerEmail, isRead, accountEmail } = input;

  if (!(await isConnected(ownerEmail))) {
    return withLocalEmailMutationLock(ownerEmail, async () => {
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
    });
  }

  const accounts = await listMutableAccounts(ownerEmail);
  if (accounts.length === 0) throw new Error("No Google account connected");

  const preferred = accountEmail
    ? accounts.find((a) => a.accountId === accountEmail)
    : undefined;
  const ordered = preferred
    ? [preferred, ...accounts.filter((a) => a !== preferred)]
    : accounts;

  let lastErr: Error | undefined;
  for (const account of ordered) {
    const token = await getToken(account.accountId, ownerEmail);
    if (!token) continue;
    try {
      const updated = (await gmailModifyMessage(
        token,
        id,
        isRead ? undefined : ["UNREAD"],
        isRead ? ["UNREAD"] : undefined,
      )) as { historyId?: string } | undefined;
      const threadId = (
        await findThreadIdsByMessageIds(ownerEmail, account.accountId, [id])
      ).get(id);
      if (threadId) {
        await syncInboxLabelDelta(ownerEmail, account.accountId, [threadId], {
          add: isRead ? undefined : ["UNREAD"],
          remove: isRead ? ["UNREAD"] : undefined,
          scope: "message",
          messageIds: [id],
          providerHistoryId: updated?.historyId,
        });
      }
      return { id, isRead };
    } catch (err: any) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("Mark read failed");
}

export async function markAllLocalUnreadRead(input: {
  ownerEmail: string;
  accountEmail: string;
  excludeThreadIds: string[];
}): Promise<BulkMarkReadResult> {
  const { ownerEmail, accountEmail } = input;
  if (accountEmail.toLowerCase() !== ownerEmail.toLowerCase()) {
    throw new Error("Local mail only supports the authenticated owner account");
  }

  const excludedThreadIds = new Set(input.excludeThreadIds.filter(Boolean));
  return withLocalEmailMutationLock(ownerEmail, async () => {
    const emails = await readLocalEmails(ownerEmail);
    const matched = emails.filter((email) => !email.isRead);
    const excluded = matched.filter((email) =>
      excludedThreadIds.has(email.threadId || email.id),
    );
    const selectedIds = new Set(
      matched
        .filter((email) => !excludedThreadIds.has(email.threadId || email.id))
        .map((email) => email.id),
    );
    const updated = emails.map((email) =>
      selectedIds.has(email.id) ? { ...email, isRead: true } : email,
    );

    if (selectedIds.size > 0) {
      await writeLocalEmails(ownerEmail, updated);
      await writeLocalLabels(
        ownerEmail,
        recomputeUnreadCounts(updated, await readLocalLabels(ownerEmail)),
      );
    }

    const persisted = await readLocalEmails(ownerEmail);
    const remaining = persisted.filter((email) => !email.isRead);
    const matchedIds = new Set(matched.map((email) => email.id));
    const remainingProtected = remaining.filter((email) =>
      excludedThreadIds.has(email.threadId || email.id),
    );
    const unexpectedRemaining = remaining.filter((email) =>
      selectedIds.has(email.id),
    );
    const newUnread = remaining.filter((email) => !matchedIds.has(email.id));

    return {
      mode: "all-unread",
      accountEmail,
      matchedMessages: matched.length,
      matchedThreads: new Set(
        matched.map((email) => email.threadId || email.id),
      ).size,
      excludedMessages: excluded.length,
      excludedThreads: new Set(
        excluded.map((email) => email.threadId || email.id),
      ).size,
      changedMessages: selectedIds.size,
      batchCount: selectedIds.size > 0 ? 1 : 0,
      failures: [],
      remainingUnreadMessages: remaining.length,
      remainingUnreadThreads: new Set(
        remaining.map((email) => email.threadId || email.id),
      ).size,
      remainingProtectedMessages: remainingProtected.length,
      remainingProtectedThreads: new Set(
        remainingProtected.map((email) => email.threadId || email.id),
      ).size,
      unexpectedUnreadMessages: unexpectedRemaining.length,
      unexpectedUnreadThreads: new Set(
        unexpectedRemaining.map((email) => email.threadId || email.id),
      ).size,
      newUnreadMessages: newUnread.length,
      newUnreadThreads: new Set(
        newUnread.map((email) => email.threadId || email.id),
      ).size,
      verificationComplete: unexpectedRemaining.length === 0,
    };
  });
}

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

export async function markThreadRead(
  input: MarkThreadReadInput,
): Promise<MarkThreadReadResult> {
  const { threadId, ownerEmail, isRead, accountEmail } = input;

  if (!(await isConnected(ownerEmail))) {
    return withLocalEmailMutationLock(ownerEmail, async () => {
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
    });
  }

  const resolvedAccount = await resolveMutationAccount(
    ownerEmail,
    accountEmail,
    { threadId },
  );
  const token = await getAccountToken(resolvedAccount, ownerEmail);
  const updated = (await gmailModifyThread(
    token,
    threadId,
    isRead ? undefined : ["UNREAD"],
    isRead ? ["UNREAD"] : undefined,
  )) as { historyId?: string } | undefined;
  invalidateThreadCache(ownerEmail, threadId);
  await syncInboxLabelDelta(ownerEmail, resolvedAccount, [threadId], {
    add: isRead ? undefined : ["UNREAD"],
    remove: isRead ? ["UNREAD"] : undefined,
    providerHistoryId: updated?.historyId,
  });
  return { threadId, isRead };
}
