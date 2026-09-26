import { emit } from "@agent-native/core/event-bus";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import {
  listOAuthAccountsByOwner,
  setOAuthDisplayName,
} from "@agent-native/core/oauth-tokens";
import { readBody, getSession } from "@agent-native/core/server";
import { getAppProductionUrl } from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import {
  isInboxScopedAppLabel,
  mailLabelMatches,
} from "@shared/gmail-labels.js";
import { markdownPreviewSnippet } from "@shared/markdown.js";
import {
  emailMessageMatchesSearch,
  searchQueryNeedsAttachmentMetadata,
} from "@shared/search.js";
import type { EmailMessage, Label, UserSettings } from "@shared/types.js";
import {
  createError,
  defineEventHandler,
  getQuery,
  getRouterParam,
  getHeader,
  setResponseStatus,
  setResponseHeader,
  type H3Event,
} from "h3";
import { nanoid } from "nanoid";

import {
  incrementSendFrequency,
  getContactFrequencyMap,
} from "../lib/contact-frequency.js";
import {
  parseSavedDraftBackend,
  resolveSavedDraftBackend,
} from "../lib/draft-backend.js";
import { isValidAddressList } from "../lib/email-address-validation.js";
import {
  collectLinks,
  newClickToken,
  newPixelToken,
  persistTracking,
  type TrackingContext,
} from "../lib/email-tracking.js";
import {
  filterInboxScopedThreadMessages,
  filterLabelMessages,
} from "../lib/gmail-query.js";
import {
  gmailGetMessage,
  gmailGetThread,
  gmailListLabels,
  gmailModifyThread,
  gmailSendMessage,
  googleFetch,
  peopleListConnections,
  peopleListOtherContacts,
  calendarGetEvent,
  calendarPatchEvent,
  gmailGetAttachment,
  GmailQuotaCooldownError,
} from "../lib/google-api.js";
import {
  isConnected,
  getConnectedAccountsWithErrors,
  getClientForConnectedAccount,
  getClientsWithErrors,
  invalidateListCacheForOwner,
  listGmailMessages,
  gmailToEmailMessage,
  getAccountDisplayName,
  invalidateHistoryCacheForAccount,
  setAccountDisplayName,
} from "../lib/google-auth.js";
import { syncInboxLabelDelta } from "../lib/inbox-store-sync.js";
import { getSyntheticEmailsForView, getSnoozedThreadIds } from "../lib/jobs.js";
import { listInboxEmails } from "../lib/list-inbox-emails.js";
import {
  readLocalEmails as readEmails,
  withLocalEmailMutationLock,
  writeLocalEmails as writeEmails,
} from "../lib/local-email-store.js";
import { readSettings } from "../lib/mail-settings.js";
import {
  bodyToHtml as outgoingBodyToHtml,
  buildRawEmail as buildOutgoingRawEmail,
  resolveComposeAttachments,
  splitReplyQuote,
} from "../lib/outgoing-email.js";
import {
  resolveExistingSavedDraftOwnership,
  SavedDraftOwnershipError,
} from "../lib/saved-draft-ownership.js";
import { resolveGoogleSenderIdentity } from "../lib/sender-identity.js";
import {
  threadMessagesCache,
  THREAD_CACHE_TTL,
  threadCacheKey,
  invalidateThreadCache,
} from "../lib/thread-cache.js";

function stripCrlf(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

const labelMapCache = new Map<
  string,
  { map: Map<string, string>; expiresAt: number }
>();
const LABEL_CACHE_TTL = 5 * 60 * 1000;

type MailAccountError = { email: string; error: string };
type AccountTokenResult = {
  tokens: Array<{ email: string; accessToken: string }>;
  errors: MailAccountError[];
};

function formatMailAccountErrors(errors: readonly MailAccountError[]): string {
  return errors.map(({ email, error }) => `${email}: ${error}`).join("; ");
}

function mergeMailAccountErrors(
  ...groups: ReadonlyArray<readonly MailAccountError[]>
): MailAccountError[] {
  const merged = new Map<string, MailAccountError>();
  for (const error of groups.flat()) {
    merged.set(`${error.email.toLowerCase()}\0${error.error}`, error);
  }
  return [...merged.values()];
}

function setMailAccountErrorsHeader(
  event: H3Event,
  errors: readonly MailAccountError[],
): void {
  if (errors.length === 0) return;
  const safe = JSON.stringify(errors).replace(/[^\x20-\x7e]/g, "?");
  setResponseHeader(event, "X-Account-Errors", safe);
}

async function getCachedLabelMap(
  accountTokens: Array<{ email: string; accessToken: string }>,
): Promise<Map<string, string>> {
  const cacheKey = accountTokens
    .map((a) => a.email)
    .sort()
    .join(",");
  const cached = labelMapCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.map;

  const labelMap = new Map<string, string>();
  await Promise.all(
    accountTokens.map(async ({ accessToken }) => {
      try {
        const res = await gmailListLabels(accessToken);
        for (const label of res.labels || []) {
          if (label.id && label.name) {
            labelMap.set(label.id, label.name);
          }
        }
      } catch {}
    }),
  );
  labelMapCache.set(cacheKey, {
    map: labelMap,
    expiresAt: Date.now() + LABEL_CACHE_TTL,
  });
  return labelMap;
}

async function getAccessToken(
  ownerEmail: string,
  accountEmail: string,
): Promise<string | null> {
  const client = await getClientForConnectedAccount(ownerEmail, accountEmail);
  return client?.accessToken ?? null;
}

async function getAccountTokens(
  forEmail: string,
  requestedAccountEmails?: readonly string[],
): Promise<AccountTokenResult> {
  const requested = requestedAccountEmails
    ? new Set(requestedAccountEmails.map((account) => account.toLowerCase()))
    : undefined;
  const [accounts, { clients, errors }] = await Promise.all([
    listOAuthAccountsByOwner("google", forEmail),
    getClientsWithErrors(
      forEmail,
      requestedAccountEmails ? [...requestedAccountEmails] : undefined,
    ),
  ]);
  const oauthAccounts = accounts.filter(
    (account) => !requested || requested.has(account.accountId.toLowerCase()),
  );
  const oauthAccountEmails = new Set(
    oauthAccounts.map((account) => account.accountId.toLowerCase()),
  );

  for (const account of oauthAccounts) {
    if (account.displayName && !getAccountDisplayName(account.accountId)) {
      setAccountDisplayName(account.accountId, account.displayName);
    }
  }

  for (const client of clients) {
    if (
      !oauthAccountEmails.has(client.email.toLowerCase()) ||
      getAccountDisplayName(client.email)
    ) {
      continue;
    }
    setAccountDisplayName(client.email, client.email);
    googleFetch(
      `https://www.googleapis.com/oauth2/v2/userinfo`,
      client.accessToken,
    )
      .then((profile: any) => {
        if (profile?.name) {
          setAccountDisplayName(client.email, profile.name);
          setOAuthDisplayName("google", client.email, profile.name).catch(
            () => {},
          );
        }
      })
      .catch(() => {});
  }

  return {
    tokens: clients.map(({ email, accessToken }) => ({ email, accessToken })),
    errors,
  };
}

async function resolveAccountEmail(
  requestAccountEmail: string | undefined,
  ownerEmail: string,
): Promise<string> {
  if (!requestAccountEmail) {
    const { clients, errors } = await getClientsWithErrors(ownerEmail);
    const ownerAccount = clients.find(
      (client) => client.email.toLowerCase() === ownerEmail.toLowerCase(),
    );
    if (ownerAccount) return ownerAccount.email;
    if (clients.length > 0) return clients[0].email;
    if (errors.length > 0) {
      throw createError({
        statusCode: 503,
        statusMessage: formatMailAccountErrors(errors),
        data: { accountErrors: errors },
      });
    }
    return ownerEmail;
  }
  const { accounts, errors } = await getConnectedAccountsWithErrors(ownerEmail);
  const account = accounts.find(
    (accountEmail) =>
      accountEmail.toLowerCase() === requestAccountEmail.toLowerCase(),
  );
  if (!account) {
    if (errors.length > 0) {
      throw createError({
        statusCode: 503,
        statusMessage: formatMailAccountErrors(errors),
        data: { accountErrors: errors },
      });
    }
    throw createError({
      statusCode: 403,
      statusMessage: "Account not owned by current user",
    });
  }
  return account;
}

type GmailAccessResult =
  | { ok: true; accountEmail: string; accessToken: string }
  | {
      ok: false;
      response: { error: string; accountErrors?: MailAccountError[] };
    };

async function resolveGmailAccess(
  event: H3Event,
  ownerEmail: string,
  requestedAccountEmail?: string,
): Promise<GmailAccessResult> {
  let accountEmail: string;
  try {
    accountEmail = await resolveAccountEmail(requestedAccountEmail, ownerEmail);
  } catch (error: any) {
    setResponseStatus(event, error?.statusCode ?? 500);
    return {
      ok: false,
      response: {
        error:
          error?.statusMessage ??
          error?.message ??
          "Could not resolve the Gmail account",
        ...(error?.data?.accountErrors
          ? { accountErrors: error.data.accountErrors }
          : {}),
      },
    };
  }

  let accessToken: string | null;
  try {
    accessToken = await getAccessToken(ownerEmail, accountEmail);
  } catch (error) {
    const accountErrors = [
      {
        email: accountEmail,
        error:
          error instanceof Error
            ? error.message
            : "Google credential refresh failed",
      },
    ];
    setResponseStatus(event, 503);
    return {
      ok: false,
      response: {
        error: formatMailAccountErrors(accountErrors),
        accountErrors,
      },
    };
  }

  if (!accessToken) {
    setResponseStatus(event, 401);
    return {
      ok: false,
      response: { error: "No valid access token for account" },
    };
  }

  return { ok: true, accountEmail, accessToken };
}

async function userEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }
  return session.email;
}

