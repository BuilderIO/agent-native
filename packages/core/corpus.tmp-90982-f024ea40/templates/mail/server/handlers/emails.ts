import { emit } from "@agent-native/core/event-bus";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import {
  getOAuthTokens,
  saveOAuthTokens,
  listOAuthAccountsByOwner,
  setOAuthDisplayName,
} from "@agent-native/core/oauth-tokens";
import { readBody, getSession } from "@agent-native/core/server";
import { getAppProductionUrl } from "@agent-native/core/server";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { mailLabelMatches } from "@shared/gmail-labels.js";
import { markdownPreviewSnippet } from "@shared/markdown.js";
import { emailMessageMatchesSearch } from "@shared/search.js";
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

import { normalizeSignature } from "../../shared/signature.js";
import {
  incrementSendFrequency,
  getContactFrequencyMap,
} from "../lib/contact-frequency.js";
import {
  collectLinks,
  newClickToken,
  newPixelToken,
  persistTracking,
  type TrackingContext,
} from "../lib/email-tracking.js";
import { filterInboxScopedThreadMessages } from "../lib/gmail-query.js";
import {
  createOAuth2Client,
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
} from "../lib/google-api.js";
import {
  isConnected,
  invalidateListCacheForOwner,
  listGmailMessages,
  gmailToEmailMessage,
  getAccountDisplayName,
  getOAuth2Credentials,
  setAccountDisplayName,
} from "../lib/google-auth.js";
import { getSyntheticEmailsForView, getSnoozedThreadIds } from "../lib/jobs.js";
import { listInboxEmails } from "../lib/list-inbox-emails.js";
import {
  bodyToHtml as outgoingBodyToHtml,
  buildRawEmail as buildOutgoingRawEmail,
  resolveComposeAttachments,
  splitReplyQuote,
} from "../lib/outgoing-email.js";
import { resolveGoogleSenderIdentity } from "../lib/sender-identity.js";
// State-change operations (archive/unarchive/star/trash/untrash/markRead) have
// been migrated to the action surface; their handlers have been removed. The
// shared lib functions in ../lib/email-state.js remain the single source of
// truth and are called directly from the action definitions.
import {
  threadMessagesCache,
  THREAD_CACHE_TTL,
  threadCacheKey,
  invalidateThreadCache,
} from "../lib/thread-cache.js";

/**
 * Strip CRLF from any value that flows into an RFC 2822 header line. Without
 * this, any `\r\n` in `to`/`cc`/`bcc`/`subject`/`from` injects a new header
 * (`Subject: hi\r\nBcc: attacker@evil` would silently BCC the attacker via
 * the user's connected Gmail account). See email-templates.ts for the same
 * pattern applied to system emails.
 */
