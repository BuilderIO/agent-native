import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { getSetting } from "@agent-native/core/settings";
import { isInboxScopedAppLabel } from "@shared/gmail-labels.js";
import {
  emailMessageMatchesSearch,
  searchQueryNeedsAttachmentMetadata,
} from "@shared/search.js";
import { z } from "zod";

import {
  augmentSelfSentLabels,
  filterInboxTabEmails,
  OTHER_INBOX_TAB_PARAM,
  resolvePinnedLabels,
  pinnedTriageLabels,
  inboxThreadKey,
  savedFilterThreadIds,
} from "../app/lib/inbox-tabs.js";
import { buildGmailEmailSearchQuery } from "../server/lib/gmail-query.js";
import { gmailGetThread } from "../server/lib/google-api.js";
import {
  isConnected,
  getClients,
  listGmailMessages,
  gmailToEmailMessage,
  fetchGmailLabelMap,
} from "../server/lib/google-auth.js";
import { getSyntheticEmailsForView } from "../server/lib/jobs.js";
import { readSettings } from "../server/lib/mail-settings.js";
import {
  listQueuedDrafts,
  requireQueuedDraft,
} from "../server/lib/queued-drafts.js";
import type { EmailMessage } from "../shared/types.js";
import { getAccessTokens, fetchLabelMap } from "./helpers.js";

// Keep automatic screen context within the page-tool budget; list-emails is
// the full inventory path when the agent needs more than this preview.
const SCREEN_EMAIL_LIMIT = 10;

