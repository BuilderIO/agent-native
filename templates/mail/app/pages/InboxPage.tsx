import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useParams, useNavigate, useSearchParams } from "react-router";
import { cn } from "@/lib/utils";
import { EmailList, InboxZero } from "@/components/email/EmailList";
import { groupIntoThreads, type ThreadSummary } from "@/lib/threads";
import { EmailThread } from "@/components/email/EmailThread";
import { useComposeState } from "@/hooks/use-compose-state";
import {
  useNavigationState,
  type NavigationState,
} from "@/hooks/use-navigation-state";
import {
  useEmails,
  useMarkRead,
  useDeleteDraft,
  useSettings,
} from "@/hooks/use-emails";

import { IntegrationsSidebar } from "@/components/email/IntegrationsSidebar";
import { GoogleConnectBanner } from "@/components/GoogleConnectBanner";
import { useAccountFilter } from "@/hooks/use-account-filter";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
import { Button } from "@/components/ui/button";
import type { EmailMessage } from "@shared/types";

function ContactPanel({
  emailId,
  contactEmail,
  emails,
}: {
  emailId: string | undefined;
  contactEmail?: string;
  emails: EmailMessage[];
}) {
  // Look up from already-cached list data instead of making a separate API call
  const email = useMemo(
    () => emails.find((e) => e.id === emailId),
    [emails, emailId],
  );
  // Always use inbox emails for "recent from contact" — shares React Query cache,
  // no extra fetch. The `emails` prop may be a different view (sent, starred, etc.)
  const { data: inboxEmails = [] } = useEmails("inbox");

  const displayEmail = contactEmail || email?.from.email;
  const displayName = contactEmail
    ? contactEmail
    : email?.from.name || email?.from.email;

  if (!displayEmail) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-muted-foreground/40">No contact selected</p>
      </div>
    );
  }

  const recentFromContact = inboxEmails
    .filter((e) => e.from.email === displayEmail && e.id !== emailId)
    .slice(0, 4)
    .map((e) => ({ id: e.id, subject: e.subject }));

  return (
    <IntegrationsSidebar
      email={displayEmail}
      displayName={displayName || displayEmail}
      recentEmails={recentFromContact}
    />
  );
}