function stripCrlf(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Loose validator for an RFC 2822 address-list header value (To/Cc/Bcc).
 * Accepts comma-separated addresses optionally wrapped in `Display Name <addr>`
 * form. Empty input is allowed (caller guards on required-vs-optional). Real
 * full-spec validation is intractable in regex; this catches the common
 * "subject: foo\r\nBcc: …" / "garbage" cases after the CRLF strip and lets
 * Gmail's server-side validation do the rest.
 */
function isValidAddressList(value: string): boolean {
  if (!value) return true;
  const stripped = value.trim();
  if (!stripped) return true;
  // Address regex: must have something@something.something (no whitespace
  // inside the local-or-domain). Display-name + angle-addr form is allowed.
  const ADDR = /(?:[^,<>]*<\s*\S+@\S+\.\S+\s*>|\s*\S+@\S+\.\S+\s*)/;
  const parts = stripped.split(",");
  return parts.every((p) => ADDR.test(p.trim()));
}

// ---------------------------------------------------------------------------
// Label map cache — avoids re-fetching label names from Gmail on every request
// ---------------------------------------------------------------------------

const labelMapCache = new Map<
  string,
  { map: Map<string, string>; expiresAt: number }
>();
const LABEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getCachedLabelMap(
  accountTokens: Array<{ email: string; accessToken: string }>,
): Promise<Map<string, string>> {
  // Build a cache key from sorted account emails
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

// ---------------------------------------------------------------------------
// Token helper — get a valid access token, refreshing if needed
// ---------------------------------------------------------------------------

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
}

async function getAccessToken(accountEmail: string): Promise<string | null> {
  const tokens = (await getOAuthTokens("google", accountEmail)) as unknown as
    | StoredTokens
    | undefined;
  if (!tokens?.access_token) return null;

  // If token expires within 5 minutes, refresh it
  if (
    tokens.expiry_date &&
    tokens.refresh_token &&
    tokens.expiry_date < Date.now() + 5 * 60 * 1000
  ) {
    try {
      const { clientId, clientSecret } =
        await getOAuth2Credentials(accountEmail);
      const oauth = createOAuth2Client(
        clientId,
        clientSecret,
        "http://localhost:8080/_agent-native/google/callback",
      );
      const refreshed = await oauth.refreshToken(tokens.refresh_token);
      const updated = {
        ...tokens,
        access_token: refreshed.access_token,
        expiry_date: Date.now() + refreshed.expires_in * 1000,
      };
      await saveOAuthTokens(
        "google",
        accountEmail,
        updated as unknown as Record<string, unknown>,
      );
      return refreshed.access_token;
    } catch (err: any) {
      console.error(
        `[getAccessToken] refresh failed for ${accountEmail}:`,
        err.message,
      );
      // Fall through to use existing token
    }
  }

  return tokens.access_token;
}

/**
 * Get access tokens for accounts owned by the given user.
 * Always requires forEmail to enforce per-user isolation.
 */
async function getAccountTokens(
  forEmail: string,
): Promise<Array<{ email: string; accessToken: string }>> {
  const accounts = await listOAuthAccountsByOwner("google", forEmail);

  const results: Array<{ email: string; accessToken: string }> = [];

  for (const account of accounts) {
    // Seed in-memory cache from SQL on first load
    if (account.displayName && !getAccountDisplayName(account.accountId)) {
      setAccountDisplayName(account.accountId, account.displayName);
    }

    const token = await getAccessToken(account.accountId);
    if (token) {
      results.push({ email: account.accountId, accessToken: token });
      // Fetch from Google if we still don't have a display name
      if (!getAccountDisplayName(account.accountId)) {
        // Mark as attempted immediately so concurrent requests don't re-fire
        setAccountDisplayName(account.accountId, account.accountId);
        googleFetch(`https://www.googleapis.com/oauth2/v2/userinfo`, token)
          .then((profile: any) => {
            if (profile?.name) {
              setAccountDisplayName(account.accountId, profile.name);
              setOAuthDisplayName(
                "google",
                account.accountId,
                profile.name,
              ).catch(() => {});
            }
          })
          .catch(() => {});
      }
    }
  }

  return results;
}

/**
 * Validate that the given accountEmail is owned by the logged-in user.
 * Returns the validated account email, or the user's own email as fallback.
 */
async function resolveAccountEmail(
  requestAccountEmail: string | undefined,
  ownerEmail: string,
): Promise<string> {
  if (!requestAccountEmail || requestAccountEmail === ownerEmail) {
    return ownerEmail;
  }
  const accounts = await listOAuthAccountsByOwner("google", ownerEmail);
  const isOwned = accounts.some((a) => a.accountId === requestAccountEmail);
  if (!isOwned) {
    throw new Error("Account not owned by current user");
  }
  return requestAccountEmail;
}

/** Extract the logged-in user's email from the request session. */
async function userEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
  }
  return session.email;
}

// ─── Settings defaults ──────────────────────────────────────────────────────