function reqSource(event: H3Event) {
  return getHeader(event, "x-request-source") || undefined;
}

async function readGmailComposeAttachment(
  ownerEmail: string,
  requestAccountEmail: string | undefined,
  attachment: {
    gmailMessageId?: string;
    gmailAttachmentId?: string;
    accountEmail?: string;
  },
): Promise<Buffer | null> {
  if (!attachment.gmailMessageId || !attachment.gmailAttachmentId) return null;
  const requestedAccountEmail = requestAccountEmail ?? attachment.accountEmail;
  const requestedAccount = requestedAccountEmail
    ? await resolveAccountEmail(requestedAccountEmail, ownerEmail)
    : undefined;
  const { tokens: accountTokens, errors } = await getAccountTokens(
    ownerEmail,
    requestedAccount ? [requestedAccount] : undefined,
  );
  const candidates = requestedAccount
    ? accountTokens.filter((account) => account.email === requestedAccount)
    : accountTokens;

  for (const { accessToken } of candidates) {
    try {
      const res = await gmailGetAttachment(
        accessToken,
        attachment.gmailMessageId,
        attachment.gmailAttachmentId,
      );
      if (res?.data) return Buffer.from(res.data, "base64url");
    } catch {
      continue;
    }
  }
  if (errors.length > 0) {
    throw createError({
      statusCode: 502,
      statusMessage: formatMailAccountErrors(errors),
      data: { accountErrors: errors },
    });
  }
  return null;
}

async function resolveEmailComposeAttachments(
  attachments: unknown,
  ownerEmail: string,
  requestAccountEmail?: string,
) {
  return resolveComposeAttachments(attachments, ownerEmail, {
    readGmailAttachment: (attachment) =>
      readGmailComposeAttachment(ownerEmail, requestAccountEmail, attachment),
  });
}

async function readLabels(email: string): Promise<Label[]> {
  const data = await getUserSetting(email, "labels");
  if (data && Array.isArray((data as any).labels)) {
    return (data as any).labels;
  }
  return [];
}

async function writeLabels(
  email: string,
  labels: Label[],
  options?: { requestSource?: string },
): Promise<void> {
  await putUserSetting(email, "labels", { labels }, options);
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
    const unread = active.filter((e) => !e.isRead).length;
    return { ...label, unreadCount: unread, totalCount: active.length };
  });
}

function parseEmailPageLimit(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(Math.max(Math.floor(n), 10), 50);
}

function gmailErrorStatus(error: unknown): {
  status: number;
  retryAfterSeconds?: number;
} {
  if (error instanceof GmailQuotaCooldownError) {
    return {
      status: 429,
      retryAfterSeconds: Math.min(
        Math.max(1, Math.ceil(error.retryAfterMs / 1000)),
        300,
      ),
    };
  }
  const parsed = (error as any)?.message?.match(/\((\d+)\)/)?.[1];
  return { status: parsed ? Number(parsed) : 502 };
}

