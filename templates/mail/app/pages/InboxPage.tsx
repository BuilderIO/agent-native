import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { normalizeDocumentTitle } from "@agent-native/core/shared";
import { AI_PRIORITY_MAX_EMAILS, type MailSortMode } from "@shared/ai-priority";
import {
  isInboxScopedAppLabel,
  mailLabelsInclude,
  mailLabelsIncludeAny,
} from "@shared/gmail-labels";
import { ALL_TAB_PARAM, inboxTabHref } from "@shared/inbox-threads";
import type { EmailMessage } from "@shared/types";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { EmailList, InboxZero } from "@/components/email/EmailList";
import { EmailThread } from "@/components/email/EmailThread";
import { IntegrationsSidebar } from "@/components/email/IntegrationsSidebar";
import { GoogleConnectBanner } from "@/components/GoogleConnectBanner";
import { useAccountFilter } from "@/hooks/use-account-filter";
import {
  FOCUS_COMPOSE_DRAFT_EVENT,
  useComposeState,
} from "@/hooks/use-compose-state";
import {
  EMPTY_LABELS,
  useEmails,
  useLabels,
  useMarkRead,
  useSettings,
} from "@/hooks/use-emails";
import { useGoogleAuthStatus } from "@/hooks/use-google-auth";
import {
  INBOX_PAGE_SIZE,
  inboxThreadsHasNextPage,
  mergeInboxThreadPages,
  resolveInboxTabId,
  useInboxOverview,
  useInboxThreads,
  useInboxThreadsPages,
} from "@/hooks/use-inbox-threads";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNavigationState } from "@/hooks/use-navigation-state";
import {
  OTHER_INBOX_TAB_PARAM,
  resolvePinnedLabels,
  resolveDefaultMailHref,
  pinnedTriageLabels,
  augmentSelfSentLabels,
  filterInboxTabEmails,
  inboxThreadKey,
  savedFilterThreadIds,
} from "@/lib/inbox-tabs";
import {
  buildForwardDraft,
  buildReplyDraft,
} from "@/lib/message-draft-builders";
import { savedEmailDraftMetadata } from "@/lib/saved-draft";
import { groupIntoThreads, type ThreadSummary } from "@/lib/threads";
import { cn } from "@/lib/utils";

