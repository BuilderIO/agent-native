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
import type { EmailMessage, Label, UserSettings } from "@shared/types.js";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { readBody, getSession } from "@agent-native/core/server";
import {
  getOAuthTokens,
  saveOAuthTokens,
  listOAuthAccounts,
  listOAuthAccountsByOwner,
  setOAuthDisplayName,
} from "@agent-native/core/oauth-tokens";
import {
  createOAuth2Client,
  gmailGetMessage,
  gmailGetThread,
  gmailListLabels,
  gmailModifyMessage,
  gmailModifyThread,
  gmailSendMessage,
  gmailTrashThread,
  gmailUntrashThread,
  googleFetch,
  peopleListConnections,
  peopleListOtherContacts,
  calendarGetEvent,
  calendarPatchEvent,
} from "../lib/google-api.js";
import {
  isConnected,
  listGmailMessages,
  gmailToEmailMessage,
  getAccountDisplayName,
  setAccountDisplayName,
} from "../lib/google-auth.js";
import {
  incrementSendFrequency,
  getContactFrequencyMap,
} from "../lib/contact-frequency.js";
import { emit } from "@agent-native/core/event-bus";
import { getSyntheticEmailsForView, getSnoozedThreadIds } from "../lib/jobs.js";
import {
  collectLinks,
  injectTrackingIntoHtml,
  newClickToken,
  newPixelToken,
  persistTracking,
  type TrackingContext,
} from "../lib/email-tracking.js";
import { getAppProductionUrl } from "@agent-native/core/server";

// ---------------------------------------------------------------------------
// Label map cache — avoids re-fetching label names from Gmail on every request
// ---------------------------------------------------------------------------

const labelMapCache = new Map<
  string,
  { map: Map<string, string>; expiresAt: number }
>();
const LABEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// In-memory cache for fully-fetched thread messages. Keyed by
// `${ownerEmail}:${threadId}` so different users don't share entries.
// Keeps prefetches and repeat opens from hammering the Gmail API (which
// tripped the per-minute quota and made every navigation feel slow).
const threadMessagesCache = new Map<
  string,
  { messages: EmailMessage[]; expiresAt: number }
>();
const THREAD_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function threadCacheKey(ownerEmail: string, threadId: string) {
  return `${ownerEmail}:${threadId}`;
}

export function invalidateThreadCache(ownerEmail: string, threadId: string) {
  threadMessagesCache.delete(threadCacheKey(ownerEmail, threadId));
}

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
      const clientId = process.env.GOOGLE_CLIENT_ID!;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
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
  theme: "dark",
  density: "comfortable",
  previewPane: "right",
  sendAndArchive: false,
  undoSendDelay: 5,
  tracking: { opens: true, clicks: false },
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
    return { ...DEFAULT_SETTINGS, ...(data as any) } as UserSettings;
  }
  return { ...DEFAULT_SETTINGS };
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

// ─── Email list ───────────────────────────────────────────────────────────────