export const listEmails = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const {
    view = "inbox",
    q,
    label,
    forceRefresh,
    limit,
  } = getQuery(event) as {
    view?: string;
    q?: string;
    label?: string;
    forceRefresh?: string;
    limit?: string;
  };
  const pageLimit = parseEmailPageLimit(limit);

  if (view === "snoozed" || view === "scheduled") {
    let emails = await getSyntheticEmailsForView(email, view);
    if (q) {
      emails = emails.filter((message) =>
        emailMessageMatchesSearch(message, q),
      );
    }
    return { emails };
  }

  if (await isConnected(email)) {
    try {
      const { pageToken } = getQuery(event) as { pageToken?: string };
      let pageTokens: Record<string, string> | undefined;
      if (pageToken) {
        try {
          pageTokens = JSON.parse(
            Buffer.from(pageToken, "base64url").toString(),
          );
        } catch {
          // ignore malformed tokens
        }
      }

      // Fence list responses before token resolution so an in-flight request
      // cannot repopulate the old shared snapshot while force-refresh waits.
      if (forceRefresh) invalidateListCacheForOwner(email);

      const { tokens: accountTokens, errors: tokenErrors } =
        await getAccountTokens(email);
      if (forceRefresh) {
        for (const account of accountTokens)
          invalidateHistoryCacheForAccount(account.email);
        invalidateListCacheForOwner(email);
      }
      const labelMap = await getCachedLabelMap(accountTokens);
      const isPlainInboxRequest = view === "inbox" && !q && !label;
      const settings = isPlainInboxRequest
        ? await readSettings(email)
        : undefined;
      const hasAttachmentSavedFilter =
        isPlainInboxRequest &&
        (settings?.savedFilters ?? []).some((filter) =>
          searchQueryNeedsAttachmentMetadata(filter.query),
        );

      const listResult = await listInboxEmails({
        ownerEmail: email,
        view,
        q,
        label,
        limit: pageLimit,
        pageTokens,
        threadFormat:
          view === "drafts" || hasAttachmentSavedFilter ? "full" : "metadata",
        threadCandidateLimit: q ? 80 : undefined,
        accountTokens,
        labelMap,
      });

      if (!listResult.ok) {
        setMailAccountErrorsHeader(event, tokenErrors);
        if (listResult.isQuotaError) {
          setResponseStatus(event, 429);
          setResponseHeader(
            event,
            "Retry-After",
            String(listResult.retryAfterSeconds),
          );
        } else {
          setResponseStatus(event, 502);
        }
        return { error: listResult.message };
      }

      const {
        emails,
        errors: listErrors,
        nextPageTokens,
        resultSizeEstimate,
      } = listResult;
      const errors = mergeMailAccountErrors(listErrors, tokenErrors);

      setMailAccountErrorsHeader(event, errors);

      let nextPageToken: string | undefined;
      if (nextPageTokens) {
        nextPageToken = Buffer.from(JSON.stringify(nextPageTokens)).toString(
          "base64url",
        );
      }
      return {
        emails,
        ...(nextPageToken && { nextPageToken }),
        ...(resultSizeEstimate && { totalEstimate: resultSizeEstimate }),
      };
    } catch (error: any) {
      console.error("[listEmails] Gmail error:", error.message);
      setResponseStatus(event, error?.statusCode ?? 500);
      return { error: error.message };
    }
  }

  let emails = await readEmails(email);

  if (label && (view === "inbox" || view === "unread")) {
    emails = filterInboxScopedThreadMessages(
      emails.filter((e) =>
        e.labelIds.some((labelId) => mailLabelMatches(labelId, label)),
      ),
      view,
      label,
      new Set([email.toLowerCase()]),
    );
  } else {
    switch (view) {
      case "inbox":
        emails = emails.filter(
          (e) => !e.isArchived && !e.isTrashed && !e.isDraft && !e.isSent,
        );
        break;
      case "unread":
        emails = emails.filter(
          (e) =>
            !e.isRead &&
            !e.isArchived &&
            !e.isTrashed &&
            !e.isDraft &&
            !e.isSent,
        );
        break;
      case "starred":
        emails = emails.filter((e) => e.isStarred && !e.isTrashed);
        break;
      case "sent":
        emails = emails.filter((e) => e.isSent && !e.isTrashed);
        break;
      case "drafts":
        emails = emails.filter((e) => e.isDraft);
        break;
      case "archive":
        emails = emails.filter((e) => e.isArchived && !e.isTrashed);
        break;
      case "trash":
        emails = emails.filter((e) => e.isTrashed);
        break;
      case "all":
        if (label) emails = filterLabelMessages(emails, label);
        break;
      default:
        const labelId = view.startsWith("label:")
          ? view.replace("label:", "")
          : view;
        emails = emails.filter(
          (e) => e.labelIds.includes(labelId) && !e.isTrashed,
        );
    }
  }

  if (q) {
    emails = emails.filter((e) => emailMessageMatchesSearch(e, q));
  }

  if (!q && (view === "inbox" || view === "unread")) {
    const snoozedIds = await getSnoozedThreadIds(email);
    if (snoozedIds.size > 0) {
      emails = emails.filter(
        (e) => !snoozedIds.has(e.threadId) && !snoozedIds.has(e.id),
      );
    }
  }

  emails.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  const { pageToken: localPageToken } = getQuery(event) as {
    pageToken?: string;
  };
  const offset = (() => {
    const n = Number(localPageToken);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  })();
  const page = emails.slice(offset, offset + pageLimit);
  const nextOffset = offset + pageLimit;
  const nextPageToken =
    nextOffset < emails.length ? String(nextOffset) : undefined;

  return {
    emails: page,
    ...(nextPageToken && { nextPageToken }),
    totalEstimate: emails.length,
  };
});

// ─── Thread messages ─────────────────────────────────────────────────────────

export const getThreadMessages = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const threadId = getRouterParam(event, "threadId") as string;
  const { accountEmail } = getQuery(event) as { accountEmail?: string };

  const cacheKey = threadCacheKey(email, threadId);
  const cached = threadMessagesCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.messages;
  }

  if (await isConnected(email)) {
    try {
      let resolvedAccount: string | undefined;
      if (accountEmail) {
        try {
          resolvedAccount = await resolveAccountEmail(accountEmail, email);
        } catch (error: any) {
          const statusCode = error?.statusCode ?? 403;
          setResponseStatus(event, statusCode);
          return {
            error: error?.statusMessage ?? "Account not owned by current user",
            ...(error?.data?.accountErrors
              ? { accountErrors: error.data.accountErrors }
              : {}),
          };
        }
      }
      const { tokens: accountTokens, errors } = await getAccountTokens(
        email,
        resolvedAccount ? [resolvedAccount] : undefined,
      );
      let candidateTokens = accountTokens;
      if (resolvedAccount) {
        candidateTokens = accountTokens.filter(
          (account) =>
            account.email.toLowerCase() === resolvedAccount.toLowerCase(),
        );
      }
      setMailAccountErrorsHeader(event, errors);
      const labelMap = await getCachedLabelMap(accountTokens);

      for (const { email: acctEmail, accessToken } of candidateTokens) {
        try {
          const threadRes = await gmailGetThread(accessToken, threadId, "full");
          const messages = (threadRes.messages || []).map((m: any) =>
            gmailToEmailMessage(
              { ...m, _accountEmail: acctEmail },
              acctEmail,
              labelMap,
            ),
          );
          messages.sort(
            (a: any, b: any) =>
              new Date(a.date).getTime() - new Date(b.date).getTime(),
          );
          threadMessagesCache.set(cacheKey, {
            messages,
            expiresAt: Date.now() + THREAD_CACHE_TTL,
          });
          return messages;
        } catch (error: any) {
          const { status, retryAfterSeconds } = gmailErrorStatus(error);
          if (status === 404) continue;
          console.error("[getThreadMessages] Gmail error:", error.message);
          setResponseStatus(event, status);
          if (retryAfterSeconds !== undefined) {
            setResponseHeader(event, "Retry-After", String(retryAfterSeconds));
          }
          return { error: error.message };
        }
      }
      if (candidateTokens.length > 0) {
        if (errors.length > 0) {
          setResponseStatus(event, 502);
          return {
            error: formatMailAccountErrors(errors),
            accountErrors: errors,
          };
        }
        setResponseStatus(event, 404);
        return { error: "Thread not found in any account" };
      }
      if (errors.length > 0) {
        setResponseStatus(event, 502);
        return {
          error: formatMailAccountErrors(errors),
          accountErrors: errors,
        };
      }
    } catch (error: any) {
      console.error("[getThreadMessages] error:", error.message);
      setResponseStatus(event, error?.statusCode ?? 500);
      return { error: error.message };
    }
  }

  const emails = await readEmails(email);
  const threadMessages = emails
    .filter((e) => e.threadId === threadId)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (threadMessages.length === 0) {
    setResponseStatus(event, 404);
    return { error: "Thread not found" };
  }

  return threadMessages;
});

export const getEmail = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  if (await isConnected(email)) {
    const { tokens: accountTokens, errors } = await getAccountTokens(email);
    setMailAccountErrorsHeader(event, errors);
    const labelMap = await getCachedLabelMap(accountTokens);
    for (const { email: acctEmail, accessToken } of accountTokens) {
      try {
        const msg = await gmailGetMessage(
          accessToken,
          getRouterParam(event, "id") as string,
          "full",
        );
        return gmailToEmailMessage(msg, acctEmail, labelMap);
      } catch (error: any) {
        const { status, retryAfterSeconds } = gmailErrorStatus(error);
        if (status === 404) continue;
        console.error("[getEmail] Gmail error:", error.message);
        setResponseStatus(event, status);
        if (retryAfterSeconds !== undefined) {
          setResponseHeader(event, "Retry-After", String(retryAfterSeconds));
        }
        return { error: error.message };
      }
    }
    if (accountTokens.length > 0) {
      if (errors.length > 0) {
        setResponseStatus(event, 502);
        return {
          error: formatMailAccountErrors(errors),
          accountErrors: errors,
        };
      }
      setResponseStatus(event, 404);
      return { error: "Message not found in any account" };
    }
    if (errors.length > 0) {
      setResponseStatus(event, 502);
      return {
        error: formatMailAccountErrors(errors),
        accountErrors: errors,
      };
    }
  }

  const emails = await readEmails(email);
  const found = emails.find((e) => e.id === getRouterParam(event, "id"));
  if (!found) {
    setResponseStatus(event, 404);
    return { error: "Email not found" };
  }
  return found;
});