const DEFAULT_SETTINGS: UserSettings = {
  name: "",
  email: "",
  signature: "",
  writingStyle: "",
  theme: "dark",
  density: "comfortable",
  previewPane: "right",
  sendAndArchive: false,
  undoSendDelay: 5,
  tracking: { opens: false, clicks: false },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function readEmails(email: string): Promise<EmailMessage[]> {
  const data = await getUserSetting(email, "local-emails");
  if (data && Array.isArray((data as any).emails)) {
    return (data as any).emails;
  }
  return [];
}

function reqSource(event: H3Event) {
  return getHeader(event, "x-request-source") || undefined;
}

async function writeEmails(
  email: string,
  emails: EmailMessage[],
  options?: { requestSource?: string },
): Promise<void> {
  await putUserSetting(email, "local-emails", { emails }, options);
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
  const accountTokens = await getAccountTokens(ownerEmail);
  const requestedAccountEmail = requestAccountEmail ?? attachment.accountEmail;
  const requestedAccount = requestedAccountEmail
    ? await resolveAccountEmail(requestedAccountEmail, ownerEmail)
    : undefined;
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

async function readSettings(email: string): Promise<UserSettings> {
  const data = await getUserSetting(email, "mail-settings");
  if (data) {
    return {
      ...DEFAULT_SETTINGS,
      ...(data as any),
      email: (data as any).email || email,
      signature: normalizeSignature((data as any).signature),
    } as UserSettings;
  }
  return { ...DEFAULT_SETTINGS, email };
}

function recomputeUnreadCounts(
  emails: EmailMessage[],
  labels: Label[],
): Label[] {
  return labels.map((label) => {
    const active = emails.filter(
      (e) => !e.isArchived && !e.isTrashed && e.labelIds.includes(label.id),
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

// ─── Email list ───────────────────────────────────────────────────────────────

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

  // If Google is connected, fetch from Gmail directly (skip demo data)
  if (await isConnected(email)) {
    try {
      if (forceRefresh) invalidateListCacheForOwner(email);

      const { pageToken } = getQuery(event) as { pageToken?: string };
      // Decode composite page tokens (one per Gmail account)
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

      // Fetch label name mapping from all accounts (cached)
      const accountTokens = await getAccountTokens(email);
      const labelMap = await getCachedLabelMap(accountTokens);

      const listResult = await listInboxEmails({
        ownerEmail: email,
        view,
        q,
        label,
        limit: pageLimit,
        pageTokens,
        threadFormat: view === "drafts" ? "full" : "metadata",
        threadCandidateLimit: q ? 80 : undefined,
        accountTokens,
        labelMap,
      });

      if (!listResult.ok) {
        // All accounts failed — surface as error
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

      const { emails, errors, nextPageTokens, resultSizeEstimate } = listResult;

      // If some accounts failed but others succeeded, add warning header.
      // HTTP headers must be ByteString (code points <= 255), so strip any
      // UTF-8 that might land in an error message (em dashes, smart quotes,
      // etc. from Google error responses). Otherwise the whole handler 500s.
      if (errors.length > 0) {
        const safe = JSON.stringify(errors).replace(/[^\x20-\x7e]/g, "?");
        setResponseHeader(event, "X-Account-Errors", safe);
      }

      // Encode next page token for the frontend
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
      setResponseStatus(event, 500);
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
    // Filter by view
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
        break;
      default:
        // label: prefixed or raw label id
        const labelId = view.startsWith("label:")
          ? view.replace("label:", "")
          : view;
        emails = emails.filter(
          (e) => e.labelIds.includes(labelId) && !e.isTrashed,
        );
    }
  }

  // Full-text search
  if (q) {
    emails = emails.filter((e) => emailMessageMatchesSearch(e, q));
  }

  // Filter out snoozed emails. Skip when searching so snoozed hits surface too.
  if (!q && (view === "inbox" || view === "unread")) {
    const snoozedIds = await getSnoozedThreadIds(email);
    if (snoozedIds.size > 0) {
      emails = emails.filter(
        (e) => !snoozedIds.has(e.threadId) && !snoozedIds.has(e.id),
      );
    }
  }

  // Sort by date descending
  emails.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  // Paginate the same way the Gmail-connected branch above does, so local/demo
  // mode doesn't load the entire filtered list in one unbounded response and
  // infinite scroll (which relies on nextPageToken) actually has a next page.
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

  // Cache hit: skip Gmail entirely. Survives prefetch → navigate within TTL,
  // and across sibling j/k navigation for the same thread.
  const cacheKey = threadCacheKey(email, threadId);
  const cached = threadMessagesCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.messages;
  }

  if (await isConnected(email)) {
    try {
      const accountTokens = await getAccountTokens(email);
      let candidateTokens = accountTokens;
      if (accountEmail) {
        let resolvedAccount: string;
        try {
          resolvedAccount = await resolveAccountEmail(accountEmail, email);
        } catch {
          setResponseStatus(event, 403);
          return { error: "Account not owned by current user" };
        }
        candidateTokens = accountTokens.filter(
          (account) => account.email === resolvedAccount,
        );
      }
      const labelMap = await getCachedLabelMap(accountTokens);

      // When the list row tells us which connected account owns the thread,
      // fetch only that account. Otherwise fall back to scanning all accounts
      // for older callers and copied URLs.
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
          // Sort oldest first
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
          const status = error?.message?.match(/\((\d+)\)/)?.[1];
          if (status === "404") continue;
          console.error("[getThreadMessages] Gmail error:", error.message);
          setResponseStatus(event, parseInt(status) || 502);
          return { error: error.message };
        }
      }
      if (candidateTokens.length > 0) {
        setResponseStatus(event, 404);
        return { error: "Thread not found in any account" };
      }
    } catch (error: any) {
      console.error("[getThreadMessages] error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  // Demo data: find all emails with matching threadId
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

// ─── Single email ─────────────────────────────────────────────────────────────

export const getEmail = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  if (await isConnected(email)) {
    const accountTokens = await getAccountTokens(email);
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
        const status = error?.message?.match(/\((\d+)\)/)?.[1];
        if (status === "404") continue;
        console.error("[getEmail] Gmail error:", error.message);
        setResponseStatus(event, parseInt(status) || 502);
        return { error: error.message };
      }
    }
    if (accountTokens.length > 0) {
      setResponseStatus(event, 404);
      return { error: "Message not found in any account" };
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

// ─── Report spam ──────────────────────────────────────────────────────────────

export const reportSpam = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const body = ((await readBody(event).catch(() => ({}))) ?? {}) as {
    accountEmail?: string;
    threadId?: string;
  };
  const { accountEmail, threadId: bodyThreadId } = body;

  if (await isConnected(email)) {
    const acct = await resolveAccountEmail(accountEmail, email);
    const accessToken = await getAccessToken(acct);
    if (!accessToken) {
      setResponseStatus(event, 401);
      return { error: "No valid access token for account" };
    }
    try {
      const id = getRouterParam(event, "id") as string;
      // Get the threadId from the message if not provided
      let threadId = bodyThreadId;
      if (!threadId) {
        const msg = await gmailGetMessage(accessToken, id, "minimal");
        threadId = msg.threadId;
      }
      // Report spam on entire thread
      await gmailModifyThread(accessToken, threadId!, ["SPAM"], ["INBOX"]);
      invalidateThreadCache(email, threadId!);
      return { id, threadId, spam: true };
    } catch (error: any) {
      console.error("[reportSpam] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  // Local fallback: move to trash with a spam label
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
        labelIds: [...emails[i].labelIds.filter((l) => l !== "inbox"), "spam"],
      };
    }
  }
  await writeEmails(email, emails, { requestSource: reqSource(event) });
  const labels = recomputeUnreadCounts(emails, await readLabels(email));
  await writeLabels(email, labels, { requestSource: reqSource(event) });
  return { id: getRouterParam(event, "id"), threadId, spam: true };
});

// ─── Block sender ─────────────────────────────────────────────────────────────

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

  // If Gmail is connected, create a filter to auto-delete + report spam
  if (await isConnected(email)) {
    const acct = await resolveAccountEmail(accountEmail, email);
    const accessToken = await getAccessToken(acct);
    if (!accessToken) {
      setResponseStatus(event, 401);
      return { error: "No valid access token for account" };
    }
    try {
      const id = getRouterParam(event, "id") as string;

      // Report the entire thread as spam
      const msg = await gmailGetMessage(accessToken, id, "minimal");
      await gmailModifyThread(accessToken, msg.threadId, ["SPAM"], ["INBOX"]);
      invalidateThreadCache(email, msg.threadId);

      // Create a filter to auto-delete future emails from this sender
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
        // Filter creation may fail (permissions), but spam report still worked
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

  // Local fallback: add to blocked list + trash the thread
  const blocked = await readBlockedSenders(email);
  if (!blocked.includes(senderEmail.toLowerCase())) {
    blocked.push(senderEmail.toLowerCase());
    await writeBlockedSenders(email, blocked, {
      requestSource: reqSource(event),
    });
  }

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
        labelIds: [...emails[i].labelIds.filter((l) => l !== "inbox"), "spam"],
      };
    }
  }
  await writeEmails(email, emails, { requestSource: reqSource(event) });
  const labels = recomputeUnreadCounts(emails, await readLabels(email));
  await writeLabels(email, labels, { requestSource: reqSource(event) });
  return { id: getRouterParam(event, "id"), threadId, blocked: senderEmail };
});

// ─── Mute thread ──────────────────────────────────────────────────────────────

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
    const acct = await resolveAccountEmail(accountEmail, email);
    const accessToken = await getAccessToken(acct);
    if (!accessToken) {
      setResponseStatus(event, 401);
      return { error: "No valid access token for account" };
    }
    try {
      const threadId = getRouterParam(event, "threadId") as string;
      // Gmail "mute" = remove from inbox; future replies also skip inbox
      await gmailModifyThread(accessToken, threadId, undefined, ["INBOX"]);
      invalidateThreadCache(email, threadId);
      return { threadId, muted: true };
    } catch (error: any) {
      console.error("[muteThread] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  // Local fallback: archive all messages in thread + record as muted
  const threadId = getRouterParam(event, "threadId") as string;
  const muted = await readMutedThreads(email);
  if (!muted.includes(threadId)) {
    muted.push(threadId);
    await writeMutedThreads(email, muted, { requestSource: reqSource(event) });
  }

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

// ─── Delete permanently ───────────────────────────────────────────────────────

export const deleteEmail = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const emails = await readEmails(email);
  const filtered = emails.filter((e) => e.id !== getRouterParam(event, "id"));
  if (filtered.length === emails.length) {
    setResponseStatus(event, 404);
    return { error: "Email not found" };
  }
  await writeEmails(email, filtered, { requestSource: reqSource(event) });
  return { ok: true };
});

// ─── Send / compose ───────────────────────────────────────────────────────────

export const sendEmail = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const settings = await readSettings(email);
  const reqBody = await readBody(event);
  const { to, cc, bcc, subject, body, replyToId, accountEmail } = reqBody;

  if (!to || subject === undefined || body === undefined) {
    setResponseStatus(event, 400);
    return { error: "Missing required fields: to, subject, body" };
  }

  // Validate address-list shape after stripCrlf — guards against header
  // injection where the attacker supplies a `\r\n`-laced subject or
  // recipient and tries to smuggle Bcc/Reply-To headers into the raw email.
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
  } catch {
    setResponseStatus(event, 400);
    return { error: "One or more attachments could not be read" };
  }

  // If Gmail is connected, send via Gmail API
  if (await isConnected(email)) {
    try {
      const accountTokens = await getAccountTokens(email);
      let selectedToken = accountTokens[0]?.accessToken;
      let selectedEmail =
        (await resolveAccountEmail(accountEmail, email)) ||
        accountTokens[0]?.email ||
        "me";

      let threadId: string | undefined;
      let inReplyTo: string | undefined;
      let references: string | undefined;

      if (replyToId) {
        // Find which account owns the original message and use that for the reply
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
      }

      if (accountEmail) {
        const match = accountTokens.find((c) => c.email === accountEmail);
        if (match) {
          selectedToken = match.accessToken;
          selectedEmail = match.email;
        }
      }

      if (selectedToken) {
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

        // Bust the server-side thread cache so the next fetch shows the new
        // message. Without this, replies sent within the 5-min TTL don't
        // appear until the cache entry expires.
        if (sent.threadId) {
          invalidateThreadCache(email, sent.threadId);
        }
        invalidateListCacheForOwner(email);

        // Track contact frequency for all recipients
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

        // Emit mail.message.sent event (best-effort)
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
          // best-effort — never block the send response
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
      }
    } catch (error: any) {
      console.error("[sendEmail] Gmail API error:", error.message);
      setResponseStatus(event, 500);
      return { error: "Failed to send email via Gmail" };
    }
  }

  // Local fallback: store as sent email
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

// ─── Save draft (persistent, Gmail-style) ─────────────────────────────────────

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

  // Validate header values after stripCrlf — same protection as sendEmail.
  // Drafts go through the same buildRawEmail path so they need the same
  // header-injection guard.
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

  // If Gmail is connected, create/update a Gmail draft
  if (await isConnected(email)) {
    const acct = await resolveAccountEmail(reqBody?.accountEmail, email);
    const accessToken = await getAccessToken(acct);
    if (!accessToken) {
      setResponseStatus(event, 401);
      return { error: "No valid access token for account" };
    }
    try {
      const draftFrom = accountEmail || "me";
      const raw = buildOutgoingRawEmail({
        from: draftFrom,
        to: to || "",
        cc: cc || "",
        bcc: bcc || "",
        subject: subject || "(no subject)",
        body: body || "",
        attachments,
      });

      if (draftId) {
        // Update existing Gmail draft
        try {
          const updated = await googleFetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}`,
            accessToken,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: { raw } }),
            },
          );
          return { draftId: updated.id, updated: true };
        } catch {
          // Draft may have been deleted; create new
        }
      }
      // Create new Gmail draft
      const created = await googleFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/drafts`,
        accessToken,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: { raw } }),
        },
      );
      return { draftId: created.id, created: true };
    } catch (error: any) {
      console.error("[saveDraft] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  // Local fallback: save as EmailMessage with isDraft=true
  const emails = await readEmails(email);
  const existingIdx = draftId
    ? emails.findIndex((e) => e.id === draftId && e.isDraft)
    : -1;

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
    [existingIdx >= 0 ? "updated" : "created"]: true,
  };
});

