import { defineAction } from "@agent-native/core/action";
import { readAppStateForCurrentTab } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { mailLabelMatches } from "@shared/gmail-labels.js";
import {
  conversationFilterFlags,
  inboxFilterAccepts,
  inboxFilterRequest,
  keepAcceptedConversations,
  viewTakesInboxFilter,
} from "@shared/inbox-filters.js";
import { emailMessageMatchesSearch } from "@shared/search.js";
import { z } from "zod";

import {
  augmentSelfSentLabels,
  resolvePinnedLabels,
  inboxThreadKey,
} from "../app/lib/inbox-tabs.js";
import {
  buildGmailEmailSearchQuery,
  filterLabelMessages,
} from "../server/lib/gmail-query.js";
import { gmailGetThread } from "../server/lib/google-api.js";
import {
  isConnected,
  getClientsWithErrors,
  listGmailMessages,
  gmailToEmailMessage,
} from "../server/lib/google-auth.js";
import { buildLocalInboxItems } from "../server/lib/inbox-tabs-server.js";
import { getSyntheticEmailsForView } from "../server/lib/jobs.js";
import { readLocalEmails } from "../server/lib/local-email-store.js";
import { readSettings } from "../server/lib/mail-settings.js";
import {
  listQueuedDrafts,
  requireQueuedDraft,
} from "../server/lib/queued-drafts.js";
import type { ListInboxThreadsResult } from "../shared/inbox-threads.js";
import type { EmailMessage } from "../shared/types.js";
import { getAccessTokens, fetchLabelMap } from "./helpers.js";
import listInboxThreads from "./list-inbox-threads.js";

const SCREEN_EMAIL_LIMIT = 10;
const SCREEN_THREAD_CANDIDATE_LIMIT = 40;
// ponytail: stop after three pages; use list-emails for exhaustive filtered inventory.
const SCREEN_EMAIL_MAX_PAGES = 3;

type EmailPreviewResult = {
  emails: any[];
  truncated: boolean;
  coverageComplete: boolean;
  failedAccounts: string[];
  partialAccounts?: string[];
  freshness?: string;
  tabs?: unknown[];
  activeTabId?: string;
  error?: string;
};

function formatPreviewError(error: unknown): string {
  const message =
    error instanceof Error && error.message
      ? error.message
      : "Unable to read Mail preview";
  return (
    message
      .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
      .replace(
        /\b(access_token|refresh_token|id_token|token)=([^\s&]+)/gi,
        "$1=[redacted]",
      )
      .slice(0, 240) || "Unable to read Mail preview"
  );
}

function boundEmailPreview(
  emails: any[],
  failedAccounts: string[] = [],
  coverageComplete = failedAccounts.length === 0,
): EmailPreviewResult {
  return {
    emails: emails.slice(0, SCREEN_EMAIL_LIMIT + 1),
    truncated: emails.length > SCREEN_EMAIL_LIMIT,
    coverageComplete,
    failedAccounts,
  };
}