export const reportSpam = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const body = ((await readBody(event).catch(() => ({}))) ?? {}) as {
    accountEmail?: string;
    threadId?: string;
  };
  const { accountEmail, threadId: bodyThreadId } = body;

  if (await isConnected(email)) {
    const gmailAccess = await resolveGmailAccess(event, email, accountEmail);
    if (!gmailAccess.ok) return gmailAccess.response;
    const { accountEmail: acct, accessToken } = gmailAccess;
    try {
      const id = getRouterParam(event, "id") as string;
      let threadId = bodyThreadId;
      if (!threadId) {
        const msg = await gmailGetMessage(accessToken, id, "minimal");
        threadId = msg.threadId;
      }
      const updated = (await gmailModifyThread(
        accessToken,
        threadId!,
        ["SPAM"],
        ["INBOX"],
      )) as { historyId?: string } | undefined;
      invalidateThreadCache(email, threadId!);
      await syncInboxLabelDelta(email, acct, [threadId!], {
        add: ["SPAM"],
        remove: ["INBOX"],
        providerHistoryId: updated?.historyId,
      });
      return { id, threadId, spam: true };
    } catch (error: any) {
      console.error("[reportSpam] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  return withLocalEmailMutationLock(email, async () => {
    const emails = await readEmails(email);
    const target = emails.find((e) => e.id === getRouterParam(event, "id"));
    if (!target) {
      setResponseStatus(event, 404);
      return { error: "Email not found" };
    }
    const threadId = target.threadId || target.id;
    for (let i = 0; i < emails.length; i++) {
      const eid = emails[i].threadId || emails[i].id;
      if (eid === threadId) {
        emails[i] = {
          ...emails[i],
          isTrashed: true,
          labelIds: [
            ...emails[i].labelIds.filter((l) => l !== "inbox"),
            "spam",
          ],
        };
      }
    }
    await writeEmails(email, emails, { requestSource: reqSource(event) });
    const labels = recomputeUnreadCounts(emails, await readLabels(email));
    await writeLabels(email, labels, { requestSource: reqSource(event) });
    return { id: getRouterParam(event, "id"), threadId, spam: true };
  });
});

async function readBlockedSenders(email: string): Promise<string[]> {
  const data = await getUserSetting(email, "blocked-senders");
  if (data && Array.isArray((data as any).senders)) {
    return (data as any).senders;
  }
  return [];
}

async function writeBlockedSenders(
  email: string,
  senders: string[],
  options?: { requestSource?: string },
): Promise<void> {
  await putUserSetting(email, "blocked-senders", { senders }, options);
}