/**
 * Build a tracking context for an outgoing message. Returns undefined when
 * both open- and click-tracking are disabled so the caller skips injection
 * entirely.
 */
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

// ─── Delete draft ─────────────────────────────────────────────────────────────

export const deleteDraft = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const id = getRouterParam(event, "id") as string;

  if (await isConnected(email)) {
    const body = await readBody(event).catch(() => ({}));
    const acct = await resolveAccountEmail(body?.accountEmail, email);
    const accessToken = await getAccessToken(acct);
    if (!accessToken) {
      setResponseStatus(event, 401);
      return { error: "No valid access token for account" };
    }
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

  // Local fallback
  const emails = await readEmails(email);
  const filtered = emails.filter((e) => !(e.id === id && e.isDraft));
  if (filtered.length !== emails.length) {
    await writeEmails(email, filtered, { requestSource: reqSource(event) });
  }
  return { ok: true };
});

// ─── Contacts (extracted from email history) ─────────────────────────────────

export type ContactEntry = { name: string; email: string; count: number };

// Contact cache: keyed by user email, TTL 10 minutes
const contactCache = new Map<
  string,
  {
    data: ContactEntry[];
    expiresAt: number;
  }
>();
const CONTACT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Load (or return cached) contacts for the given user, ranked by send/receive
 * frequency. Exposed so agent actions like `find-contact` can reuse the same
 * waterfall (saved contacts → other contacts → recent Gmail headers → local
 * fallback) without duplicating the People API calls or the cache.
 */
