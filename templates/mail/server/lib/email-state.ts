import {
  getOAuthTokens,
  listOAuthAccountsByOwner,
} from "@agent-native/core/oauth-tokens";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { isInboxScopedAppLabel } from "@shared/gmail-labels.js";
import type { EmailMessage, Label } from "@shared/types.js";

import type { BulkMarkReadResult } from "./bulk-mark-read.js";
import {
  gmailGetMessage,
  gmailBatchGetMessages,
  gmailBatchGetThreads,
  gmailModifyMessage,
  gmailModifyThread,
  gmailTrashThread,
  registerGmailAccountToken,
} from "./google-api.js";
import {
  getClientForConnectedAccount,
  getConnectedAccountsWithErrors,
  isConnected,
} from "./google-auth.js";
import { syncInboxLabelDelta } from "./inbox-store-sync.js";
import {
  findAccountForMessage,
  findAccountForThread,
  findAccountsForTargets,
  readAccountRowCounts,
  findThreadIdsByMessageIds,
} from "./inbox-store.js";
import {
  readLocalEmails,
  withLocalEmailMutationLock,
  writeLocalEmails,
} from "./local-email-store.js";
import { invalidateThreadCache } from "./thread-cache.js";

async function getToken(
  accountId: string,
  ownerEmail: string,
): Promise<string | null> {
  const tokens = (await getOAuthTokens("google", accountId)) as unknown as
    | { access_token: string; expiry_date?: number }
    | undefined;
  if (
    tokens?.access_token &&
    (!tokens.expiry_date || Date.now() < tokens.expiry_date - 5 * 60 * 1000)
  ) {
    await registerGmailAccountToken(
      tokens.access_token,
      ownerEmail,
      accountId,
      tokens.expiry_date,
    );
    return tokens.access_token;
  }
  const client = await getClientForConnectedAccount(ownerEmail, accountId);
  return client && client.email.toLowerCase() === accountId.toLowerCase()
    ? client.accessToken
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

/** No connected account of the owner can see the thread or message. */
export class MutationAccountNotFoundError extends Error {
  readonly code = "account_not_found";
  constructor(target: string) {
    super(
      `Cannot determine which connected account owns thread ${target}; pass accountEmail`,
    );
    this.name = "MutationAccountNotFoundError";
  }
}

/** An account could not be checked, so "not found" would be a guess. */
export class MutationAccountLookupError extends Error {
  readonly code = "account_lookup_failed";
  constructor(target: string, unreadable: number) {
    super(
      `Cannot determine which connected account owns thread ${target}: ${unreadable} account(s) could not be checked; retry or pass accountEmail`,
    );
    this.name = "MutationAccountLookupError";
  }
}

/** The probe budget ran out before this target could be checked. */
export class MutationAccountProbeLimitError extends Error {
  readonly code = "account_lookup_limited";
  constructor(target: string) {
    super(
      `Cannot determine which connected account owns thread ${target}: too many lookups in one request; retry or pass accountEmail`,
    );
    this.name = "MutationAccountProbeLimitError";
  }
}

// Gmail units one account-probe round may spend: threads.get costs 40 and
// messages.get 20 per item, and the interactive lane allows 6,000 a minute, so
// a lookup takes at most half of it and never starves the mutation itself.
const PROBE_UNIT_BUDGET = 3_000;
const THREAD_PROBE_UNITS = 40;
const MESSAGE_PROBE_UNITS = 20;

type ProbeTarget = { key: string; threadId?: string; messageId?: string };

// (account, target) pairs Gmail already said 404 for. A retry within the
// window skips them instead of spending the budget again; entries are
// instance-local and expire, so a thread that later appears is found again.
const PROBE_MISS_TTL_MS = 2 * 60_000;
const PROBE_MISS_MAX = 2_000;
const probeMisses = new Map<string, number>();

export function clearProbeMissCache(): void {
  probeMisses.clear();
}

function probeMissKey(owner: string, account: string, t: ProbeTarget): string {
  return `${owner.toLowerCase()}\0${account.toLowerCase()}\0${
    t.threadId ? `t:${t.threadId}` : `m:${t.messageId}`
  }`;
}

function isKnownMiss(owner: string, account: string, t: ProbeTarget): boolean {
  const key = probeMissKey(owner, account, t);
  const expiresAt = probeMisses.get(key);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    probeMisses.delete(key);
    return false;
  }
  return true;
}