import { shouldShowInboxZero } from "./inbox-zero";

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
  const email = useMemo(
    () =>
      emails.find((e) => e.id === emailId || (e.threadId || e.id) === emailId),
    [emails, emailId],
  );
  const displayEmail = contactEmail || email?.from.email;
  const displayName = contactEmail
    ? contactEmail
    : email?.from.name || email?.from.email;
  const normalizedDisplayEmail = displayEmail?.trim().toLowerCase() ?? "";
  const {
    data: allEmails = [],
    isError: allEmailsError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useEmails("all", normalizedDisplayEmail || undefined, undefined, {
    enabled: Boolean(normalizedDisplayEmail),
  });
  const contactPageFetchesRef = useRef(0);
  const contactGenerationRef = useRef(0);

  useEffect(() => {
    contactPageFetchesRef.current = 0;
    contactGenerationRef.current += 1;
  }, [normalizedDisplayEmail]);

  const recentFromContact = displayEmail
    ? allEmails
        .filter((e) => {
          if (e.id === emailId) return false;
          const participants = [
            e.from,
            ...e.to,
            ...(e.cc ?? []),
            ...(e.bcc ?? []),
          ];
          return participants.some(
            (participant) =>
              participant.email.trim().toLowerCase() === normalizedDisplayEmail,
          );
        })
        .slice(0, 4)
        .map((e) => ({ id: e.id, subject: e.subject }))
    : [];

  useEffect(() => {
    const maxContactPages = 4;
    if (
      !normalizedDisplayEmail ||
      recentFromContact.length >= 4 ||
      !hasNextPage ||
      isFetchingNextPage ||
      isFetchNextPageError ||
      contactPageFetchesRef.current >= maxContactPages
    ) {
      return;
    }
    const contactGeneration = contactGenerationRef.current;
    contactPageFetchesRef.current += 1;
    void fetchNextPage().catch(() => {
      if (contactGenerationRef.current === contactGeneration) {
        contactPageFetchesRef.current = maxContactPages;
      }
    });
  }, [
    fetchNextPage,
    hasNextPage,
    isFetchNextPageError,
    isFetchingNextPage,
    normalizedDisplayEmail,
    recentFromContact.length,
  ]);

  if (!displayEmail) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-muted-foreground/40">
          {t("mail.contacts.noContactSelected")}
        </p>
      </div>
    );
  }

  return (
    <IntegrationsSidebar
      email={displayEmail}
      displayName={displayName || displayEmail}
      recentEmails={recentFromContact}
      recentEmailsError={allEmailsError}
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
    <div className="flex h-full w-[220px] min-w-0 shrink-0 flex-col overflow-hidden border-e border-border/30 bg-muted/50 dark:bg-[var(--mail-sidebar-surface)]">
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
                setSelectedIds(new Set());
                if (!email.isRead)
                  markRead.mutate({
                    id: email.id,
                    isRead: true,
                    accountEmail: email.accountEmail,
                    threadId: email.threadId || email.id,
                  });
                onNavigateThread(threadKey);
                void navigate(`/${view}/${threadKey}${routeSearchSuffix}`);
              }}
              className={cn(
                "w-full text-start px-3 h-[38px] flex items-center border-b border-border/10 transition-colors",
                isMultiSelected
                  ? "bg-primary/20 ring-1 ring-inset ring-primary/40"
                  : isActive
                    ? "bg-primary/10"
                    : "hover:bg-accent dark:hover:bg-[var(--mail-sidebar-hover-surface)]",
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

const EMPTY_ACCOUNTS: { email: string; displayName?: string }[] = [];
const EMPTY_EMAILS: EmailMessage[] = [];

export function InboxPage() {
  const t = useT();
  const { view = "inbox", threadId: routeThreadId } = useParams<{
    view: string;
    threadId: string;
  }>();
  const navigate = useNavigate();
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
  const [sortMode, setSortMode] = useState<MailSortMode>(() => {
    try {
      return localStorage.getItem("mail-sort-mode") === "priority"
        ? "priority"
        : "newest";
    } catch {
      return "newest";
    }
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedThreadIds = useMemo(
    () => Array.from(selectedIds),
    [selectedIds],
  );
  const [isMaximized, setIsMaximized] = useState(false);
  const compose = useComposeState();
  const navState = useNavigationState();
  const [, setLastArchivedId] = useState<string | null>(null);
  const {
    data: settings,
    isLoading: settingsLoading,
    isError: settingsError,
  } = useSettings();
  const jevAvailability = useActionQuery(
    "get-jev-availability",
    {},
    {
      enabled: view === "inbox" || navState.command.data?.sort === "priority",
      staleTime: 0,
      // request-storm-allow: the shared status query revalidates API-key setup when its settings tab returns.
      refetchOnWindowFocus: true,
      retry: 2,
    },
  );
  const jevConfigured =
    !jevAvailability.isError && jevAvailability.data?.configured === true;
  const showPrioritySort =
    jevConfigured || (jevAvailability.isError && sortMode === "priority");
  const changeSortMode = useCallback((mode: MailSortMode) => {
    setSortMode(mode);
    try {
      localStorage.setItem("mail-sort-mode", mode);
      // coercion-ok: server preference remains available when browser storage is restricted.
    } catch {
      // The server preference remains available when browser storage is restricted.
    }
  }, []);
  const toggleSortMode = useCallback(() => {
    if (showPrioritySort) {
      changeSortMode(sortMode === "priority" ? "newest" : "priority");
    }
  }, [changeSortMode, showPrioritySort, sortMode]);
  useKeyboardShortcuts([{ key: "i", meta: true, handler: toggleSortMode }]);
  const [searchParams] = useSearchParams();
  const activeLabel = searchParams.get("label");
  const activeInboxTab = searchParams.get("tab");
  const activeFilterId = searchParams.get("filter");
  const routeSearchSuffix = searchParams.toString()
    ? `?${searchParams.toString()}`
    : "";

  const googleStatus = useGoogleAuthStatus();
  const { activeAccounts, allAccounts } = useAccountFilter();
  const myEmails = useMemo(() => {
    const emails = new Set(
      allAccounts.map((account) => account.email.toLowerCase()),
    );
    if (settings?.email) emails.add(settings.email.toLowerCase());
    return emails;
  }, [allAccounts, settings?.email]);
  const { data: labelsData, accountErrors: labelAccountErrors } = useLabels(
    activeAccounts.size > 0 ? [...activeAccounts] : undefined,
  );
  const labels = labelsData ?? EMPTY_LABELS;

  const connectedAccounts = useMemo(
    () => googleStatus.data?.accounts ?? EMPTY_ACCOUNTS,
    [googleStatus.data?.accounts],
  );
  const isGoogleConnected = connectedAccounts.length > 0;
  const connectedEmails = useMemo(
    () => new Set(connectedAccounts.map((a) => a.email.toLowerCase())),
    [connectedAccounts],
  );
  const userPinnedLabels = settings?.pinnedLabels;
  const combineInbox = settings?.combineInbox === true;
  const pinnedLabels = useMemo(
    () => resolvePinnedLabels(userPinnedLabels, isGoogleConnected),
    [isGoogleConnected, userPinnedLabels],
  );
  const triageLabels = useMemo(
    () => pinnedTriageLabels(pinnedLabels),
    [pinnedLabels],
  );
  const hasNoteToSelf = pinnedLabels.includes("note-to-self");
  const activeLabelRecord = useMemo(() => {
    if (!activeLabel) return undefined;
    const normalizedId = activeLabel.includes("/")
      ? activeLabel
          .slice(activeLabel.lastIndexOf("/") + 1)
          .replace(/_/g, " ")
          .toLowerCase()
      : activeLabel.toLowerCase();
    return labels.find(
      (label) =>
        label.id === activeLabel ||
        label.id === normalizedId ||
        label.name.toLowerCase() === activeLabel.toLowerCase(),
    );
  }, [activeLabel, labels]);
  const activeLabelIsInboxScoped =
    !!activeLabel &&
    activeLabelRecord?.type !== "user" &&
    isInboxScopedAppLabel(activeLabelRecord?.id ?? activeLabel);
  const shouldNormalizeCombinedInboxRoute =
    combineInbox &&
    view === "inbox" &&
    (activeLabelIsInboxScoped ||
      activeInboxTab === OTHER_INBOX_TAB_PARAM ||
      activeInboxTab === ALL_TAB_PARAM);

  const activeSavedFilter = settings?.savedFilters?.find(
    (filter) => filter.id === activeFilterId,
  );
  const savedFilterQueries = useMemo(
    () => (settings?.savedFilters ?? []).map((filter) => filter.query),
    [settings?.savedFilters],
  );
  const searchQuery =
    activeSavedFilter?.query ?? searchParams.get("q") ?? undefined;

  const isInboxView = view === "inbox" && !searchParams.get("q");
  useEffect(() => {
    try {
      if (
        localStorage.getItem("mail-sort-mode") === null &&
        settings?.sortMode
      ) {
        setSortMode(settings.sortMode);
      }
    } catch {
      if (settings?.sortMode) setSortMode(settings.sortMode);
    }
  }, [settings?.sortMode]);
  useEffect(() => {
    if (
      jevAvailability.isSuccess &&
      !jevConfigured &&
      sortMode === "priority"
    ) {
      changeSortMode("newest");
    }
  }, [changeSortMode, jevAvailability.isSuccess, jevConfigured, sortMode]);
  useEffect(() => {
    if (jevAvailability.isError && sortMode === "priority") {
      toast.error(t("mail.sort.priorityFailed"));
    }
  }, [jevAvailability.isError, sortMode, t]);
  const resolvedInboxTab = resolveInboxTabId(searchParams);
  const inboxAccountEmails =
    activeAccounts.size > 0 ? [...activeAccounts] : undefined;
  const inboxThreads = useInboxThreads(
    {
      tab: resolvedInboxTab,
      accountEmails: inboxAccountEmails,
      limit: INBOX_PAGE_SIZE,
      offset: 0,
    },
    { enabled: view === "inbox" },
  );
  const inboxOverview = useInboxOverview(inboxAccountEmails);
  const inboxMetadata =
    inboxOverview.data ??
    (inboxThreads.isPlaceholderData ? undefined : inboxThreads.data);
  const [inboxExtraPageCount, setInboxExtraPageCount] = useState(0);
  useEffect(() => {
    const priorityExtraPages = Math.max(
      0,
      Math.ceil(AI_PRIORITY_MAX_EMAILS / INBOX_PAGE_SIZE) - 1,
    );
    setInboxExtraPageCount(
      showPrioritySort && isInboxView && sortMode === "priority"
        ? priorityExtraPages
        : 0,
    );
  }, [
    activeAccounts,
    isInboxView,
    showPrioritySort,
    resolvedInboxTab,
    sortMode,
  ]);
  const inboxExtraOffsets = useMemo(
    () =>
      Array.from(
        { length: inboxExtraPageCount },
        (_, i) => (i + 1) * INBOX_PAGE_SIZE,
      ),
    [inboxExtraPageCount],
  );
  const inboxExtraPages = useInboxThreadsPages(
    {
      tab: resolvedInboxTab,
      accountEmails: inboxAccountEmails,
      limit: INBOX_PAGE_SIZE,
    },
    inboxExtraOffsets,
    { enabled: isInboxView && inboxExtraOffsets.length > 0 },
  );
  const inboxItems = useMemo(
    () => [
      ...(inboxThreads.data?.items ?? []),
      ...mergeInboxThreadPages(inboxExtraPages.map((page) => page.data)),
    ],
    [inboxThreads.data?.items, inboxExtraPages],
  );
  const inboxHasNextPage =
    isInboxView && inboxThreads.data !== undefined
      ? inboxThreadsHasNextPage(inboxItems.length, inboxThreads.data.total)
      : false;
  const inboxIsFetchingNextPage = inboxExtraPages.some(
    (page) => page.isFetching,
  );
  const inboxIsFetchNextPageError = inboxExtraPages.some(
    (page) => page.isError,
  );
  const fetchInboxNextPage = useCallback(() => {
    if (!inboxHasNextPage || inboxIsFetchingNextPage) return Promise.resolve();
    const lastPage = inboxExtraPages[inboxExtraPages.length - 1];
    if (lastPage?.isError) {
      return lastPage.refetch().then(() => undefined);
    }
    setInboxExtraPageCount((count) => count + 1);
    return Promise.resolve();
  }, [inboxHasNextPage, inboxIsFetchingNextPage, inboxExtraPages]);
  const inboxAccountErrors = useMemo(() => {
    if (inboxThreads.isPlaceholderData) return undefined;
    const errored = inboxMetadata?.accounts.filter(
      (account) =>
        account.state === "error" || account.state === "needs_reauth",
    );
    const inboxErrors = errored?.length
      ? errored.map((account) => ({
          email: account.accountEmail,
          error: account.error ?? "",
        }))
      : [];
    const reportedEmails = new Set(inboxErrors.map((e) => e.email));
    const labelErrors = (labelAccountErrors ?? []).filter(
      (e) => !reportedEmails.has(e.email),
    );
    const combined = [...inboxErrors, ...labelErrors];
    return combined.length ? combined : undefined;
  }, [
    inboxMetadata?.accounts,
    inboxThreads.isPlaceholderData,
    labelAccountErrors,
  ]);

  useEffect(() => {
    if (
      settingsLoading ||
      settingsError ||
      !settings ||
      view !== "inbox" ||
      routeThreadId ||
      activeLabel ||
      activeInboxTab ||
      activeFilterId ||
      searchQuery ||
      combineInbox
    )
      return;
    const defaultHref = resolveDefaultMailHref({
      combineInbox,
      showAllTab: settings?.showAllTab,
      pinnedLabels: userPinnedLabels,
      savedFilters: settings?.savedFilters,
      isGoogleConnected,
    });
    if (defaultHref !== "/inbox") {
      void navigate(defaultHref, { replace: true });
    }
  }, [
    activeFilterId,
    activeInboxTab,
    activeLabel,
    combineInbox,
    isGoogleConnected,
    navigate,
    routeThreadId,
    searchQuery,
    settings,
    settingsError,
    settingsLoading,
    userPinnedLabels,
    view,
  ]);

  useEffect(() => {
    if (!shouldNormalizeCombinedInboxRoute) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("label");
    nextParams.delete("tab");
    const search = nextParams.toString();
    void navigate(
      {
        pathname: "/inbox",
        search: search ? `?${search}` : "",
      },
      { replace: true },
    );
  }, [navigate, searchParams, shouldNormalizeCombinedInboxRoute]);

  const isPinnedTab =
    !!activeLabel &&
    view === "inbox" &&
    mailLabelsInclude(triageLabels, activeLabel);
  const mailboxWideLabelTab =
    view === "inbox" && !!activeLabel && !activeLabelIsInboxScoped;
  const clientSliceTab =
    !combineInbox && isPinnedTab && !searchQuery && !mailboxWideLabelTab;
  const isOtherTab =
    view === "inbox" &&
    !combineInbox &&
    activeInboxTab === OTHER_INBOX_TAB_PARAM &&
    !searchQuery;
  const effectiveLabel = shouldNormalizeCombinedInboxRoute
    ? undefined
    : clientSliceTab
      ? undefined
      : (activeLabel ?? undefined);
  const emailView = activeSavedFilter
    ? "inbox"
    : mailboxWideLabelTab
      ? "all"
      : view;
  const {
    data: fetchedEmails,
    isLoading: emailsIsLoading,
    isFetching: emailsIsFetching,
    isError: emailsIsError,
    error: emailsFetchError,
    refetch: refetchFetchedEmails,
    hasNextPage: emailsHasNextPage,
    fetchNextPage: emailsFetchNextPage,
    isFetchingNextPage: emailsIsFetchingNextPage,
    isFetchNextPageError: emailsIsFetchNextPageError,
    accountErrors: emailsAccountErrors,
  } = useEmails(emailView, searchQuery, effectiveLabel, {
    enabled: !isInboxView,
  });

  const rawEmails = isInboxView ? inboxItems : fetchedEmails;
  const hasEmailData = isInboxView
    ? inboxThreads.data !== undefined
    : fetchedEmails !== undefined;
  const inboxStillSyncingEmpty =
    isInboxView && inboxMetadata?.syncing === true && inboxItems.length === 0;
  const isLoading = isInboxView
    ? inboxThreads.isLoading ||
      inboxThreads.isPlaceholderData ||
      inboxStillSyncingEmpty
    : emailsIsLoading;
  const isFetching = isInboxView ? inboxThreads.isFetching : emailsIsFetching;
  const isError = isInboxView ? inboxThreads.isError : emailsIsError;
  const emailsError = isInboxView
    ? (inboxThreads.error ?? null)
    : emailsFetchError;
  const refetchEmails = isInboxView
    ? inboxThreads.refetch
    : refetchFetchedEmails;
  const hasNextPage = isInboxView ? inboxHasNextPage : emailsHasNextPage;
  const fetchNextPage = isInboxView ? fetchInboxNextPage : emailsFetchNextPage;
  const isFetchingNextPage = isInboxView
    ? inboxIsFetchingNextPage
    : emailsIsFetchingNextPage;
  const isFetchNextPageError = isInboxView
    ? inboxIsFetchNextPageError
    : emailsIsFetchNextPageError;
  const accountErrors = isInboxView ? inboxAccountErrors : emailsAccountErrors;
  const emailListLoading =
    isLoading ||
    !hasEmailData ||
    (!googleStatus.data && googleStatus.isLoading);

  const emails = useMemo(() => {
    if (isInboxView) return rawEmails ?? EMPTY_EMAILS;

    let filtered = augmentSelfSentLabels(rawEmails ?? EMPTY_EMAILS, {
      isGoogleConnected,
      connectedEmails,
      hasNoteToSelf,
    });

    if (activeAccounts.size > 0) {
      filtered = filtered.filter(
        (e) => e.accountEmail && activeAccounts.has(e.accountEmail),
      );
    }

    if (shouldNormalizeCombinedInboxRoute) return filtered;

    if (clientSliceTab && activeLabel) {
      return filterInboxTabEmails(
        filtered,
        activeLabel,
        pinnedLabels,
        savedFilterQueries,
      );
    }
    if (isOtherTab) {
      return filterInboxTabEmails(
        filtered,
        null,
        pinnedLabels,
        savedFilterQueries,
      );
    }

    if (activeLabel) {
      const isInboxScopedLabel = activeLabelIsInboxScoped;
      const hasLabel = (e: (typeof filtered)[0]) =>
        mailLabelsInclude(e.labelIds, activeLabel);
      const latestByThread = new Map<string, (typeof filtered)[0]>();
      const labelThreadIds = new Set<string>();
      for (const e of filtered) {
        const key = inboxThreadKey(e);
        if (hasLabel(e)) labelThreadIds.add(key);
        const existing = latestByThread.get(key);
        if (!existing || new Date(e.date) > new Date(existing.date)) {
          latestByThread.set(key, e);
        }
      }
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
      return filtered.filter((e) => qualifiedThreadIds.has(inboxThreadKey(e)));
    }
    if (view === "inbox" && !searchQuery && savedFilterQueries.length > 0) {
      const savedFilterThreads = savedFilterThreadIds(
        filtered,
        savedFilterQueries,
      );
      return filtered.filter((e) => !savedFilterThreads.has(inboxThreadKey(e)));
    }
    return filtered;
  }, [
    rawEmails,
    isInboxView,
    view,
    searchQuery,
    activeLabel,
    isOtherTab,
    clientSliceTab,
    pinnedLabels,
    triageLabels,
    activeAccounts,
    isGoogleConnected,
    connectedEmails,
    hasNoteToSelf,
    activeLabelIsInboxScoped,
    shouldNormalizeCombinedInboxRoute,
    savedFilterQueries,
  ]);

  useEffect(
    () => setSelectedIds(new Set()),
    [view, activeLabel, activeInboxTab, activeFilterId],
  );

  const searchQ = searchQuery;
  useEffect(() => {
    navState.sync({
      view,
      threadId,
      focusedEmailId: focusedId ?? undefined,
      search: searchQ,
      label: activeLabel ?? undefined,
      filter: activeFilterId ?? undefined,
      activeInboxTab:
        view === "inbox"
          ? (inboxThreads.data?.activeTabId ?? resolvedInboxTab)
          : (activeInboxTab ?? undefined),
      activeAccounts:
        activeAccounts.size > 0 ? Array.from(activeAccounts) : undefined,
      selectedThreadIds:
        selectedThreadIds.length > 0 ? selectedThreadIds : undefined,
      sort: sortMode === "priority" && showPrioritySort ? sortMode : undefined,
    });
  }, [
    view,
    threadId,
    focusedId,
    searchQ,
    activeLabel,
    activeFilterId,
    isInboxView,
    inboxThreads.data?.activeTabId,
    resolvedInboxTab,
    activeInboxTab,
    activeAccounts,
    selectedThreadIds,
    showPrioritySort,
    jevAvailability.isError,
    sortMode,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: navCommand } = navState.command;
  const lastCommandRef = useRef<string>("");
  useEffect(() => {
    if (!navCommand) return;
    if (navCommand.sort === "priority" && jevAvailability.isLoading) {
      return;
    }
    const key = JSON.stringify(navCommand);
    if (key === lastCommandRef.current) return;
    lastCommandRef.current = key;

    const targetView = navCommand.view || view;
    const targetFilter = navCommand.filter;
    const targetThread = navCommand.threadId;

    if (navCommand.sort === "newest") {
      changeSortMode("newest");
    } else if (navCommand.sort === "priority") {
      changeSortMode(
        jevAvailability.isError || jevConfigured ? "priority" : "newest",
      );
    }

    if (navCommand.composeDraftId && !targetThread) {
      compose.setActiveId(navCommand.composeDraftId);
      window.dispatchEvent(
        new CustomEvent(FOCUS_COMPOSE_DRAFT_EVENT, {
          detail: { id: navCommand.composeDraftId },
        }),
      );
      if (view !== "inbox") void navigate("/inbox");
    } else if (targetView === "draft-queue") {
      const target = navCommand.queuedDraftId
        ? `/draft-queue?id=${encodeURIComponent(navCommand.queuedDraftId)}`
        : "/draft-queue";
      void navigate(target);
    } else if (targetView === "settings") {
      const target = navCommand.settingsSection
        ? `/settings?section=${encodeURIComponent(navCommand.settingsSection)}`
        : "/settings";
      void navigate(target);
    } else if (navCommand.tab) {
      void navigate(inboxTabHref(navCommand.tab));
    } else if (targetFilter) {
      void navigate(`/inbox?filter=${encodeURIComponent(targetFilter)}`);
    } else if (targetThread) {
      void navigate(`/${targetView}/${targetThread}`);
    } else if (targetView !== view) {
      void navigate(`/${targetView}`);
    }

    void navState.clearCommand();
  }, [navCommand, view, navigate, jevAvailability.isLoading, jevConfigured]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const activeSubject = threadId
    ? threads.find(
        (thread) =>
          (thread.latestMessage.threadId || thread.latestMessage.id) ===
          threadId,
      )?.latestMessage.subject
    : undefined;

  useEffect(() => {
    if (!activeSubject) return;
    const nextTitle = `${normalizeDocumentTitle(
      activeSubject,
      t("mail.routeTitles.emailThread"),
    )} — Mail`;
    const previousTitle = document.title;
    document.title = nextTitle;
    return () => {
      if (document.title === nextTitle) document.title = previousTitle;
    };
  }, [activeSubject, t]);

  const threadIds = useMemo(
    () => threads.map((t) => t.latestMessage.threadId || t.latestMessage.id),
    [threads],
  );

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
    (email: EmailMessage, mode: "reply" | "replyAll" | "forward") => {
      if (mode === "forward") {
        compose.open(buildForwardDraft(email, myEmails));
        return;
      }
      compose.open(
        buildReplyDraft(email, myEmails, { replyAll: mode === "replyAll" }),
      );
    },
    [compose, myEmails],
  );

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
        ...savedEmailDraftMetadata(email),
      });
    },
    [compose],
  );

  const isMobile = useIsMobile();
  const hasThread = !!threadId;
  const isInboxZero = shouldShowInboxZero({
    view,
    activeLabel,
    hasEmailData,
    isLoading: emailListLoading,
    isError,
    hasThread,
    searchQuery,
    isSavedFilter: Boolean(activeSavedFilter),
    threadCount: threads.length,
    hasNextPage: Boolean(hasNextPage),
    hasAccountErrors: Boolean(accountErrors?.length),
  });
  const [sidebarContactEmail, setSidebarContactEmail] = useState<
    string | undefined
  >();

  useEffect(() => {
    setSidebarContactEmail(undefined);
  }, [threadId]);

  const contactEmailId = threadId ?? focusedId ?? undefined;

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
            accountErrors={accountErrors}
            labels={
              isInboxView ? (inboxMetadata?.labels ?? EMPTY_LABELS) : undefined
            }
            refetchEmails={refetchEmails}
            hasNextPage={hasNextPage}
            fetchNextPage={fetchNextPage}
            isFetchingNextPage={isFetchingNextPage}
            isFetchNextPageError={isFetchNextPageError}
            sortMode={sortMode}
            showPrioritySort={showPrioritySort}
            jevConfigured={jevConfigured}
            jevAvailabilityLoading={
              jevAvailability.isLoading || jevAvailability.isFetching
            }
            jevAvailabilityError={jevAvailability.isError}
            onJevConnected={() => void jevAvailability.refetch()}
            onJevRetry={() => void jevAvailability.refetch()}
            onSortModeChange={changeSortMode}
          />
        )}
      </div>

      {/* Right contact panel — hidden during initial load or when maximized */}
      {!emailListLoading && !(hasThread && isMaximized) && (
        <div className="mail-contact-side-panel hidden w-[260px] shrink-0 flex-col border-s border-border/30 bg-muted/50 dark:bg-[var(--mail-sidebar-surface)]">
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
