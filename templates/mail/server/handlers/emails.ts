import {
  defineEventHandler,
  getQuery,
  readBody,
  getRouterParam,
  getHeader,
  setResponseStatus,
  setResponseHeader,
  type H3Event,
} from "h3";
import { nanoid } from "nanoid";
import type { EmailMessage, Label, UserSettings } from "@shared/types.js";
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { getSession } from "@agent-native/core/server";
import {
  getOAuthTokens,
  saveOAuthTokens,
  listOAuthAccounts,
  listOAuthAccountsByOwner,
} from "@agent-native/core/oauth-tokens";
import {
  createOAuth2Client,
  gmailGetMessage,
  gmailGetThread,
  gmailListLabels,
  gmailModifyMessage,
  gmailModifyThread,
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
} from "../lib/google-auth.js";
import { getSyntheticEmailsForView } from "../lib/jobs.js";

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
        "http://localhost:8080/api/google/callback",
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
 * Get access tokens for accounts. When `forEmail` is provided, returns only
 * that user's accounts (multi-user mode). Otherwise returns all (legacy).
 */
async function getAccountTokens(
  forEmail?: string,
): Promise<Array<{ email: string; accessToken: string }>> {
  const accounts = forEmail
    ? await listOAuthAccountsByOwner("google", forEmail)
    : await listOAuthAccounts("google");

  const results: Array<{ email: string; accessToken: string }> = [];

  for (const account of accounts) {
    const token = await getAccessToken(account.accountId);
    if (token) {
      results.push({ email: account.accountId, accessToken: token });
    }
  }

  return results;
}

/** Extract the logged-in user's email from the request session. */
async function userEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  return session?.email ?? "local@localhost";
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
  const { view = "inbox", q } = getQuery(event) as {
    view?: string;
    q?: string;
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
    return emails;
  }

  // If Google is connected, fetch from Gmail directly (skip demo data)
  if (await isConnected(email)) {
    try {
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
        // Search across all mail, not scoped to current view
        searchQuery = q;
      } else {
        searchQuery = gmailQuery[view] ?? `label:${view}`;
      }

      // Fetch label name mapping from all accounts
      const accountTokens = await getAccountTokens(email);
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
          } catch (err: any) {
            console.error(
              "[listEmails] Failed to fetch label map:",
              err?.message,
            );
          }
        }),
      );
      const { messages, errors } = await listGmailMessages(
        searchQuery,
        undefined,
        email,
      );
      if (messages.length === 0 && errors.length > 0) {
        // All accounts failed — surface as error
        setResponseStatus(event, 502);
        return {
          error: errors.map((e) => `${e.email}: ${e.error}`).join("; "),
        };
      }
      const emails = messages.map((m) =>
        gmailToEmailMessage(m, undefined, labelMap),
      );
      emails.sort(
        (a: any, b: any) =>
          new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
      // If some accounts failed but others succeeded, add warning header
      if (errors.length > 0) {
        setResponseHeader(event, "X-Account-Errors", JSON.stringify(errors));
      }
      return emails;
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

  // Sort by date descending
  emails.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  return emails;
});

// ─── Thread messages ─────────────────────────────────────────────────────────

export const getThreadMessages = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const threadId = getRouterParam(event, "threadId") as string;

  if (await isConnected(email)) {
    try {
      const accountTokens = await getAccountTokens(email);
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
    for (const { email: acctEmail, accessToken } of accountTokens) {
      try {
        const labelRes = await gmailListLabels(accessToken);
        const labelMap = new Map<string, string>();
        for (const label of labelRes.labels || []) {
          if (label.id && label.name) {
            labelMap.set(label.id, label.name);
          }
        }
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
    const acct = accountEmail || email;
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
    const acct = body?.accountEmail || email;
    const accessToken = await getAccessToken(acct);
    if (!accessToken) {
      setResponseStatus(event, 401);
      return { error: "No valid access token for account" };
    }
    try {
      const id = getRouterParam(event, "id") as string;
      const msg = await gmailGetMessage(accessToken, id, "minimal");
      await gmailModifyThread(accessToken, msg.threadId, undefined, ["INBOX"]);
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
    const acct = body?.accountEmail || email;
    const accessToken = await getAccessToken(acct);
    if (!accessToken) {
      setResponseStatus(event, 401);
      return { error: "No valid access token for account" };
    }
    try {
      const id = getRouterParam(event, "id") as string;
      const msg = await gmailGetMessage(accessToken, id, "minimal");
      await gmailModifyThread(accessToken, msg.threadId, ["INBOX"]);
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
    const acct = body?.accountEmail || email;
    const accessToken = await getAccessToken(acct);
    if (!accessToken) {
      setResponseStatus(event, 401);
      return { error: "No valid access token for account" };
    }
    try {
      const id = getRouterParam(event, "id") as string;
      const msg = await gmailGetMessage(accessToken, id, "minimal");
      await gmailTrashThread(accessToken, msg.threadId);
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
    const acct = body?.accountEmail || email;
    const accessToken = await getAccessToken(acct);
    if (!accessToken) {
      setResponseStatus(event, 401);
      return { error: "No valid access token for account" };
    }
    try {
      const id = getRouterParam(event, "id") as string;
      const msg = await gmailGetMessage(accessToken, id, "minimal");
      await gmailUntrashThread(accessToken, msg.threadId);
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
    const acct = accountEmail || email;
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
    const acct = accountEmail || email;
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
    const acct = accountEmail || email;
    const accessToken = await getAccessToken(acct);
    if (!accessToken) {
      setResponseStatus(event, 401);
      return { error: "No valid access token for account" };
    }
    try {
      const threadId = getRouterParam(event, "threadId") as string;
      // Gmail "mute" = remove from inbox; future replies also skip inbox
      await gmailModifyThread(accessToken, threadId, undefined, ["INBOX"]);
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
      let selectedEmail = accountEmail || accountTokens[0]?.email || "me";

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
        // Fetch the sender's display name from Gmail send-as settings
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
          // Fall back to email-only if settings fetch fails
        }

        const raw = buildRawEmail({
          from: fromHeader,
          to: to || "",
          cc: cc || "",
          bcc: bcc || "",
          subject: subject || "(no subject)",
          body: body || "",
          inReplyTo,
          references,
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
    bodyHtml: markdownToHtml(body),
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
    const acct = reqBody?.accountEmail || email;
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
    bodyHtml: markdownToHtml(body || ""),
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
}): string {
  const boundary = `agent-native-${nanoid(12)}`;
  const textBody = markdownToPlainText(opts.body);
  const htmlBody = markdownToHtml(opts.body);
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

// ─── Delete draft ─────────────────────────────────────────────────────────────

export const deleteDraft = defineEventHandler(async (event: H3Event) => {
  const email = await userEmail(event);
  const id = getRouterParam(event, "id") as string;

  if (await isConnected(email)) {
    const body = await readBody(event).catch(() => ({}));
    const acct = body?.accountEmail || email;
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

      // If People API returned nothing (e.g. missing scopes), extract from Gmail
      if (contactMap.size === 0) {
        try {
          const { messages } = await listGmailMessages("", 100, email);
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
          console.error("[listContacts] Gmail fallback error:", err.message);
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
    const acct = accountEmail || email;
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
