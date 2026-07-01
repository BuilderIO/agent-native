import { useT } from "@agent-native/core/client";
import {
  isInboxScopedAppLabel,
  mailLabelsInclude,
  mailLabelsIncludeAny,
} from "@shared/gmail-labels";
import type { EmailMessage } from "@shared/types";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";

import { EmailList, InboxZero } from "@/components/email/EmailList";
import { EmailThread } from "@/components/email/EmailThread";
import { IntegrationsSidebar } from "@/components/email/IntegrationsSidebar";
import { GoogleConnectBanner } from "@/components/GoogleConnectBanner";
import { useAccountFilter } from "@/hooks/use-account-filter";
import {
  FOCUS_COMPOSE_DRAFT_EVENT,
  useComposeState,
} from "@/hooks/use-compose-state";
import { useEmails, useMarkRead, useSettings } from "@/hooks/use-emails";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNavigationState } from "@/hooks/use-navigation-state";
import {
  resolvePinnedLabels,
  pinnedTriageLabels,
  augmentSelfSentLabels,
  filterInboxTabEmails,
} from "@/lib/inbox-tabs";
import { groupIntoThreads, type ThreadSummary } from "@/lib/threads";
import { cn } from "@/lib/utils";

function ContactPanel({
  emailId,
  contactEmail,
  emails,
}: {
  emailId: string | undefined;
  contactEmail?: string;
  emails: EmailMessage[];
}) {
  const t = useT();
  // Look up from already-cached list data instead of making a separate API call
  const email = useMemo(
    () =>
      emails.find((e) => e.id === emailId || (e.threadId || e.id) === emailId),
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
        <p className="text-xs text-muted-foreground/40">
          {t("mail.contacts.noContactSelected")}
        </p>
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
      threadId={email?.threadId}
      focusedEmailId={email?.id ?? emailId}
    />
  );
}

function formatSidebarSender(thread: ThreadSummary): string {
  if (thread.messageCount <= 1) {
    return thread.latestMessage.from.name || thread.latestMessage.from.email;
  }

  if (thread.participants.length <= 1) return thread.participants[0] || "";
  const firstNames = thread.participants.map(
    (participant) => participant.split(" ")[0],
  );
  if (firstNames.length <= 2) return firstNames.join(", ");
  return `${firstNames[0]} .. ${firstNames[firstNames.length - 1]}`;
}