function conversationRows(
  emails: EmailMessage[],
  accepts: ReturnType<typeof inboxFilterAccepts>,
  members: readonly EmailMessage[] = emails,
): EmailMessage[] {
  const kept = accepts
    ? keepAcceptedConversations(emails, accepts, members)
    : emails;
  const conversations = new Map<string, EmailMessage[]>();
  for (const email of members) {
    const key = inboxThreadKey(email);
    const conversation = conversations.get(key);
    if (conversation) conversation.push(email);
    else conversations.set(key, [email]);
  }
  const latestByThread = new Map<string, EmailMessage>();
  for (const email of kept) {
    const key = inboxThreadKey(email);
    const existing = latestByThread.get(key);
    if (
      !existing ||
      new Date(email.date).getTime() > new Date(existing.date).getTime()
    ) {
      latestByThread.set(key, email);
    }
  }
  return Array.from(latestByThread, ([key, latest]) => {
    const flags = conversationFilterFlags(conversations.get(key) ?? [latest]);
    return { ...latest, isRead: !flags.unread, isStarred: flags.starred };
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

async function fetchInboxPreview(
  tab: string | undefined,
  activeAccounts: unknown,
  inboxFilter: string,
): Promise<EmailPreviewResult> {
  try {
    const accountEmails = Array.isArray(activeAccounts)
      ? activeAccounts.filter(
          (email): email is string => typeof email === "string",
        )
      : [];
    const result = (await listInboxThreads.run({
      limit: SCREEN_EMAIL_LIMIT,
      offset: 0,
      ...(tab ? { tab } : {}),
      ...(accountEmails.length > 0 ? { accountEmails } : {}),
      ...(inboxFilter ? { inboxFilter } : {}),
    })) as ListInboxThreadsResult;
    const failedAccounts = result.accounts
      .filter(
        (account) =>
          account.state === "error" || account.state === "needs_reauth",
      )
      .map((account) => account.accountEmail);
    const partialAccounts = result.accounts
      .filter(
        (account) =>
          account.state === "initial" ||
          account.backfillPending ||
          account.reachedCap,
      )
      .map((account) => account.accountEmail);
    return {
      emails: result.items,
      truncated: Boolean(result.hasMore || result.reachedCap),
      coverageComplete:
        failedAccounts.length === 0 && partialAccounts.length === 0,
      failedAccounts,
      partialAccounts,
      ...(result.read ? { freshness: result.read.freshness } : {}),
      tabs: result.tabs.map(({ id, kind, name, total, unread }) => ({
        id,
        kind,
        name,
        total,
        unread,
      })),
      activeTabId: result.activeTabId,
    };
  } catch (error) {
    return {
      ...boundEmailPreview([]),
      coverageComplete: false,
      error: formatPreviewError(error),
    };
  }
}

async function fetchEmailList({
  view,
  search,
  activeAccounts,
  filterId,
  label,
  inboxFilter = "",
}: {
  view: string;
  search?: string | undefined;
  activeAccounts?: unknown;
  filterId?: string | undefined;
  label?: string | undefined;
  inboxFilter?: string;
}): Promise<EmailPreviewResult> {
  try {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const requestedFilterId = filterId?.trim();
    const selectedAccountEmails = Array.isArray(activeAccounts)
      ? [
          ...new Set(
            activeAccounts
              .filter((email): email is string => typeof email === "string")
              .map((email) => email.toLowerCase()),
          ),
        ]
      : [];
    const selectedAccountSet = new Set(selectedAccountEmails);
    const filterSelectedAccounts = (emails: any[]) => {
      if (selectedAccountEmails.length === 0) return emails;
      return emails.filter(
        (email) =>
          typeof email.accountEmail === "string" &&
          selectedAccountSet.has(email.accountEmail.toLowerCase()),
      );
    };

    const googleConnected = await isConnected(ownerEmail);
    const settings =
      googleConnected || requestedFilterId
        ? await readSettings(ownerEmail)
        : undefined;
    const pinnedLabels = resolvePinnedLabels(
      settings?.pinnedLabels,
      googleConnected,
    );
    const savedFilter = requestedFilterId
      ? settings?.savedFilters?.find(
          (filter) => filter.id === requestedFilterId,
        )
      : undefined;
    const effectiveSearch = requestedFilterId ? savedFilter?.query : search;
    const effectiveView = savedFilter && view !== "inbox" ? "all" : view;
    const hasNoteToSelf = pinnedLabels.includes("note-to-self");
    const { clients, errors: clientErrors } = googleConnected
      ? await getClientsWithErrors(
          ownerEmail,
          selectedAccountEmails.length > 0 ? selectedAccountEmails : undefined,
        )
      : { clients: [], errors: [] };
    const connectedEmails = new Set(
      clients.map(({ email }) => email.toLowerCase()),
    );
    const clientErrorEmails = new Set(
      clientErrors.map(({ email }) => email.toLowerCase()),
    );
    const missingSelectedAccounts = selectedAccountEmails.filter(
      (email) => !connectedEmails.has(email) && !clientErrorEmails.has(email),
    );
    const prepareEmails = (emails: any[]) => {
      const augmented = augmentSelfSentLabels(emails as EmailMessage[], {
        isGoogleConnected: googleConnected,
        connectedEmails,
        hasNoteToSelf,
      });
      return filterSelectedAccounts(augmented);
    };
    if (effectiveView === "snoozed" || effectiveView === "scheduled") {
      let emails = await getSyntheticEmailsForView(ownerEmail, effectiveView);
      if (effectiveSearch) {
        emails = emails.filter((e: any) =>
          emailMessageMatchesSearch(e, effectiveSearch),
        );
      }
      return boundEmailPreview(filterSelectedAccounts(emails));
    }
    const viewFilter = viewTakesInboxFilter(effectiveView) ? inboxFilter : "";
    const filterAccepts = viewFilter ? inboxFilterAccepts(viewFilter) : null;
    const scopeLabel = savedFilter ? undefined : label?.trim() || undefined;
    if (googleConnected) {
      const labelMap = new Map<string, string>();
      const failedAccounts = new Set([
        ...clientErrors.map(({ email }) => email),
        ...missingSelectedAccounts,
      ]);
      const effectiveQuery =
        buildGmailEmailSearchQuery({
          view: effectiveView,
          q: effectiveSearch,
          label: scopeLabel,
          inboxFilter: viewFilter,
        }) || (effectiveView === "all" ? "" : "in:inbox");
      const listOptions: NonNullable<Parameters<typeof listGmailMessages>[4]> =
        {
          mode: "threads" as const,
          threadFormat: "metadata",
          threadCandidateLimit:
            effectiveSearch || viewFilter
              ? SCREEN_THREAD_CANDIDATE_LIMIT
              : undefined,
        };
      let pageTokens: Record<string, string> | undefined;
      let pageAccountEmails =
        selectedAccountEmails.length > 0 ? selectedAccountEmails : undefined;
      let messages: any[] = [];
      let filteredMessages: any[] = [];
      let hasMore = false;
      let pagesRead = 0;

      for (;;) {
        const page = await listGmailMessages(
          effectiveQuery,
          SCREEN_EMAIL_LIMIT + 1,
          ownerEmail,
          pageTokens,
          {
            ...listOptions,
            accountEmails: pageAccountEmails,
          },
        );
        pagesRead += 1;
        for (const error of page.errors ?? []) {
          if (error?.email) failedAccounts.add(error.email);
        }
        messages = messages.concat(page.messages);
        const preparedMessages = messages.map((m: any) =>
          gmailToEmailMessage(m, m._accountEmail, labelMap),
        );
        filteredMessages = conversationRows(
          prepareEmails(preparedMessages),
          filterAccepts,
        );
        pageTokens = page.nextPageTokens;
        hasMore = Boolean(pageTokens && Object.keys(pageTokens).length > 0);
        if (
          !hasMore ||
          filteredMessages.length > SCREEN_EMAIL_LIMIT ||
          pagesRead >= SCREEN_EMAIL_MAX_PAGES
        ) {
          break;
        }
        pageAccountEmails = Object.keys(pageTokens!);
      }

      return {
        emails: filteredMessages.slice(0, SCREEN_EMAIL_LIMIT + 1),
        truncated: hasMore || filteredMessages.length > SCREEN_EMAIL_LIMIT,
        coverageComplete: failedAccounts.size === 0,
        failedAccounts: Array.from(failedAccounts),
      };
    }

    const mailbox = await readLocalEmails(ownerEmail);
    if (effectiveView === "inbox") {
      let items = buildLocalInboxItems(mailbox, ownerEmail);
      if (scopeLabel) {
        items = items.filter((item) =>
          item.labelIds.some((labelId) =>
            mailLabelMatches(labelId, scopeLabel),
          ),
        );
      }
      if (effectiveSearch) {
        items = items.filter((item) =>
          emailMessageMatchesSearch(item, effectiveSearch),
        );
      }
      if (filterAccepts) {
        items = items.filter((item) =>
          filterAccepts({
            unread: item.unreadCount > 0,
            starred: item.isStarred,
          }),
        );
      }
      return boundEmailPreview(
        prepareEmails(
          items.map((item) => ({ ...item, isRead: item.unreadCount === 0 })),
        ),
      );
    }
    let emails = mailbox;
    switch (effectiveView) {
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
      case "all":
        if (scopeLabel) emails = filterLabelMessages(emails, scopeLabel);
        break;
    }
    if (effectiveSearch) {
      emails = emails.filter((e: any) =>
        emailMessageMatchesSearch(e, effectiveSearch),
      );
    }
    return boundEmailPreview(
      prepareEmails(conversationRows(emails, filterAccepts, mailbox)),
    );
  } catch (error) {
    return {
      ...boundEmailPreview([]),
      coverageComplete: false,
      error: formatPreviewError(error),
    };
  }
}

async function fetchThreadMessages(threadId: string): Promise<any> {
  try {
    const accounts = await getAccessTokens();
    if (accounts.length === 0) return null;

    const labelMap = new Map<string, string>();
    await Promise.all(
      accounts.map(async ({ accessToken }) => {
        try {
          const map = await fetchLabelMap(accessToken);
          for (const [id, name] of map) labelMap.set(id, name);
        } catch {}
      }),
    );

    for (const { email, accessToken } of accounts) {
      try {
        const threadRes = await gmailGetThread(accessToken, threadId, "full");
        const messages = (threadRes.messages || [])
          .map((m: any) =>
            gmailToEmailMessage(
              { ...m, _accountEmail: email },
              email,
              labelMap,
            ),
          )
          .sort(
            (a: any, b: any) =>
              new Date(a.date).getTime() - new Date(b.date).getTime(),
          );

        return {
          threadId,
          messages: messages.map((m: any) => ({
            id: m.id,
            from: m.from?.name
              ? `${m.from.name} <${m.from.email}>`
              : (m.from?.email ?? ""),
            to: (m.to || []).map((t: any) =>
              t.name ? `${t.name} <${t.email}>` : t.email,
            ),
            subject: m.subject,
            body: m.body,
            date: m.date,
            isRead: m.isRead,
          })),
        };
      } catch (err: any) {
        if (err?.message?.includes("404")) continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export default defineAction({
  description:
    "See what the user is currently looking at on screen. Returns the current view, a bounded email preview, and the open thread (if any). Use list-emails for a full inventory. Prefer the auto-included <current-screen> block; call this only when you need a refreshed snapshot.",
  schema: z.object({
    full: z.coerce
      .boolean()
      .optional()
      .describe(
        "Set to true for full detail (deprecated, now always returns full detail)",
      ),
  }),
  http: false,
  readOnly: true,
  mcpTool: "search",
  run: async () => {
    const navigation = await readAppStateForCurrentTab("navigation", {
      fallbackToGlobal: false,
    });

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    const nav = navigation as any;
    if (nav?.view === "draft-queue") {
      try {
        const drafts = await listQueuedDrafts({
          scope: nav.queueScope === "requested" ? "requested" : "review",
          status: "active",
          limit: 50,
        });
        screen.draftQueue = {
          scope: nav.queueScope ?? "review",
          count: drafts.length,
          drafts: drafts.map((draft) => ({
            id: draft.id,
            ownerEmail: draft.ownerEmail,
            requesterEmail: draft.requesterEmail,
            to: draft.to,
            subject: draft.subject,
            status: draft.status,
            context: draft.context,
            createdAt: draft.createdAt,
          })),
        };
        if (nav.queuedDraftId) {
          const { draft: selected } = await requireQueuedDraft(
            nav.queuedDraftId,
          );
          screen.queuedDraft = selected;
        }
      } catch (err) {
        screen.draftQueue = {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    } else if (nav?.view) {
      const inboxFilter =
        typeof nav.inboxFilter === "string" && viewTakesInboxFilter(nav.view)
          ? inboxFilterRequest(nav.inboxFilter)
          : "";
      const preview =
        nav.view === "inbox" && !nav.search
          ? await fetchInboxPreview(
              nav.tab ?? nav.activeInboxTab ?? nav.label ?? nav.filter,
              nav.activeAccounts,
              inboxFilter,
            )
          : await fetchEmailList({
              view: nav.view,
              search: nav.search,
              activeAccounts: nav.activeAccounts,
              filterId: nav.filter,
              label: typeof nav.label === "string" ? nav.label : undefined,
              inboxFilter,
            });
      const {
        emails,
        truncated,
        coverageComplete,
        failedAccounts,
        partialAccounts,
        freshness,
        error,
      } = preview;
      const selectedThreadIds = Array.isArray(nav.selectedThreadIds)
        ? new Set(
            nav.selectedThreadIds.filter(
              (id: unknown): id is string => typeof id === "string",
            ),
          )
        : new Set<string>();
      const compact = emails.slice(0, SCREEN_EMAIL_LIMIT).map((e: any) => ({
        id: e.id,
        threadId: e.threadId,
        isSelected: selectedThreadIds.has(e.threadId || e.id),
        from: e.from?.name
          ? `${e.from.name} <${e.from.email}>`
          : (e.from?.email ?? e.from ?? ""),
        subject: e.subject,
        snippet: e.snippet,
        date: e.date,
        isRead: e.isRead,
        isStarred: e.isStarred,
      }));
      screen.emailList = {
        view: nav.view,
        label: nav.label ?? null,
        filter: nav.filter ?? null,
        inboxFilter: inboxFilter || null,
        activeInboxTab: nav.activeInboxTab ?? null,
        sort: nav.sort ?? "newest",
        activeAccounts: nav.activeAccounts ?? [],
        search: nav.search ?? null,
        selectedThreadIds: Array.from(selectedThreadIds),
        count: compact.length,
        truncated,
        coverage: {
          complete: coverageComplete,
          failedAccounts,
          ...(partialAccounts?.length ? { partialAccounts } : {}),
          ...(freshness ? { freshness } : {}),
          ...(error ? { error } : {}),
        },
        emails: compact,
        ...(preview.tabs
          ? { tabs: preview.tabs, activeTabId: preview.activeTabId }
          : {}),
      };
      if (nav.view === "drafts") {
        const scheduled = await fetchEmailList({
          view: "scheduled",
          search: nav.search,
          activeAccounts: nav.activeAccounts,
        });
        const emailList = screen.emailList as Record<string, unknown>;
        emailList.scheduled = scheduled.emails
          .slice(0, SCREEN_EMAIL_LIMIT)
          .map((e: EmailMessage) => ({
            id: e.id,
            threadId: e.threadId,
            to: e.to.map((address) => address.email),
            subject: e.subject,
            sendAt: e.date,
          }));
        if (!nav.search) {
          try {
            const requested = await listQueuedDrafts({
              scope: "review",
              status: "active",
              limit: 50,
            });
            emailList.requested = requested.map((draft) => ({
              id: draft.id,
              requesterEmail: draft.requesterEmail,
              requesterName: draft.requesterName,
              to: draft.to,
              subject: draft.subject,
              createdAt: draft.createdAt,
            }));
          } catch (err) {
            emailList.requested = {
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }
      }
    }

    if (nav?.threadId) {
      const thread = await fetchThreadMessages(nav.threadId);
      if (thread) screen.thread = thread;
    }

    if (Object.keys(screen).length === 0) {
      return "No application state found. Is the app running?";
    }
    return JSON.stringify(screen, null, 2);
  },
});