function ThreadListSidebar({
  emails,
  activeThreadId,
  view,
  labelSuffix,
  selectedIds,
  setSelectedIds,
}: {
  emails: EmailMessage[];
  activeThreadId: string;
  view: string;
  labelSuffix: string;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const navigate = useNavigate();
  const markRead = useMarkRead();
  const threads = useMemo(() => groupIntoThreads(emails), [emails]);

  return (
    <div className="w-[220px] shrink-0 flex flex-col border-r border-border/30 bg-muted/50 dark:bg-[hsl(220,6%,5%)] overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {threads.map((thread) => {
          const email = thread.latestMessage;
          const threadKey = email.threadId || email.id;
          const isActive = threadKey === activeThreadId;
          const isMultiSelected = selectedIds.has(threadKey);
          return (
            <button
              key={email.id}
              onClick={() => {
                // A plain click is a single-thread action — clear any
                // in-progress multi-selection so the next keyboard shortcut
                // doesn't act on a stale set.
                setSelectedIds(new Set());
                if (!email.isRead)
                  markRead.mutate({
                    id: email.id,
                    isRead: true,
                    accountEmail: email.accountEmail,
                  });
                navigate(`/${view}/${threadKey}${labelSuffix}`);
              }}
              className={cn(
                "w-full text-left px-3 h-[38px] flex items-center border-b border-border/10 transition-colors",
                isMultiSelected
                  ? "bg-primary/20 ring-1 ring-inset ring-primary/40"
                  : isActive
                    ? "bg-primary/10"
                    : "hover:bg-accent dark:hover:bg-[hsl(220,5%,13%)]",
              )}
            >
              <div className="flex items-center gap-2 min-w-0 w-full">
                {thread.hasUnread && (
                  <div className="h-[7px] w-[7px] rounded-full bg-primary shrink-0" />
                )}
                <span
                  className={cn(
                    "text-[13px] truncate",
                    thread.hasUnread
                      ? "font-semibold text-foreground"
                      : "text-foreground/90",
                  )}
                >
                  {email.subject}
                </span>
                {thread.messageCount > 1 && (
                  <span className="text-[10px] text-muted-foreground/70 shrink-0">
                    {thread.messageCount}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Stable references for the default "empty" fallbacks of useQuery data —
// using `[]` inline creates a fresh array on every render, which cascades
// through memos into EmailThread's props and causes re-render storms.
const EMPTY_ACCOUNTS: { email: string; displayName?: string }[] = [];
const EMPTY_LABELS: string[] = [];

export function InboxPage() {
  const { view = "inbox", threadId: routeThreadId } = useParams<{
    view: string;
    threadId: string;
  }>();
  const navigate = useNavigate();
  // Immediate thread ID for instant list→thread transition. React Router
  // wraps navigations in startTransition, which keeps the old list view
  // visible until the route commits. This local state bypasses that: the
  // click handler sets it synchronously, so the thread view renders on the
  // next frame. The URL catches up via navigate() in the background.
  const [pendingThreadId, setPendingThreadId] = useState<string | undefined>(
    undefined,
  );
  const threadId = pendingThreadId || routeThreadId;
  // Clear pending once the route catches up
  useEffect(() => {
    if (routeThreadId === pendingThreadId) setPendingThreadId(undefined);
  }, [routeThreadId, pendingThreadId]);
  // Clear pending when going back to list
  useEffect(() => {
    if (!routeThreadId) setPendingThreadId(undefined);
  }, [routeThreadId]);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const compose = useComposeState();
  const navState = useNavigationState();
  const [lastArchivedId, setLastArchivedId] = useState<string | null>(null);
  const { data: settings } = useSettings();
  const [searchParams] = useSearchParams();
  const activeLabel = searchParams.get("label");
  const labelSuffix = activeLabel
    ? `?label=${encodeURIComponent(activeLabel)}`
    : "";

  // Always fetch from the URL view (inbox, starred, etc.)
  // Label tabs use ?label= param and always fetch inbox
  const searchQuery = searchParams.get("q") ?? undefined;
  const {
    data: rawEmails = [],
    isLoading,
    isError,
    refetch,
  } = useEmails(view, searchQuery, activeLabel ?? undefined);
  const googleStatus = useGoogleAuthStatus();
  const { activeAccounts } = useAccountFilter();

  // Memoize every derived array — the emails memo depends on these, and fresh
  // array refs on every render were cascading into EmailThread as unstable
  // threads/emailIds props.
  const connectedAccounts = useMemo(
    () => googleStatus.data?.accounts ?? EMPTY_ACCOUNTS,
    [googleStatus.data?.accounts],
  );
  const isGoogleConnected = connectedAccounts.length > 0;
  const connectedEmails = useMemo(
    () => new Set(connectedAccounts.map((a) => a.email.toLowerCase())),
    [connectedAccounts],
  );
  const userPinnedLabels = useMemo(
    () => settings?.pinnedLabels ?? EMPTY_LABELS,
    [settings?.pinnedLabels],
  );
  const pinnedLabels = useMemo(
    () =>
      isGoogleConnected
        ? ["important", ...userPinnedLabels.filter((id) => id !== "important")]
        : userPinnedLabels,
    [isGoogleConnected, userPinnedLabels],
  );
  const pinnedUserLabels = useMemo(
    () =>
      pinnedLabels.filter(
        (id) => !["starred", "sent", "drafts", "archive", "trash"].includes(id),
      ),
    [pinnedLabels],
  );
  const hasNoteToSelf = pinnedLabels.includes("note-to-self");

  const emails = useMemo(() => {
    // Augment emails with virtual labels:
    // - Self-sent emails get "important" (or "note-to-self" if that tab is pinned)
    let filtered = rawEmails.map((e) => {
      if (!isGoogleConnected) return e;
      const isSelfSent = connectedEmails.has(e.from.email.toLowerCase());
      if (!isSelfSent) return e;
      const virtualLabel = hasNoteToSelf ? "note-to-self" : "important";
      if (e.labelIds.includes(virtualLabel)) return e;
      // Add virtual label, remove "important" if routing to note-to-self
      let labelIds = [...e.labelIds];
      if (hasNoteToSelf) labelIds = labelIds.filter((l) => l !== "important");
      if (!labelIds.includes(virtualLabel)) labelIds.push(virtualLabel);
      return { ...e, labelIds };
    });

    // Filter by active accounts (empty set = all accounts, no filtering)
    if (activeAccounts.size > 0) {
      filtered = filtered.filter(
        (e) => e.accountEmail && activeAccounts.has(e.accountEmail),
      );
    }

    if (activeLabel) {
      // Label tab: show threads where the latest message has this label
      // (mirrors Superhuman behavior — a thread belongs to a label based on its latest message)
      const shortLabel = activeLabel.includes("/")
        ? activeLabel
            .slice(activeLabel.lastIndexOf("/") + 1)
            .replace(/_/g, " ")
            .toLowerCase()
        : activeLabel.toLowerCase();
      const hasLabel = (e: (typeof filtered)[0]) =>
        e.labelIds.some((l) => l === activeLabel || l === shortLabel);
      // Find the latest message per thread
      const latestByThread = new Map<string, (typeof filtered)[0]>();
      for (const e of filtered) {
        const key = e.threadId || e.id;
        const existing = latestByThread.get(key);
        if (!existing || new Date(e.date) > new Date(existing.date)) {
          latestByThread.set(key, e);
        }
      }
      // Keep threads whose latest message has the label
      // For "important", exclude threads that belong to any other pinned tab
      const otherPinnedShorts =
        activeLabel === "important"
          ? pinnedUserLabels
              .filter((l) => l !== "important")
              .map((l) =>
                l.includes("/")
                  ? l
                      .slice(l.lastIndexOf("/") + 1)
                      .replace(/_/g, " ")
                      .toLowerCase()
                  : l.toLowerCase(),
              )
          : [];
      const qualifiedThreadIds = new Set(
        [...latestByThread.entries()]
          .filter(([, latest]) => {
            if (!hasLabel(latest)) return false;
            // If viewing "important", skip threads that match another pinned tab
            if (
              otherPinnedShorts.length > 0 &&
              latest.labelIds.some((lid) => otherPinnedShorts.includes(lid))
            )
              return false;
            return true;
          })
          .map(([threadId]) => threadId),
      );
      return filtered.filter((e) => qualifiedThreadIds.has(e.threadId || e.id));
    }
    if (view === "inbox" && pinnedUserLabels.length > 0) {
      // Inbox: filter out emails that belong to a pinned label
      // Compute short names for each pinned label so we match email labelIds
      const pinnedShortNames = pinnedUserLabels.map((l) =>
        l.includes("/")
          ? l
              .slice(l.lastIndexOf("/") + 1)
              .replace(/_/g, " ")
              .toLowerCase()
          : l.toLowerCase(),
      );
      return filtered.filter(
        (e) =>
          !e.labelIds.some(
            (lid) =>
              pinnedUserLabels.includes(lid) || pinnedShortNames.includes(lid),
          ),
      );
    }
    return filtered;
  }, [
    rawEmails,
    view,
    activeLabel,
    pinnedUserLabels,
    activeAccounts,
    isGoogleConnected,
    connectedEmails,
    hasNoteToSelf,
  ]);

  // Clear multi-selection when switching views or label tabs. Do NOT clear on
  // threadId changes — shift+j/k in detail view navigates between threads while
  // extending the selection, so selection must persist across thread nav.
  useEffect(() => setSelectedIds(new Set()), [view, activeLabel]);

  // Sync current navigation state to file (write-only, so agent can read it)
  const searchQ = searchParams.get("q") ?? undefined;
  useEffect(() => {
    navState.sync({
      view,
      threadId,
      focusedEmailId: focusedId ?? undefined,
      search: searchQ,
      label: activeLabel ?? undefined,
    });
  }, [view, threadId, focusedId, searchQ, activeLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  // One-shot agent navigation: agent writes navigate.json, UI reads it, navigates, deletes it
  const { data: navCommand } = navState.command;
  const lastCommandRef = useRef<string>("");
  useEffect(() => {
    if (!navCommand) return;
    const key = JSON.stringify(navCommand);
    if (key === lastCommandRef.current) return;
    lastCommandRef.current = key;

    const targetView = navCommand.view || view;
    const targetThread = navCommand.threadId;

    if (targetThread) {
      navigate(`/${targetView}/${targetThread}`);
    } else if (targetView !== view) {
      navigate(`/${targetView}`);
    }

    // Delete the command file so it doesn't re-trigger
    navState.clearCommand();
  }, [navCommand, view, navigate]); // eslint-disable-line react-hooks/exhaustive-deps
  // Stable-identity pattern: keep the previous array reference when the
  // content hasn't meaningfully changed. Without this, markThreadRead's
  // optimistic update (which rebuilds the emails array for a single isRead
  // flip) produces a new `threads` reference on every unread-open, which
  // cascades through EmailThread's props and re-renders the whole detail
  // view. With this, the props only change when the list of threads (or
  // their latest-message identities) actually changes.
  const rawThreads = useMemo(() => groupIntoThreads(emails), [emails]);
  const prevThreadsRef = useRef<ThreadSummary[]>([]);
  const threads = useMemo(() => {
    const prev = prevThreadsRef.current;
    if (
      prev.length === rawThreads.length &&
      prev.every(
        (t, i) =>
          t.latestMessage.id === rawThreads[i].latestMessage.id &&
          t.latestMessage.threadId === rawThreads[i].latestMessage.threadId &&
          t.hasUnread === rawThreads[i].hasUnread,
      )
    ) {
      return prev;
    }
    prevThreadsRef.current = rawThreads;
    return rawThreads;
  }, [rawThreads]);
  const threadIds = useMemo(
    () => threads.map((t) => t.latestMessage.threadId || t.latestMessage.id),
    [threads],
  );

  // Safety valve: if pendingThreadId points to a thread that was removed from
  // the view (archived/trashed before the route caught up), clear it so the
  // app doesn't get stuck rendering a ghost thread.
  useEffect(() => {
    if (
      pendingThreadId &&
      threads.length > 0 &&
      !threads.some(
        (t) =>
          (t.latestMessage.threadId || t.latestMessage.id) === pendingThreadId,
      )
    ) {
      setPendingThreadId(undefined);
    }
  }, [pendingThreadId, threads]);

  const handleCompose = useCallback(
    (email: EmailMessage, mode: "reply" | "forward") => {
      if (mode === "reply") {
        compose.open({
          to: email.from.email,
          subject: email.subject.startsWith("Re:")
            ? email.subject
            : `Re: ${email.subject}`,
          body: `\n\n\n\n— On ${new Date(email.date).toLocaleDateString()}, ${email.from.name || email.from.email} wrote:\n\n${email.body
            .split("\n")
            .map((l) => `> ${l}`)
            .join("\n")}`,
          mode: "reply",
          replyToId: email.id,
          replyToThreadId: email.threadId,
        });
      } else {
        compose.open({
          to: "",
          subject: email.subject.startsWith("Fwd:")
            ? email.subject
            : `Fwd: ${email.subject}`,
          body: `\n\n\n\n— Forwarded message —\nFrom: ${email.from.name} <${email.from.email}>\n\n${email.body}`,
          mode: "forward",
          replyToId: email.id,
          replyToThreadId: email.threadId,
        });
      }
    },
    [compose],
  );

  const deleteDraft = useDeleteDraft();

  // Open a saved draft in the compose window
  const handleDraftOpen = useCallback(
    (email: EmailMessage) => {
      compose.open({
        to: email.to.map((r) => r.email).join(", "),
        cc: email.cc?.map((r) => r.email).join(", ") ?? "",
        bcc: email.bcc?.map((r) => r.email).join(", ") ?? "",
        subject: email.subject === "(no subject)" ? "" : email.subject,
        body: email.body,
        mode: "compose",
        replyToId: (email as any).replyToId,
        replyToThreadId: (email as any).replyToThreadId,
        savedDraftId: email.id,
      });
      // Delete the persistent draft (it's now in the compose window)
      deleteDraft.mutate(email.id);
    },
    [compose, deleteDraft],
  );

  const isMobile = useIsMobile();
  const hasThread = !!threadId;
  const isInboxZero =
    !isLoading &&
    !isError &&
    !hasThread &&
    !searchQuery &&
    threads.length === 0;
  const [sidebarContactEmail, setSidebarContactEmail] = useState<
    string | undefined
  >();

  // Reset sidebar contact when navigating away from a thread
  useEffect(() => {
    setSidebarContactEmail(undefined);
  }, [threadId]);

  // Use the focused email ID for the contact panel, falling back to the selected thread
  const contactEmailId = threadId ?? focusedId ?? undefined;

  // Error state — only show connect banner when Google is definitively not connected.
  // For transient errors (rate limits, network blips), show a retry message instead.
  if (isError && !hasThread && threads.length === 0) {
    if (!googleStatus.isLoading && googleStatus.data?.connected === false) {
      return <GoogleConnectBanner variant="hero" />;
    }
    if (!googleStatus.isLoading) {
      return (
        <div className="flex flex-1 items-center justify-center text-center">
          <div>
            <p className="text-sm text-muted-foreground">
              Failed to load emails
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => refetch()}
            >
              Retry
            </Button>
          </div>
        </div>
      );
    }
  }

  // Inbox Zero — full-bleed image, no sidebar
  if (isInboxZero) {
    return <InboxZero />;
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Thin email list sidebar — shown when viewing a thread, hidden on mobile */}
      {hasThread && !isMobile && (
        <ThreadListSidebar
          emails={emails}
          activeThreadId={threadId!}
          view={view}
          labelSuffix={labelSuffix}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
        />
      )}

      {/* Center area — email list OR thread view */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {hasThread ? (
          <EmailThread
            activeThreadId={threadId}
            onArchived={setLastArchivedId}
            emailIds={threadIds}
            threads={threads}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            onContactSelect={setSidebarContactEmail}
            onNavigateThread={setPendingThreadId}
          />
        ) : (
          <EmailList
            emails={emails}
            focusedId={focusedId}
            setFocusedId={setFocusedId}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            onCompose={handleCompose}
            onArchived={setLastArchivedId}
            onDraftOpen={handleDraftOpen}
            onNavigateThread={setPendingThreadId}
          />
        )}
      </div>

      {/* Right contact panel — hidden during initial load */}
      {!isLoading && (
        <div className="hidden lg:flex w-[260px] shrink-0 flex-col border-l border-border/30 bg-muted/50 dark:bg-[hsl(220,6%,5%)]">
          <ContactPanel
            emailId={contactEmailId}
            contactEmail={sidebarContactEmail}
            emails={emails}
          />
        </div>
      )}
    </div>
  );
}
