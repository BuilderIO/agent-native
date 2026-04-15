import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  forwardRef,
  Fragment,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { cn, formatEmailDate, formatFileSize } from "@/lib/utils";
import { useTheme } from "next-themes";
import { useComposeState } from "@/hooks/use-compose-state";
import { useAccountFilter } from "@/hooks/use-account-filter";
import {
  useThreadMessages,
  useArchiveEmail,
  useTrashEmail,
  useUntrashEmail,
  useToggleStar,
  useMarkRead,
  useMarkThreadRead,
  useUnarchiveEmail,
  useSettings,
  useUpdateSettings,
  unsuppressThread,
} from "@/hooks/use-emails";
import { useQueryClient } from "@tanstack/react-query";
import { ensureThread, warmThreads } from "@/lib/thread-cache";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { setUndoAction } from "@/hooks/use-undo";
import { toast } from "sonner";
import type { EmailMessage, MobileActionId } from "@shared/types";
import type { ThreadSummary } from "@/lib/threads";
import { Skeleton } from "@/components/ui/skeleton";
import {
  IconArrowLeft,
  IconCheck,
  IconChevronUp,
  IconChevronDown,
  IconExternalLink,
  IconMailOff,
  IconX,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconPaperclip,
  IconDownload,
  IconPhoto,
  IconSearch,
} from "@tabler/icons-react";
import {
  InlineReplyComposer,
  type InlineReplyHandle,
} from "./InlineReplyComposer";
import { MobileActionBar, DEFAULT_MOBILE_ACTIONS } from "./MobileActionBar";
import { useIsMobile } from "@/hooks/use-mobile";