function rememberMiss(owner: string, account: string, t: ProbeTarget): void {
  if (probeMisses.size >= PROBE_MISS_MAX) {
    const oldest = probeMisses.keys().next().value;
    if (oldest !== undefined) probeMisses.delete(oldest);
  }
  probeMisses.set(
    probeMissKey(owner, account, t),
    Date.now() + PROBE_MISS_TTL_MS,
  );
}

// The synced store only keeps inbox rows, so a thread archived long enough ago
// has none. Cache misses are resolved together: every connected Gmail account
// (OAuth and managed) is asked once, with the still-unresolved ids as a batch
// of minimal reads. Only a 404 means "not this account"; any other failure
// counts as unreadable so the caller never reports it as "not found". Targets
// past the unit budget get a typed limit error instead of an unbounded probe.
async function probeAccountsForTargets(
  ownerEmail: string,
  accountIds: readonly string[],
  targets: readonly ProbeTarget[],
): Promise<Map<string, string | Error>> {
  const outcome = new Map<string, string | Error>();
  const unreadable = new Map<string, number>();
  let open = [...targets];
  let budget = PROBE_UNIT_BUDGET;
  // Accounts that answered 404 for each target: "not found" is only true once
  // every candidate account has.
  const missing = new Map<string, Set<string>>();
  const targetName = (t: ProbeTarget) => t.threadId ?? t.messageId ?? t.key;

  for (const [index, accountId] of accountIds.entries()) {
    if (open.length === 0) break;
    // Known 404s for this account cost nothing and count as answered.
    const toProbe: ProbeTarget[] = [];
    for (const t of open) {
      if (isKnownMiss(ownerEmail, accountId, t)) {
        const accounts = missing.get(t.key) ?? new Set<string>();
        accounts.add(accountId);
        missing.set(t.key, accounts);
      } else {
        toProbe.push(t);
      }
    }
    if (toProbe.length === 0) continue;
    // Each account gets an equal share of what is left, so an owner late in
    // the list is still reached; shares an account does not use roll forward.
    let allowance = Math.floor(budget / (accountIds.length - index));
    let token: string | null = null;
    try {
      token = await getToken(accountId, ownerEmail);
    } catch {
      token = null;
    }
    if (!token) {
      for (const t of toProbe)
        unreadable.set(t.key, (unreadable.get(t.key) ?? 0) + 1);
      continue;
    }

    // Take as many open targets as the remaining budget pays for.
    const probing: ProbeTarget[] = [];
    for (const t of toProbe) {
      const cost = t.threadId ? THREAD_PROBE_UNITS : MESSAGE_PROBE_UNITS;
      if (allowance < cost) break;
      allowance -= cost;
      budget -= cost;
      probing.push(t);
    }
    if (probing.length === 0) continue;

    const found = new Set<string>();
    const failed = new Set<string>();
    const threadTargets = probing.filter((t) => t.threadId);
    const messageTargets = probing.filter((t) => !t.threadId && t.messageId);
    const run = async (
      group: ProbeTarget[],
      idOf: (t: ProbeTarget) => string,
      fetchBatch: (
        ids: string[],
      ) => Promise<Array<{ id: string; data: any; error?: string }>>,
    ) => {
      if (group.length === 0) return;
      const ids = [...new Set(group.map(idOf))];
      try {
        const parts = await fetchBatch(ids);
        const byId = new Map(parts.map((part) => [part.id, part]));
        for (const t of group) {
          const part = byId.get(idOf(t));
          if (part && !part.error && part.data?.id === idOf(t)) {
            found.add(t.key);
          } else if (part && /HTTP 404/.test(part.error ?? "")) {
            const accounts = missing.get(t.key) ?? new Set<string>();
            accounts.add(accountId);
            missing.set(t.key, accounts);
            rememberMiss(ownerEmail, accountId, t);
          } else {
            failed.add(t.key);
          }
        }
      } catch {
        for (const t of group) failed.add(t.key);
      }
    };
    await run(
      threadTargets,
      (t) => t.threadId!,
      (ids) => gmailBatchGetThreads(token!, ids, "minimal"),
    );
    await run(
      messageTargets,
      (t) => t.messageId!,
      (ids) => gmailBatchGetMessages(token!, ids, "minimal"),
    );

    const stillOpen: ProbeTarget[] = [];
    for (const t of open) {
      if (found.has(t.key)) outcome.set(t.key, accountId);
      else {
        if (failed.has(t.key)) {
          unreadable.set(t.key, (unreadable.get(t.key) ?? 0) + 1);
        }
        stillOpen.push(t);
      }
    }
    open = stillOpen;
  }

  for (const t of open) {
    const count = unreadable.get(t.key) ?? 0;
    if (count > 0) {
      outcome.set(t.key, new MutationAccountLookupError(targetName(t), count));
    } else if (
      (!t.threadId && !t.messageId) ||
      (missing.get(t.key)?.size ?? 0) >= accountIds.length
    ) {
      outcome.set(t.key, new MutationAccountNotFoundError(targetName(t)));
    } else {
      // Some candidate account was never asked (budget ran out first).
      outcome.set(t.key, new MutationAccountProbeLimitError(targetName(t)));
    }
  }
  return outcome;
}