function ThreadListSidebar({
  emails,
  activeThreadId,
  view,
  routeSearchSuffix,
  selectedIds,
  setSelectedIds,
  onNavigateThread,
}: {
  emails: EmailMessage[];
  activeThreadId: string;
  view: string;
  routeSearchSuffix: string;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  onNavigateThread: (threadId: string) => void;
}) {
  const navigate = useNavigate();
  const markRead = useMarkRead();
  const threads = useMemo(() => groupIntoThreads(emails), [emails]);
  const selectAllThreads = useCallback(() => {
    if (threads.length === 0) return;
    setSelectedIds(
      new Set(
        threads.map(
          (thread) => thread.latestMessage.threadId || thread.latestMessage.id,
        ),
      ),
    );
  }, [threads, setSelectedIds]);

  useKeyboardShortcuts([{ key: "a", meta: true, handler: selectAllThreads }]);

  return (
    <div className="flex h-full w-[220px] min-w-0 shrink-0 flex-col overflow-hidden border-e border-border/30 bg-muted/50 dark:bg-[hsl(220,6%,5%)]">
      <div className="flex-1 overflow-y-auto">
        {threads.map((thread) => {
          const email = thread.latestMessage;
          const threadKey = email.threadId || email.id;
          const isActive = threadKey === activeThreadId;
          const isMultiSelected = selectedIds.has(threadKey);
          const senderName = formatSidebarSender(thread);
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
                onNavigateThread(threadKey);
                navigate(`/${view}/${threadKey}${routeSearchSuffix}`);
              }}
              className={cn(
                "w-full text-start px-3 h-[38px] flex items-center border-b border-border/10 transition-colors",
                isMultiSelected
                  ? "bg-primary/20 ring-1 ring-inset ring-primary/40"
                  : isActive
                    ? "bg-primary/10"
                    : "hover:bg-accent dark:hover:bg-[hsl(220,5%,13%)]",
              )}
            >
              <div className="flex items-center gap-1.5 min-w-0 w-full">
                {thread.hasUnread && (
                  <div className="h-[7px] w-[7px] rounded-full bg-primary shrink-0" />
                )}
                <span
                  className={cn(
                    "max-w-[46%] shrink-0 truncate text-[13px]",
                    thread.hasUnread
                      ? "font-semibold text-foreground"
                      : "text-foreground/90",
                  )}
                  title={senderName}
                >
                  {senderName}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[13px]",
                    thread.hasUnread
                      ? "font-medium text-foreground"
                      : "text-muted-foreground/90",
                  )}
                  title={email.subject}
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
const EMPTY_EMAILS: EmailMessage[] = [];

export function InboxPage() {
  const { view = "inbox", threadId: routeThreadId } = useParams<{
    view: string;
    threadId: string;
  }>();
  const navigate = useNavigate();
  // Immediate thread route override. React Router wraps navigations in
  // startTransition, which can leave the previous route visible until the new
  // route commits. `undefined` means "use the URL", a string means "show this
  // thread now", and `null` means "show the list now".
  const [optimisticThreadId, setOptimisticThreadId] = useState<
    string | null | undefined
  >(undefined);
  const threadId =
    optimisticThreadId === undefined
      ? routeThreadId
      : (optimisticThreadId ?? undefined);
  const handleOptimisticThreadNavigation = useCallback(
    (nextThreadId: string | undefined) => {
      setOptimisticThreadId(nextThreadId ?? null);
    },
    [],
  );
  // Clear the override once the URL catches up.
  useEffect(() => {
    if (optimisticThreadId === undefined) return;
    if (
      optimisticThreadId === null
        ? !routeThreadId
        : routeThreadId === optimisticThreadId
    ) {
      setOptimisticThreadId(undefined);
    }
  }, [routeThreadId, optimisticThreadId]);

  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedThreadIds = useMemo(
    () => Array.from(selectedIds),
    [selectedIds],
  );
  const [isMaximized, setIsMaximized] = useState(false);
  const compose = useComposeState();
  const navState = useNavigationState();
  const [, setLastArchivedId] = useState<string | null>(null);
  const { data: settings } = useSettings();
  const [searchParams] = useSearchParams();
  const activeLabel = searchParams.get("label");
  const routeSearchSuffix = searchParams.toString()
    ? `?${searchParams.toString()}`
    : "";

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
    () => resolvePinnedLabels(userPinnedLabels, isGoogleConnected),
    [isGoogleConnected, userPinnedLabels],
  );
  const triageLabels = useMemo(
    () => pinnedTriageLabels(pinnedLabels),
    [pinnedLabels],
  );
  const hasNoteToSelf = pinnedLabels.includes("note-to-self");

  // Always fetch from the URL view (inbox, starred, etc.).
  // Top-bar triage tabs (Important / pinned labels / "Other") are slices of
  // the single inbox query — NOT a separate Gmail `label:` search — so the
  // tab badge count and the list it shows always agree. Non-pinned sidebar
  // labels (and label searches) still hit the server label query.
  const searchQuery = searchParams.get("q") ?? undefined;
  const isPinnedTab =
    !!activeLabel &&
    view === "inbox" &&
    mailLabelsInclude(triageLabels, activeLabel);
  const clientSliceTab = isPinnedTab && !searchQuery;
  const effectiveLabel = clientSliceTab
    ? undefined
    : (activeLabel ?? undefined);
  const {
    data: rawEmails,
    isLoading,
    isFetching,
    isError,
    error: emailsError,
    refetch: refetchEmails,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useEmails(view, searchQuery, effectiveLabel);
  const hasEmailData = rawEmails !== undefined;
  const emailListLoading =
    isLoading ||
    !hasEmailData ||
    (!googleStatus.data && googleStatus.isLoading);

  const emails = useMemo(() => {
    // Self-sent mail → virtual "important"/"note-to-self" so it lands in the
    // matching triage tab. Shared with the badge counts (AppLayout) so the
    // two agree on self-sent threads.
    let filtered = augmentSelfSentLabels(rawEmails ?? EMPTY_EMAILS, {
      isGoogleConnected,
      connectedEmails,
      hasNoteToSelf,
    });

    // Filter by active accounts (empty set = all accounts, no filtering)
    if (activeAccounts.size > 0) {
      filtered = filtered.filter(
        (e) => e.accountEmail && activeAccounts.has(e.accountEmail),
      );
    }

    // Top-bar triage tab: slice the loaded inbox with the exact same
    // membership rule the badge uses (qualifiesForInboxTab). This is what
    // keeps the tab number equal to the emails listed under it.
    if (clientSliceTab && activeLabel) {
      return filterInboxTabEmails(filtered, activeLabel, pinnedLabels);
    }
    // "Other" tab — the inbox remainder, same partition as its badge.
    if (
      !searchQuery &&
      view === "inbox" &&
      !activeLabel &&
      triageLabels.length > 0
    ) {
      return filterInboxTabEmails(filtered, null, pinnedLabels);
    }

    if (activeLabel) {
      // Non-pinned sidebar label (or a label search): server-fetched. User
      // Gmail labels keep thread membership when any fetched message carries
      // the label, so replies don't disappear just because the latest row
      // differs; inbox-scoped app labels stay a latest-message slice.
      const isInboxScopedLabel = isInboxScopedAppLabel(activeLabel);
      const hasLabel = (e: (typeof filtered)[0]) =>
        mailLabelsInclude(e.labelIds, activeLabel);
      const latestByThread = new Map<string, (typeof filtered)[0]>();
      const labelThreadIds = new Set<string>();
      for (const e of filtered) {
        const key = e.threadId || e.id;
        if (hasLabel(e)) labelThreadIds.add(key);
        const existing = latestByThread.get(key);
        if (!existing || new Date(e.date) > new Date(existing.date)) {
          latestByThread.set(key, e);
        }
      }
      // For "important", exclude threads that belong to any other pinned tab
      const otherPinnedLabels =
        activeLabel === "important"
          ? triageLabels.filter((l) => l !== "important")
          : [];
      const qualifiedThreadIds = new Set(
        [...latestByThread.entries()]
          .filter(([threadKey, latest]) => {
            if (
              isInboxScopedLabel
                ? !hasLabel(latest)
                : !labelThreadIds.has(threadKey)
            )
              return false;
            if (
              otherPinnedLabels.length > 0 &&
              mailLabelsIncludeAny(latest.labelIds, otherPinnedLabels)
            )
              return false;
            return true;
          })
          .map(([threadId]) => threadId),
      );
      return filtered.filter((e) => qualifiedThreadIds.has(e.threadId || e.id));
    }
    return filtered;
  }, [
    rawEmails,
    view,
    searchQuery,
    activeLabel,
    clientSliceTab,
    pinnedLabels,
    triageLabels,
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
      selectedThreadIds:
        selectedThreadIds.length > 0 ? selectedThreadIds : undefined,
    });
  }, [view, threadId, focusedId, searchQ, activeLabel, selectedThreadIds]); // eslint-disable-line react-hooks/exhaustive-deps

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

    if (navCommand.composeDraftId && !targetThread) {
      // A deep link reopened a compose draft. The open route already wrote the
      // matching compose-<id> app-state entry, which the compose panel
      // auto-opens via polling. Select the requested draft immediately so
      // existing compose tabs do not keep focus when the draft arrives.
      compose.setActiveId(navCommand.composeDraftId);
      window.dispatchEvent(
        new CustomEvent(FOCUS_COMPOSE_DRAFT_EVENT, {
          detail: { id: navCommand.composeDraftId },
        }),
      );
      if (view !== "inbox") navigate("/inbox");
    } else if (targetView === "draft-queue") {
      const target = navCommand.queuedDraftId
        ? `/draft-queue?id=${encodeURIComponent(navCommand.queuedDraftId)}`
        : "/draft-queue";
      navigate(target);
    } else if (targetView === "settings") {
      const target = navCommand.settingsSection
        ? `/settings?section=${encodeURIComponent(navCommand.settingsSection)}`
        : "/settings";
      navigate(target);
    } else if (targetThread) {
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

  // Safety valve: if optimisticThreadId points to a thread that was removed from
  // the view (archived/trashed before the route caught up), clear it so the
  // app doesn't get stuck rendering a ghost thread.
  useEffect(() => {
    if (
      optimisticThreadId &&
      threads.length > 0 &&
      !threads.some(
        (t) =>
          (t.latestMessage.threadId || t.latestMessage.id) ===
          optimisticThreadId,
      )
    ) {
      setOptimisticThreadId(undefined);
    }
  }, [optimisticThreadId, threads]);

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

  // Open a saved draft in the compose window
  const handleDraftOpen = useCallback(
    (email: EmailMessage) => {
      compose.open({
        to: email.to.map((r) => r.email).join(", "),
        cc: email.cc?.map((r) => r.email).join(", ") ?? "",
        bcc: email.bcc?.map((r) => r.email).join(", ") ?? "",
        subject: email.subject === "(no subject)" ? "" : email.subject,
        body: email.body,
        attachments: email.attachments?.map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          originalName: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
          url: `/api/attachments?messageId=${encodeURIComponent(
            email.id,
          )}&id=${encodeURIComponent(
            attachment.id,
          )}&mimeType=${encodeURIComponent(attachment.mimeType)}`,
          source: "gmail",
          gmailMessageId: email.id,
          gmailAttachmentId: attachment.id,
          accountEmail: email.accountEmail,
        })),
        mode: "compose",
        replyToId: (email as any).replyToId,
        replyToThreadId: (email as any).replyToThreadId,
        savedDraftId: email.id,
      });
    },
    [compose],
  );

  const isMobile = useIsMobile();
  const hasThread = !!threadId;
  const showsScenicInboxZero =
    view === "inbox" && (!activeLabel || activeLabel === "important");
  const isInboxZero =
    showsScenicInboxZero &&
    hasEmailData &&
    !emailListLoading &&
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
  // For transient errors (rate limits, network blips), let EmailList render its
  // richer retry/cooldown state instead of replacing it with a generic error.
  if (isError && !hasThread && threads.length === 0) {
    const message = emailsError?.message ?? "";
    const needsGoogleConnection =
      /No Google account connected|GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET/i.test(
        message,
      );
    if (
      needsGoogleConnection ||
      (!googleStatus.isLoading && googleStatus.data?.connected === false)
    ) {
      return <GoogleConnectBanner variant="hero" />;
    }
  }

  // Inbox Zero — full-bleed image, no sidebar
  if (isInboxZero) {
    return <InboxZero />;
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main content */}
      {hasThread && !isMobile && !isMaximized && (
        <ThreadListSidebar
          emails={emails}
          activeThreadId={threadId}
          view={view}
          routeSearchSuffix={routeSearchSuffix}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          onNavigateThread={handleOptimisticThreadNavigation}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {hasThread ? (
          <EmailThread
            activeThreadId={threadId}
            onArchived={setLastArchivedId}
            emailIds={threadIds}
            threads={threads}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            onContactSelect={setSidebarContactEmail}
            onNavigateThread={handleOptimisticThreadNavigation}
            isMaximized={isMaximized}
            onToggleMaximize={() => setIsMaximized((v) => !v)}
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
            onNavigateThread={handleOptimisticThreadNavigation}
            isLoading={emailListLoading}
            isFetching={isFetching}
            emailsError={emailsError}
            refetchEmails={refetchEmails}
            hasNextPage={hasNextPage}
            fetchNextPage={fetchNextPage}
            isFetchingNextPage={isFetchingNextPage}
          />
        )}
      </div>

      {/* Right contact panel — hidden during initial load or when maximized */}
      {!emailListLoading && !(hasThread && isMaximized) && (
        <div className="mail-contact-side-panel hidden w-[260px] shrink-0 flex-col border-s border-border/30 bg-muted/50 dark:bg-[hsl(220,6%,5%)]">
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