export function EmailThread({
  onArchived,
  emailIds = [],
  threads = [],
  selectedIds,
  setSelectedIds,
  onContactSelect,
}: {
  onArchived?: (id: string) => void;
  emailIds?: string[];
  /**
   * Full thread summaries for the current view. Used to resolve thread keys
   * back to their latestMessage (id, accountEmail) when bulk-archiving via
   * shift+j/k multi-selection from the detail view.
   */
  threads?: ThreadSummary[];
  /**
   * Multi-selection of thread keys (`threadId || id`). Shared with the list
   * view so selections survive navigation between list and detail views, and
   * shift+j/k in detail view can extend the same set.
   */
  selectedIds?: Set<string>;
  setSelectedIds?: React.Dispatch<React.SetStateAction<Set<string>>>;
  onContactSelect?: (email: string) => void;
}) {
  const { view = "inbox", threadId } = useParams<{
    view: string;
    threadId: string;
  }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const labelParam = searchParams.get("label");
  const labelSuffix = labelParam
    ? `?label=${encodeURIComponent(labelParam)}`
    : "";
  const compose = useComposeState();
  const queryClient = useQueryClient();

  // Pull any messages we already have from the list cache (instant, no fetch).
  // The emails query uses useInfiniteQuery so cached data is InfiniteData<{ emails: EmailMessage[] }>,
  // not a flat array — flatten pages before searching.
  const cachedMessages = useMemo(() => {
    if (!threadId) return [];
    const allCached: EmailMessage[] = [];
    const queries = queryClient.getQueriesData<unknown>({
      queryKey: ["emails"],
    });
    for (const [, data] of queries) {
      let emails: EmailMessage[];
      if (Array.isArray(data)) {
        emails = data as EmailMessage[];
      } else if (
        data &&
        typeof data === "object" &&
        "pages" in data &&
        Array.isArray((data as any).pages)
      ) {
        // InfiniteData<EmailsPage> — flatten pages
        emails = (data as any).pages.flatMap(
          (p: any) => p.emails ?? [],
        ) as EmailMessage[];
      } else {
        continue;
      }
      for (const email of emails) {
        if ((email.threadId || email.id) === threadId) {
          allCached.push(email);
        }
      }
    }
    // Dedupe by id and sort oldest-first
    const seen = new Set<string>();
    return allCached
      .filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [threadId, queryClient]);

  // Fetch all messages in the thread (URL param is the real threadId)
  const {
    data: threadMessages,
    isLoading: isThreadLoading,
    isFetching: isThreadFetching,
  } = useThreadMessages(threadId);

  // Use the latestMessage from the threads prop as a last-resort preview (avoids
  // full skeleton when the user just clicked from the list and we have the data).
  const previewMessage = useMemo(() => {
    if (!threadId || !threads.length) return undefined;
    const thread = threads.find(
      (t) => (t.latestMessage.threadId || t.latestMessage.id) === threadId,
    );
    return thread?.latestMessage;
  }, [threadId, threads]);

  // Use full thread when loaded, fall back to list cache, then to the single
  // preview message we already have from the list view — never show a full
  // skeleton when we already have the subject/snippet visible in the list.
  const allMessages =
    threadMessages ??
    (cachedMessages.length > 0
      ? cachedMessages
      : previewMessage
        ? [previewMessage]
        : []);
  // Hide Superhuman reminder messages — they're noise in the thread view
  const messages = useMemo(
    () =>
      allMessages.filter(
        (m) =>
          !(
            m.from.email === "reminder@superhuman.com" ||
            (m.from.name === "Reminder" &&
              (m.snippet || m.body || "")
                .toLowerCase()
                .includes("reminder from superhuman"))
          ),
      ),
    [allMessages],
  );
  const isHydratingThread =
    !!threadId && !threadMessages && (isThreadLoading || isThreadFetching);

  // Use the latest message as the "primary" email for actions/metadata
  const email = messages.length > 0 ? messages[messages.length - 1] : undefined;

  // Auto-expand latest + unread; user toggles override via this set
  const [userToggles, setUserToggles] = useState<Record<string, boolean>>({});

  // Reset user overrides and search when navigating to a different thread
  useEffect(() => {
    setUserToggles({});
    setSearchOpen(false);
    setSearchQuery("");
    setSearchMatchIdx(0);
  }, [threadId]);

  // In-thread search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchIdx, setSearchMatchIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Match counts per message for in-thread search
  const matchCountByMsg = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const msg of messages) {
      const text = msg.bodyHtml
        ? msg.bodyHtml.replace(/<[^>]+>/g, " ")
        : msg.body || "";
      const lower = text.toLowerCase();
      let count = 0;
      let i = lower.indexOf(q);
      while (i !== -1) {
        count++;
        i = lower.indexOf(q, i + q.length);
      }
      if (count > 0) map.set(msg.id, count);
    }
    return map;
  }, [searchQuery, messages]);

  const totalMatches = useMemo(
    () => [...matchCountByMsg.values()].reduce((a, b) => a + b, 0),
    [matchCountByMsg],
  );

  const safeMatchIdx =
    totalMatches > 0
      ? ((searchMatchIdx % totalMatches) + totalMatches) % totalMatches
      : 0;

  const getActiveLocalIdx = useCallback(
    (msgId: string): number | null => {
      if (!searchQuery.trim() || totalMatches === 0) return null;
      let offset = 0;
      for (const msg of messages) {
        const count = matchCountByMsg.get(msg.id) ?? 0;
        if (msg.id === msgId) {
          const local = safeMatchIdx - offset;
          return local >= 0 && local < count ? local : null;
        }
        offset += count;
      }
      return null;
    },
    [searchQuery, totalMatches, safeMatchIdx, messages, matchCountByMsg],
  );

  // Compute which messages are expanded: latest + unread by default, user toggles override
  const expandedIds = useMemo(() => {
    const ids = new Set<string>();
    if (messages.length === 0) return ids;
    ids.add(messages[messages.length - 1].id); // always expand latest
    for (const msg of messages) {
      if (!msg.isRead) ids.add(msg.id);
    }
    // Apply user overrides
    for (const [id, expanded] of Object.entries(userToggles)) {
      if (expanded) ids.add(id);
      else ids.delete(id);
    }
    // Auto-expand messages with search matches
    if (searchQuery.trim()) {
      for (const msgId of matchCountByMsg.keys()) {
        ids.add(msgId);
      }
    }
    return ids;
  }, [messages, userToggles, searchQuery, matchCountByMsg]);

  // Focused message index for keyboard nav (n/p) — starts on latest
  const [focusedIndex, setFocusedIndex] = useState(-1);
  useEffect(() => {
    setFocusedIndex(messages.length > 0 ? messages.length - 1 : -1);
  }, [threadId]);
  // Update if messages grow (full thread loaded)
  useEffect(() => {
    if (focusedIndex === -1 && messages.length > 0) {
      setFocusedIndex(messages.length - 1);
    }
  }, [messages.length, focusedIndex]);
  const focusedRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Scroll so the most recent (last) message is at the top of the viewport.
  // Pin for ~800ms to handle iframe resizes / async content.
  const scrolledForRef = useRef<string | undefined>();
  const lastMessageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!threadId || messages.length === 0) return;
    const key = `${threadId}:${messages.length}`;
    if (scrolledForRef.current === key) return;
    scrolledForRef.current = key;
    const el = scrollContainerRef.current;
    const lastMsg = lastMessageRef.current;
    if (!el) return;
    const scrollToLatest = () => {
      if (lastMsg) {
        // Use manual scrollTop instead of scrollIntoView to avoid
        // scrolling ancestor overflow:hidden containers (causes header cutoff)
        el.scrollTop = lastMsg.offsetTop - el.offsetTop - 8;
      } else {
        el.scrollTop = el.scrollHeight;
      }
    };
    scrollToLatest();
    let stop = false;
    let raf: number;
    const pin = () => {
      if (!stop) {
        scrollToLatest();
        raf = requestAnimationFrame(pin);
      }
    };
    raf = requestAnimationFrame(pin);
    const timer = setTimeout(() => {
      stop = true;
      cancelAnimationFrame(raf);
    }, 800);
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [threadId, messages.length]);

  const archiveEmail = useArchiveEmail();
  const unarchiveEmail = useUnarchiveEmail();
  const trashEmail = useTrashEmail();
  const untrashEmail = useUntrashEmail();
  const toggleStar = useToggleStar();
  const markRead = useMarkRead();
  const markThreadRead = useMarkThreadRead();

  // Auto-mark all unread messages in this thread as read when viewed.
  // Defer the mutation past the commit so its optimistic emails-cache update
  // doesn't re-render the detail view we just finished mounting.
  const hasUnread = messages.some((m) => !m.isRead);
  useEffect(() => {
    if (threadId && hasUnread) {
      const id = threadId;
      const handle = setTimeout(() => markThreadRead.mutate(id), 0);
      return () => clearTimeout(handle);
    }
    // Only trigger when threadId changes or messages load with unread
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, hasUnread]);

  const goBack = useCallback(
    () => navigate(`/${view}${labelSuffix}`),
    [navigate, view, labelSuffix],
  );

  // Navigate between threads (j/k) — use ref to avoid stale closure
  const emailIdsRef = useRef(emailIds);
  emailIdsRef.current = emailIds;

  const goToSibling = useCallback(
    (delta: number) => {
      const ids = emailIdsRef.current;
      if (!threadId || ids.length === 0) return;
      const idx = ids.indexOf(threadId);
      let nextIdx: number;
      if (idx === -1) {
        // Current thread isn't in the list (e.g. opened from search or a direct link) —
        // jump to the first (j) or last (k) email so navigation still works.
        nextIdx = delta > 0 ? 0 : ids.length - 1;
      } else {
        nextIdx = idx + delta;
        if (nextIdx < 0 || nextIdx >= ids.length) return;
      }
      const nextThreadId = ids[nextIdx];
      // Plain j/k is a single-thread action — clear any in-progress
      // multi-selection so the next shortcut (e/d/s/u) doesn't act on it.
      setSelectedIds?.(new Set());
      void ensureThread(nextThreadId);
      navigate(`/${view}/${nextThreadId}${labelSuffix}`);
    },
    [threadId, view, navigate, labelSuffix, setSelectedIds],
  );

  // Shift+j/k extends multi-selection across siblings and auto-previews the
  // newly selected thread. Selection is keyed by thread key (`threadId || id`)
  // to match the list view so a selection can span both views seamlessly.
  const extendSelection = useCallback(
    (delta: number) => {
      if (!setSelectedIds) return;
      const ids = emailIdsRef.current;
      if (!threadId || ids.length === 0) return;
      const idx = ids.indexOf(threadId);
      if (idx === -1) return;
      const nextIdx = idx + delta;
      if (nextIdx < 0 || nextIdx >= ids.length) return;
      const nextThreadKey = ids[nextIdx];

      setSelectedIds((prev) => {
        const updated = new Set(prev);
        // Anchor the current thread on first shift-move.
        if (prev.size === 0) updated.add(threadId);
        updated.add(nextThreadKey);
        return updated;
      });

      // Auto-preview the latest selected thread. Use replace so the history
      // stack doesn't fill up with every shift+j/k press.
      navigate(`/${view}/${nextThreadKey}${labelSuffix}`, { replace: true });
    },
    [threadId, view, navigate, labelSuffix, setSelectedIds],
  );

  // Warm the full list of siblings through the plain-Map cache. warmThreads
  // dedupes cached entries and caps concurrency so mass-warming doesn't trip
  // Gmail quota.
  useEffect(() => {
    if (emailIds.length === 0) return;
    warmThreads(emailIds);
  }, [emailIds]);

  const advanceOrGoBack = useCallback(() => {
    if (!threadId || emailIds.length === 0) {
      goBack();
      return;
    }
    const idx = emailIds.indexOf(threadId);
    if (idx !== -1 && idx + 1 < emailIds.length) {
      navigate(`/${view}/${emailIds[idx + 1]}${labelSuffix}`, {
        replace: true,
      });
    } else if (idx !== -1 && idx - 1 >= 0) {
      navigate(`/${view}/${emailIds[idx - 1]}${labelSuffix}`, {
        replace: true,
      });
    } else {
      goBack();
    }
  }, [threadId, emailIds, view, navigate, goBack]);

  // Advance to next thread when current email is dismissed (snoozed/spam/muted)
  useEffect(() => {
    const handler = (e: Event) => {
      const { emailId } = (e as CustomEvent<{ emailId: string }>).detail;
      if (messages.some((m) => m.id === emailId)) {
        advanceOrGoBack();
      }
    };
    window.addEventListener("email:snoozed", handler);
    return () => window.removeEventListener("email:snoozed", handler);
  }, [messages, advanceOrGoBack]);

  // Navigate between messages within the thread (n/p)
  const focusMessage = useCallback(
    (delta: number) => {
      if (messages.length === 0) return;
      setFocusedIndex((prev) => {
        const nextIdx = Math.max(
          0,
          Math.min(messages.length - 1, prev + delta),
        );
        setTimeout(() => {
          const container = scrollContainerRef.current;
          const target = focusedRef.current;
          if (container && target) {
            const targetTop = target.offsetTop - container.offsetTop;
            const targetBottom = targetTop + target.offsetHeight;
            const viewTop = container.scrollTop;
            const viewBottom = viewTop + container.clientHeight;
            if (targetTop < viewTop) {
              container.scrollTop = targetTop;
            } else if (targetBottom > viewBottom) {
              container.scrollTop = targetBottom - container.clientHeight;
            }
          }
        }, 50);
        return nextIdx;
      });
    },
    [messages.length],
  );

  // Toggle expand/collapse on focused message (Enter)
  const toggleFocused = useCallback(() => {
    if (focusedIndex < 0 || focusedIndex >= messages.length) return;
    const id = messages[focusedIndex].id;
    const isExpanded = expandedIds.has(id);
    setUserToggles((prev) => ({ ...prev, [id]: !isExpanded }));
  }, [focusedIndex, messages, expandedIds]);

  // Mobile action bar
  const isMobile = useIsMobile();

  // Resolve the set of thread keys the next action should operate on. If the
  // user has a multi-selection (via shift+j/k in list or detail view), act on
  // that; otherwise fall back to the currently viewed thread.
  const getActionThreadKeys = useCallback((): string[] => {
    if (selectedIds && selectedIds.size > 0) return Array.from(selectedIds);
    if (threadId) return [threadId];
    return [];
  }, [selectedIds, threadId]);

  const handleArchive = useCallback(() => {
    const threadKeys = getActionThreadKeys();
    if (threadKeys.length === 0) return;

    // Resolve each thread key to its latestMessage via the threads prop, with
    // a fallback to the current email when acting on the focused thread alone.
    const targets = threadKeys
      .map((key) => {
        const t = threads.find(
          (t) => (t.latestMessage.threadId || t.latestMessage.id) === key,
        );
        if (t) return t.latestMessage;
        // Fallback: single-thread archive of the currently viewed thread.
        if (email && (email.threadId || email.id) === key) return email;
        return undefined;
      })
      .filter((m): m is EmailMessage => !!m);

    if (targets.length === 0) return;

    for (const t of targets) onArchived?.(t.id);

    const undo = () => {
      for (const key of threadKeys) unsuppressThread(key);
      for (const t of targets) unarchiveEmail.mutate(t.id);
      queryClient.invalidateQueries({ queryKey: ["emails"] });
    };
    setUndoAction(undo);
    toast(
      targets.length > 1
        ? `Archived ${targets.length} conversations.`
        : "Marked as Done.",
      {
        action: { label: "UNDO", onClick: undo },
        position: isMobile ? "top-center" : undefined,
      },
    );
    advanceOrGoBack();
    for (const t of targets) {
      archiveEmail.mutate({
        id: t.id,
        accountEmail: t.accountEmail,
        removeLabel: labelParam || undefined,
      });
    }
    setSelectedIds?.(new Set());
  }, [
    email,
    threads,
    getActionThreadKeys,
    archiveEmail,
    unarchiveEmail,
    advanceOrGoBack,
    onArchived,
    queryClient,
    labelParam,
    isMobile,
    setSelectedIds,
  ]);

  const handleTrash = useCallback(() => {
    const threadKeys = getActionThreadKeys();
    if (threadKeys.length === 0) return;

    const targets = threadKeys
      .map((key) => {
        const t = threads.find(
          (t) => (t.latestMessage.threadId || t.latestMessage.id) === key,
        );
        if (t) return t.latestMessage;
        if (email && (email.threadId || email.id) === key) return email;
        return undefined;
      })
      .filter((m): m is EmailMessage => !!m);

    if (targets.length === 0) return;

    const undo = () => {
      for (const key of threadKeys) unsuppressThread(key);
      for (const t of targets) untrashEmail.mutate(t.id);
      queryClient.invalidateQueries({ queryKey: ["emails"] });
    };
    setUndoAction(undo);
    toast(
      targets.length > 1
        ? `Trashed ${targets.length} conversations.`
        : "Moved to Trash.",
      { action: { label: "UNDO", onClick: undo } },
    );
    advanceOrGoBack();
    for (const t of targets) trashEmail.mutate(t.id);
    setSelectedIds?.(new Set());
  }, [
    email,
    threads,
    getActionThreadKeys,
    trashEmail,
    untrashEmail,
    advanceOrGoBack,
    queryClient,
    setSelectedIds,
  ]);

  const handleStar = useCallback(() => {
    if (!email) return;
    toggleStar.mutate({ id: email.id, isStarred: !email.isStarred });
  }, [email, toggleStar]);

  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();
  const { allAccounts } = useAccountFilter();
  const myEmails = useMemo(() => {
    const emails = new Set(allAccounts.map((a) => a.email.toLowerCase()));
    if (settings?.email) emails.add(settings.email.toLowerCase());
    return emails;
  }, [allAccounts, settings?.email]);
  const myEmail = settings?.email?.toLowerCase() ?? "";

  // Inline reply: find any inline draft belonging to this thread
  const inlineReplyRef = useRef<InlineReplyHandle>(null);
  const inlineDraft = compose.drafts.find(
    (d) => d.inline && d.replyToThreadId === threadId,
  );

  const buildReplyQuote = (target: EmailMessage) =>
    `\n\n\n\n— On ${new Date(target.date).toLocaleDateString()}, ${target.from.name || target.from.email} wrote:\n\n${target.body
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n")}`;

  // Determine which of our accounts the email was sent to (for reply-from)
  const findReplyAccount = useCallback(
    (target: EmailMessage): string | undefined => {
      // First check accountEmail on the message itself
      if (target.accountEmail) return target.accountEmail;
      // Otherwise scan to/cc for one of our connected accounts
      const allAddrs = [
        ...target.to.map((r) => r.email.toLowerCase()),
        ...(target.cc || []).map((r) => r.email.toLowerCase()),
      ];
      return allAddrs.find((e) => myEmails.has(e));
    },
    [myEmails],
  );

  const handleReply = useCallback(
    (msg?: EmailMessage) => {
      // If inline draft exists and no specific message, just focus it
      const existing = compose.drafts.find(
        (d) => d.inline && d.replyToThreadId === threadId,
      );
      if (existing && !msg) {
        inlineReplyRef.current?.focusEditor();
        return;
      }
      // Discard existing inline draft if switching to a different message
      if (existing) compose.discard(existing.id);

      const target = msg ?? email;
      if (!target) return;
      // If the message is from me, reply to the first "to" recipient instead
      const isFromMe = myEmails.has(target.from.email.toLowerCase());
      const replyTo = isFromMe
        ? (target.to[0]?.email ?? target.from.email)
        : target.from.email;
      compose.open({
        to: replyTo,
        subject: target.subject.startsWith("Re:")
          ? target.subject
          : `Re: ${target.subject}`,
        body: buildReplyQuote(target),
        mode: "reply",
        replyToId: target.id,
        replyToThreadId: target.threadId,
        accountEmail: findReplyAccount(target),
        inline: true,
      });
    },
    [email, compose, myEmails, findReplyAccount, threadId],
  );

  const handleReplyAll = useCallback(
    (msg?: EmailMessage) => {
      // If inline draft exists and no specific message, just focus it
      const existing = compose.drafts.find(
        (d) => d.inline && d.replyToThreadId === threadId,
      );
      if (existing && !msg) {
        inlineReplyRef.current?.focusEditor();
        return;
      }
      if (existing) compose.discard(existing.id);

      const target = msg ?? email;
      if (!target) return;
      const isFromMe = myEmails.has(target.from.email.toLowerCase());
      // Collect all recipients, excluding all of my accounts
      const allRecipients = [
        ...(isFromMe ? [] : [target.from.email]),
        ...target.to.map((r) => r.email),
        ...(target.cc || []).map((r) => r.email),
      ];
      const uniqueTo = [
        ...new Set(
          allRecipients
            .map((e) => e.toLowerCase())
            .filter((e) => !myEmails.has(e)),
        ),
      ];
      compose.open({
        to: uniqueTo.join(", "),
        subject: target.subject.startsWith("Re:")
          ? target.subject
          : `Re: ${target.subject}`,
        body: buildReplyQuote(target),
        mode: "reply",
        replyToId: target.id,
        replyToThreadId: target.threadId,
        accountEmail: findReplyAccount(target),
        inline: true,
      });
    },
    [email, compose, myEmails, findReplyAccount, threadId],
  );

  const handleForwardMsg = useCallback(
    (msg: EmailMessage) => {
      const existing = compose.drafts.find(
        (d) => d.inline && d.replyToThreadId === threadId,
      );
      if (existing) compose.discard(existing.id);
      compose.open({
        to: "",
        subject: msg.subject.startsWith("Fwd:")
          ? msg.subject
          : `Fwd: ${msg.subject}`,
        body: `\n\n\n\n— Forwarded message —\nFrom: ${msg.from.name} <${msg.from.email}>\n\n${msg.body}`,
        mode: "forward",
        replyToId: msg.id,
        replyToThreadId: msg.threadId,
        accountEmail: findReplyAccount(msg),
        inline: true,
      });
    },
    [compose, findReplyAccount, threadId],
  );

  const handleForward = useCallback(() => {
    if (!email) return;
    handleForwardMsg(email);
  }, [email, handleForwardMsg]);

  // Keyboard shortcuts
  useKeyboardShortcuts(
    [
      {
        key: "Escape",
        handler: () => {
          // If a multi-selection is active, first Escape clears it; second
          // Escape goes back to the list. Matches Gmail / Superhuman feel.
          if (selectedIds && selectedIds.size > 0) {
            setSelectedIds?.(new Set());
            return;
          }
          goBack();
        },
      },
      { key: "j", handler: () => goToSibling(1) },
      { key: "k", handler: () => goToSibling(-1) },
      { key: "j", shift: true, handler: () => extendSelection(1) },
      { key: "k", shift: true, handler: () => extendSelection(-1) },
      { key: "ArrowDown", shift: true, handler: () => extendSelection(1) },
      { key: "ArrowUp", shift: true, handler: () => extendSelection(-1) },
      { key: "n", handler: () => focusMessage(1) },
      { key: "p", handler: () => focusMessage(-1) },
      { key: "Enter", handler: toggleFocused },
      {
        key: "o",
        handler: toggleFocused,
      },
      {
        key: "o",
        meta: true,
        handler: () => {
          if (githubPrUrl) window.open(githubPrUrl, "_blank");
        },
      },
      { key: "e", handler: handleArchive },
      { key: "s", handler: handleStar },
      {
        key: "r",
        handler: () => {
          const focused =
            focusedIndex >= 0 ? messages[focusedIndex] : undefined;
          handleReply(focused);
        },
      },
      {
        key: "a",
        handler: () => {
          const focused =
            focusedIndex >= 0 ? messages[focusedIndex] : undefined;
          handleReplyAll(focused);
        },
      },
      { key: "f", handler: handleForward },
      {
        key: "f",
        meta: true,
        skipInInput: false,
        handler: () => {
          if (!searchOpen) {
            setSearchOpen(true);
            setTimeout(() => searchInputRef.current?.focus(), 50);
          } else {
            searchInputRef.current?.focus();
          }
        },
      },
      {
        key: "u",
        handler: () => {
          if (!email) return;
          markRead.mutate({
            id: email.id,
            isRead: !email.isRead,
            accountEmail: email.accountEmail,
          });
        },
      },
      {
        key: "I",
        shift: true,
        handler: () => {
          if (!email) return;
          markRead.mutate({
            id: email.id,
            isRead: true,
            accountEmail: email.accountEmail,
          });
        },
      },
      {
        key: "U",
        shift: true,
        handler: () => {
          if (!email) return;
          markRead.mutate({
            id: email.id,
            isRead: false,
            accountEmail: email.accountEmail,
          });
        },
      },
    ],
    !!threadId,
  );

  const mobileActions = settings?.mobileActions ?? DEFAULT_MOBILE_ACTIONS;
  const handleMobileAction = useCallback(
    (action: MobileActionId) => {
      switch (action) {
        case "archive":
          handleArchive();
          break;
        case "trash":
          handleTrash();
          break;
        case "star":
          handleStar();
          break;
        case "reply":
          handleReply();
          break;
        case "replyAll":
          handleReplyAll();
          break;
        case "forward":
          handleForward();
          break;
        case "markUnread":
          if (email)
            markRead.mutate({
              id: email.id,
              isRead: false,
              accountEmail: email.accountEmail,
            });
          break;
        case "prev":
          goToSibling(-1);
          break;
        case "next":
          goToSibling(1);
          break;
      }
    },
    [
      handleArchive,
      handleTrash,
      handleStar,
      handleReply,
      handleReplyAll,
      handleForward,
      email,
      markRead,
      goToSibling,
    ],
  );

  // Extract GitHub PR URL from any message in the thread
  const githubPrUrl = useMemo(() => {
    for (const msg of messages) {
      const text = msg.bodyHtml
        ? msg.bodyHtml.replace(/<[^>]+>/g, " ")
        : msg.body || "";
      const match = text.match(/https:\/\/github\.com\/[^\s"'<>]+\/pull\/\d+/);
      if (match) return match[0].replace(/[.,;)]+$/, ""); // strip trailing punctuation
    }
    return null;
  }, [messages]);

  // Extract unsubscribe info from thread messages (use the most recent with the header)
  const unsubscribeInfo = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const unsub = messages[i].unsubscribe;
      if (unsub && (unsub.url || unsub.mailto)) {
        return {
          ...unsub,
          messageId: messages[i].id,
          accountEmail: messages[i].accountEmail,
        };
      }
    }
    // Fallback: scan HTML body for unsubscribe links
    for (let i = messages.length - 1; i >= 0; i--) {
      const html = messages[i].bodyHtml;
      if (!html) continue;
      const match = html.match(
        /<a\s[^>]*href=["']([^"']+)["'][^>]*>[^<]*unsubscribe[^<]*<\/a>/i,
      );
      if (match) return { url: match[1], bodyFallback: true } as const;
    }
    return null;
  }, [messages]);

  const [unsubscribing, setUnsubscribing] = useState(false);

  const handleUnsubscribe = useCallback(async () => {
    if (!unsubscribeInfo) return;

    // If we only found a link in the body (no header), just open it
    if (!("messageId" in unsubscribeInfo)) {
      if (unsubscribeInfo.url) window.open(unsubscribeInfo.url, "_blank");
      return;
    }

    setUnsubscribing(true);
    try {
      const res = await fetch(
        `/api/emails/${unsubscribeInfo.messageId}/unsubscribe`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountEmail: unsubscribeInfo.accountEmail,
          }),
        },
      );
      const data = await res.json();

      if (data.ok) {
        toast.success("Unsubscribe request sent");
        // Also open the URL so user can confirm if needed
        if (data.url || unsubscribeInfo.url) {
          window.open(data.url || unsubscribeInfo.url, "_blank");
        }
      } else {
        // Fallback: open the unsubscribe URL directly
        if (unsubscribeInfo.url) {
          window.open(unsubscribeInfo.url, "_blank");
        } else {
          toast.error("Could not unsubscribe");
        }
      }
    } catch {
      // Fallback: open URL directly
      if (unsubscribeInfo.url) {
        window.open(unsubscribeInfo.url, "_blank");
      }
    } finally {
      setUnsubscribing(false);
    }
  }, [unsubscribeInfo]);

  if (!threadId) return null;

  if (!email) {
    if (isHydratingThread) {
      return <ThreadLoadingState onBack={goBack} />;
    }
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-muted-foreground text-sm">Email not found</p>
      </div>
    );
  }

  // Filter to user labels for display
  const systemLabels = new Set([
    "inbox",
    "sent",
    "drafts",
    "archive",
    "trash",
    "starred",
    "all",
    "important",
  ]);
  const displayLabels = [...new Set(email.labelIds)].filter(
    (l) => !systemLabels.has(l),
  );

  // Strip "Re: " / "Fwd: " prefixes for thread subject
  const threadSubject = email.subject.replace(/^(Re|Fwd|Fw):\s*/i, "");

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Thread header */}
      <div className="shrink-0 px-3 sm:px-5 pt-4 sm:pt-5 pb-3">
        <div className="flex items-start gap-2 sm:gap-3">
          <button
            onClick={goBack}
            className="mt-0.5 flex h-9 w-9 sm:h-7 sm:w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Back (Esc)"
          >
            <IconArrowLeft className="h-[14px] w-[14px]" />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2 flex-wrap">
              <h1 className="text-base sm:text-lg font-semibold leading-tight text-foreground">
                {threadSubject}
              </h1>
              {isHydratingThread && (
                <Skeleton className="mt-0.5 h-5 w-28 rounded-full" />
              )}
              {displayLabels.map((labelId) => (
                <span
                  key={labelId}
                  className="label-badge shrink-0 bg-pink-500/20 text-pink-700 dark:text-pink-300 mt-1"
                >
                  {labelId}
                </span>
              ))}
              {/* Action bar */}
              <div className="hidden sm:flex items-center gap-0.5 ml-auto shrink-0">
                <button
                  onClick={handleArchive}
                  className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="Done (E)"
                >
                  <IconCheck className="h-4 w-4" />
                </button>
                <button
                  onClick={() => goToSibling(-1)}
                  className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors ml-1"
                >
                  <IconChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => goToSibling(1)}
                  className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <IconChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {(githubPrUrl || unsubscribeInfo) && (
              <div className="mt-1.5 flex items-center gap-3">
                {githubPrUrl && (
                  <a
                    href={githubPrUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative inline-flex items-center gap-1.5 text-[12px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    title="View Pull Request (⌘O)"
                  >
                    <IconExternalLink className="h-3 w-3" />
                    View Pull Request
                    <span className="pointer-events-none absolute left-0 top-full mt-1 z-50 hidden group-hover:flex items-center gap-1.5 rounded-md border border-border/50 bg-popover px-2.5 py-1.5 text-[12px] font-medium text-foreground shadow-lg whitespace-nowrap">
                      View Pull Request
                      <kbd className="flex items-center justify-center rounded border border-border/60 bg-muted px-1 text-[10px] text-muted-foreground">
                        ⌘
                      </kbd>
                      <kbd className="flex items-center justify-center rounded border border-border/60 bg-muted px-1.5 text-[10px] text-muted-foreground">
                        O
                      </kbd>
                    </span>
                  </a>
                )}
                {unsubscribeInfo && (
                  <button
                    onClick={handleUnsubscribe}
                    disabled={unsubscribing}
                    className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground/50 hover:text-muted-foreground transition-colors disabled:opacity-50"
                    title="Unsubscribe from this mailing list"
                  >
                    <IconMailOff className="h-3 w-3" />
                    {unsubscribing ? "Unsubscribing..." : "Unsubscribe"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* In-thread search bar */}
      {searchOpen && (
        <ThreadSearchBar
          query={searchQuery}
          onChange={(q) => {
            setSearchQuery(q);
            setSearchMatchIdx(0);
          }}
          onNext={() => setSearchMatchIdx((p) => p + 1)}
          onPrev={() => setSearchMatchIdx((p) => p - 1)}
          onClose={() => {
            setSearchOpen(false);
            setSearchQuery("");
            setSearchMatchIdx(0);
          }}
          matchIdx={safeMatchIdx}
          totalMatches={totalMatches}
          inputRef={searchInputRef}
        />
      )}

      {/* Thread messages */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-3 sm:px-5 pb-4"
      >
        <div className="max-w-3xl mx-auto pt-1.5 space-y-1.5">
          {isHydratingThread && messages.length > 0 && (
            <div className="sticky top-0 z-10 pb-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-background/90 px-3 py-1.5 shadow-sm backdrop-blur">
                <Skeleton className="h-2 w-2 rounded-full" />
                <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Loading full thread
                </span>
                <Skeleton className="h-2 w-16 rounded-full" />
              </div>
            </div>
          )}

          {messages.map((msg, idx) => {
            const isExpanded = expandedIds.has(msg.id);
            const isFocused = idx === focusedIndex;
            const isLast = idx === messages.length - 1;
            const showComposerAfter = inlineDraft?.replyToId === msg.id;
            return (
              <Fragment key={msg.id}>
                {isExpanded ? (
                  <ExpandedMessageCard
                    ref={(el) => {
                      if (isFocused)
                        (
                          focusedRef as React.MutableRefObject<HTMLDivElement | null>
                        ).current = el;
                      if (isLast) lastMessageRef.current = el;
                    }}
                    email={msg}
                    isFocused={isFocused}
                    onCollapse={() => {
                      setUserToggles((prev) => ({ ...prev, [msg.id]: false }));
                    }}
                    onReply={() => handleReply(msg)}
                    onReplyAll={() => handleReplyAll(msg)}
                    onForward={() => handleForwardMsg(msg)}
                    onFocus={() => setFocusedIndex(idx)}
                    onContactSelect={onContactSelect}
                    searchTerm={searchQuery.trim() || undefined}
                    activeLocalIdx={getActiveLocalIdx(msg.id)}
                  />
                ) : (
                  <CollapsedMessageRow
                    ref={(el) => {
                      if (isFocused)
                        (
                          focusedRef as React.MutableRefObject<HTMLDivElement | null>
                        ).current = el;
                      if (isLast) lastMessageRef.current = el;
                    }}
                    email={msg}
                    isFocused={isFocused}
                    onClick={() => {
                      setFocusedIndex(idx);
                      setUserToggles((prev) => ({ ...prev, [msg.id]: true }));
                    }}
                  />
                )}
                {showComposerAfter && (
                  <div className="mt-3">
                    <InlineReplyComposer
                      ref={inlineReplyRef}
                      draft={inlineDraft}
                      messages={messages}
                      onUpdate={compose.update}
                      onDiscard={compose.discard}
                      onClose={(id) => {
                        const drafts = compose.drafts ?? [];
                        const draft = drafts.find((d: any) => d.id === id);
                        const hasContent = !!(
                          draft?.to?.trim() ||
                          draft?.subject?.trim() ||
                          draft?.body?.trim()
                        );
                        const snapshot = draft ? { ...draft } : null;
                        compose.close(id);
                        if (hasContent && snapshot) {
                          toast("Draft saved.", {
                            action: {
                              label: "REOPEN",
                              onClick: () => {
                                const { id: _id, ...reopenData } = snapshot;
                                compose.open({ ...reopenData, inline: true });
                              },
                            },
                            cancel: {
                              label: "DELETE DRAFT",
                              onClick: () => {
                                if (snapshot.savedDraftId) {
                                  fetch(
                                    `/api/emails/${snapshot.savedDraftId}`,
                                    {
                                      method: "DELETE",
                                    },
                                  );
                                }
                              },
                            },
                          });
                        }
                      }}
                      onPopOut={(id) => compose.update(id, { inline: false })}
                      onFlush={compose.flush}
                      onReopen={(state) =>
                        compose.open({ ...state, inline: true })
                      }
                    />
                  </div>
                )}
              </Fragment>
            );
          })}

          {/* Inline reply composer fallback (replyToId not matched) */}
          {inlineDraft &&
            !messages.some((m) => m.id === inlineDraft.replyToId) && (
              <div className="mt-3">
                <InlineReplyComposer
                  ref={inlineReplyRef}
                  draft={inlineDraft}
                  messages={messages}
                  onUpdate={compose.update}
                  onDiscard={compose.discard}
                  onClose={(id) => {
                    const drafts = compose.drafts ?? [];
                    const draft = drafts.find((d: any) => d.id === id);
                    const hasContent = !!(
                      draft?.to?.trim() ||
                      draft?.subject?.trim() ||
                      draft?.body?.trim()
                    );
                    const snapshot = draft ? { ...draft } : null;
                    compose.close(id);
                    if (hasContent && snapshot) {
                      toast("Draft saved.", {
                        action: {
                          label: "REOPEN",
                          onClick: () => {
                            const { id: _id, ...reopenData } = snapshot;
                            compose.open({ ...reopenData, inline: true });
                          },
                        },
                        cancel: {
                          label: "DELETE DRAFT",
                          onClick: () => {
                            if (snapshot.savedDraftId) {
                              fetch(`/api/emails/${snapshot.savedDraftId}`, {
                                method: "DELETE",
                              });
                            }
                          },
                        },
                      });
                    }
                  }}
                  onPopOut={(id) => compose.update(id, { inline: false })}
                  onFlush={compose.flush}
                  onReopen={(state) => compose.open({ ...state, inline: true })}
                />
              </div>
            )}

          {/* Reply prompt when no draft open */}
          {!inlineDraft && (
            <div
              className="flex items-center rounded-lg bg-accent/40 px-4 py-3 sm:py-2.5 cursor-text hover:bg-accent/60 transition-colors mt-3"
              onClick={() => handleReply()}
            >
              <span className="text-[13px] text-muted-foreground/60">
                Reply
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Mobile bottom action bar */}
      {isMobile && (
        <MobileActionBar
          actions={mobileActions}
          isStarred={email.isStarred}
          onAction={handleMobileAction}
          onUpdateActions={(actions) =>
            updateSettings.mutate({ mobileActions: actions })
          }
        />
      )}
    </div>
  );
}

function ThreadLoadingState({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-3 sm:px-5 pt-4 sm:pt-5 pb-3">
        <div className="flex items-start gap-2 sm:gap-3">
          <button
            onClick={onBack}
            className="mt-0.5 flex h-9 w-9 sm:h-7 sm:w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Back (Esc)"
          >
            <IconArrowLeft className="h-[14px] w-[14px]" />
          </button>

          <div className="flex-1 min-w-0 space-y-3 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-7 w-80 max-w-[70%]" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
            <div className="flex items-center gap-1">
              <Skeleton className="h-7 w-7 rounded" />
              <Skeleton className="h-7 w-7 rounded" />
              <Skeleton className="h-7 w-7 rounded" />
              <Skeleton className="h-7 w-7 rounded" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 sm:px-5 pb-4">
        <div className="mx-auto max-w-3xl space-y-3 pt-1.5">
          <ThreadMessageSkeleton />
          <ThreadMessageSkeleton compact />
          <ThreadMessageSkeleton />
        </div>
      </div>
    </div>
  );
}

function ThreadMessageSkeleton({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center gap-3 rounded-lg px-3 py-3">
        <Skeleton className="h-4 w-20 shrink-0" />
        <Skeleton className="h-4 flex-1" />
        <Skeleton className="h-4 w-14 shrink-0" />
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-card dark:bg-[hsl(220,5%,10%)] overflow-hidden px-4 py-4">
      <div className="flex items-start gap-3">
        <Skeleton className="h-9 w-9 rounded-full shrink-0" />
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-3 w-56" />
          <div className="space-y-2 pt-1">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-[92%]" />
            <Skeleton className="h-3 w-[76%]" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Collapsed message row (Superhuman style) ────────────────────────────────

const CollapsedMessageRow = forwardRef<
  HTMLDivElement,
  {
    email: EmailMessage;
    isFocused?: boolean;
    onClick: () => void;
  }
>(function CollapsedMessageRow({ email, isFocused, onClick }, ref) {
  const senderFirst = (email.from.name || email.from.email).split(" ")[0];

  return (
    <div
      ref={ref}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 sm:gap-3 px-3 py-3 sm:py-2 cursor-pointer rounded transition-colors",
        isFocused
          ? "bg-accent/50 ring-1 ring-primary/30"
          : "hover:bg-accent/40",
      )}
    >
      <span className="text-[13px] font-semibold text-foreground/80 w-[80px] shrink-0 truncate">
        {senderFirst}
      </span>
      <span className="text-[13px] text-muted-foreground truncate flex-1">
        {email.snippet}
      </span>
      <span className="text-[12px] text-muted-foreground/60 tabular-nums shrink-0 ml-2">
        {formatEmailDate(email.date)}
      </span>
    </div>
  );
});

// ─── Expanded message card (Superhuman style) ────────────────────────────────

const ExpandedMessageCard = forwardRef<
  HTMLDivElement,
  {
    email: EmailMessage;
    isFocused?: boolean;
    onCollapse: () => void;
    onReply: () => void;
    onReplyAll: () => void;
    onForward: () => void;
    onFocus?: () => void;
    onContactSelect?: (email: string) => void;
    searchTerm?: string;
    activeLocalIdx?: number | null;
  }
>(function ExpandedMessageCard(
  {
    email,
    isFocused,
    onCollapse,
    onReply,
    onReplyAll,
    onForward,
    onFocus,
    onContactSelect,
    searchTerm,
    activeLocalIdx,
  },
  ref,
) {
  const [showDetails, setShowDetails] = useState(false);
  const senderName = email.from.name || email.from.email;
  const recipients = [
    ...email.to.map((r) => r.name || r.email),
    ...(email.cc || []).map((r) => r.name || r.email),
  ].join(", ");

  const formatContact = (c: { name: string; email: string }) =>
    c.name && c.name !== c.email ? `${c.name} <${c.email}>` : c.email;

  const renderContactLink = (
    c: { name: string; email: string },
    i: number,
    arr: { name: string; email: string }[],
  ) => (
    <span key={c.email}>
      <button
        onClick={() => onContactSelect?.(c.email)}
        className="hover:text-primary transition-colors"
      >
        {formatContact(c)}
      </button>
      {i < arr.length - 1 && ", "}
    </span>
  );

  return (
    <div
      ref={ref}
      onClick={onFocus}
      className={cn(
        "rounded-lg bg-card dark:bg-[hsl(220,5%,10%)] overflow-hidden cursor-pointer",
        isFocused
          ? "ring-1 ring-primary/40"
          : "ring-1 ring-transparent hover:ring-border/30",
      )}
    >
      {/* Header */}
      {showDetails ? (
        <div className="px-3 sm:px-4 py-3">
          <div className="flex flex-col gap-1 text-[13px]">
            <div className="flex gap-3">
              <span className="w-10 shrink-0 text-muted-foreground/60">
                From
              </span>
              <span className="text-foreground font-semibold">
                <button
                  onClick={() => onContactSelect?.(email.from.email)}
                  className="hover:text-primary transition-colors"
                >
                  {formatContact(email.from)}
                </button>
              </span>
            </div>
            <div className="flex gap-3">
              <span className="w-10 shrink-0 text-muted-foreground/60">To</span>
              <span className="text-foreground">
                {email.to.map(renderContactLink)}
              </span>
            </div>
            {email.cc && email.cc.length > 0 && (
              <div className="flex gap-3">
                <span className="w-10 shrink-0 text-muted-foreground/60">
                  Cc
                </span>
                <span className="text-foreground">
                  {email.cc.map(renderContactLink)}
                </span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="w-10 shrink-0" />
              <span className="text-muted-foreground/60">
                {new Date(email.date).toLocaleDateString("en-US", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}{" "}
                at{" "}
                {new Date(email.date).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  timeZoneName: "short",
                })}
              </span>
              <button
                onClick={() => setShowDetails(false)}
                className="text-muted-foreground/50 hover:text-foreground transition-colors"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 cursor-pointer"
          onClick={onCollapse}
        >
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onContactSelect?.(email.from.email);
                setShowDetails(true);
              }}
              className="text-[13px] font-semibold text-foreground shrink-0 hover:text-foreground/80 transition-colors"
            >
              {senderName}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowDetails(true);
              }}
              className="text-[12px] text-muted-foreground/50 hover:text-muted-foreground transition-colors truncate text-left"
            >
              to {recipients}
            </button>
          </div>

          {/* Reply / Reply All / Forward buttons */}
          <div className="flex items-center gap-1 sm:gap-0.5 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReply();
              }}
              className="flex h-9 w-9 sm:h-6 sm:w-6 items-center justify-center rounded text-muted-foreground/40 hover:text-foreground transition-colors"
              title="Reply"
            >
              <IconArrowBackUp className="h-4 w-4 sm:h-[14px] sm:w-[14px]" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReplyAll();
              }}
              className="flex h-9 w-9 sm:h-6 sm:w-6 items-center justify-center rounded text-muted-foreground/40 hover:text-foreground transition-colors"
              title="Reply All"
            >
              <IconArrowBackUp className="h-4 w-4 sm:h-[14px] sm:w-[14px]" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onForward();
              }}
              className="flex h-9 w-9 sm:h-6 sm:w-6 items-center justify-center rounded text-muted-foreground/40 hover:text-foreground transition-colors"
              title="Forward"
            >
              <IconArrowForwardUp className="h-4 w-4 sm:h-[14px] sm:w-[14px]" />
            </button>
          </div>

          <span className="shrink-0 text-[12px] text-muted-foreground/50 tabular-nums">
            {formatEmailDate(email.date)}
          </span>
        </div>
      )}

      {/* Body */}
      <div className="px-3 sm:px-4 pb-5 pt-1 overflow-x-hidden">
        {email.bodyHtml ? (
          <HtmlEmailBody
            html={email.bodyHtml}
            senderEmail={email.from.email}
            searchTerm={searchTerm}
            activeLocalIdx={activeLocalIdx}
          />
        ) : email.body ? (
          <PlainTextBody
            body={email.body}
            searchTerm={searchTerm}
            activeLocalIdx={activeLocalIdx}
          />
        ) : email.snippet ? (
          <div className="text-[13px] text-muted-foreground whitespace-pre-wrap">
            {email.snippet}
            <span className="text-muted-foreground/60">…</span>
          </div>
        ) : null}
      </div>

      {/* Attachments */}
      {email.attachments && email.attachments.length > 0 && (
        <div className="px-3 sm:px-4 pb-4">
          {/* Image thumbnails */}
          {email.attachments.some((a) => a.mimeType.startsWith("image/")) && (
            <div className="flex flex-wrap gap-2 mb-2">
              {email.attachments
                .filter((a) => a.mimeType.startsWith("image/"))
                .map((att) => {
                  const url = `/api/attachments?messageId=${email.id}&id=${encodeURIComponent(att.id)}&mimeType=${encodeURIComponent(att.mimeType)}`;
                  return (
                    <a
                      key={att.id}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-lg overflow-hidden border border-border/40 hover:border-border bg-accent/30 hover:bg-accent/50"
                      title={att.filename}
                    >
                      <img
                        src={url}
                        alt={att.filename}
                        className="h-32 max-w-[200px] object-cover"
                        loading="lazy"
                      />
                    </a>
                  );
                })}
            </div>
          )}
          {/* Non-image files + download all */}
          <div className="flex flex-wrap items-center gap-2">
            {email.attachments
              .filter((a) => !a.mimeType.startsWith("image/"))
              .map((att) => (
                <a
                  key={att.id}
                  href={`/api/attachments?messageId=${email.id}&id=${encodeURIComponent(att.id)}`}
                  download={att.filename}
                  className="flex items-center gap-2 rounded-lg bg-accent/60 px-3 py-2 text-xs hover:bg-accent cursor-pointer"
                >
                  <IconPaperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="text-foreground/80 truncate max-w-[180px]">
                    {att.filename}
                  </span>
                  <span className="text-muted-foreground">
                    {formatFileSize(att.size)}
                  </span>
                </a>
              ))}
            {email.attachments.length > 1 && (
              <button
                onClick={() => {
                  for (const att of email.attachments!) {
                    const a = document.createElement("a");
                    a.href = `/api/attachments?messageId=${email.id}&id=${encodeURIComponent(att.id)}`;
                    a.download = att.filename;
                    a.click();
                  }
                }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <IconDownload className="h-3 w-3" />
                Download all
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

// ─── Plain text body with quoted text trimming ───────────────────────────────

/** Detect where an email signature begins in plain text (standard "-- " separator) */
function findSignatureStart(lines: string[], beforeLine?: number): number {
  const limit = beforeLine != null ? beforeLine : lines.length;
  for (let i = 0; i < limit; i++) {
    if (/^--\s*$/.test(lines[i].trim())) return i;
  }
  return -1;
}

/** Detect where quoted/forwarded content begins in a plain text email */
function findQuoteStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    // "On ... wrote:" pattern (with optional em-dash/dash prefix)
    if (/^[—–-]*\s*On .+ wrote:$/i.test(lines[i].trim())) return i;
    // "--- Original Message ---" / "--- Forwarded message ---"
    if (/^-{2,}\s*(Original|Forwarded)\s/i.test(lines[i].trim())) return i;
    // Block of consecutive ">" quoted lines (at least 2)
    if (
      lines[i].trimStart().startsWith(">") &&
      i + 1 < lines.length &&
      lines[i + 1].trimStart().startsWith(">")
    ) {
      // Walk back to include any blank line or "On ... wrote:" right before
      let start = i;
      if (start > 0 && lines[start - 1].trim() === "") start--;
      if (start > 0 && /^On .+ wrote:$/i.test(lines[start - 1].trim())) start--;
      return start;
    }
  }
  return -1;
}

function PlainTextBody({
  body,
  searchTerm,
  activeLocalIdx,
}: {
  body: string;
  searchTerm?: string;
  activeLocalIdx?: number | null;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const [showSig, setShowSig] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lines = body.split("\n");
  const quoteStart = findQuoteStart(lines);
  const hasQuoted = quoteStart >= 0;
  const sigStart = findSignatureStart(
    lines,
    hasQuoted ? quoteStart : undefined,
  );
  const hasSig = sigStart >= 0;

  // When searching, show all content (including quoted/sig) so matches aren't hidden
  const forceShowAll = !!searchTerm;

  // Determine visible lines: body → [sig toggle] → [quote toggle]
  let visibleLines: string[];
  if (forceShowAll) {
    visibleLines = lines;
  } else if (hasSig && !showSig) {
    visibleLines = lines.slice(0, sigStart);
  } else if (hasQuoted && !showQuoted) {
    visibleLines = lines.slice(0, quoteStart);
  } else {
    visibleLines = lines;
  }

  // Scroll active match into view
  useEffect(() => {
    if (activeLocalIdx == null || !containerRef.current) return;
    const mark = containerRef.current.querySelectorAll("mark[data-search]")[
      activeLocalIdx
    ] as HTMLElement | undefined;
    mark?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeLocalIdx]);

  // Render text with search highlights
  const renderHighlighted = (text: string, globalMatchOffset: number) => {
    if (!searchTerm) return text || "\u00a0";
    const q = searchTerm.toLowerCase();
    const lower = text.toLowerCase();
    const nodes: React.ReactNode[] = [];
    let matchCount = globalMatchOffset;
    let idx = 0;
    let pos = lower.indexOf(q);
    while (pos !== -1) {
      if (pos > idx) nodes.push(text.slice(idx, pos));
      const isActive = matchCount === activeLocalIdx;
      nodes.push(
        <mark
          key={`${pos}-${matchCount}`}
          data-search={matchCount}
          className={
            isActive
              ? "bg-amber-400 text-black rounded-[2px]"
              : "bg-yellow-200/25 text-inherit rounded-[2px]"
          }
        >
          {text.slice(pos, pos + searchTerm.length)}
        </mark>,
      );
      matchCount++;
      idx = pos + searchTerm.length;
      pos = lower.indexOf(q, idx);
    }
    if (idx < text.length) nodes.push(text.slice(idx));
    return nodes.length > 0 ? nodes : text || "\u00a0";
  };

  // Count matches in lines above the current one so we can track global match index per line
  const countMatchesInText = (text: string) => {
    if (!searchTerm) return 0;
    const q = searchTerm.toLowerCase();
    const lower = text.toLowerCase();
    let count = 0;
    let i = lower.indexOf(q);
    while (i !== -1) {
      count++;
      i = lower.indexOf(q, i + q.length);
    }
    return count;
  };

  let cumulativeMatches = 0;

  return (
    <div ref={containerRef} className="email-body-content">
      {visibleLines.map((line, i) => {
        const offset = cumulativeMatches;
        cumulativeMatches += countMatchesInText(line);
        return (
          <p key={i} className={line === "" ? "mb-3" : "mb-0"}>
            {renderHighlighted(line, offset)}
          </p>
        );
      })}
      {hasSig && !showSig && !forceShowAll && (
        <button
          onClick={() => setShowSig(true)}
          className="mt-1 text-[13px] text-muted-foreground/50 hover:text-muted-foreground tracking-wider"
        >
          ···
        </button>
      )}
      {hasQuoted && !showQuoted && !forceShowAll && (showSig || !hasSig) && (
        <button
          onClick={() => setShowQuoted(true)}
          className="mt-1 text-[13px] text-muted-foreground/50 hover:text-muted-foreground tracking-wider"
        >
          ···
        </button>
      )}
    </div>
  );
}

// ─── HTML email body (iframe) ────────────────────────────────────────────────

// Match the expanded card bg: hsl(220, 5%, 10%) ≈ #17181a
const IFRAME_BG_DARK = "#17181a";
const IFRAME_BG_LIGHT = "#ffffff";

// ─── Color utilities for dark-mode email processing ─────────────────────────

const NAMED_COLORS: Record<string, [number, number, number]> = {
  // Dark colors
  black: [0, 0, 0],
  navy: [0, 0, 128],
  darkblue: [0, 0, 139],
  darkgreen: [0, 100, 0],
  maroon: [128, 0, 0],
  darkred: [139, 0, 0],
  brown: [165, 42, 42],
  purple: [128, 0, 128],
  indigo: [75, 0, 130],
  midnightblue: [25, 25, 112],
  darkslategray: [47, 79, 79],
  darkslategrey: [47, 79, 79],
  dimgray: [105, 105, 105],
  dimgrey: [105, 105, 105],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  // Light/white colors (needed for background detection)
  white: [255, 255, 255],
  snow: [255, 250, 250],
  ivory: [255, 255, 240],
  floralwhite: [255, 250, 240],
  ghostwhite: [248, 248, 255],
  whitesmoke: [245, 245, 245],
  seashell: [255, 245, 238],
  linen: [250, 240, 230],
  beige: [245, 245, 220],
  oldlace: [253, 245, 230],
  antiquewhite: [250, 235, 215],
  aliceblue: [240, 248, 255],
  mintcream: [245, 255, 250],
  lavender: [230, 230, 250],
  // Mid-range colors
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  orange: [255, 165, 0],
  teal: [0, 128, 128],
  silver: [192, 192, 192],
  lightgray: [211, 211, 211],
  lightgrey: [211, 211, 211],
};

function parseColorToRgb(
  color: string,
): { r: number; g: number; b: number } | null {
  const c = color.trim().toLowerCase();

  if (NAMED_COLORS[c]) {
    const [r, g, b] = NAMED_COLORS[c];
    return { r, g, b };
  }

  // Hex: #RGB or #RRGGBB
  const hexMatch = c.match(/^#([0-9a-f]{3,8})$/);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
      };
    }
    if (hex.length >= 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
  }

  // rgb(r, g, b) or rgba(r, g, b, a)
  const rgbMatch = c.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/,
  );
  if (rgbMatch) {
    const alpha = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;
    if (alpha < 0.5) return null;
    return {
      r: parseInt(rgbMatch[1]),
      g: parseInt(rgbMatch[2]),
      b: parseInt(rgbMatch[3]),
    };
  }

  return null;
}

function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((ch) => {
    const s = ch / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** Convert RGB to HSL (h: 0-360, s: 0-1, l: 0-1) */
function rgbToHsl(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/** Convert HSL back to RGB */
function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  h /= 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

/**
 * Transform a dark color to its light equivalent for dark mode.
 * Preserves hue and saturation, lightens the color.
 * e.g. dark blue (#00008B) → light blue (#8B8BFF), black → #e4e4e7
 * Returns null if the color doesn't need transformation (already light enough).
 */
function lightenColorForDarkMode(colorStr: string): string | null {
  const rgb = parseColorToRgb(colorStr);
  if (!rgb) return null;
  const lum = relativeLuminance(rgb.r, rgb.g, rgb.b);
  // Don't transform colors that are already readable on dark bg
  if (lum >= 0.15) return null;
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  // For near-black/gray (no saturation), use our standard light text color
  if (hsl.s < 0.1) return "#e4e4e7";
  // Lighten: mirror the lightness around 0.5 and boost
  // A dark color at L=0.2 becomes L=0.7, L=0.1 becomes L=0.75
  const newL = Math.min(0.85, Math.max(0.6, 1 - hsl.l));
  const newRgb = hslToRgb(hsl.h, Math.min(hsl.s, 0.85), newL);
  return `rgb(${newRgb.r}, ${newRgb.g}, ${newRgb.b})`;
}

/**
 * Check if the email has intentional colored (non-white) backgrounds
 * that indicate a designed layout. White/near-white backgrounds are NOT
 * considered "designed" — they're just the default and we override them to dark.
 * Returns true only for colored backgrounds (e.g. blue banners, gray sections).
 */
function emailHasDesignedBackground(html: string): boolean {
  const lower = html.toLowerCase();
  if (
    !lower.includes("style") &&
    !lower.includes("bgcolor") &&
    !lower.includes("background")
  ) {
    return false;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Check for non-white background colors on body/html
  const checkBg = (colorStr: string): boolean => {
    const rgb = parseColorToRgb(colorStr.trim());
    if (!rgb) return false;
    const lum = relativeLuminance(rgb.r, rgb.g, rgb.b);
    // White/near-white (lum > 0.85) → not "designed", just default
    // Very dark (lum < 0.05) → already dark, no issue
    // Everything else (colored backgrounds) → designed layout
    return lum <= 0.85 && lum >= 0.05;
  };

  const body = doc.body;
  const bodyStyle = body?.getAttribute("style") || "";
  const bgMatch = bodyStyle.match(/background(?:-color)?\s*:\s*([^;!]+)/i);
  if (bgMatch && checkBg(bgMatch[1])) return true;

  const bodyBg = body?.getAttribute("bgcolor");
  if (bodyBg && checkBg(bodyBg)) return true;

  const htmlBg = doc.documentElement?.getAttribute("bgcolor");
  if (htmlBg && checkBg(htmlBg)) return true;

  // Check <style> blocks for body/html background
  const styleTags = doc.querySelectorAll("style");
  for (const tag of styleTags) {
    const text = tag.textContent || "";
    const ruleMatch = text.match(
      /(?:html|body)\s*\{[^}]*?background(?:-color)?\s*:\s*([^;}]+)/im,
    );
    if (ruleMatch && checkBg(ruleMatch[1])) return true;
  }

  // Check for significant use of colored table cell backgrounds
  // (common in marketing emails with colored sections)
  const coloredCells = doc.querySelectorAll(
    'td[bgcolor], th[bgcolor], td[style*="background"], th[style*="background"]',
  );
  let coloredCellCount = 0;
  for (const cell of coloredCells) {
    const bg =
      cell.getAttribute("bgcolor") ||
      (cell.getAttribute("style") || "").match(
        /background(?:-color)?\s*:\s*([^;!]+)/i,
      )?.[1];
    if (bg && checkBg(bg)) {
      coloredCellCount++;
      if (coloredCellCount >= 3) return true; // multiple colored cells → designed
    }
  }

  return false;
}

// Known tracking pixel domains (partial matches against hostname)
const TRACKER_DOMAINS = [
  "open.convertkit-",
  "pixel.mailchimp.com",
  "list-manage.com/track",
  "t.sendinblue.com",
  "t.sidekickopen",
  "t.semail.",
  "tracking.tldrnewsletter.com",
  "links.iterable.com",
  "email.mg.",
  "trk.klclick",
  "beacon.krxd.net",
  "r.sup.sh", // Superhuman
  "t.superhuman.com",
  "track.hubspot",
  "track.customer.io",
  "ct.sendgrid.net",
  "sendgrid.net/wf/open",
  "mandrillapp.com/track",
  "mailgun.org/track",
  "go.pardot.com",
  "analytics.google.com",
  "google-analytics.com",
  "bat.bing.com",
  "facebook.com/tr",
  "connect.facebook.net",
  "ad.doubleclick.net",
  "demdex.net",
  "omtrdc.net",
  "ml.klaviyo.com",
  "trk.klaviyo.com",
];

function isTrackingUrl(src: string): boolean {
  try {
    const url = new URL(src);
    const full = url.hostname + url.pathname;
    return TRACKER_DOMAINS.some((d) => full.includes(d));
  } catch {
    return false;
  }
}

type SanitizedEmailHtml = {
  headHtml: string;
  bodyHtml: string;
};

function sanitizeEmailHtml(html: string): SanitizedEmailHtml {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  doc
    .querySelectorAll(
      "script, noscript, iframe, frame, object, embed, base, meta[http-equiv='refresh']",
    )
    .forEach((node) => node.remove());

  const elements = doc.querySelectorAll<HTMLElement>("*");
  elements.forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (
        (name === "href" || name === "src" || name === "xlink:href") &&
        value.startsWith("javascript:")
      ) {
        el.removeAttribute(attr.name);
      }
    }
  });

  return {
    headHtml: doc.head.innerHTML,
    bodyHtml: doc.body.innerHTML,
  };
}

/** Strip images from HTML based on policy. Returns [processedHtml, imageCount]. */
function processHtmlImages(
  html: string,
  policy: "show" | "block-trackers" | "block-all",
): [string, number] {
  if (policy === "show") return [html, 0];

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const images = doc.querySelectorAll("img");
  let blocked = 0;

  images.forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (!src || src.startsWith("data:") || src.startsWith("cid:")) return;

    if (policy === "block-all") {
      img.removeAttribute("src");
      img.setAttribute("data-blocked-src", src);
      blocked++;
    } else if (policy === "block-trackers" && isTrackingUrl(src)) {
      img.remove();
      blocked++;
    }
  });

  // Also strip tracking pixel style tags (1x1 images via CSS background)
  if (policy === "block-trackers" || policy === "block-all") {
    doc.querySelectorAll('img[width="1"][height="1"]').forEach((img) => {
      img.remove();
      blocked++;
    });
    doc.querySelectorAll('img[width="0"]').forEach((img) => {
      img.remove();
      blocked++;
    });
    doc
      .querySelectorAll(
        'img[style*="display:none"], img[style*="display: none"]',
      )
      .forEach((img) => {
        img.remove();
        blocked++;
      });
  }

  return [doc.body.innerHTML, blocked];
}