export const blockSender = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const body = ((await readBody(event).catch(() => ({}))) ?? {}) as {
    senderEmail?: string;
    accountEmail?: string;
  };
  const { senderEmail, accountEmail } = body;

  if (!senderEmail) {
    setResponseStatus(event, 400);
    return { error: "Missing senderEmail" };
  }

  if (await isConnected(email)) {
    const gmailAccess = await resolveGmailAccess(event, email, accountEmail);
    if (!gmailAccess.ok) return gmailAccess.response;
    const { accountEmail: acct, accessToken } = gmailAccess;
    try {
      const id = getRouterParam(event, "id") as string;

      const msg = await gmailGetMessage(accessToken, id, "minimal");
      const updated = (await gmailModifyThread(
        accessToken,
        msg.threadId,
        ["SPAM"],
        ["INBOX"],
      )) as { historyId?: string } | undefined;
      invalidateThreadCache(email, msg.threadId);
      await syncInboxLabelDelta(email, acct, [msg.threadId], {
        add: ["SPAM"],
        remove: ["INBOX"],
        providerHistoryId: updated?.historyId,
      });

      try {
        await googleFetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/settings/filters`,
          accessToken,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              criteria: { from: senderEmail },
              action: { removeLabelIds: ["INBOX"], addLabelIds: ["TRASH"] },
            }),
          },
        );
      } catch (filterErr: any) {
        console.error(
          "[blockSender] filter creation failed:",
          filterErr.message,
        );
      }

      return { id, blocked: senderEmail };
    } catch (error: any) {
      console.error("[blockSender] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  const blocked = await readBlockedSenders(email);
  if (!blocked.includes(senderEmail.toLowerCase())) {
    blocked.push(senderEmail.toLowerCase());
    await writeBlockedSenders(email, blocked, {
      requestSource: reqSource(event),
    });
  }

  return withLocalEmailMutationLock(email, async () => {
    const emails = await readEmails(email);
    const target = emails.find((e) => e.id === getRouterParam(event, "id"));
    if (!target) {
      setResponseStatus(event, 404);
      return { error: "Email not found" };
    }
    const threadId = target.threadId || target.id;
    for (let i = 0; i < emails.length; i++) {
      const eid = emails[i].threadId || emails[i].id;
      if (eid === threadId) {
        emails[i] = {
          ...emails[i],
          isTrashed: true,
          labelIds: [
            ...emails[i].labelIds.filter((l) => l !== "inbox"),
            "spam",
          ],
        };
      }
    }
    await writeEmails(email, emails, { requestSource: reqSource(event) });
    const labels = recomputeUnreadCounts(emails, await readLabels(email));
    await writeLabels(email, labels, { requestSource: reqSource(event) });
    return { id: getRouterParam(event, "id"), threadId, blocked: senderEmail };
  });
});

async function readMutedThreads(email: string): Promise<string[]> {
  const data = await getUserSetting(email, "muted-threads");
  if (data && Array.isArray((data as any).threads)) {
    return (data as any).threads;
  }
  return [];
}

async function writeMutedThreads(
  email: string,
  threads: string[],
  options?: { requestSource?: string },
): Promise<void> {
  await putUserSetting(email, "muted-threads", { threads }, options);
}

export const muteThread = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const body = ((await readBody(event).catch(() => ({}))) ?? {}) as {
    accountEmail?: string;
  };
  const { accountEmail } = body;

  if (await isConnected(email)) {
    const gmailAccess = await resolveGmailAccess(event, email, accountEmail);
    if (!gmailAccess.ok) return gmailAccess.response;
    const { accountEmail: acct, accessToken } = gmailAccess;
    try {
      const threadId = getRouterParam(event, "threadId") as string;
      const updated = (await gmailModifyThread(
        accessToken,
        threadId,
        undefined,
        ["INBOX"],
      )) as { historyId?: string } | undefined;
      invalidateThreadCache(email, threadId);
      await syncInboxLabelDelta(email, acct, [threadId], {
        remove: ["INBOX"],
        providerHistoryId: updated?.historyId,
      });
      return { threadId, muted: true };
    } catch (error: any) {
      console.error("[muteThread] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  const threadId = getRouterParam(event, "threadId") as string;
  const muted = await readMutedThreads(email);
  if (!muted.includes(threadId)) {
    muted.push(threadId);
    await writeMutedThreads(email, muted, { requestSource: reqSource(event) });
  }

  return withLocalEmailMutationLock(email, async () => {
    const emails = await readEmails(email);
    for (let i = 0; i < emails.length; i++) {
      const eid = emails[i].threadId || emails[i].id;
      if (eid === threadId) {
        emails[i] = {
          ...emails[i],
          isArchived: true,
          labelIds: emails[i].labelIds.filter((l) => l !== "inbox"),
        };
      }
    }
    await writeEmails(email, emails, { requestSource: reqSource(event) });
    const labels = recomputeUnreadCounts(emails, await readLabels(email));
    await writeLabels(email, labels, { requestSource: reqSource(event) });
    return { threadId, muted: true };
  });
});

export const deleteEmail = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  return withLocalEmailMutationLock(email, async () => {
    const emails = await readEmails(email);
    const filtered = emails.filter((e) => e.id !== getRouterParam(event, "id"));
    if (filtered.length === emails.length) {
      setResponseStatus(event, 404);
      return { error: "Email not found" };
    }
    await writeEmails(email, filtered, { requestSource: reqSource(event) });
    return { ok: true };
  });
});

export const sendEmail = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const settings = await readSettings(email);
  const reqBody = await readBody(event);
  const { to, cc, bcc, subject, body, replyToId, accountEmail } = reqBody;

  if (!to || subject === undefined || body === undefined) {
    setResponseStatus(event, 400);
    return { error: "Missing required fields: to, subject, body" };
  }

  const cleanedTo = stripCrlf(to);
  const cleanedCc = cc ? stripCrlf(cc) : "";
  const cleanedBcc = bcc ? stripCrlf(bcc) : "";
  if (
    !isValidAddressList(cleanedTo) ||
    !isValidAddressList(cleanedCc) ||
    !isValidAddressList(cleanedBcc)
  ) {
    setResponseStatus(event, 400);
    return { error: "Invalid recipient address" };
  }

  let attachments;
  try {
    attachments = await resolveEmailComposeAttachments(
      reqBody.attachments,
      email,
      accountEmail,
    );
  } catch (error: any) {
    setResponseStatus(event, error?.statusCode ?? 400);
    return {
      error:
        error?.statusMessage ?? "One or more attachments could not be read",
      ...(error?.data?.accountErrors
        ? { accountErrors: error.data.accountErrors }
        : {}),
    };
  }

  if (await isConnected(email)) {
    try {
      let selectedEmail = await resolveAccountEmail(accountEmail, email);
      const { tokens: accountTokens, errors } = await getAccountTokens(
        email,
        replyToId && !accountEmail ? undefined : [selectedEmail],
      );
      let selectedToken = accountTokens.find(
        (account) =>
          account.email.toLowerCase() === selectedEmail.toLowerCase(),
      )?.accessToken;

      let threadId: string | undefined;
      let inReplyTo: string | undefined;
      let references: string | undefined;

      if (replyToId) {
        for (const { email: acctEmail, accessToken } of accountTokens) {
          try {
            const original = await gmailGetMessage(
              accessToken,
              replyToId,
              "metadata",
            );

            threadId = original.threadId ?? undefined;
            const headers = original.payload?.headers || [];
            inReplyTo =
              headers.find((h: any) => h.name === "Message-Id")?.value ??
              undefined;
            const refs = headers.find(
              (h: any) => h.name === "References",
            )?.value;
            references = [refs, inReplyTo].filter(Boolean).join(" ");
            if (!accountEmail) {
              selectedToken = accessToken;
              selectedEmail = acctEmail;
            }
            break;
          } catch (err: any) {
            if (err?.message?.includes("404")) continue;
          }
        }
        if (!threadId) {
          if (errors.length > 0) {
            setResponseStatus(event, 502);
            return {
              error: formatMailAccountErrors(errors),
              accountErrors: errors,
            };
          }
          setResponseStatus(event, 404);
          return { error: "Reply source not found in the selected account" };
        }
      }

      if (!selectedToken) {
        if (errors.length > 0) {
          setResponseStatus(event, 502);
          return {
            error: formatMailAccountErrors(errors),
            accountErrors: errors,
          };
        }
        setResponseStatus(event, 401);
        return { error: "No valid access token for account" };
      }
      setMailAccountErrorsHeader(event, errors);

      const senderIdentity = await resolveGoogleSenderIdentity({
        accessToken: selectedToken,
        email: selectedEmail,
        fallbackName: settings.name,
        cachedName: getAccountDisplayName(selectedEmail),
        onResolvedDisplayName: (name) => {
          setAccountDisplayName(selectedEmail, name);
          void setOAuthDisplayName("google", selectedEmail, name).catch(
            () => {},
          );
        },
      });

      const tracking = buildTrackingContext(event, body || "", settings);

      const raw = buildOutgoingRawEmail({
        from: senderIdentity.header,
        to: cleanedTo,
        cc: cleanedCc,
        bcc: cleanedBcc,
        subject: subject || "(no subject)",
        body: body || "",
        inReplyTo,
        references,
        tracking,
        attachments,
      });

      const sendBody: any = { raw };
      if (threadId) sendBody.threadId = threadId;

      const sent = await googleFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/send`,
        selectedToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sendBody),
        },
      );

      if (tracking && sent?.id) {
        persistTracking({
          pixelToken: tracking.pixelToken,
          messageId: sent.id,
          ownerEmail: selectedEmail,
          sentAt: Date.now(),
          linkTokens: tracking.linkTokens,
        }).catch((err) =>
          console.error("[sendEmail] persistTracking failed:", err),
        );
      }

      if (sent.threadId) {
        invalidateThreadCache(email, sent.threadId);
      }
      invalidateListCacheForOwner(email);

      const allRecipients = [to, cc, bcc]
        .filter(Boolean)
        .flatMap((field: string) =>
          field.split(",").map((r: string) => {
            const match = r.trim().match(/^(.+?)\s*<(.+?)>$/);
            return match
              ? { email: match[2].trim(), name: match[1].trim() }
              : { email: r.trim() };
          }),
        )
        .filter((r) => r.email);
      incrementSendFrequency(email, allRecipients).catch(() => {});

      try {
        emit(
          "mail.message.sent",
          {
            messageId: sent.id,
            to: to || "",
            subject: subject || "",
          },
          { owner: email },
        );
      } catch {
        // coercion-ok: the provider send succeeded; this secondary event is best-effort.
      }

      setResponseStatus(event, 201);
      return {
        id: sent.id,
        threadId: sent.threadId,
        labelIds: sent.labelIds || ["SENT"],
        from: {
          name: senderIdentity.displayName || senderIdentity.email,
          email: senderIdentity.email,
        },
      };
    } catch (error: any) {
      console.error("[sendEmail] Gmail API error:", error.message);
      setResponseStatus(event, error?.statusCode ?? 500);
      return {
        error: error?.statusMessage ?? "Failed to send email via Gmail",
        ...(error?.data?.accountErrors
          ? { accountErrors: error.data.accountErrors }
          : {}),
      };
    }
  }

  return withLocalEmailMutationLock(email, async () => {
    const emails = await readEmails(email);

    const newEmail: EmailMessage = {
      id: `msg-${nanoid(8)}`,
      threadId: replyToId
        ? (emails.find((e) => e.id === replyToId)?.threadId ??
          `thread-${nanoid(8)}`)
        : `thread-${nanoid(8)}`,
      from: { name: settings.name, email: settings.email },
      to: (to as string).split(",").map((t: string) => {
        const trimmed = t.trim();
        return { name: trimmed, email: trimmed };
      }),
      ...(cc
        ? {
            cc: (cc as string)
              .split(",")
              .map((t: string) => ({ name: t.trim(), email: t.trim() })),
          }
        : {}),
      ...(bcc
        ? {
            bcc: (bcc as string)
              .split(",")
              .map((t: string) => ({ name: t.trim(), email: t.trim() })),
          }
        : {}),
      subject,
      snippet: markdownPreviewSnippet(body),
      body,
      bodyHtml: outgoingBodyToHtml(body),
      date: new Date().toISOString(),
      isRead: true,
      isStarred: false,
      isSent: true,
      isArchived: false,
      isTrashed: false,
      labelIds: ["sent"],
      ...(attachments.length > 0
        ? {
            attachments: attachments.map((att) => ({
              id: att.filename,
              filename: att.originalName,
              mimeType: att.mimeType,
              size: att.size,
              url: att.url,
            })),
          }
        : {}),
    };

    emails.push(newEmail);
    await writeEmails(email, emails, { requestSource: reqSource(event) });

    setResponseStatus(event, 201);
    return newEmail;
  });
});