function latestPerThread(emails: any[]): any[] {
  const byThread = new Map<string, any>();
  for (const email of emails) {
    const key = inboxThreadKey(email);
    const existing = byThread.get(key);
    if (
      !existing ||
      new Date(email.date).getTime() > new Date(existing.date).getTime()
    ) {
      byThread.set(key, email);
    }
  }
  return Array.from(byThread.values()).sort(
    (a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

async function fetchEmailList(
  view: string,
  search?: string,
  label?: string,
  activeInboxTab?: string,
  activeAccounts?: string[],
  filterId?: string,
): Promise<any[]> {
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
    const shouldReadSettings =
      googleConnected ||
      Boolean(requestedFilterId) ||
      (view === "inbox" &&
        !search &&
        (activeInboxTab === OTHER_INBOX_TAB_PARAM || Boolean(label)));
    const settings = shouldReadSettings
      ? await readSettings(ownerEmail)
      : undefined;
    const savedFilter = requestedFilterId
      ? settings?.savedFilters?.find(
          (filter) => filter.id === requestedFilterId,
        )
      : undefined;
    const effectiveSearch = requestedFilterId ? savedFilter?.query : search;
    const effectiveView = savedFilter ? "all" : view;
    const userPinnedLabels = settings?.pinnedLabels;
    const pinnedLabels = resolvePinnedLabels(userPinnedLabels, googleConnected);
    const triageLabels = pinnedTriageLabels(pinnedLabels);
    const activeTriageTab =
      effectiveView === "inbox" && !effectiveSearch
        ? activeInboxTab === OTHER_INBOX_TAB_PARAM
          ? null
          : label &&
              triageLabels.includes(label) &&
              isInboxScopedAppLabel(label)
            ? label
            : undefined
        : undefined;
    const savedFilterQueries =
      settings?.savedFilters?.map((filter) => filter.query) ?? [];
    const needsSavedFilterParts =
      effectiveView === "inbox" &&
      !effectiveSearch &&
      savedFilterQueries.some(searchQueryNeedsAttachmentMetadata);
    const needsLabelMap =
      Boolean(label) ||
      Boolean(activeInboxTab) ||
      savedFilterQueries.length > 0;
    const hasNoteToSelf = pinnedLabels.includes("note-to-self");
    const clients = googleConnected ? await getClients(ownerEmail) : [];
    const connectedEmails = new Set(
      clients.map(({ email }) => email.toLowerCase()),
    );
    const prepareEmails = (emails: any[]) => {
      const augmented = augmentSelfSentLabels(emails as EmailMessage[], {
        isGoogleConnected: googleConnected,
        connectedEmails,
        hasNoteToSelf,
      });
      return filterSelectedAccounts(augmented);
    };
    const applyActiveInboxTab = (emails: any[]) => {
      const prepared = prepareEmails(emails);
      const filtered =
        activeTriageTab !== undefined
          ? filterInboxTabEmails(
              prepared,
              activeTriageTab,
              pinnedLabels,
              savedFilterQueries,
            )
          : prepared;
      if (effectiveView !== "inbox" || effectiveSearch || label) {
        return filtered;
      }
      const savedFilterThreads = savedFilterThreadIds(
        filtered,
        savedFilterQueries,
      );
      return filtered.filter(
        (email) => !savedFilterThreads.has(inboxThreadKey(email)),
      );
    };
    if (effectiveView === "snoozed" || effectiveView === "scheduled") {
      let emails = await getSyntheticEmailsForView(ownerEmail, effectiveView);
      if (effectiveSearch) {
        emails = emails.filter((e: any) =>
          emailMessageMatchesSearch(e, effectiveSearch),
        );
      }
      return filterSelectedAccounts(emails).slice(0, SCREEN_EMAIL_LIMIT + 1);
    }
    if (googleConnected) {
      const labelMap = new Map<string, string>();
      if (needsLabelMap) {
        await Promise.all(
          clients.map(async ({ accessToken }) => {
            try {
              const map = await fetchGmailLabelMap(accessToken);
              for (const [id, name] of map) labelMap.set(id, name);
              // coercion-ok: Label metadata is optional; Gmail messages remain usable without it.
            } catch {}
          }),
        );
      }

      const gmailQuery = buildGmailEmailSearchQuery({
        view: effectiveView,
        q: effectiveSearch,
      });
      const effectiveQuery =
        effectiveView === "all" && !effectiveSearch
          ? ""
          : gmailQuery || "in:inbox";
      const { messages } = await listGmailMessages(
        effectiveQuery,
        SCREEN_EMAIL_LIMIT + 1,
        ownerEmail,
        undefined,
        {
          mode: "threads",
          // Metadata responses omit MIME parts. Saved-filter partitioning
          // needs attachment filenames for has:attachment/filename queries.
          threadFormat: needsSavedFilterParts ? "full" : "metadata",
          accountEmails:
            selectedAccountEmails.length > 0
              ? selectedAccountEmails
              : undefined,
          threadCandidateLimit: effectiveSearch ? 500 : undefined,
          threadRecentMessageCandidateLimit: undefined,
        },
      );

      const preparedMessages = messages.map((m: any) =>
        gmailToEmailMessage(m, m._accountEmail, labelMap),
      );
      return latestPerThread(applyActiveInboxTab(preparedMessages)).slice(
        0,
        SCREEN_EMAIL_LIMIT + 1,
      );
    }

    // Fallback: local store
    const data = await getSetting("local-emails");
    if (data && Array.isArray((data as any).emails)) {
      let emails = (data as any).emails;
      switch (effectiveView) {
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
      if (effectiveSearch) {
        emails = emails.filter((e: any) =>
          emailMessageMatchesSearch(e, effectiveSearch),
        );
      }
      return applyActiveInboxTab(emails).slice(0, SCREEN_EMAIL_LIMIT + 1);
    }
    return [];
  } catch {
    return [];
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
  run: async () => {
    const navigation = await readAppState("navigation");

    const screen: Record<string, unknown> = {};
    if (navigation) screen.navigation = navigation;

    // Fetch queued drafts when the user is on the draft queue.
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
      const emails = await fetchEmailList(
        nav.view,
        nav.search,
        nav.label,
        nav.activeInboxTab,
        nav.activeAccounts,
        nav.filter,
      );
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
        activeInboxTab: nav.activeInboxTab ?? null,
        activeAccounts: nav.activeAccounts ?? [],
        search: nav.search ?? null,
        selectedThreadIds: Array.from(selectedThreadIds),
        count: compact.length,
        truncated: emails.length > compact.length,
        emails: compact,
      };
    }

    // Fetch thread messages directly via Gmail API if the user is viewing a thread
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
