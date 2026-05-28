import { defineAction } from "@agent-native/core";
import { getRequestUserEmail, buildDeepLink } from "@agent-native/core/server";
import {
  listGmailMessages,
  gmailToEmailMessage,
  fetchGmailLabelMap,
  getClients,
  isConnected,
} from "../server/lib/google-auth.js";
import { buildGmailEmailSearchQuery } from "../server/lib/gmail-query.js";
import { getUserSetting } from "@agent-native/core/settings";
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

export default defineAction({
  description: "Search emails across all views using Gmail search syntax.",
  schema: z.object({
    q: z
      .string()
      .optional()
      .describe(
        "Search query (required), supports Gmail search operators like from:, to:, subject:, is:unread",
      ),
    view: z
      .enum([
        "inbox",
        "unread",
        "starred",
        "sent",
        "drafts",
        "archive",
        "trash",
        "all",
      ])
      .optional()
      .describe("Limit search to a view (default: all)"),
    limit: z.coerce.number().optional().describe("Max results (default: 25)"),
    account: z
      .string()
      .optional()
      .describe(
        "Filter to a specific account email address. By default searches all connected accounts.",
      ),
    includeCounts: cliBoolean
      .optional()
      .describe("Set to true to include thread/page unread counts"),
    compact: cliBoolean.optional().describe("Set to true for compact output"),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  link: ({ args }) => {
    const q = typeof args?.q === "string" ? args.q : undefined;
    if (!q) return null;
    return {
      url: buildDeepLink({ app: "mail", view: "all", params: { q } }),
      label: "Open search in Mail",
      view: "all",
    };
  },
  run: async (args) => {
    if (!args.q) return "Error: --q is required";
    const view = args.view ?? "all";
    const limit = args.limit ?? 25;
    const includeCounts = args.includeCounts === true;
    const compact = args.compact !== false;
    const accountFilter = args.account?.toLowerCase();
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");

    if (!(await isConnected(ownerEmail))) {
      const data = await getUserSetting(ownerEmail, "local-emails");
      let emails =
        data && Array.isArray((data as any).emails) ? (data as any).emails : [];
      switch (view) {
        case "inbox":
          emails = emails.filter(
            (e: any) =>
              !e.isArchived && !e.isTrashed && !e.isDraft && !e.isSent,
          );
          break;
        case "unread":
          emails = emails.filter(
            (e: any) =>
              !e.isRead &&
              !e.isArchived &&
              !e.isTrashed &&
              !e.isDraft &&
              !e.isSent,
          );
          break;
        case "starred":
          emails = emails.filter((e: any) => e.isStarred && !e.isTrashed);
          break;
        case "sent":
          emails = emails.filter((e: any) => e.isSent && !e.isTrashed);
          break;
        case "drafts":
          emails = emails.filter((e: any) => e.isDraft);
          break;
        case "archive":
          emails = emails.filter((e: any) => e.isArchived && !e.isTrashed);
          break;
        case "trash":
          emails = emails.filter((e: any) => e.isTrashed);
          break;
      }

      emails = emails
        .filter((e: any) => emailMessageMatchesSearch(e, args.q))
        .sort(
          (a: any, b: any) =>
            new Date(b.date).getTime() - new Date(a.date).getTime(),
        );

      emails = latestPerThread(emails).slice(0, limit);

      const payload = compact ? toCompact(emails) : emails;
      if (includeCounts) {
        return JSON.stringify(
          {
            emails: payload,
            threadCount: emails.length,
            unreadInPage: emails.filter((e: any) => e.hasUnread).length,
          },
          null,
          2,
        );
      }
      return JSON.stringify(payload, null, 2);
    }

    const clients = await getClients(ownerEmail);
    if (clients.length === 0) return "Error: No Google account connected.";

    const gmailQuery = buildGmailEmailSearchQuery({ view, q: args.q });

    const labelMap = new Map<string, string>();
    await Promise.all(
      clients.map(async ({ accessToken }) => {
        try {
          const map = await fetchGmailLabelMap(accessToken);
          for (const [id, name] of map) labelMap.set(id, name);
        } catch {}
      }),
    );

    const { messages, errors, resultSizeEstimate } = await listGmailMessages(
      gmailQuery,
      limit,
      ownerEmail,
      undefined,
      { mode: "threads", threadCandidateLimit: 500 },
    );
    if (errors.length > 0 && messages.length === 0) {
      return `Error: ${errors.map((e) => `${e.email}: ${e.error}`).join("; ")}`;
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
  },
});