// Accounts a target can belong to: every connected Gmail account Mail knows,
// OAuth grants and managed workspace connections alike.
async function listCandidateAccounts(
  ownerEmail: string,
): Promise<{ accounts: string[]; incomplete: boolean }> {
  const { accounts, errors } = await getConnectedAccountsWithErrors(ownerEmail);
  if (accounts.length === 0 && errors.length > 0) {
    throw new Error(errors.map(({ error }) => error).join("; "));
  }
  return { accounts, incomplete: errors.length > 0 };
}

async function resolveCacheMisses(
  ownerEmail: string,
  misses: readonly ProbeTarget[],
): Promise<Map<string, string | Error>> {
  const { accounts, incomplete } = await listCandidateAccounts(ownerEmail);
  const outcome = new Map<string, string | Error>();
  if (accounts.length === 1 && !incomplete) {
    for (const t of misses) outcome.set(t.key, accounts[0]);
    return outcome;
  }
  // Try the account holding the most cached rows first: it is the likeliest
  // owner of a thread the store has lost. A failed count only loses the order.
  const counts = await readAccountRowCounts(ownerEmail).catch(
    () => new Map<string, number>(),
  );
  const ordered = [...accounts].sort(
    (a, b) =>
      (counts.get(b.toLowerCase()) ?? 0) - (counts.get(a.toLowerCase()) ?? 0),
  );
  const probed = await probeAccountsForTargets(ownerEmail, ordered, misses);
  for (const t of misses) {
    const result = probed.get(t.key);
    // A managed lookup that errored means the account list may be missing the
    // owner, so a plain miss is reported as a failed lookup, not "not found".
    outcome.set(
      t.key,
      result instanceof MutationAccountNotFoundError && incomplete
        ? new MutationAccountLookupError(t.threadId ?? t.messageId ?? t.key, 1)
        : (result ?? new MutationAccountNotFoundError(t.key)),
    );
  }
  return outcome;
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

  const target: ProbeTarget = { key: "target", ...ctx };
  const result = (await resolveCacheMisses(ownerEmail, [target])).get("target");
  if (typeof result === "string") return result;
  throw result ?? new MutationAccountNotFoundError("unknown");
}

/** A target no account could be found for, with the typed failure kept. */
export type UnresolvedMutationTarget = {
  id: string;
  error: string;
  /** Machine-readable reason, e.g. account_not_found. */
  code?: string;
  /** Error class: MutationAccountNotFoundError, MutationAccountLookupError... */
  kind?: string;
};
type UnresolvedFields = Omit<UnresolvedMutationTarget, "id">;

