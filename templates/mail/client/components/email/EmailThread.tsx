import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cn, formatEmailDate, formatFileSize } from "@/lib/utils";
import { useComposeState } from "@/hooks/use-compose-state";
import {
  useEmail,
  useThreadMessages,
  useArchiveEmail,
  useTrashEmail,
  useToggleStar,
  useMarkRead,
  useUnarchiveEmail,
} from "@/hooks/use-emails";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { toast } from "sonner";
import type { EmailMessage } from "@shared/types";

export function EmailThread({
  onArchived,
  emailIds = [],
}: {
  onArchived?: (id: string) => void;
  emailIds?: string[];
}) {
  const { view = "inbox", threadId } = useParams<{
    view: string;
    threadId: string;
  }>();
  const navigate = useNavigate();
  const compose = useComposeState();

  // Fetch the clicked email to get its real threadId
  const { data: email, isLoading: emailLoading } = useEmail(threadId);
  // Fetch all messages in the thread
  const realThreadId = email?.threadId;
  const { data: threadMessages } = useThreadMessages(realThreadId);

  // Messages sorted oldest-first; fall back to single email
  const messages = useMemo(() => {
    if (threadMessages && threadMessages.length > 0) return threadMessages;
    if (email) return [email];
    return [];
  }, [threadMessages, email]);

  // Track which message is expanded — default to the last one
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // When messages load, expand the last one
  useEffect(() => {
    if (messages.length > 0 && expandedId === null) {
      setExpandedId(messages[messages.length - 1].id);
    }
  }, [messages, expandedId]);

  // Reset expanded when navigating to a different thread
  useEffect(() => {
    setExpandedId(null);
  }, [threadId]);

  const expandedIndex = messages.findIndex((m) => m.id === expandedId);
  const expandedRef = useRef<HTMLDivElement>(null);

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
      const nextIdx = Math.max(
        0,
        Math.min(messages.length - 1, expandedIndex + delta),
      );
      setExpandedId(messages[nextIdx].id);
      // Scroll into view after render
      setTimeout(() => {
        expandedRef.current?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }, 50);
    },
    [messages, expandedIndex],
  );

  const handleArchive = useCallback(() => {
    if (!email) return;
    const id = email.id;
    archiveEmail.mutate(id, {
      onSuccess: () => {
        onArchived?.(id);
        toast("Marked as Done.", {
          action: {
            label: "UNDO",
            onClick: () => unarchiveEmail.mutate(id),
          },
        });
        advanceOrGoBack();
      },
    });
  }, [email, archiveEmail, unarchiveEmail, advanceOrGoBack, onArchived]);

  const handleTrash = useCallback(() => {
    if (!email) return;
    trashEmail.mutate(email.id, {
      onSuccess: () => {
        toast("Moved to Trash.");
        advanceOrGoBack();
      },
    });
  }, [email, trashEmail, advanceOrGoBack]);

  const handleStar = useCallback(() => {
    if (!email) return;
    toggleStar.mutate({ id: email.id, isStarred: !email.isStarred });
  }, [email, toggleStar]);

  const handleReply = useCallback(
    (msg?: EmailMessage) => {
      const target = msg ?? messages.find((m) => m.id === expandedId) ?? email;
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
    [email, messages, expandedId, compose],
  );

  const handleForward = useCallback(() => {
    const target = messages.find((m) => m.id === expandedId) ?? email;
    if (!target) return;
    compose.open({
      to: "",
      subject: target.subject.startsWith("Fwd:")
        ? target.subject
        : `Fwd: ${target.subject}`,
      body: `\n\n— Forwarded message —\nFrom: ${target.from.name} <${target.from.email}>\n\n${target.body}`,
      mode: "forward",
      replyToId: target.id,
      replyToThreadId: target.threadId,
    });
  }, [email, messages, expandedId, compose]);

  // Keyboard shortcuts
  useKeyboardShortcuts(
    [
      { key: "Escape", handler: goBack },
      { key: "j", handler: () => goToSibling(1) },
      { key: "k", handler: () => goToSibling(-1) },
      { key: "n", handler: () => focusMessage(1) },
      { key: "p", handler: () => focusMessage(-1) },
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

  if (emailLoading) {
    return (
      <div className="flex flex-1 flex-col p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
            <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
          </div>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-3 rounded bg-muted animate-pulse"
              style={{ width: `${60 + Math.random() * 30}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

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
              className="h-[18px] w-[18px]"
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
              <button className="flex items-center gap-1.5 px-2 py-1 rounded text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                Share
              </button>
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
              <button className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                <svg
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="h-4 w-4"
                >
                  <path
                    fillRule="evenodd"
                    d="M1 8a7 7 0 1 1 14 0A7 7 0 0 1 1 8zm7.75-4.25a.75.75 0 0 0-1.5 0V8c0 .414.336.75.75.75h3.25a.75.75 0 0 0 0-1.5h-2.5v-3.5z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <button className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                <svg
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="h-4 w-4"
                >
                  <path d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14zm-1.5-8.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm5 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM5.32 10.68a.75.75 0 0 1 1.06-.04 3.25 3.25 0 0 0 3.24 0 .75.75 0 1 1 1.02 1.1A4.75 4.75 0 0 1 8 12.75a4.75 4.75 0 0 1-2.64-.99.75.75 0 0 1-.04-1.08z" />
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
          {messages.map((msg) => {
            const isExpanded = msg.id === expandedId;
            return isExpanded ? (
              <ExpandedMessageCard
                key={msg.id}
                ref={expandedRef}
                email={msg}
                onCollapse={() => setExpandedId(null)}
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
              />
            ) : (
              <CollapsedMessageRow
                key={msg.id}
                email={msg}
                onClick={() => {
                  setExpandedId(msg.id);
                  setTimeout(() => {
                    expandedRef.current?.scrollIntoView({
                      block: "nearest",
                      behavior: "smooth",
                    });
                  }, 50);
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

function CollapsedMessageRow({
  email,
  onClick,
}: {
  email: EmailMessage;
  onClick: () => void;
}) {
  const senderFirst = (email.from.name || email.from.email).split(" ")[0];

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2 cursor-pointer rounded hover:bg-accent/40 transition-colors"
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
}

// ─── Expanded message card (Superhuman style) ────────────────────────────────

import { forwardRef } from "react";

const ExpandedMessageCard = forwardRef<
  HTMLDivElement,
  {
    email: EmailMessage;
    onCollapse: () => void;
    onReply: () => void;
    onForward: () => void;
  }
>(function ExpandedMessageCard({ email, onCollapse, onReply, onForward }, ref) {
  const senderName = email.from.name || email.from.email;
  const recipients = [
    ...email.to.map((r) => r.name || r.email),
    ...(email.cc || []).map((r) => r.name || r.email),
  ].join(", ");

  return (
    <div
      ref={ref}
      className="rounded-lg bg-[hsl(220,5%,10%)] overflow-hidden border-l-2 border-primary/40"
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={onCollapse}
      >
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-[13px] font-semibold text-foreground shrink-0">
            {senderName}
          </span>
          <span className="text-[12px] text-muted-foreground/50 truncate">
            to {recipients}
          </span>
        </div>

        {/* Reply / Forward buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onReply();
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
            title="Reply (R)"
          >
            <svg
              viewBox="0 0 16 16"
              fill="currentColor"
              className="h-3.5 w-3.5 scale-x-[-1]"
            >
              <path d="M1.5 1.75a.75.75 0 0 1 1.27-.53l5.25 5.25a.75.75 0 0 1 0 1.06l-5.25 5.25A.75.75 0 0 1 1.5 12.25V1.75z" />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onForward();
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent transition-colors"
            title="Forward (F)"
          >
            <svg
              viewBox="0 0 16 16"
              fill="currentColor"
              className="h-3.5 w-3.5"
            >
              <path d="M1.5 1.75a.75.75 0 0 1 1.27-.53l5.25 5.25a.75.75 0 0 1 0 1.06l-5.25 5.25A.75.75 0 0 1 1.5 12.25V1.75z" />
            </svg>
          </button>
        </div>

        <span className="shrink-0 text-[12px] text-muted-foreground/50 tabular-nums">
          {formatEmailDate(email.date)}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 pb-5 pt-1">
        {email.bodyHtml ? (
          <HtmlEmailBody html={email.bodyHtml} />
        ) : (
          <div className="email-body-content">
            {email.body.split("\n").map((line, i) => (
              <p key={i} className={line === "" ? "mb-3" : "mb-0"}>
                {line || "\u00a0"}
              </p>
            ))}
          </div>
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
  </style>
</head>
<body>${html}</body>
</html>`);
    doc.close();

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