export const saveDraft = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const settings = await readSettings(email);
  const reqBody = await readBody(event);
  const {
    to,
    cc,
    bcc,
    subject,
    body,
    draftId,
    replyToId,
    replyToThreadId,
    accountEmail,
  } = reqBody;

  let requestedBackend: ReturnType<typeof parseSavedDraftBackend>;
  try {
    requestedBackend = parseSavedDraftBackend(reqBody.savedDraftBackend);
  } catch {
    setResponseStatus(event, 400);
    return { error: "Invalid saved draft backend" };
  }
  if (
    !isValidAddressList(to ? stripCrlf(to) : "") ||
    !isValidAddressList(cc ? stripCrlf(cc) : "") ||
    !isValidAddressList(bcc ? stripCrlf(bcc) : "")
  ) {
    setResponseStatus(event, 400);
    return { error: "Invalid recipient address" };
  }

  let attachments;
  try {
    attachments = await resolveEmailComposeAttachments(
      reqBody.attachments,
      email,
      accountEmail,
    );
  } catch {
    setResponseStatus(event, 400);
    return { error: "One or more attachments could not be read" };
  }

  if (
    draftId !== undefined &&
    draftId !== null &&
    typeof draftId !== "string"
  ) {
    setResponseStatus(event, 400);
    return { error: "Invalid saved draft ID" };
  }
  const savedDraftId =
    typeof draftId === "string" && draftId ? draftId : undefined;

  let draftBackend: "gmail" | "local";
  let gmailConnected: boolean | undefined;
  let draftAccountEmail = accountEmail as string | undefined;
  try {
    if (savedDraftId) {
      const ownership = await resolveExistingSavedDraftOwnership({
        ownerEmail: email,
        savedDraftId,
        savedDraftBackend: requestedBackend,
        accountEmail: draftAccountEmail,
      });
      draftBackend = ownership.backend;
      draftAccountEmail = ownership.accountEmail ?? draftAccountEmail;
    } else {
      gmailConnected =
        requestedBackend === "local" ? false : await isConnected(email);
      draftBackend = resolveSavedDraftBackend(requestedBackend, gmailConnected);
    }
  } catch (error) {
    if (!(error instanceof SavedDraftOwnershipError)) throw error;
    setResponseStatus(event, 409);
    return { error: error.message };
  }

  if (draftBackend === "gmail") {
    if (!(gmailConnected ?? (await isConnected(email)))) {
      setResponseStatus(event, 401);
      return { error: "Gmail is not connected for this saved draft" };
    }
    const gmailAccess = await resolveGmailAccess(
      event,
      email,
      draftAccountEmail,
    );
    if (!gmailAccess.ok) return gmailAccess.response;
    const { accountEmail: acct, accessToken } = gmailAccess;
    try {
      const draftFrom = draftAccountEmail || "me";
      const raw = buildOutgoingRawEmail({
        from: draftFrom,
        to: to || "",
        cc: cc || "",
        bcc: bcc || "",
        subject: subject || "(no subject)",
        body: body || "",
        attachments,
      });

      if (savedDraftId) {
        try {
          const updated = await googleFetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(savedDraftId)}`,
            accessToken,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: { raw } }),
            },
          );
          return {
            draftId: updated.id,
            backend: "gmail" as const,
            accountEmail: acct,
            updated: true,
          };
        } catch (error) {
          if (!(error instanceof Error) || !/\b404\b/.test(error.message)) {
            throw error;
          }
          // A deleted Gmail draft is safe to replace with a new one.
        }
      }
      const created = await googleFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/drafts`,
        accessToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: { raw } }),
        },
      );
      return {
        draftId: created.id,
        backend: "gmail" as const,
        accountEmail: acct,
        created: true,
      };
    } catch (error: any) {
      console.error("[saveDraft] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  return withLocalEmailMutationLock(email, async () => {
    const emails = await readEmails(email);
    const existingIdx = savedDraftId
      ? emails.findIndex((e) => e.id === savedDraftId && e.isDraft)
      : -1;
    if (savedDraftId && existingIdx < 0) {
      setResponseStatus(event, 409);
      return { error: "Saved local draft was not found" };
    }

    const draftEmail: EmailMessage = {
      id: existingIdx >= 0 ? emails[existingIdx].id : `draft-${nanoid(8)}`,
      threadId:
        existingIdx >= 0
          ? emails[existingIdx].threadId
          : replyToId
            ? (emails.find((e) => e.id === replyToId)?.threadId ??
              `thread-${nanoid(8)}`)
            : `thread-${nanoid(8)}`,
      from: { name: settings.name, email: settings.email },
      to: to
        ? (to as string)
            .split(",")
            .filter((t: string) => t.trim())
            .map((t: string) => ({ name: t.trim(), email: t.trim() }))
        : [],
      ...(cc
        ? {
            cc: (cc as string)
              .split(",")
              .filter((t: string) => t.trim())
              .map((t: string) => ({ name: t.trim(), email: t.trim() })),
          }
        : {}),
      ...(bcc
        ? {
            bcc: (bcc as string)
              .split(",")
              .filter((t: string) => t.trim())
              .map((t: string) => ({ name: t.trim(), email: t.trim() })),
          }
        : {}),
      subject: subject || "(no subject)",
      snippet: markdownPreviewSnippet(body || ""),
      body: body || "",
      bodyHtml: outgoingBodyToHtml(body || ""),
      date: new Date().toISOString(),
      isRead: true,
      isStarred: false,
      isDraft: true,
      isArchived: false,
      isTrashed: false,
      labelIds: ["drafts"],
      ...(attachments.length > 0
        ? {
            attachments: attachments.map((att) => ({
              id: att.filename,
              filename: att.originalName,
              mimeType: att.mimeType,
              size: att.size,
              url: att.url,
            })),
          }
        : {}),
      ...(replyToId ? { replyToId } : {}),
      ...(replyToThreadId ? { replyToThreadId } : {}),
    };

    if (existingIdx >= 0) {
      emails[existingIdx] = draftEmail;
    } else {
      emails.push(draftEmail);
    }
    await writeEmails(email, emails, { requestSource: reqSource(event) });

    return {
      draftId: draftEmail.id,
      backend: "local" as const,
      [existingIdx >= 0 ? "updated" : "created"]: true,
    };
  });
});

function buildTrackingContext(
  event: H3Event,
  body: string,
  settings: UserSettings,
): TrackingContext | undefined {
  const trackOpens = settings.tracking?.opens === true;
  const trackClicks = settings.tracking?.clicks === true;
  if (!trackOpens && !trackClicks) return undefined;

  const linkTokens = new Map<string, string>();
  if (trackClicks) {
    const split = splitReplyQuote(body);
    const portion = split ? split.newContent : body;
    for (const url of collectLinks(portion)) {
      linkTokens.set(url, newClickToken());
    }
  }

  return {
    pixelToken: newPixelToken(),
    linkTokens,
    trackOpens,
    trackClicks,
    appUrl: getAppProductionUrl(event),
  };
}

