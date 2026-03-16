import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  cn,
  formatEmailDateFull,
  getInitials,
  getAvatarColor,
  formatFileSize,
  formatEmailDate,
} from "@/lib/utils";
import { ComposeModal } from "./ComposeModal";
import {
  useEmail,
  useArchiveEmail,
  useTrashEmail,
  useToggleStar,
  useMarkRead,
} from "@/hooks/use-emails";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { toast } from "sonner";
import type { EmailMessage } from "@shared/types";

export function EmailThread() {
  const { view = "inbox", threadId } = useParams<{
    view: string;
    threadId: string;
  }>();
  const navigate = useNavigate();
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyEmail, setReplyEmail] = useState<EmailMessage | null>(null);
  const [forwardOpen, setForwardOpen] = useState(false);

  const { data: email, isLoading } = useEmail(threadId);
  const archiveEmail = useArchiveEmail();
  const trashEmail = useTrashEmail();
  const toggleStar = useToggleStar();
  const markRead = useMarkRead();

  const goBack = useCallback(() => navigate(`/${view}`), [navigate, view]);

  const handleArchive = useCallback(() => {
    if (!email) return;
    archiveEmail.mutate(email.id, {
      onSuccess: () => {
        toast.success("Archived");
        goBack();
      },
    });
  }, [email, archiveEmail, goBack]);

  const handleTrash = useCallback(() => {
    if (!email) return;
    trashEmail.mutate(email.id, {
      onSuccess: () => {
        toast.success("Moved to trash");
        goBack();
      },
    });
  }, [email, trashEmail, goBack]);

  const handleStar = useCallback(() => {
    if (!email) return;
    toggleStar.mutate({ id: email.id, isStarred: !email.isStarred });
  }, [email, toggleStar]);

  const handleReply = useCallback(
    (msg?: EmailMessage) => {
      setReplyEmail(msg ?? email ?? null);
      setReplyOpen(true);
    },
    [email],
  );

  const handleForward = useCallback(() => {
    if (!email) return;
    setReplyEmail(email);
    setForwardOpen(true);
  }, [email]);

  // Keyboard shortcuts — Gmail / Superhuman standard (active when thread is open)
  useKeyboardShortcuts(
    [
      { key: "Escape", handler: goBack },
      { key: "e", handler: handleArchive },
      { key: "d", handler: handleTrash },
      { key: "#", handler: handleTrash, shift: true },
      { key: "s", handler: handleStar },
      { key: "r", handler: () => handleReply() },
      { key: "a", handler: () => handleReply() }, // reply-all
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

  if (isLoading) {
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden panel-slide-in">
      {/* Thread header */}
      <div className="shrink-0 px-5 pt-5 pb-3">
        {/* Back button + subject row */}
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
                {email.subject}
              </h1>
              {/* Label badges */}
              {displayLabels.map((labelId) => (
                <span
                  key={labelId}
                  className="label-badge bg-pink-500/20 text-pink-300"
                >
                  {labelId}
                </span>
              ))}
            </div>

            {/* Action bar — Superhuman style */}
            <div className="flex items-center gap-0.5 mt-2">
              {/* Share */}
              <button className="flex items-center gap-1.5 px-2 py-1 rounded text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                Share
              </button>

              {/* Done (checkmark) */}
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

              {/* Remind (clock) */}
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

              {/* React (emoji) */}
              <button className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                <svg
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="h-4 w-4"
                >
                  <path d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14zm-1.5-8.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm5 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM5.32 10.68a.75.75 0 0 1 1.06-.04 3.25 3.25 0 0 0 3.24 0 .75.75 0 1 1 1.02 1.1A4.75 4.75 0 0 1 8 12.75a4.75 4.75 0 0 1-2.64-.99.75.75 0 0 1-.04-1.08z" />
                </svg>
              </button>

              {/* Nav arrows */}
              <button className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors ml-1">
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
              <button className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
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

      {/* Thread content */}
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <div className="max-w-3xl mx-auto">
          {/* Message card */}
          <EmailMessageCard email={email} onReply={() => handleReply(email)} />

          {/* Attachments */}
          {email.attachments && email.attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 ml-10">
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
      </div>

      {/* Bottom reply input — Superhuman style */}
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

      {/* Reply compose */}
      <ComposeModal
        open={replyOpen}
        onOpenChange={setReplyOpen}
        replyTo={replyEmail ?? undefined}
        mode="reply"
      />
      <ComposeModal
        open={forwardOpen}
        onOpenChange={setForwardOpen}
        replyTo={email}
        mode="forward"
      />
    </div>
  );
}

function HtmlEmailBody({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const doc = iframe.contentDocument;
    if (!doc) return;

    // Write the HTML content into the iframe with dark-mode-friendly styles
    doc.open();
    doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: transparent !important;
      color: #e4e4e7 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      overflow: hidden;
    }
    * {
      background-color: transparent !important;
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

    // Auto-resize iframe to fit content
    const resize = () => {
      if (doc.body) {
        const h = doc.body.scrollHeight;
        if (h > 0) setHeight(h);
      }
    };

    // Resize after images load
    const images = doc.querySelectorAll("img");
    images.forEach((img) => img.addEventListener("load", resize));

    // Initial resize with a small delay for rendering
    resize();
    const timer = setTimeout(resize, 100);
    const timer2 = setTimeout(resize, 500);

    return () => {
      clearTimeout(timer);
      clearTimeout(timer2);
      images.forEach((img) => img.removeEventListener("load", resize));
    };
  }, [html]);

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-same-origin"
      style={{
        width: "100%",
        height: `${height}px`,
        border: "none",
        background: "transparent",
        colorScheme: "dark",
      }}
      title="Email content"
    />
  );
}

function EmailMessageCard({
  email,
  onReply,
}: {
  email: EmailMessage;
  onReply: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const senderName = email.from.name || email.from.email;

  return (
    <div className="rounded-lg bg-card/80 overflow-hidden border border-border/30">
      {/* Message header */}
      <div
        className="flex cursor-pointer items-center gap-3 px-4 py-3"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-[13px] font-semibold text-foreground shrink-0">
            {senderName}
          </span>
          <span className="text-[12px] text-muted-foreground/60">to</span>
          <span className="text-[12px] text-muted-foreground/60 truncate">
            {email.to.map((r) => r.name || r.email).join(", ")}
            {email.cc?.length
              ? ` & ${email.cc.map((r) => r.name || r.email).join(", ")}`
              : ""}
          </span>
        </div>

        <span className="shrink-0 text-[12px] text-muted-foreground/50 tabular-nums">
          {formatEmailDate(email.date)}
        </span>
      </div>

      {/* Message body */}
      {expanded && (
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
      )}
    </div>
  );
}