function HtmlEmailBody({
  html,
  senderEmail,
  searchTerm,
  activeLocalIdx,
}: {
  html: string;
  senderEmail?: string;
  searchTerm?: string;
  activeLocalIdx?: number | null;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const sanitizedHtml = useMemo(() => sanitizeEmailHtml(html), [html]);
  // Only fall back to light bg when the email has actual designed colored backgrounds
  // (not white/near-white which we override to dark). This matches Superhuman behavior.
  const hasDesignedBg = useMemo(() => emailHasDesignedBackground(html), [html]);
  const IFRAME_BG = hasDesignedBg || !isDark ? IFRAME_BG_LIGHT : IFRAME_BG_DARK;
  const { data: settings } = useSettings();
  const updateSettings = useUpdateSettings();

  const imagePolicy = settings?.imagePolicy ?? "show";
  const trustedSenders = settings?.trustedSenders ?? [];
  const senderDomain = senderEmail?.split("@")[1]?.toLowerCase();
  const isTrusted = senderEmail
    ? trustedSenders.includes(senderEmail.toLowerCase()) ||
      (senderDomain ? trustedSenders.includes(`@${senderDomain}`) : false)
    : false;

  const [showImagesForThread, setShowImagesForThread] = useState(false);

  // Determine effective policy for this email
  const effectivePolicy =
    isTrusted || showImagesForThread
      ? imagePolicy === "block-all"
        ? "block-trackers" // trusted senders still get tracker blocking if policy isn't "show"
        : imagePolicy
      : imagePolicy;

  const [processedHtml, blockedCount] = useMemo(
    () => processHtmlImages(sanitizedHtml.bodyHtml, effectivePolicy),
    [sanitizedHtml.bodyHtml, effectivePolicy],
  );

  const handleAlwaysTrust = () => {
    if (!senderDomain) return;
    const current = settings?.trustedSenders ?? [];
    const domainKey = `@${senderDomain}`;
    if (!current.includes(domainKey)) {
      updateSettings.mutate({ trustedSenders: [...current, domainKey] });
    }
    setShowImagesForThread(true);
  };

  const useDarkIframeCss = isDark && !hasDesignedBg;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const doc = iframe.contentDocument;
    if (!doc) return;

    doc.open();
    const iframeCss = useDarkIframeCss
      ? `
    html, body {
      margin: 0;
      padding: 0;
      background: ${IFRAME_BG} !important;
      color: #e4e4e7 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      overflow: hidden;
      color-scheme: dark;
    }
    /* Force dark backgrounds on all container elements */
    div, table, tr, td, th, span, p, blockquote, pre, ul, ol, li,
    h1, h2, h3, h4, h5, h6, header, footer, section, article,
    form, fieldset, center, font, main, aside, nav {
      background-color: transparent !important;
      background-image: none !important;
    }
    /* Default text color for elements that don't have readable inline colors */
    body, div, p, span, td, th, li, h1, h2, h3, h4, h5, h6,
    font, strong, em, b, i, u, small, label, dt, dd, pre, code,
    blockquote { color: inherit; }
    a { color: #818cf8 !important; }
    img { max-width: 100%; height: auto; }
    hr { border-color: rgba(255,255,255,0.1) !important; }
    .quoted-hidden { display: none; }
    .sig-collapsed { display: none; }
    .quote-toggle, .sig-toggle {
      display: inline-block;
      cursor: pointer;
      color: rgba(161,161,170,0.5);
      font-size: 13px;
      letter-spacing: 0.15em;
      padding: 2px 0;
      border: none;
      background: none;
      margin-top: 4px;
    }
    .quote-toggle:hover, .sig-toggle:hover { color: rgba(161,161,170,0.8); }
`
      : `
    html, body {
      margin: 0;
      padding: 0;
      background: ${IFRAME_BG};
      color: #1a1a1a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      overflow: hidden;
    }
    img { max-width: 100%; height: auto; }
    .quoted-hidden { display: none; }
    .sig-collapsed { display: none; }
    .quote-toggle, .sig-toggle {
      display: inline-block;
      cursor: pointer;
      color: rgba(0,0,0,0.4);
      font-size: 13px;
      letter-spacing: 0.15em;
      padding: 2px 0;
      border: none;
      background: none;
      margin-top: 4px;
    }
    .quote-toggle:hover, .sig-toggle:hover { color: rgba(0,0,0,0.7); }
`;

    doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  ${sanitizedHtml.headHtml}
  <style>${iframeCss}  </style>
</head>
<body>${processedHtml}</body>
</html>`);
    doc.close();

    const resize = () => {
      if (doc.body) {
        const h = doc.body.scrollHeight;
        if (h > 0) setHeight(h);
      }
    };

    // Hide quoted content (Gmail blockquotes, .gmail_quote, etc.) behind "..."
    const quoteSelectors = [
      ".gmail_quote",
      ".gmail_extra",
      'blockquote[type="cite"]',
      ".yahoo_quoted",
      "#appendonsend",
      ".zmail_extra",
      'div[id="divRplyFwdMsg"]',
    ];
    const quotes = doc.querySelectorAll(quoteSelectors.join(","));
    quotes.forEach((quote) => {
      (quote as HTMLElement).classList.add("quoted-hidden");
      const toggle = doc.createElement("button");
      toggle.className = "quote-toggle";
      toggle.textContent = "···";
      toggle.addEventListener("click", () => {
        const wasHidden = (quote as HTMLElement).classList.contains(
          "quoted-hidden",
        );
        (quote as HTMLElement).classList.toggle("quoted-hidden");
        toggle.style.display = wasHidden ? "none" : "";
        // Recalculate iframe height after expanding/collapsing quoted content
        requestAnimationFrame(resize);
      });
      quote.parentNode?.insertBefore(toggle, quote);
    });

    // ── Collapse signature blocks ──
    // Gmail signatures
    const sigSelectors = [
      ".gmail_signature",
      '[data-smartmail="gmail_signature"]',
    ];
    const sigs = doc.querySelectorAll(sigSelectors.join(","));
    sigs.forEach((sig) => {
      (sig as HTMLElement).classList.add("sig-collapsed");
      const toggle = doc.createElement("button");
      toggle.className = "sig-toggle";
      toggle.textContent = "···";
      toggle.addEventListener("click", () => {
        const wasHidden = (sig as HTMLElement).classList.contains(
          "sig-collapsed",
        );
        (sig as HTMLElement).classList.toggle("sig-collapsed");
        toggle.style.display = wasHidden ? "none" : "";
        requestAnimationFrame(resize);
      });
      sig.parentNode?.insertBefore(toggle, sig);
    });

    // Detect "-- " signature separator in text nodes (standard email sig convention)
    if (sigs.length === 0) {
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
      let sigNode: HTMLElement | null = null;
      let textNode: Text | null;
      while ((textNode = walker.nextNode() as Text | null)) {
        const text = textNode.textContent || "";
        // Standard sig separator: "-- " on its own line (or just "--")
        if (/^--\s*$/.test(text.trim())) {
          sigNode = textNode.parentElement;
          break;
        }
      }
      if (sigNode) {
        // Wrap the sig separator and all following siblings in a container
        const container = doc.createElement("div");
        container.className = "sig-collapsed";
        sigNode.parentNode?.insertBefore(container, sigNode);
        container.appendChild(sigNode);
        while (container.nextSibling) {
          // Don't swallow quote toggles or quoted content
          if (
            (container.nextSibling as HTMLElement).classList?.contains(
              "quote-toggle",
            ) ||
            (container.nextSibling as HTMLElement).classList?.contains(
              "quoted-hidden",
            )
          )
            break;
          container.appendChild(container.nextSibling);
        }
        const toggle = doc.createElement("button");
        toggle.className = "sig-toggle";
        toggle.textContent = "···";
        toggle.addEventListener("click", () => {
          const wasHidden = container.classList.contains("sig-collapsed");
          container.classList.toggle("sig-collapsed");
          toggle.style.display = wasHidden ? "none" : "";
          requestAnimationFrame(resize);
        });
        container.parentNode?.insertBefore(toggle, container);
      }
    }

    // ── Force dark mode: transform colors for readability ──
    if (useDarkIframeCss) {
      // Remove bgcolor attributes — replace white/light with nothing (our CSS
      // sets dark bg), keep truly transparent
      doc.querySelectorAll("[bgcolor]").forEach((el) => {
        (el as HTMLElement).removeAttribute("bgcolor");
      });

      // Walk elements with inline styles and transform colors
      const styledEls = doc.querySelectorAll<HTMLElement>("[style]");
      styledEls.forEach((el) => {
        const style = el.getAttribute("style") || "";

        // Remove inline background colors (CSS handles it via !important)
        if (/background/i.test(style)) {
          el.style.backgroundColor = "transparent";
          el.style.backgroundImage = "none";
        }

        // Transform dark text colors → light equivalents (preserving hue)
        const colorMatch = style.match(/(?<![a-z-])color\s*:\s*([^;!]+)/i);
        if (colorMatch) {
          const lightened = lightenColorForDarkMode(colorMatch[1].trim());
          if (lightened) el.style.color = lightened;
        }
      });

      // Transform <font color="..."> dark colors
      doc.querySelectorAll<HTMLElement>("font[color]").forEach((el) => {
        const c = el.getAttribute("color") || "";
        const lightened = lightenColorForDarkMode(c);
        if (lightened) el.setAttribute("color", lightened);
      });

      // Transform dark text color rules in <style> blocks
      doc.querySelectorAll("style").forEach((tag) => {
        const text = tag.textContent || "";
        tag.textContent = text.replace(
          /((?:body|td|th|p|div|span|li|font)\s*(?:,\s*(?:body|td|th|p|div|span|li|font)\s*)*\{[^}]*?)(?<![a-z-])color\s*:\s*([^;}]+)/gim,
          (match, before, colorVal) => {
            const lightened = lightenColorForDarkMode(colorVal.trim());
            if (lightened) return `${before}color: ${lightened}`;
            return match;
          },
        );
      });
    }

    // Make all links open in a new browser tab (web) or new window (Electron)
    const links = doc.querySelectorAll("a[href]");
    const isElectron = navigator.userAgent.includes("Electron");
    links.forEach((a) => {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });

    // Enhance Google Calendar RSVP buttons for inline response
    const rsvpLinks = doc.querySelectorAll(
      'a[href*="calendar.google.com/calendar/event"]',
    );
    const rstMap: Record<string, { response: string; label: string }> = {
      "1": { response: "accepted", label: "Yes" },
      "2": { response: "declined", label: "No" },
      "3": { response: "tentative", label: "Maybe" },
    };
    // Extract the event ID from any RSVP link's eid param
    let calEventId: string | null = null;
    rsvpLinks.forEach((a) => {
      const href = a.getAttribute("href") || "";
      try {
        const url = new URL(href);
        const eid = url.searchParams.get("eid");
        if (eid && !calEventId) {
          // eid is base64 — the event ID is the part before the space/email
          try {
            const decoded = atob(eid);
            // Format: "eventId email" — take the first part
            calEventId = decoded.split(" ")[0] || null;
          } catch {
            calEventId = eid;
          }
        }
      } catch {}
    });

    if (calEventId && rsvpLinks.length > 0) {
      const eventId = calEventId;
      rsvpLinks.forEach((a) => {
        const href = a.getAttribute("href") || "";
        try {
          const url = new URL(href);
          const rst = url.searchParams.get("rst");
          const info = rst ? rstMap[rst] : null;
          if (!info) return;

          // Style the button for inline RSVP
          const el = a as HTMLElement;
          el.style.cssText = useDarkIframeCss
            ? `
            display: inline-block !important;
            padding: 6px 16px !important;
            border-radius: 6px !important;
            font-size: 13px !important;
            font-weight: 500 !important;
            cursor: pointer !important;
            text-decoration: none !important;
            border: 1px solid rgba(255,255,255,0.15) !important;
            color: #e4e4e7 !important;
            background: rgba(255,255,255,0.05) !important;
          `
            : `
            display: inline-block !important;
            padding: 6px 16px !important;
            border-radius: 6px !important;
            font-size: 13px !important;
            font-weight: 500 !important;
            cursor: pointer !important;
            text-decoration: none !important;
            border: 1px solid rgba(0,0,0,0.15) !important;
            color: #374151 !important;
            background: rgba(0,0,0,0.04) !important;
          `;
        } catch {}
      });

      // Handle RSVP clicks inline
      const handleRsvpClick = async (e: MouseEvent) => {
        const anchor = (e.target as Element)?.closest?.(
          'a[href*="calendar.google.com/calendar/event"]',
        ) as HTMLElement | null;
        if (!anchor) return;
        const href = anchor.getAttribute("href") || "";
        try {
          const url = new URL(href);
          const rst = url.searchParams.get("rst");
          const info = rst ? rstMap[rst] : null;
          if (!info) return;

          e.preventDefault();
          e.stopPropagation();

          // Highlight the clicked button
          anchor.style.background = "#22c55e !important";
          anchor.style.borderColor = "#22c55e !important";
          anchor.style.color = "#fff !important";

          // Dim the others
          rsvpLinks.forEach((other) => {
            if (other !== anchor) {
              (other as HTMLElement).style.opacity = "0.3";
              (other as HTMLElement).style.pointerEvents = "none";
            }
          });

          // Call our API
          try {
            const res = await fetch("/api/calendar/rsvp", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                eventId,
                response: info.response,
              }),
            });
            if (!res.ok) {
              // Fallback: open the original link
              window.open(href, "_blank", "noopener,noreferrer");
            }
          } catch {
            window.open(href, "_blank", "noopener,noreferrer");
          }
        } catch {}
      };
      doc.addEventListener("click", handleRsvpClick);
    }

    const handleLinkClick = (e: MouseEvent) => {
      const anchor = (e.target as Element)?.closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      // Don't handle RSVP links here — they have their own handler
      if (href.includes("calendar.google.com/calendar/event")) return;
      e.preventDefault();
      if (isElectron && (window as any).require) {
        const { shell } = (window as any).require("electron");
        shell.openExternal(href);
      } else {
        window.open(href, "_blank", "noopener,noreferrer");
      }
    };
    doc.addEventListener("click", handleLinkClick);

    // Forward keyboard events from iframe to parent
    const forwardKey = (e: KeyboardEvent) => {
      const forwarded = new KeyboardEvent(e.type, {
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        which: e.which,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(forwarded);
    };
    doc.addEventListener("keydown", forwardKey);

    const images = doc.querySelectorAll("img");
    images.forEach((img) => img.addEventListener("load", resize));

    resize();
    const timer = setTimeout(resize, 100);
    const timer2 = setTimeout(resize, 500);

    return () => {
      doc.removeEventListener("click", handleLinkClick);
      doc.removeEventListener("keydown", forwardKey);
      clearTimeout(timer);
      clearTimeout(timer2);
      images.forEach((img) => img.removeEventListener("load", resize));
    };
  }, [
    processedHtml,
    sanitizedHtml.headHtml,
    isDark,
    useDarkIframeCss,
    IFRAME_BG,
  ]);

  // Inject / clear search highlights in the iframe whenever searchTerm or content changes
  useEffect(() => {
    const injectHighlights = () => {
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      if (!doc?.body) return;

      // Remove existing marks and normalize text nodes
      doc.querySelectorAll("mark[data-search]").forEach((mark) => {
        const text = doc.createTextNode(mark.textContent || "");
        mark.parentNode?.replaceChild(text, mark);
      });
      doc.body.normalize();

      const q = searchTerm?.trim().toLowerCase();
      if (!q) return;

      // Collect all matching text-node positions
      const matches: { node: Text; start: number; idx: number }[] = [];
      let matchIdx = 0;
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const tag = node.parentElement?.tagName.toLowerCase();
          return tag === "script" || tag === "style"
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT;
        },
      });
      let node: Text | null;
      while ((node = walker.nextNode() as Text)) {
        const text = node.textContent || "";
        const lower = text.toLowerCase();
        let pos = lower.indexOf(q);
        while (pos !== -1) {
          matches.push({ node, start: pos, idx: matchIdx++ });
          pos = lower.indexOf(q, pos + q.length);
        }
      }

      // Wrap in reverse order so earlier indices stay valid
      for (let i = matches.length - 1; i >= 0; i--) {
        const { node: textNode, start, idx } = matches[i];
        try {
          const range = doc.createRange();
          range.setStart(textNode, start);
          range.setEnd(textNode, start + q.length);
          const mark = doc.createElement("mark");
          mark.setAttribute("data-search", String(idx));
          mark.style.cssText =
            "background:rgba(253,224,71,0.25);color:inherit;border-radius:2px;";
          range.surroundContents(mark);
        } catch {
          // surroundContents fails when range spans element boundaries; skip
        }
      }

      // Recalculate height after injecting marks
      const h = doc.body.scrollHeight;
      if (h > 0) setHeight(h);
    };

    // Small delay to ensure iframe DOM is ready after a processedHtml rewrite
    const timer = setTimeout(injectHighlights, 60);
    return () => clearTimeout(timer);
  }, [searchTerm, processedHtml]);

  // Update which mark is "active" and scroll it into view
  useEffect(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc?.body) return;

    doc.querySelectorAll("mark[data-search]").forEach((m) => {
      (m as HTMLElement).style.background = "rgba(253,224,71,0.25)";
      (m as HTMLElement).style.color = "inherit";
    });

    if (activeLocalIdx == null) return;
    const marks = doc.querySelectorAll("mark[data-search]");
    const active = marks[activeLocalIdx] as HTMLElement | undefined;
    if (active) {
      active.style.background = "rgb(251,191,36)";
      active.style.color = "#000";
      active.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeLocalIdx, searchTerm]);

  const showBanner =
    effectivePolicy === "block-all" && blockedCount > 0 && !showImagesForThread;

  return (
    <div>
      {showBanner && (
        <div className="flex items-center gap-2 px-3 py-1.5 mb-2 rounded-md bg-accent/60 text-[12px] text-muted-foreground">
          <IconPhoto className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
          <span>Images blocked.</span>
          <button
            onClick={() => setShowImagesForThread(true)}
            className="text-primary hover:text-primary/80 font-medium transition-colors"
          >
            Show images
          </button>
          {senderEmail && (
            <button
              onClick={handleAlwaysTrust}
              className="text-muted-foreground/60 hover:text-muted-foreground font-medium transition-colors"
            >
              Always from {senderEmail.split("@")[1]}
            </button>
          )}
        </div>
      )}
      <iframe
        ref={iframeRef}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        style={{
          width: "100%",
          height: `${height}px`,
          border: "none",
          background: IFRAME_BG,
          colorScheme: useDarkIframeCss ? "dark" : "light",
          borderRadius: hasDesignedBg && isDark ? "6px" : undefined,
        }}
        title="Email content"
      />
    </div>
  );
}

// ─── In-thread search bar ─────────────────────────────────────────────────────

function ThreadSearchBar({
  query,
  onChange,
  onNext,
  onPrev,
  onClose,
  matchIdx,
  totalMatches,
  inputRef,
}: {
  query: string;
  onChange: (q: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  matchIdx: number;
  totalMatches: number;
  inputRef: React.RefObject<HTMLInputElement>;
}) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    }
  };

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-border/50 bg-background/80 backdrop-blur-sm">
      <IconSearch className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search in conversation…"
        className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 outline-none min-w-0"
        autoComplete="off"
        spellCheck={false}
      />
      {query && (
        <span className="text-[12px] text-muted-foreground/50 tabular-nums shrink-0 select-none">
          {totalMatches === 0
            ? "No matches"
            : `${matchIdx + 1} / ${totalMatches}`}
        </span>
      )}
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          onClick={onPrev}
          disabled={totalMatches === 0}
          className="flex h-8 w-8 sm:h-6 sm:w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Previous match (Shift+Enter)"
        >
          <IconChevronUp className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
        </button>
        <button
          onClick={onNext}
          disabled={totalMatches === 0}
          className="flex h-8 w-8 sm:h-6 sm:w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Next match (Enter)"
        >
          <IconChevronDown className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
        </button>
        <button
          onClick={onClose}
          className="flex h-8 w-8 sm:h-6 sm:w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors ml-1"
          title="Close (Esc)"
        >
          <IconX className="h-3.5 w-3.5 sm:h-3 sm:w-3" />
        </button>
      </div>
    </div>
  );
}