export async function loadContactsForEmail(
  email: string,
): Promise<ContactEntry[]> {
  const cached = contactCache.get(email);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  if (await isConnected(email)) {
    try {
      const accountTokens = await getAccountTokens(email);
      const contactMap = new Map<
        string,
        { name: string; email: string; count: number }
      >();

      for (const { accessToken } of accountTokens) {
        // Fetch saved contacts (People API connections)
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
                  existing.count += 5; // boost saved contacts
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
        }

        // Fetch "other contacts" (people you've interacted with but haven't saved)
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
        }
      }

      // Always merge in addresses from Gmail headers. People API's
      // otherContacts only surfaces senders, so people the user has emailed
      // (but who haven't replied) won't appear unless we scan sent messages.
      // We query sent first to ensure outgoing recipients are captured, then
      // fall back to a general scan when People API returned nothing (e.g.
      // missing scopes).
      const gmailQueries =
        contactMap.size === 0 ? ["in:sent", ""] : ["in:sent"];
      for (const query of gmailQueries) {
        try {
          const { messages } = await listGmailMessages(
            query,
            25,
            email,
            undefined,
            { messageFormat: "metadata" },
          );
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
                  if (
                    name &&
                    name !== addr &&
                    existing.name === existing.email
                  ) {
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
        }
      }

      // Merge SQL-tracked send frequency into contact counts
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
      contactCache.set(email, {
        data: contacts,
        expiresAt: Date.now() + CONTACT_CACHE_TTL,
      });
      return contacts;
    } catch (error: any) {
      console.error("[listContacts] error:", error.message);
      // Fall through to demo data
    }
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
  contactCache.set(email, {
    data: contacts,
    expiresAt: Date.now() + CONTACT_CACHE_TTL,
  });
  return contacts;
}

