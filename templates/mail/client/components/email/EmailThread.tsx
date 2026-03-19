import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  forwardRef,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { cn, formatEmailDate, formatFileSize } from "@/lib/utils";
import { useComposeState } from "@/hooks/use-compose-state";
import { useAccountFilter } from "@/components/layout/AppLayout";
import {
  useThreadMessages,
  useArchiveEmail,
  useTrashEmail,
  useToggleStar,
  useMarkRead,
  useUnarchiveEmail,
  useSettings,
  useUpdateSettings,
} from "@/hooks/use-emails";
import { useQueryClient } from "@tanstack/react-query";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { setUndoAction } from "@/hooks/use-undo";
import { toast } from "sonner";
import type { EmailMessage } from "@shared/types";
import {
  InlineReplyComposer,
  type InlineReplyHandle,
} from "./InlineReplyComposer";

export function EmailThread({
  onArchived,
  emailIds = [],
  onContactSelect,
}: {
  onArchived?: (id: string) => void;
  emailIds?: string[];
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

  // Pull any messages we already have from the list cache (instant, no fetch)
  const cachedMessages = useMemo(() => {
    if (!threadId) return [];
    const allCached: EmailMessage[] = [];
    const queries = queryClient.getQueriesData<EmailMessage[]>({
      queryKey: ["emails"],
    });
    for (const [, data] of queries) {
      if (!data) continue;
      for (const email of data) {
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
  const { data: threadMessages } = useThreadMessages(threadId);

  // Use full thread when loaded, otherwise show what we have from the list cache
  const messages = threadMessages ?? cachedMessages;

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
  const toggleStar = useToggleStar();
  const markRead = useMarkRead();

  const goBack = useCallback(
    () => navigate(`/${view}${labelSuffix}`),
    [navigate, view, labelSuffix],
  );

  // Navigate between threads (j/k)
  const goToSibling = useCallback(
    (delta: number) => {
      if (!threadId || emailIds.length === 0) return;
      const idx = emailIds.indexOf(threadId);
      if (idx === -1) return;
      const nextIdx = idx + delta;
      if (nextIdx < 0 || nextIdx >= emailIds.length) return;
      navigate(`/${view}/${emailIds[nextIdx]}${labelSuffix}`);
    },
    [threadId, emailIds, view, navigate, labelSuffix],
  );

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

  const handleArchive = useCallback(() => {
    if (!email) return;
    const id = email.id;
    onArchived?.(id);
    const undo = () => unarchiveEmail.mutate(id);
    setUndoAction(undo);
    toast("Marked as Done.", {
      action: {
        label: "UNDO",
        onClick: undo,
      },
    });
    advanceOrGoBack();
    archiveEmail.mutate({ id, accountEmail: email.accountEmail });
  }, [email, archiveEmail, unarchiveEmail, advanceOrGoBack, onArchived]);

  const handleTrash = useCallback(() => {
    if (!email) return;
    toast("Moved to Trash.");
    advanceOrGoBack();
    trashEmail.mutate(email.id);
  }, [email, trashEmail, advanceOrGoBack]);

  const handleStar = useCallback(() => {
    if (!email) return;
    toggleStar.mutate({ id: email.id, isStarred: !email.isStarred });
  }, [email, toggleStar]);

  const { data: settings } = useSettings();
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
    `\n\n— On ${new Date(target.date).toLocaleDateString()}, ${target.from.name || target.from.email} wrote:\n\n${target.body
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
        body: `\n\n— Forwarded message —\nFrom: ${msg.from.name} <${msg.from.email}>\n\n${msg.body}`,
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
      { key: "Escape", handler: goBack },
      { key: "j", handler: () => goToSibling(1) },
      { key: "k", handler: () => goToSibling(-1) },
      { key: "n", handler: () => focusMessage(1) },
      { key: "p", handler: () => focusMessage(-1) },
      { key: "Enter", handler: toggleFocused },
      { key: "o", handler: toggleFocused },
      { key: "e", handler: handleArchive },
      { key: "d", handler: handleTrash },
      { key: "#", handler: handleTrash, shift: true },
      { key: "s", handler: handleStar },
      { key: "r", handler: () => handleReply() },
      { key: "a", handler: () => handleReplyAll() },
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
          markRead.mutate({ id: email.id, isRead: !email.isRead });
        },
      },
      {
        key: "I",
        shift: true,
        handler: () => {
          if (!email) return;
          markRead.mutate({ id: email.id, isRead: true });
        },
      },
      {
        key: "U",
        shift: true,
        handler: () => {
          if (!email) return;
          markRead.mutate({ id: email.id, isRead: false });
        },
      },
    ],
    !!threadId,
  );

  if (!threadId) return null;

  if (!email) {
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
  const displayLabels = email.labelIds.filter((l) => !systemLabels.has(l));

  // Strip "Re: " / "Fwd: " prefixes for thread subject
  const threadSubject = email.subject.replace(/^(Re|Fwd|Fw):\s*/i, "");

  return (
    <div className="flex flex-1 flex-col overflow-hidden panel-slide-in">
      {/* Thread header */}
      <div className="shrink-0 px-5 pt-5 pb-3">
        <div className="flex items-start gap-3">
          <button
            onClick={goBack}
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Back (Esc)"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-[14px] w-[14px]"
            >
              <path
                fillRule="evenodd"
                d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2 flex-wrap">
              <h1 className="text-lg font-semibold leading-tight text-foreground">
                {threadSubject}
              </h1>
              {displayLabels.map((labelId) => (
                <span
                  key={labelId}
                  className="label-badge shrink-0 bg-pink-500/20 text-pink-300 mt-1"
                >
                  {labelId}
                </span>
              ))}
              {/* Action bar */}
              <div className="flex items-center gap-0.5 ml-auto shrink-0">
                <button
                  onClick={handleArchive}
                  className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  title="Done (E)"
                >
                  <svg
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="h-4 w-4"
                  >
                    <path
                      fillRule="evenodd"
                      d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
                <button
                  onClick={() => goToSibling(-1)}
                  className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors ml-1"
                >
                  <svg
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="h-3.5 w-3.5"
                  >
                    <path
                      fillRule="evenodd"
                      d="M11.78 9.78a.75.75 0 0 1-1.06 0L8 7.06 5.28 9.78a.75.75 0 0 1-1.06-1.06l3.25-3.25a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
                <button
                  onClick={() => goToSibling(1)}
                  className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <svg
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="h-3.5 w-3.5"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>
            </div>
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
        className="flex-1 overflow-y-auto px-5 pb-4"
      >
        <div className="max-w-3xl mx-auto pt-1.5 space-y-1.5">
          {messages.map((msg, idx) => {
            const isExpanded = expandedIds.has(msg.id);
            const isFocused = idx === focusedIndex;
            const isLast = idx === messages.length - 1;
            return isExpanded ? (
              <ExpandedMessageCard
                key={msg.id}
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
                onContactSelect={onContactSelect}
                searchTerm={searchQuery.trim() || undefined}
                activeLocalIdx={getActiveLocalIdx(msg.id)}
              />
            ) : (
              <CollapsedMessageRow
                key={msg.id}
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
            );
          })}

          {/* Inline reply composer */}
          {inlineDraft ? (
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
          ) : (
            <div
              className="flex items-center rounded-lg bg-accent/40 px-4 py-2.5 cursor-text hover:bg-accent/60 transition-colors mt-3"
              onClick={() => handleReply()}
            >
              <span className="text-[13px] text-muted-foreground/60">
                Reply
              </span>
            </div>
          )}
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
        "flex items-center gap-3 px-3 py-2 cursor-pointer rounded transition-colors",
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
      className={cn(
        "rounded-lg bg-[hsl(220,5%,10%)] overflow-hidden",
        isFocused && "ring-1 ring-primary/30",
      )}
    >
      {/* Header */}
      {showDetails ? (
        <div className="px-4 py-3">
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
                <svg
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="h-3.5 w-3.5"
                >
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="flex items-center gap-3 px-4 py-3 cursor-pointer"
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
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReply();
              }}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40 hover:text-foreground transition-colors"
              title="Reply"
            >
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-[14px] w-[14px]"
              >
                <path d="M7.5 4.5L2.5 9l5 4.5" />
                <path d="M2.5 9h10a4.5 4.5 0 0 1 0 9H14" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReplyAll();
              }}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40 hover:text-foreground transition-colors"
              title="Reply All"
            >
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-[14px] w-[14px]"
              >
                <path d="M10 4.5L5 9l5 4.5" />
                <path d="M5 9h8a4.5 4.5 0 0 1 0 9h-1" />
                <path d="M6.5 4.5L1.5 9l5 4.5" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onForward();
              }}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40 hover:text-foreground transition-colors"
              title="Forward"
            >
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-[14px] w-[14px]"
              >
                <path d="M12.5 4.5L17.5 9l-5 4.5" />
                <path d="M17.5 9h-10a4.5 4.5 0 0 0 0 9H6" />
              </svg>
            </button>
          </div>

          <span className="shrink-0 text-[12px] text-muted-foreground/50 tabular-nums">
            {formatEmailDate(email.date)}
          </span>
        </div>
      )}

      {/* Body */}
      <div className="px-4 pb-5 pt-1">
        {email.bodyHtml ? (
          <HtmlEmailBody
            html={email.bodyHtml}
            senderEmail={email.from.email}
            searchTerm={searchTerm}
            activeLocalIdx={activeLocalIdx}
          />
        ) : (
          <PlainTextBody
            body={email.body}
            searchTerm={searchTerm}
            activeLocalIdx={activeLocalIdx}
          />
        )}
      </div>

      {/* Attachments */}
      {email.attachments && email.attachments.length > 0 && (
        <div className="px-4 pb-4 flex flex-wrap gap-2">
          {email.attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-2 rounded-lg bg-accent/60 px-3 py-2 text-xs hover:bg-accent transition-colors cursor-pointer"
            >
              <svg
                viewBox="0 0 16 16"
                fill="currentColor"
                className="h-3 w-3 text-muted-foreground shrink-0"
              >
                <path d="M11.28 1.47a.75.75 0 0 1 0 1.06L5.56 8.25a2.5 2.5 0 0 0 3.536 3.536l5.72-5.72a.75.75 0 0 1 1.06 1.06l-5.72 5.72a4 4 0 0 1-5.656-5.656l5.72-5.72a.75.75 0 0 1 1.06 0z" />
              </svg>
              <span className="text-foreground/80">{att.filename}</span>
              <span className="text-muted-foreground">
                {formatFileSize(att.size)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// ─── Plain text body with quoted text trimming ───────────────────────────────

/** Detect where quoted/forwarded content begins in a plain text email */
function findQuoteStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    // "On ... wrote:" pattern
    if (/^On .+ wrote:$/i.test(lines[i].trim())) return i;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const lines = body.split("\n");
  const quoteStart = findQuoteStart(lines);
  const hasQuoted = quoteStart >= 0;

  // When searching, show all content (including quoted) so matches aren't hidden
  const forceShowAll = !!searchTerm;
  const visibleLines =
    hasQuoted && !showQuoted && !forceShowAll
      ? lines.slice(0, quoteStart)
      : lines;

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
      {hasQuoted && !showQuoted && !forceShowAll && (
        <button
          onClick={() => setShowQuoted(true)}
          className="mt-1 text-[13px] text-muted-foreground/50 hover:text-muted-foreground transition-colors tracking-wider"
        >
          ···
        </button>
      )}
    </div>
  );
}

// ─── HTML email body (iframe) ────────────────────────────────────────────────

// Match the expanded card bg: hsl(220, 5%, 10%) ≈ #17181a
const IFRAME_BG = "#17181a";

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
    () => processHtmlImages(html, effectivePolicy),
    [html, effectivePolicy],
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

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const doc = iframe.contentDocument;
    if (!doc) return;

    doc.open();
    doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: ${IFRAME_BG};
      color: #e4e4e7;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      overflow: hidden;
    }
    
    a { color: #818cf8 }
    img { max-width: 100%; height: auto; }
    hr { border-color: rgba(255,255,255,0.1); }
    .quoted-hidden { display: none; }
    .quote-toggle {
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
    .quote-toggle:hover { color: rgba(161,161,170,0.8); }
  </style>
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
          el.style.cssText = `
            display: inline-block !important;
            padding: 6px 16px !important;
            border-radius: 6px !important;
            font-size: 13px !important;
            font-weight: 500 !important;
            cursor: pointer !important;
            transition: all 0.15s !important;
            text-decoration: none !important;
            border: 1px solid rgba(255,255,255,0.15) !important;
            color: #e4e4e7 !important;
            background: rgba(255,255,255,0.05) !important;
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
          anchor.style.background = "rgba(74, 222, 128, 0.15) !important";
          anchor.style.borderColor = "rgba(74, 222, 128, 0.4) !important";
          anchor.style.color = "#4ade80 !important";
          anchor.textContent = `${info.label} ✓`;

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
  }, [processedHtml]);

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
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
          >
            <path d="M2.5 4A1.5 1.5 0 0 0 1 5.5v5A1.5 1.5 0 0 0 2.5 12h11a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 13.5 4h-11ZM4 7.5a1 1 0 1 1 2 0 1 1 0 0 1-2 0Zm4.5-.5a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3ZM8 9.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5Z" />
          </svg>
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
          colorScheme: "dark",
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
    <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border/50 bg-background/80 backdrop-blur-sm">
      <svg
        viewBox="0 0 16 16"
        fill="currentColor"
        className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0"
      >
        <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.099zm-5.242 1.156a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11" />
      </svg>
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
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Previous match (Shift+Enter)"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
            <path
              fillRule="evenodd"
              d="M11.78 9.78a.75.75 0 0 1-1.06 0L8 7.06 5.28 9.78a.75.75 0 0 1-1.06-1.06l3.25-3.25a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <button
          onClick={onNext}
          disabled={totalMatches === 0}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title="Next match (Enter)"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
            <path
              fillRule="evenodd"
              d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors ml-1"
          title="Close (Esc)"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
            <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