export const deleteDraft = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const id = getRouterParam(event, "id") as string;

  if (await isConnected(email)) {
    const body = await readBody(event).catch(() => ({}));
    const gmailAccess = await resolveGmailAccess(
      event,
      email,
      body?.accountEmail,
    );
    if (!gmailAccess.ok) return gmailAccess.response;
    const { accessToken } = gmailAccess;
    try {
      await googleFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${id}`,
        accessToken,
        { method: "DELETE" },
      );
    } catch {
      // Draft may not exist in Gmail
    }
    return { ok: true };
  }

  return withLocalEmailMutationLock(email, async () => {
    const emails = await readEmails(email);
    const filtered = emails.filter((e) => !(e.id === id && e.isDraft));
    if (filtered.length !== emails.length) {
      await writeEmails(email, filtered, { requestSource: reqSource(event) });
    }
    return { ok: true };
  });
});

export type ContactEntry = { name: string; email: string; count: number };
export type ContactLookupResult = {
  contacts: ContactEntry[];
  errors: MailAccountError[];
};

const contactCache = new Map<
  string,
  {
    data: ContactEntry[];
    errors: MailAccountError[];
    expiresAt: number;
  }
>();
const CONTACT_CACHE_TTL = 10 * 60 * 1000;

export async function loadContactsForEmail(
  email: string,
): Promise<ContactLookupResult> {
  const cached = contactCache.get(email);
  if (cached && Date.now() < cached.expiresAt) {
    return { contacts: cached.data, errors: cached.errors };
  }

  if (await isConnected(email)) {
    const { tokens: accountTokens, errors } = await getAccountTokens(email);
    const contactMap = new Map<
      string,
      { name: string; email: string; count: number }
    >();

    for (const { email: accountEmail, accessToken } of accountTokens) {
      try {
        let nextPageToken: string | undefined;
        do {
          const resp = await peopleListConnections(accessToken, {
            pageSize: 200,
            personFields: "names,emailAddresses",
            pageToken: nextPageToken,
          });
          for (const person of resp.connections || []) {
            const emails = person.emailAddresses || [];
            const name =
              person.names?.[0]?.displayName || emails[0]?.value || "";
            for (const em of emails) {
              if (!em.value) continue;
              const key = em.value.toLowerCase();
              const existing = contactMap.get(key);
              if (existing) {
                existing.count += 5;
                if (
                  name &&
                  name !== em.value &&
                  existing.name === existing.email
                ) {
                  existing.name = name;
                }
              } else {
                contactMap.set(key, {
                  name: name || em.value,
                  email: em.value,
                  count: 5,
                });
              }
            }
          }
          nextPageToken = resp.nextPageToken ?? undefined;
        } while (nextPageToken);
      } catch (err: any) {
        console.error("[listContacts] connections error:", err.message);
        errors.push({ email: accountEmail, error: err.message });
      }

      try {
        let nextPageToken: string | undefined;
        do {
          const resp = await peopleListOtherContacts(accessToken, {
            pageSize: 200,
            readMask: "names,emailAddresses",
            pageToken: nextPageToken,
          });
          for (const person of resp.otherContacts || []) {
            const emails = person.emailAddresses || [];
            const name =
              person.names?.[0]?.displayName || emails[0]?.value || "";
            for (const em of emails) {
              if (!em.value) continue;
              const key = em.value.toLowerCase();
              if (!contactMap.has(key)) {
                contactMap.set(key, {
                  name: name || em.value,
                  email: em.value,
                  count: 1,
                });
              }
            }
          }
          nextPageToken = resp.nextPageToken ?? undefined;
        } while (nextPageToken);
      } catch (err: any) {
        console.error("[listContacts] otherContacts error:", err.message);
        errors.push({ email: accountEmail, error: err.message });
      }
    }

    const gmailQueries = contactMap.size === 0 ? ["in:sent", ""] : ["in:sent"];
    for (const query of gmailQueries) {
      try {
        const { messages, errors: gmailErrors } = await listGmailMessages(
          query,
          25,
          email,
          undefined,
          { messageFormat: "metadata" },
        );
        errors.push(...gmailErrors);
        for (const msg of messages) {
          const headers = msg.payload?.headers || [];
          for (const field of ["From", "To", "Cc", "Bcc"]) {
            const raw =
              headers.find(
                (h: any) => h.name?.toLowerCase() === field.toLowerCase(),
              )?.value || "";
            if (!raw) continue;
            for (const part of raw.split(",")) {
              const trimmed = part.trim();
              if (!trimmed) continue;
              const match = trimmed.match(/^(.+?)\s*<(.+?)>$/);
              const name = match
                ? match[1].trim().replace(/^"|"$/g, "")
                : trimmed;
              const addr = match ? match[2].trim() : trimmed;
              if (!addr || !addr.includes("@")) continue;
              const key = addr.toLowerCase();
              const existing = contactMap.get(key);
              if (existing) {
                existing.count++;
                if (name && name !== addr && existing.name === existing.email) {
                  existing.name = name;
                }
              } else {
                contactMap.set(key, {
                  name: name || addr,
                  email: addr,
                  count: 1,
                });
              }
            }
          }
        }
      } catch (err: any) {
        console.error(
          `[listContacts] Gmail header scan error (query="${query}"):`,
          err.message,
        );
        errors.push({ email: "workspace", error: err.message });
      }
    }

    let freqMap: Map<string, number>;
    try {
      freqMap = await getContactFrequencyMap(email);
    } catch {
      freqMap = new Map();
    }
    const contacts = Array.from(contactMap.values())
      .map((c) => ({
        ...c,
        count: c.count + (freqMap.get(c.email.toLowerCase()) || 0) * 10,
      }))
      .sort((a, b) => b.count - a.count);
    const result = {
      contacts,
      errors: mergeMailAccountErrors(errors),
    };
    if (result.errors.length === 0) {
      contactCache.set(email, {
        data: contacts,
        errors: [],
        expiresAt: Date.now() + CONTACT_CACHE_TTL,
      });
    }
    return result;
  }

  const emails = await readEmails(email);
  const contactMap = new Map<
    string,
    { name: string; email: string; count: number }
  >();

  for (const msg of emails) {
    const addresses = [
      msg.from,
      ...(msg.to || []),
      ...(msg.cc || []),
      ...(msg.bcc || []),
    ];
    for (const addr of addresses) {
      if (!addr?.email) continue;
      const key = addr.email.toLowerCase();
      const existing = contactMap.get(key);
      if (existing) {
        existing.count++;
        if (
          addr.name &&
          addr.name !== addr.email &&
          (!existing.name || existing.name === existing.email)
        ) {
          existing.name = addr.name;
        }
      } else {
        contactMap.set(key, {
          name: addr.name || addr.email,
          email: addr.email,
          count: 1,
        });
      }
    }
  }

  const contacts = Array.from(contactMap.values()).sort(
    (a, b) => b.count - a.count,
  );
  const result = { contacts, errors: [] };
  contactCache.set(email, {
    data: contacts,
    errors: [],
    expiresAt: Date.now() + CONTACT_CACHE_TTL,
  });
  return result;
}

export const listContacts = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const result = await loadContactsForEmail(email);
  setMailAccountErrorsHeader(event, result.errors);
  if (result.contacts.length === 0 && result.errors.length > 0) {
    setResponseStatus(event, 502);
    return {
      error: formatMailAccountErrors(result.errors),
      accountErrors: result.errors,
    };
  }
  return result.contacts;
});

export const listLabels = defineEventHandler(async (_event: H3Event) => {
  const email = await userEmail(_event);
  if (await isConnected(email)) {
    try {
      const { accountEmails: accountEmailsQuery } = getQuery(_event) as {
        accountEmails?: string;
      };
      const accountEmails = accountEmailsQuery
        ?.split(",")
        .map((account) => account.trim())
        .filter(Boolean);
      const { tokens: accountTokens, errors: tokenErrors } =
        await getAccountTokens(email, accountEmails);
      setMailAccountErrorsHeader(_event, tokenErrors);
      const labelMap = new Map<
        string,
        {
          id: string;
          name: string;
          type: "system" | "user";
          unreadCount: number;
          totalCount: number;
        }
      >();
      let successfulAccountReads = 0;
      let failedAccountReads = tokenErrors.length;
      for (const { accessToken } of accountTokens) {
        try {
          const res = await gmailListLabels(accessToken);
          successfulAccountReads += 1;
          for (const label of res.labels || []) {
            if (!label.id || !label.name) continue;
            const gmailId = label.id;
            const name = label.name;
            const isSystem = !gmailId.startsWith("Label_");
            const systemLabelIds: Record<string, { id: string; name: string }> =
              {
                INBOX: { id: "inbox", name: "Inbox" },
                STARRED: { id: "starred", name: "Starred" },
                SENT: { id: "sent", name: "Sent" },
                DRAFT: { id: "drafts", name: "Drafts" },
                TRASH: { id: "trash", name: "Trash" },
                IMPORTANT: { id: "important", name: "Important" },
                CATEGORY_PERSONAL: { id: "personal", name: "Primary" },
                CATEGORY_SOCIAL: { id: "social", name: "Social" },
                CATEGORY_UPDATES: { id: "updates", name: "Updates" },
                CATEGORY_PROMOTIONS: { id: "promotions", name: "Promotions" },
                CATEGORY_FORUMS: { id: "forums", name: "Forums" },
              };
            const unreadCount =
              Number(label.threadsUnread ?? label.messagesUnread ?? 0) || 0;
            const totalCount =
              Number(label.threadsTotal ?? label.messagesTotal ?? 0) || 0;
            const normalizedSystem = systemLabelIds[gmailId];
            const fullId =
              normalizedSystem?.id ?? name.toLowerCase().replace(/_/g, " ");
            const displayName =
              normalizedSystem?.name ?? name.replace(/_/g, " ");
            const existing = labelMap.get(fullId);
            if (existing) {
              existing.unreadCount += unreadCount;
              existing.totalCount += totalCount;
            } else {
              labelMap.set(fullId, {
                id: fullId,
                name: displayName,
                type: isSystem ? ("system" as const) : ("user" as const),
                unreadCount,
                totalCount,
              });
            }
          }
        } catch {
          failedAccountReads += 1;
        }
      }
      if (failedAccountReads > 0) {
        console.warn(
          `[listLabels] ${failedAccountReads} Gmail account label read(s) failed`,
        );
      }
      if (
        accountTokens.length === 0 ||
        successfulAccountReads === 0 ||
        failedAccountReads > 0
      ) {
        console.error("[listLabels] Gmail label fetch failed");
        setResponseStatus(_event, 502);
        return { error: "Unable to load Gmail labels. Please retry." };
      }
      const labels: Label[] = Array.from(labelMap.values());

      const gmailCategories: Record<string, string> = {
        important: "Important",
        "note-to-self": "Note to Self",
        promotions: "Promotions",
        social: "Social",
        updates: "Updates",
        forums: "Forums",
      };
      for (const [id, name] of Object.entries(gmailCategories)) {
        const existing = labels.findIndex((l) => l.id === id);
        if (existing >= 0) {
          labels[existing].name = name;
        } else {
          labels.push({
            id,
            name,
            type: "system",
            unreadCount: 0,
            totalCount: 0,
          });
        }
      }

      return labels;
    } catch {
      console.error("[listLabels] Gmail label request failed");
      setResponseStatus(_event, 502);
      return { error: "Unable to load Gmail labels. Please retry." };
    }
  }
  return recomputeUnreadCounts(
    await readEmails(email),
    await readLabels(email),
  );
});

export const calendarRsvp = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const { eventId, calendarId, response, accountEmail } = (await readBody(
    event,
  )) as {
    eventId: string;
    calendarId?: string;
    response: "accepted" | "declined" | "tentative";
    accountEmail?: string;
  };

  if (!eventId || !response) {
    setResponseStatus(event, 400);
    return { error: "eventId and response are required" };
  }

  if (!(await isConnected(email))) {
    setResponseStatus(event, 401);
    return { error: "No Google account connected" };
  }

  const gmailAccess = await resolveGmailAccess(event, email, accountEmail);
  if (!gmailAccess.ok) return gmailAccess.response;
  const { accessToken } = gmailAccess;

  try {
    const calId = calendarId || "primary";

    const calEvent = await calendarGetEvent(accessToken, calId, eventId);
    if (!calEvent) {
      setResponseStatus(event, 404);
      return { error: "Event not found" };
    }

    const settings = await readSettings(email);
    const myEmail = settings.email?.toLowerCase();
    const attendees = calEvent.attendees || [];
    let found = false;
    for (const attendee of attendees) {
      if (attendee.email?.toLowerCase() === myEmail || attendee.self) {
        attendee.responseStatus = response;
        found = true;
        break;
      }
    }

    if (!found) {
      attendees.push({
        email: myEmail,
        responseStatus: response,
        self: true,
      });
    }

    await calendarPatchEvent(accessToken, calId, eventId, { attendees }, "all");

    return { ok: true, response };
  } catch (error: any) {
    console.error("[calendarRsvp] error:", error.message);
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});

export const unsubscribeEmail = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const body = ((await readBody(event).catch(() => ({}))) ?? {}) as {
    accountEmail?: string;
  };

  if (!(await isConnected(email))) {
    setResponseStatus(event, 400);
    return { error: "No connected account" };
  }

  const gmailAccess = await resolveGmailAccess(event, email, body.accountEmail);
  if (!gmailAccess.ok) return gmailAccess.response;
  const { accessToken } = gmailAccess;

  try {
    const id = getRouterParam(event, "id") as string;
    const msg = await gmailGetMessage(accessToken, id, "metadata");
    const headers: Array<{ name?: string; value?: string }> =
      msg.payload?.headers || [];
    const listUnsub = headers.find(
      (h: any) => h.name?.toLowerCase() === "list-unsubscribe",
    )?.value;
    const listUnsubPost = headers.find(
      (h: any) => h.name?.toLowerCase() === "list-unsubscribe-post",
    )?.value;

    if (!listUnsub) {
      setResponseStatus(event, 404);
      return { error: "No unsubscribe header found" };
    }

    const entries = listUnsub.match(/<[^>]+>/g) || [];
    let url: string | undefined;
    let mailto: string | undefined;
    for (const entry of entries) {
      const val = entry.slice(1, -1);
      if (val.startsWith("http://") || val.startsWith("https://")) {
        url = val;
      } else if (val.startsWith("mailto:")) {
        mailto = val.slice(7);
      }
    }

    const oneClick =
      !!listUnsubPost &&
      listUnsubPost.toLowerCase().includes("list-unsubscribe=one-click");

    if (oneClick && url) {
      try {
        const res = await ssrfSafeFetch(
          url,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "List-Unsubscribe=One-Click",
            signal: AbortSignal.timeout(10_000),
          },
          { maxRedirects: 3 },
        );
        return { ok: true, method: "one-click", status: res.status, url };
      } catch (e: any) {
        if (String(e?.message ?? "").startsWith("SSRF blocked:")) {
          console.warn(
            "[unsubscribe] one-click POST blocked: SSRF-protected URL",
          );
          setResponseStatus(event, 400);
          return { error: "Unsubscribe URL is not allowed" };
        }
        console.warn("[unsubscribe] one-click POST failed:", e.message);
      }
    }

    if (mailto) {
      try {
        const [address, query] = mailto.split("?");
        const params = new URLSearchParams(query || "");
        const subject = params.get("subject") || "Unsubscribe";
        const bodyText = params.get("body") || "";

        const safeAddress = stripCrlf(address || "");
        const safeSubject = stripCrlf(subject);

        const raw = Buffer.from(
          `To: ${safeAddress}\r\nSubject: ${safeSubject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${bodyText}`,
        )
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        await gmailSendMessage(accessToken, raw);
        return { ok: true, method: "mailto", address: safeAddress, url };
      } catch (e: any) {
        console.warn("[unsubscribe] mailto send failed:", e.message);
      }
    }

    if (url) {
      return { ok: true, method: "url-only", url };
    }

    setResponseStatus(event, 400);
    return { error: "Could not unsubscribe — no usable method found" };
  } catch (error: any) {
    console.error("[unsubscribe] error:", error.message);
    setResponseStatus(event, 500);
    return { error: error.message };
  }
});
