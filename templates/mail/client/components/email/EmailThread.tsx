import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  forwardRef,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cn, formatEmailDate, formatFileSize } from "@/lib/utils";
import { useComposeState } from "@/hooks/use-compose-state";
import {
  useThreadMessages,
  useArchiveEmail,
  useTrashEmail,
  useToggleStar,
  useMarkRead,
  useUnarchiveEmail,
} from "@/hooks/use-emails";
import { useQueryClient } from "@tanstack/react-query";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { setUndoAction } from "@/hooks/use-undo";
import { toast } from "sonner";
import type { EmailMessage } from "@shared/types";

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

  // Reset user overrides when navigating to a different thread
  useEffect(() => {
    setUserToggles({});
  }, [threadId]);

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
    return ids;
  }, [messages, userToggles]);

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

  const archiveEmail = useArchiveEmail();
  const unarchiveEmail = useUnarchiveEmail();
  const trashEmail = useTrashEmail();
  const toggleStar = useToggleStar();
  const markRead = useMarkRead();

  const goBack = useCallback(() => navigate(`/${view}`), [navigate, view]);

  // Navigate between threads (j/k)
  const goToSibling = useCallback(
    (delta: number) => {
      if (!threadId || emailIds.length === 0) return;
      const idx = emailIds.indexOf(threadId);
      if (idx === -1) return;
      const nextIdx = idx + delta;
      if (nextIdx < 0 || nextIdx >= emailIds.length) return;
      navigate(`/${view}/${emailIds[nextIdx]}`);
    },
    [threadId, emailIds, view, navigate],
  );

  const advanceOrGoBack = useCallback(() => {
    if (!threadId || emailIds.length === 0) {
      goBack();
      return;
    }
    const idx = emailIds.indexOf(threadId);
    if (idx !== -1 && idx + 1 < emailIds.length) {
      navigate(`/${view}/${emailIds[idx + 1]}`, { replace: true });
    } else if (idx !== -1 && idx - 1 >= 0) {
      navigate(`/${view}/${emailIds[idx - 1]}`, { replace: true });
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
          focusedRef.current?.scrollIntoView({
            block: "nearest",
            behavior: "smooth",
          });
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
    archiveEmail.mutate(id);
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

  const handleReply = useCallback(
    (msg?: EmailMessage) => {
      const target = msg ?? email;
      if (!target) return;
      compose.open({
        to: target.from.email,
        subject: target.subject.startsWith("Re:")
          ? target.subject
          : `Re: ${target.subject}`,
        body: `\n\n— On ${new Date(target.date).toLocaleDateString()}, ${target.from.name || target.from.email} wrote:\n\n${target.body
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n")}`,
        mode: "reply",
        replyToId: target.id,
        replyToThreadId: target.threadId,
      });
    },
    [email, messages, compose],
  );

  const handleForward = useCallback(() => {
    if (!email) return;
    compose.open({
      to: "",
      subject: email.subject.startsWith("Fwd:")
        ? email.subject
        : `Fwd: ${email.subject}`,
      body: `\n\n— Forwarded message —\nFrom: ${email.from.name} <${email.from.email}>\n\n${email.body}`,
      mode: "forward",
      replyToId: email.id,
      replyToThreadId: email.threadId,
    });
  }, [email, compose]);

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
      { key: "a", handler: () => handleReply() },
      { key: "f", handler: handleForward },
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
            className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
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
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-semibold leading-tight text-foreground">
                {threadSubject}
              </h1>
              {displayLabels.map((labelId) => (
                <span
                  key={labelId}
                  className="label-badge bg-pink-500/20 text-pink-300"
                >
                  {labelId}
                </span>
              ))}
            </div>

            {/* Action bar */}
            <div className="flex items-center gap-0.5 mt-2">
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

      {/* Thread messages */}
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <div className="max-w-3xl mx-auto space-y-1">
          {messages.map((msg, idx) => {
            const isExpanded = expandedIds.has(msg.id);
            const isFocused = idx === focusedIndex;
            return isExpanded ? (
              <ExpandedMessageCard
                key={msg.id}
                ref={isFocused ? focusedRef : undefined}
                email={msg}
                isFocused={isFocused}
                onCollapse={() => {
                  setUserToggles((prev) => ({ ...prev, [msg.id]: false }));
                }}
                onReply={() => handleReply(msg)}
                onForward={() => {
                  compose.open({
                    to: "",
                    subject: msg.subject.startsWith("Fwd:")
                      ? msg.subject
                      : `Fwd: ${msg.subject}`,
                    body: `\n\n— Forwarded message —\nFrom: ${msg.from.name} <${msg.from.email}>\n\n${msg.body}`,
                    mode: "forward",
                    replyToId: msg.id,
                    replyToThreadId: msg.threadId,
                  });
                }}
                onContactSelect={onContactSelect}
              />
            ) : (
              <CollapsedMessageRow
                key={msg.id}
                ref={isFocused ? focusedRef : undefined}
                email={msg}
                isFocused={isFocused}
                onClick={() => {
                  setFocusedIndex(idx);
                  setUserToggles((prev) => ({ ...prev, [msg.id]: true }));
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Bottom reply input */}
      <div className="shrink-0 border-t border-border/40 px-5 py-3">
        <div
          className="flex items-center gap-3 rounded-lg bg-accent/40 px-4 py-2.5 cursor-text hover:bg-accent/60 transition-colors"
          onClick={() => handleReply()}
        >
          <span className="text-[13px] text-muted-foreground/60 flex-1">
            @mention anyone and share conversation
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleReply();
            }}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-primary hover:bg-primary/30 transition-colors shrink-0"
          >
            <svg
              viewBox="0 0 16 16"
              fill="currentColor"
              className="h-3.5 w-3.5"
            >
              <path d="M8 14A.75.75 0 0 1 7.25 14V4.56L4.03 7.78a.75.75 0 0 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1-1.06 1.06L8.75 4.56V14A.75.75 0 0 1 8 14z" />
            </svg>
          </button>
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
    onForward: () => void;
    onContactSelect?: (email: string) => void;
  }
>(function ExpandedMessageCard(
  { email, isFocused, onCollapse, onReply, onForward, onContactSelect },
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
        "rounded-lg bg-[hsl(220,5%,10%)] overflow-hidden border-l-2",
        isFocused
          ? "border-primary/70 ring-1 ring-primary/30"
          : "border-primary/40",
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
                onReply();
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
          <HtmlEmailBody html={email.bodyHtml} />
        ) : (
          <PlainTextBody body={email.body} />
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

function PlainTextBody({ body }: { body: string }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const lines = body.split("\n");
  const quoteStart = findQuoteStart(lines);
  const hasQuoted = quoteStart >= 0;

  const visibleLines =
    hasQuoted && !showQuoted ? lines.slice(0, quoteStart) : lines;

  return (
    <div className="email-body-content">
      {visibleLines.map((line, i) => (
        <p key={i} className={line === "" ? "mb-3" : "mb-0"}>
          {line || "\u00a0"}
        </p>
      ))}
      {hasQuoted && !showQuoted && (
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

function HtmlEmailBody({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);

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
      background: ${IFRAME_BG} !important;
      color: #e4e4e7 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      overflow: hidden;
    }
    * {
      background-color: ${IFRAME_BG} !important;
      border-color: rgba(255,255,255,0.1) !important;
    }
    body, td, th, div, p, span, li, blockquote {
      color: #e4e4e7 !important;
    }
    h1, h2, h3, h4, h5, h6, strong, b {
      color: #f4f4f5 !important;
    }
    .muted, .secondary, .text-muted, [style*="color: #"] {
      color: #a1a1aa !important;
    }
    a { color: #818cf8 !important; }
    img { max-width: 100%; height: auto; }
    hr { border-color: rgba(255,255,255,0.1) !important; }
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
<body>${html}</body>
</html>`);
    doc.close();

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
        (quote as HTMLElement).classList.toggle("quoted-hidden");
        toggle.style.display = (quote as HTMLElement).classList.contains(
          "quoted-hidden",
        )
          ? ""
          : "none";
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
    const handleLinkClick = (e: MouseEvent) => {
      const anchor = (e.target as Element)?.closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
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

    const resize = () => {
      if (doc.body) {
        const h = doc.body.scrollHeight;
        if (h > 0) setHeight(h);
      }
    };

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
  }, [html]);

  return (
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
  );
}