export const listContacts = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  return loadContactsForEmail(email);
});

// ─── Labels ───────────────────────────────────────────────────────────────────

export const listLabels = defineEventHandler(async (_event: H3Event) => {
  const email = await userEmail(_event);
  if (await isConnected(email)) {
    try {
      const accountTokens = await getAccountTokens(email);
      // Deduplicate by derived short-name id (not Gmail label ID)
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
      // Fetch labels from each account sequentially to avoid race conditions on the shared map
      for (const { accessToken } of accountTokens) {
        try {
          const res = await gmailListLabels(accessToken);
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
            // Use and display the full label name so Gmail nesting survives
            // import. The sidebar indents slash-delimited paths.
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
        } catch {}
      }
      const labels: Label[] = Array.from(labelMap.values());

      // Normalize Gmail category labels with friendly names
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
          // Fix casing (Gmail returns "IMPORTANT", we want "Important")
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
    } catch {}
  }
  return readLabels(email);
});

// ─── Settings ─────────────────────────────────────────────────────────────────

export const getSettings = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  return readSettings(email);
});

export const updateSettings = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const current = await readSettings(email);
  const body = await readBody(event);
  const updated = {
    ...current,
    ...body,
    ...(body.signature !== undefined
      ? { signature: normalizeSignature(body.signature) }
      : {}),
  };
  await putUserSetting(
    email,
    "mail-settings",
    updated as Record<string, unknown>,
    { requestSource: reqSource(event) },
  );
  return updated;
});

