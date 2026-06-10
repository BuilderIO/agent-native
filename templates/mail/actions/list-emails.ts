import { defineAction } from "@agent-native/core";
import { getUserSetting } from "@agent-native/core/settings";
import { getRequestUserEmail, buildDeepLink } from "@agent-native/core/server";
import {
  getClients,
  DEFAULT_THREAD_RECENT_MESSAGE_CANDIDATE_LIMIT,
  listGmailMessages,
  gmailToEmailMessage,
  fetchGmailLabelMap,
  isConnected,
} from "../server/lib/google-auth.js";
import {
  buildGmailEmailSearchQuery,
  filterInboxScopedThreadMessages,
} from "../server/lib/gmail-query.js";
import { getSyntheticEmailsForView } from "../server/lib/jobs.js";
import { emailMessageMatchesSearch } from "@shared/search.js";
import { z } from "zod";

const cliBoolean = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

function toCompact(emails: any[]): any[] {
  return emails.map((e) => ({
    id: e.id,
    threadId: e.threadId,
    from: e.from?.name
      ? `${e.from.name} <${e.from.email}>`
      : (e.from?.email ?? e.from),
    subject: e.subject,
    snippet: e.snippet,
    date: e.date,
    isRead: e.isRead,
    hasUnread: e.hasUnread ?? !e.isRead,
    unreadCount: e.unreadCount,
    messageCount: e.messageCount,
    isStarred: e.isStarred,
    accountEmail: e.accountEmail,
  }));
}

function latestPerThread(emails: any[]): any[] {
  const byThread = new Map<
    string,
    {
      latest: any;
      hasUnread: boolean;
      unreadCount: number;
      messageCount: number;
    }
  >();
  for (const email of emails) {
    const key = `${email.accountEmail ?? ""}:${email.threadId || email.id}`;
    const existing = byThread.get(key);
    if (!existing) {
      byThread.set(key, {
        latest: email,
        hasUnread: !email.isRead,
        unreadCount: email.isRead ? 0 : 1,
        messageCount: 1,
      });
      continue;
    }
    existing.messageCount += 1;
    if (!email.isRead) {
      existing.hasUnread = true;
      existing.unreadCount += 1;
    }
    if (
      new Date(email.date).getTime() > new Date(existing.latest.date).getTime()
    ) {
      existing.latest = email;
    }
  }
  return Array.from(byThread.values())
    .map(({ latest, hasUnread, unreadCount, messageCount }) => ({
      ...latest,
      isRead: !hasUnread,
      hasUnread,
      unreadCount,
      messageCount,
    }))
    .sort(
      (a: any, b: any) =>
        new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
}

async function readLocalEmails(ownerEmail: string): Promise<any[]> {
  const data = await getUserSetting(ownerEmail, "local-emails");
  if (data && Array.isArray((data as any).emails)) {
    return (data as any).emails;
  }
  return [];
}

export default defineAction({
  description:
    "List emails from a view (inbox, unread, starred, sent, drafts, scheduled, archive, trash) with optional search query.",
  schema: z.object({
    view: z
      .enum([
        "inbox",
        "unread",
        "starred",
        "sent",
        "drafts",
        "snoozed",
        "scheduled",
        "archive",
        "trash",
        "all",
      ])
      .optional()
      .describe("View to list (default: inbox)"),
    q: z.string().optional().describe("Full-text search query"),
    account: z
      .string()
      .optional()
      .describe(
        "Filter to a specific account email address. By default searches all connected accounts.",
      ),
    limit: z.coerce
      .number()
      .optional()
      .describe("Max number of emails to return (default: 50)"),
    includeCounts: cliBoolean
      .optional()
      .describe(
        "Set to true to include thread/page unread counts and Gmail total estimate",
      ),
    compact: cliBoolean.optional().describe("Set to true for compact output"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  link: ({ args }) => {
    const view = typeof args?.view === "string" ? args.view : "inbox";
    const search = typeof args?.q === "string" ? args.q : undefined;
    return {
      url: buildDeepLink({
        app: "mail",
        view,
        params: { q: search },
      }),
      label: "Open list in Mail",
      view,
    };
  },
  run: async (args) => {
    const view = args.view ?? "inbox";
    const query = args.q;
    const limit = args.limit ?? 50;
    const includeCounts = args.includeCounts === true;
    const compact = args.compact !== false;
    const accountFilter = args.account?.toLowerCase();
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    if (view === "snoozed" || view === "scheduled") {
      let emails = await getSyntheticEmailsForView(ownerEmail, view);
      if (query) {
        emails = emails.filter((e) => emailMessageMatchesSearch(e, query));
      }
      if (accountFilter) {
        emails = emails.filter(
          (e) => e.accountEmail?.toLowerCase() === accountFilter,
        );
      }
      return JSON.stringify(
        compact ? toCompact(emails.slice(0, limit)) : emails.slice(0, limit),
        null,
        2,
      );
    }

    if (await isConnected(ownerEmail)) {
      const clients = await getClients(ownerEmail);
      const labelMap = new Map<string, string>();
      await Promise.all(
        clients.map(async ({ accessToken }) => {
          try {
            const map = await fetchGmailLabelMap(accessToken);
            for (const [id, name] of map) labelMap.set(id, name);
          } catch {}
        }),
      );

      const gmailQuery = buildGmailEmailSearchQuery({ view, q: query });
      const effectiveQuery =
        view === "all" && !query ? "" : gmailQuery || "in:inbox -in:sent";
      const { messages, errors, resultSizeEstimate } = await listGmailMessages(
        effectiveQuery,
        limit,
        ownerEmail,
        undefined,
        {
          mode: "threads",
          threadCandidateLimit: query ? 500 : undefined,
          threadRecentMessageCandidateLimit:
            !query && (view === "inbox" || view === "unread")
              ? DEFAULT_THREAD_RECENT_MESSAGE_CANDIDATE_LIMIT
              : undefined,
        },
      );

      if (errors.length > 0 && messages.length === 0) {
        throw new Error(errors.map((e) => `${e.email}: ${e.error}`).join("; "));
      }

      let emails = messages
        .map((m) => gmailToEmailMessage(m, m._accountEmail, labelMap))
        .sort(
          (a: any, b: any) =>
            new Date(b.date).getTime() - new Date(a.date).getTime(),
        );

      if (accountFilter) {
        emails = emails.filter(
          (e: any) => e.accountEmail?.toLowerCase() === accountFilter,
        );
      }

      emails = filterInboxScopedThreadMessages(emails, view);
      emails = latestPerThread(emails).slice(0, limit);

      const payload = compact ? toCompact(emails) : emails;
      if (includeCounts) {
        return JSON.stringify(
          {
            emails: payload,
            threadCount: emails.length,
            unreadInPage: emails.filter((e: any) => e.hasUnread).length,
            ...(resultSizeEstimate !== undefined && {
              totalEstimate: resultSizeEstimate,
            }),
          },
          null,
          2,
        );
      }
      return JSON.stringify(payload, null, 2);
    }

    // Fallback: local store
    let emails = await readLocalEmails(ownerEmail);

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
    }

    if (query) {
      emails = emails.filter((e) => emailMessageMatchesSearch(e, query));
    }

    emails = latestPerThread(emails).slice(0, limit);
    const payload = compact ? toCompact(emails) : emails;
    if (includeCounts) {
      return JSON.stringify(
        {
          emails: payload,
          threadCount: emails.length,
          unreadInPage: emails.filter((e: any) => e.hasUnread).length,
          totalEstimate: emails.length,
        },
        null,
        2,
      );
    }
    return JSON.stringify(payload, null, 2);
  },
});