export const listEmails = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const {
    view = "inbox",
    q,
    label,
  } = getQuery(event) as {
    view?: string;
    q?: string;
    label?: string;
  };

  if (view === "snoozed" || view === "scheduled") {
    let emails = await getSyntheticEmailsForView(email, view);
    if (q) {
      const query = q.toLowerCase();
      emails = emails.filter(
        (message) =>
          message.subject.toLowerCase().includes(query) ||
          message.snippet.toLowerCase().includes(query) ||
          message.from.name.toLowerCase().includes(query) ||
          message.from.email.toLowerCase().includes(query) ||
          message.body.toLowerCase().includes(query),
      );
    }
    return { emails };
  }

  // If Google is connected, fetch from Gmail directly (skip demo data)
  if (await isConnected(email)) {
    try {
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

      // Map view to Gmail search query
      const gmailQuery: Record<string, string> = {
        inbox: "in:inbox",
        unread: "is:unread in:inbox",
        starred: "is:starred",
        sent: "in:sent",
        drafts: "in:drafts",
        archive: "-in:inbox -in:sent -in:drafts -in:trash",
        trash: "in:trash",
        all: "",
      };
      let searchQuery: string;
      if (q) {
        // Gmail's plain search already matches subject, body, sender name,
        // sender address, recipient, and Cc. A prior `{from:(q) to:(q) cc:(q) q}`
        // wrapper silently dropped results (e.g. the user's own "SPMB Status
        // Update 4/17" thread) — Gmail parses the braces in surprising ways
        // when mixed with field qualifiers and bare terms.
        searchQuery = q;
      } else {
        searchQuery = gmailQuery[view] ?? `label:${view}`;
      }
      // If a specific label filter is active (e.g. a pinned label tab), scope
      // the Gmail query server-side. gmailToEmailMessage normalizes Gmail's
      // CATEGORY_* labels into friendly IDs like "updates"/"promotions" and
      // synthesizes virtual IDs like "note-to-self" (self-sent mail). Translate
      // those back into the right Gmail search operator — plain `label:updates`
      // doesn't match the Updates category.
      if (label) {
        let labelClause = "";
        const id = label.toLowerCase();
        const categoryIds = new Set([
          "personal",
          "social",
          "updates",
          "promotions",
          "forums",
        ]);
        if (categoryIds.has(id)) {
          // Gmail normalizes CATEGORY_PERSONAL → "personal" on the client, but
          // its search operator for the Primary tab is `category:primary`.
          labelClause = `category:${id === "personal" ? "primary" : id}`;
        } else if (id === "important") {
          labelClause = "is:important";
        } else if (id === "note-to-self") {
          // "Note to self" is synthesized client-side for self-sent mail that
          // still landed in the inbox. Gmail has no such label — match by
          // sender (each account's `from:me` resolves per-account).
          labelClause = "from:me";
        } else {
          // User-created label: Gmail's `label:` operator wants the display
          // name with spaces replaced by hyphens; nested labels use `/`.
          labelClause = `label:${label.replace(/\s+/g, "-")}`;
        }
        searchQuery = searchQuery
          ? `${searchQuery} ${labelClause}`
          : labelClause;
      }

      // Fetch label name mapping from all accounts (cached)
      const accountTokens = await getAccountTokens(email);
      const labelMap = await getCachedLabelMap(accountTokens);
      const { messages, errors, nextPageTokens, resultSizeEstimate } =
        await listGmailMessages(searchQuery, undefined, email, pageTokens);
      if (messages.length === 0 && errors.length > 0) {
        // All accounts failed — surface as error
        setResponseStatus(event, 502);
        return {
          error: errors.map((e) => `${e.email}: ${e.error}`).join("; "),
        };
      }
      let emails = messages.map((m) =>
        gmailToEmailMessage(m, undefined, labelMap),
      );
      emails.sort(
        (a: any, b: any) =>
          new Date(b.date).getTime() - new Date(a.date).getTime(),
      );

      // Filter out snoozed emails (they may linger in Gmail due to eventual consistency).
      // Skip when searching — the user wants to find snoozed emails too.
      if (!q && (view === "inbox" || view === "unread")) {
        const snoozedIds = await getSnoozedThreadIds(email);
        if (snoozedIds.size > 0) {
          emails = emails.filter(
            (e) => !snoozedIds.has(e.threadId) && !snoozedIds.has(e.id),
          );
        }
      }

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
          !e.isRead && !e.isArchived && !e.isTrashed && !e.isDraft && !e.isSent,
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

  // Full-text search
  if (q) {
    const query = q.toLowerCase();
    emails = emails.filter(
      (e) =>
        e.subject.toLowerCase().includes(query) ||
        e.snippet.toLowerCase().includes(query) ||
        e.from.name.toLowerCase().includes(query) ||
        e.from.email.toLowerCase().includes(query) ||
        e.body.toLowerCase().includes(query),
    );
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

  return { emails };
});

// ─── Thread messages ─────────────────────────────────────────────────────────

export const getThreadMessages = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const threadId = getRouterParam(event, "threadId") as string;

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
      const labelMap = await getCachedLabelMap(accountTokens);

      // Search across all accounts for messages in this thread
      for (const { email: acctEmail, accessToken } of accountTokens) {
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
      if (accountTokens.length > 0) {
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

// ─── Mark read ────────────────────────────────────────────────────────────────

export const markRead = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const body = ((await readBody(event).catch(() => ({}))) ?? {}) as {
    isRead?: boolean;
    accountEmail?: string;
  };
  const { isRead, accountEmail } = body;

  if (await isConnected(email)) {
    const acct = await resolveAccountEmail(accountEmail, email);
    const accessToken = await getAccessToken(acct);
    if (!accessToken) {
      setResponseStatus(event, 401);
      return { error: "No valid access token for account" };
    }
    try {
      const id = getRouterParam(event, "id") as string;
      await gmailModifyMessage(
        accessToken,
        id,
        isRead ? undefined : ["UNREAD"],
        isRead ? ["UNREAD"] : undefined,
      );
      return { id, isRead };
    } catch (error: any) {
      console.error("[markRead] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  const emails = await readEmails(email);
  const idx = emails.findIndex((e) => e.id === getRouterParam(event, "id"));
  if (idx === -1) {
    setResponseStatus(event, 404);
    return { error: "Email not found" };
  }

  emails[idx] = { ...emails[idx], isRead };
  await writeEmails(email, emails, { requestSource: reqSource(event) });

  const labels = recomputeUnreadCounts(emails, await readLabels(email));
  await writeLabels(email, labels, { requestSource: reqSource(event) });

  return emails[idx];
});

// ─── Toggle star ──────────────────────────────────────────────────────────────

export const toggleStar = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const body = ((await readBody(event).catch(() => ({}))) ?? {}) as {
    isStarred?: boolean;
  };
  const { isStarred } = body;
  const emails = await readEmails(email);
  const idx = emails.findIndex((e) => e.id === getRouterParam(event, "id"));
  if (idx === -1) {
    setResponseStatus(event, 404);
    return { error: "Email not found" };
  }

  emails[idx] = { ...emails[idx], isStarred };
  await writeEmails(email, emails, { requestSource: reqSource(event) });
  return emails[idx];
});

// ─── Archive ──────────────────────────────────────────────────────────────────

export const archiveEmail = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const body = await readBody(event);
  if (await isConnected(email)) {
    const acct = await resolveAccountEmail(body?.accountEmail, email);
    const accessToken = await getAccessToken(acct);
    if (!accessToken) {
      setResponseStatus(event, 401);
      return { error: "No valid access token for account" };
    }
    try {
      const id = getRouterParam(event, "id") as string;
      const msg = await gmailGetMessage(accessToken, id, "minimal");
      // Remove INBOX + the current label (if archiving from a label view)
      const removeLabels = ["INBOX"];
      if (body?.removeLabel) {
        // Gmail label IDs for user labels are the label name or a Label_N id
        const labelId = msg.labelIds?.find(
          (l: string) =>
            l === body.removeLabel ||
            l.toLowerCase() === body.removeLabel.toLowerCase(),
        );
        if (labelId && !removeLabels.includes(labelId)) {
          removeLabels.push(labelId);
        }
      }
      await gmailModifyThread(
        accessToken,
        msg.threadId,
        undefined,
        removeLabels,
      );
      invalidateThreadCache(email, msg.threadId);
      return { id, threadId: msg.threadId, isArchived: true };
    } catch (error: any) {
      console.error("[archiveEmail] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  const emails = await readEmails(email);
  const target = emails.find((e) => e.id === getRouterParam(event, "id"));
  if (!target) {
    setResponseStatus(event, 404);
    return { error: "Email not found" };
  }

  // Archive all messages in the thread, not just the one
  const threadId = target.threadId || target.id;
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

  return { id: getRouterParam(event, "id"), threadId, isArchived: true };
});

// ─── Unarchive ───────────────────────────────────────────────────────────────

export const unarchiveEmail = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const body = await readBody(event);
  if (await isConnected(email)) {
    const acct = await resolveAccountEmail(body?.accountEmail, email);
    const accessToken = await getAccessToken(acct);
    if (!accessToken) {
      setResponseStatus(event, 401);
      return { error: "No valid access token for account" };
    }
    try {
      const id = getRouterParam(event, "id") as string;
      const msg = await gmailGetMessage(accessToken, id, "minimal");
      await gmailModifyThread(accessToken, msg.threadId, ["INBOX"]);
      invalidateThreadCache(email, msg.threadId);
      return { id, threadId: msg.threadId, isArchived: false };
    } catch (error: any) {
      console.error("[unarchiveEmail] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  const emails = await readEmails(email);
  const target = emails.find((e) => e.id === getRouterParam(event, "id"));
  if (!target) {
    setResponseStatus(event, 404);
    return { error: "Email not found" };
  }

  // Unarchive all messages in the thread
  const threadId = target.threadId || target.id;
  for (let i = 0; i < emails.length; i++) {
    const eid = emails[i].threadId || emails[i].id;
    if (eid === threadId) {
      emails[i] = {
        ...emails[i],
        isArchived: false,
        labelIds: emails[i].labelIds.includes("inbox")
          ? emails[i].labelIds
          : ["inbox", ...emails[i].labelIds],
      };
    }
  }
  await writeEmails(email, emails, { requestSource: reqSource(event) });

  const labels = recomputeUnreadCounts(emails, await readLabels(email));
  await writeLabels(email, labels, { requestSource: reqSource(event) });

  return { id: getRouterParam(event, "id"), threadId, isArchived: false };
});

// ─── Trash ────────────────────────────────────────────────────────────────────

export const trashEmail = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const body = await readBody(event);
  if (await isConnected(email)) {
    const acct = await resolveAccountEmail(body?.accountEmail, email);
    const accessToken = await getAccessToken(acct);
    if (!accessToken) {
      setResponseStatus(event, 401);
      return { error: "No valid access token for account" };
    }
    try {
      const id = getRouterParam(event, "id") as string;
      const msg = await gmailGetMessage(accessToken, id, "minimal");
      await gmailTrashThread(accessToken, msg.threadId);
      invalidateThreadCache(email, msg.threadId);
      return { id, threadId: msg.threadId, isTrashed: true };
    } catch (error: any) {
      console.error("[trashEmail] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  const emails = await readEmails(email);
  const target = emails.find((e) => e.id === getRouterParam(event, "id"));
  if (!target) {
    setResponseStatus(event, 404);
    return { error: "Email not found" };
  }

  // Trash all messages in the thread
  const threadId = target.threadId || target.id;
  for (let i = 0; i < emails.length; i++) {
    const eid = emails[i].threadId || emails[i].id;
    if (eid === threadId) {
      emails[i] = { ...emails[i], isTrashed: true, isArchived: false };
    }
  }
  await writeEmails(email, emails, { requestSource: reqSource(event) });

  const labels = recomputeUnreadCounts(emails, await readLabels(email));
  await writeLabels(email, labels, { requestSource: reqSource(event) });

  return { id: getRouterParam(event, "id"), threadId, isTrashed: true };
});

// ─── Untrash ─────────────────────────────────────────────────────────────────

export const untrashEmail = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const body = await readBody(event);
  if (await isConnected(email)) {
    const acct = await resolveAccountEmail(body?.accountEmail, email);
    const accessToken = await getAccessToken(acct);
    if (!accessToken) {
      setResponseStatus(event, 401);
      return { error: "No valid access token for account" };
    }
    try {
      const id = getRouterParam(event, "id") as string;
      const msg = await gmailGetMessage(accessToken, id, "minimal");
      await gmailUntrashThread(accessToken, msg.threadId);
      invalidateThreadCache(email, msg.threadId);
      return { id, threadId: msg.threadId, isTrashed: false };
    } catch (error: any) {
      console.error("[untrashEmail] Gmail error:", error.message);
      setResponseStatus(event, 500);
      return { error: error.message };
    }
  }

  const emails = await readEmails(email);
  const target = emails.find((e) => e.id === getRouterParam(event, "id"));
  if (!target) {
    setResponseStatus(event, 404);
    return { error: "Email not found" };
  }

  // Untrash all messages in the thread
  const threadId = target.threadId || target.id;
  for (let i = 0; i < emails.length; i++) {
    const eid = emails[i].threadId || emails[i].id;
    if (eid === threadId) {
      emails[i] = {
        ...emails[i],
        isTrashed: false,
        labelIds: emails[i].labelIds.includes("inbox")
          ? emails[i].labelIds
          : ["inbox", ...emails[i].labelIds],
      };
    }
  }
  await writeEmails(email, emails, { requestSource: reqSource(event) });

  const labels = recomputeUnreadCounts(emails, await readLabels(email));
  await writeLabels(email, labels, { requestSource: reqSource(event) });

  return { id: getRouterParam(event, "id"), threadId, isTrashed: false };
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
      await gmailModifyThread(accessToken, threadId, ["SPAM"], ["INBOX"]);
      invalidateThreadCache(email, threadId);
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
  const { to, cc, bcc, subject, body, replyToId, accountEmail } =
    await readBody(event);

  if (!to || subject === undefined || body === undefined) {
    setResponseStatus(event, 400);
    return { error: "Missing required fields: to, subject, body" };
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
        // Fetch the sender's display name from Gmail send-as settings,
        // falling back to Google profile name
        let fromHeader = selectedEmail;
        try {
          const sendAs = await googleFetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs`,
            selectedToken,
          );
          const match = sendAs?.sendAs?.find(
            (s: any) =>
              s.sendAsEmail?.toLowerCase() === selectedEmail.toLowerCase(),
          );
          if (match?.displayName) {
            fromHeader = `${match.displayName} <${selectedEmail}>`;
          }
        } catch {
          // Fall back to profile name below
        }
        // If sendAs didn't have a display name, try Google profile
        if (fromHeader === selectedEmail) {
          try {
            const profile = await googleFetch(
              `https://www.googleapis.com/oauth2/v2/userinfo`,
              selectedToken,
            );
            if (profile?.name) {
              fromHeader = `${profile.name} <${selectedEmail}>`;
            }
          } catch {
            // Fall back to email-only
          }
        }

        const tracking = buildTrackingContext(event, body || "", settings);

        const raw = buildRawEmail({
          from: fromHeader,
          to: to || "",
          cc: cc || "",
          bcc: bcc || "",
          subject: subject || "(no subject)",
          body: body || "",
          inReplyTo,
          references,
          tracking,
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
    snippet: body.slice(0, 120).replace(/\n/g, " "),
    body,
    bodyHtml: bodyToHtml(body),
    date: new Date().toISOString(),
    isRead: true,
    isStarred: false,
    isSent: true,
    isArchived: false,
    isTrashed: false,
    labelIds: ["sent"],
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
  const { to, cc, bcc, subject, body, draftId, replyToId, replyToThreadId } =
    reqBody;

  // If Gmail is connected, create/update a Gmail draft
  if (await isConnected(email)) {
    const acct = await resolveAccountEmail(reqBody?.accountEmail, email);
    const accessToken = await getAccessToken(acct);
    if (!accessToken) {
      setResponseStatus(event, 401);
      return { error: "No valid access token for account" };
    }
    try {
      const draftFrom = reqBody?.accountEmail || "me";
      const raw = buildRawEmail({
        from: draftFrom,
        to: to || "",
        cc: cc || "",
        bcc: bcc || "",
        subject: subject || "(no subject)",
        body: body || "",
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
    snippet: (body || "").slice(0, 120).replace(/\n/g, " "),
    body: body || "",
    bodyHtml: bodyToHtml(body || ""),
    date: new Date().toISOString(),
    isRead: true,
    isStarred: false,
    isDraft: true,
    isArchived: false,
    isTrashed: false,
    labelIds: ["drafts"],
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

/** Build RFC 2822 raw email for Gmail API */
function buildRawEmail(opts: {
  from: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  tracking?: TrackingContext;
}): string {
  const boundary = `agent-native-${nanoid(12)}`;
  const textBody = markdownToPlainText(opts.body);
  const htmlBody = bodyToHtml(opts.body, opts.tracking);
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    ...(opts.cc ? [`Cc: ${opts.cc}`] : []),
    ...(opts.bcc ? [`Bcc: ${opts.bcc}`] : []),
    `Subject: ${opts.subject}`,
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
    ...(opts.references ? [`References: ${opts.references}`] : []),
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    textBody,
    "",
    `--${boundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    "",
    htmlBody,
    "",
    `--${boundary}--`,
  ];
  // Gmail API expects URL-safe base64
  return Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applyInlineMarkdown(text: string): string {
  return text
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_match, label, url) =>
        `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
    )
    .replace(
      /(?<!["(>])(https?:\/\/[^\s<]+)/g,
      (url) =>
        `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`,
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function markdownToHtml(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "<div></div>";

  const blocks = normalized.split(/\n{2,}/).map((block) => block.trim());
  const html = blocks
    .map((block) => {
      if (block.startsWith("```") && block.endsWith("```")) {
        const code = block.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "");
        return `<pre><code>${escapeHtml(code)}</code></pre>`;
      }

      const heading = block.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        return `<h${level}>${applyInlineMarkdown(escapeHtml(heading[2]))}</h${level}>`;
      }

      if (/^(\-|\*|\+)\s+/m.test(block)) {
        const items = block
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.replace(/^(\-|\*|\+)\s+/, ""))
          .map((line) => `<li>${applyInlineMarkdown(escapeHtml(line))}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }

      if (/^\d+\.\s+/m.test(block)) {
        const items = block
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.replace(/^\d+\.\s+/, ""))
          .map((line) => `<li>${applyInlineMarkdown(escapeHtml(line))}</li>`)
          .join("");
        return `<ol>${items}</ol>`;
      }

      return `<p>${applyInlineMarkdown(escapeHtml(block)).replace(/\n/g, "<br />")}</p>`;
    })
    .join("");

  return `<div>${html}</div>`;
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, "$1$2")
    .trim();
}

/**
 * Split a compose body at the reply/forward quote separator.
 * Returns null for non-reply bodies (no separator found).
 */
function splitReplyQuote(body: string): {
  newContent: string;
  attribution: string;
  quotedBody: string;
} | null {
  const replyMatch = body.match(/\n*— On (.+? wrote):\n/);
  const fwdMatch = body.match(/\n*(— Forwarded message —)\n/);
  const match = replyMatch || fwdMatch;
  if (!match || match.index === undefined) return null;

  const newContent = body.slice(0, match.index);
  const attribution = replyMatch ? `On ${match[1]}:` : "Forwarded message";
  const afterSeparator = body.slice(match.index + match[0].length);
  return { newContent, attribution, quotedBody: afterSeparator };
}

/**
 * Convert quoted content into Gmail-compatible HTML blockquote.
 * Strips leading `> ` prefixes from each line before converting to HTML.
 */
function quotedContentToHtml(attribution: string, quotedBody: string): string {
  const stripped = quotedBody
    .split("\n")
    .map((line) => {
      if (line.startsWith("> ")) return line.slice(2);
      if (line === ">") return "";
      return line;
    })
    .join("\n");
  const innerHtml = markdownToHtml(stripped);
  return (
    `<div class="gmail_quote" style="margin-top:2.5em">` +
    `<div class="gmail_attr">${escapeHtml(attribution)}</div>` +
    `<blockquote class="gmail_quote" style="margin:0 0 0 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">` +
    innerHtml +
    `</blockquote></div>`
  );
}

/**
 * Convert a compose body to HTML, properly formatting reply/forward quotes
 * with Gmail-compatible blockquote structure so email clients can clip them.
 */
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
  const trackOpens = settings.tracking?.opens !== false;
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

function bodyToHtml(body: string, tracking?: TrackingContext): string {
  const split = splitReplyQuote(body);
  if (split) {
    const newHtml = markdownToHtml(split.newContent);
    const injected = tracking
      ? injectTrackingIntoHtml(newHtml, tracking)
      : newHtml;
    const quoteHtml = quotedContentToHtml(split.attribution, split.quotedBody);
    return injected + quoteHtml;
  }
  const html = markdownToHtml(body);
  return tracking ? injectTrackingIntoHtml(html, tracking) : html;
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

// Contact cache: keyed by user email, TTL 10 minutes
const contactCache = new Map<
  string,
  {
    data: Array<{ name: string; email: string; count: number }>;
    expiresAt: number;
  }
>();
const CONTACT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export const listContacts = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);

  // Return cached contacts if fresh
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
          const { messages } = await listGmailMessages(query, 100, email);
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
        { id: string; name: string; type: "system" | "user" }
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
            // Use the full label name (preserving hierarchy) as the id,
            // but display the short name (last segment, underscores -> spaces)
            const fullId = name.toLowerCase().replace(/_/g, " ");
            let shortName = name;
            const lastSlash = shortName.lastIndexOf("/");
            if (lastSlash >= 0) shortName = shortName.slice(lastSlash + 1);
            shortName = shortName.replace(/_/g, " ");
            if (!labelMap.has(fullId)) {
              labelMap.set(fullId, {
                id: fullId,
                name: shortName,
                type: isSystem ? ("system" as const) : ("user" as const),
              });
            }
          }
        } catch {}
      }
      const labels: Label[] = Array.from(labelMap.values()).map((l) => ({
        ...l,
        unreadCount: 0,
      }));

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
          labels.push({ id, name, type: "system", unreadCount: 0 });
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
  const updated = { ...current, ...body };
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

    // Try RFC 8058 one-click unsubscribe first
    if (oneClick && url) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "List-Unsubscribe=One-Click",
        });
        return { ok: true, method: "one-click", status: res.status, url };
      } catch (e: any) {
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

        // Build RFC 2822 email
        const raw = Buffer.from(
          `To: ${address}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${bodyText}`,
        )
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        await gmailSendMessage(accessToken, raw);
        return { ok: true, method: "mailto", address, url };
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