// ─── Calendar RSVP ───────────────────────────────────────────────────────────

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

  try {
    const acct = await resolveAccountEmail(accountEmail, email);
    const accessToken = await getAccessToken(acct);
    if (!accessToken) {
      setResponseStatus(event, 401);
      return { error: "Google account not found" };
    }

    const calId = calendarId || "primary";

    // Get the event first to preserve existing data
    const calEvent = await calendarGetEvent(accessToken, calId, eventId);
    if (!calEvent) {
      setResponseStatus(event, 404);
      return { error: "Event not found" };
    }

    // Find the current user's attendee entry and update their response
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
      // Add self as attendee with the response
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

// ─── Unsubscribe ─────────────────────────────────────────────────────────────

export const unsubscribeEmail = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const body = ((await readBody(event).catch(() => ({}))) ?? {}) as {
    accountEmail?: string;
  };

  if (!(await isConnected(email))) {
    setResponseStatus(event, 400);
    return { error: "No connected account" };
  }

  const acct = await resolveAccountEmail(body.accountEmail, email);
  const accessToken = await getAccessToken(acct);
  if (!accessToken) {
    setResponseStatus(event, 401);
    return { error: "No valid access token" };
  }

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

    // Extract URLs from the header
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

    // Try RFC 8058 one-click unsubscribe first.
    //
    // SSRF: the URL comes from an inbound email's `List-Unsubscribe` header
    // — fully attacker-controlled. Without this guard a phishing email can
    // make the production server POST to AWS IMDS (`http://169.254.169.254/`),
    // localhost loopback, or internal cluster services and exfiltrate cloud
    // creds / hit authenticated internal endpoints.
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
          // Don't echo the URL — that would let an attacker probe via the
          // error response to map internal infrastructure.
          setResponseStatus(event, 400);
          return { error: "Unsubscribe URL is not allowed" };
        }
        // One-click failed, fall through to other methods
        console.warn("[unsubscribe] one-click POST failed:", e.message);
      }
    }

    // Try mailto unsubscribe
    if (mailto) {
      try {
        // Parse mailto for optional subject/body
        const [address, query] = mailto.split("?");
        const params = new URLSearchParams(query || "");
        const subject = params.get("subject") || "Unsubscribe";
        const bodyText = params.get("body") || "";

        // CRLF-strip every header value flowing into the raw RFC 2822
        // message — the address/subject/body all come from inbound email
        // headers and are attacker-controlled. Without this an unsubscribe
        // mailto URI of `mailto:victim@target?subject=Hi%0D%0ABcc:attacker`
        // injects a Bcc through the user's connected Gmail account.
        const safeAddress = stripCrlf(address || "");
        const safeSubject = stripCrlf(subject);

        // Build RFC 2822 email
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

    // Return the URL for the client to open manually
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