function errorFields(err: unknown): UnresolvedFields {
  const e = err as { message?: unknown; code?: unknown; name?: unknown } | null;
  return {
    error:
      typeof e?.message === "string" && e.message
        ? e.message
        : "Could not resolve connected account",
    ...(typeof e?.code === "string" ? { code: e.code } : {}),
    ...(err instanceof Error ? { kind: err.name } : {}),
  };
}

export async function resolveMutationAccounts<
  T extends { id: string; threadId?: string; accountEmail?: string },
>(
  ownerEmail: string,
  targets: readonly T[],
): Promise<{
  resolved: Array<T & { accountEmail: string }>;
  unresolved: UnresolvedMutationTarget[];
}> {
  // One slot per target keeps the caller's order across cache hits and probes.
  const slots: Array<{ accountEmail: string } | { error: string } | undefined> =
    targets.map(() => undefined);
  const misses: ProbeTarget[] = [];
  const unmapped = targets.filter((target) => !target.accountEmail);
  let cached: Awaited<ReturnType<typeof findAccountsForTargets>> | null = null;
  let cacheError: UnresolvedFields = { error: "" };
  if (unmapped.length > 0) {
    // One query covers every target's thread and message id.
    try {
      cached = await findAccountsForTargets(ownerEmail, {
        threadIds: unmapped.flatMap((target) =>
          target.threadId ? [target.threadId] : [],
        ),
        messageIds: unmapped.map((target) => target.id),
      });
    } catch (err: any) {
      cacheError = errorFields(err);
    }
  }
  for (const [index, target] of targets.entries()) {
    if (target.accountEmail) {
      slots[index] = { accountEmail: target.accountEmail };
      continue;
    }
    if (!cached) {
      slots[index] = cacheError;
      continue;
    }
    const found =
      (target.threadId ? cached.byThread.get(target.threadId) : undefined) ??
      cached.byMessage.get(target.id);
    if (found) slots[index] = { accountEmail: found };
    else {
      misses.push({
        key: String(index),
        threadId: target.threadId,
        messageId: target.id,
      });
    }
  }
  if (misses.length > 0) {
    let outcome: Map<string, string | Error> | null = null;
    let failure: UnresolvedFields | null = null;
    try {
      outcome = await resolveCacheMisses(ownerEmail, misses);
    } catch (err: any) {
      failure = errorFields(err);
    }
    for (const miss of misses) {
      const result = outcome?.get(miss.key);
      slots[Number(miss.key)] =
        typeof result === "string"
          ? { accountEmail: result }
          : result
            ? errorFields(result)
            : (failure ?? { error: "Could not resolve connected account" });
    }
  }
  const resolved: Array<T & { accountEmail: string }> = [];
  const unresolved: Array<{ id: string; error: string }> = [];
  for (const [index, target] of targets.entries()) {
    const slot = slots[index];
    if (slot && "accountEmail" in slot) {
      resolved.push({ ...target, accountEmail: slot.accountEmail });
    } else {
      unresolved.push({
        id: target.id,
        ...(slot ?? { error: "Could not resolve connected account" }),
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
      invalidateThreadCache(ownerEmail, resolvedThreadId, account.accountId);
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
  invalidateThreadCache(ownerEmail, msg.threadId, resolvedAccount);
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
        invalidateThreadCache(ownerEmail, resolvedThreadId, account.accountId);
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
      invalidateThreadCache(ownerEmail, msg.threadId, account.accountId);
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
  if (!msg.threadId) throw new Error(`Thread not found for email ${id}`);
  const updated = (await gmailModifyThread(
    token,
    msg.threadId,
    ["INBOX"],
    ["TRASH"],
  )) as { historyId?: string } | undefined;
  invalidateThreadCache(ownerEmail, msg.threadId, resolvedAccount);
  await syncInboxLabelDelta(ownerEmail, resolvedAccount, [msg.threadId], {
    add: ["INBOX"],
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
  invalidateThreadCache(ownerEmail, threadId, resolvedAccount);
  await syncInboxLabelDelta(ownerEmail, resolvedAccount, [threadId], {
    add: isRead ? undefined : ["UNREAD"],
    remove: isRead ? ["UNREAD"] : undefined,
    providerHistoryId: updated?.historyId,
  });
  return { threadId, isRead };
}
