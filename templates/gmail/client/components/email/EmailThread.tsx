import { useState, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Archive,
  Trash2,
  Star,
  CornerUpLeft,
  MoreHorizontal,
  Paperclip,
  ChevronDown,
  ChevronUp,
  Forward,
} from "lucide-react";
import {
  cn,
  formatEmailDateFull,
  getInitials,
  getAvatarColor,
  formatFileSize,
} from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

  // Keyboard shortcuts (active when thread is open)
  useKeyboardShortcuts(
    [
      { key: "Escape", handler: goBack },
      { key: "e", handler: handleArchive },
      { key: "d", handler: handleTrash },
      { key: "s", handler: handleStar },
      { key: "r", handler: () => handleReply() },
      {
        key: "u",
        handler: () => {
          if (!email) return;
          markRead.mutate({ id: email.id, isRead: !email.isRead });
        },
      },
    ],
    !!threadId,
  );

  if (!threadId) return null;

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <div className="h-8 w-8 rounded-full bg-muted animate-pulse" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-1/4 rounded bg-muted animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
          </div>
        </div>
        <div className="flex-1 p-6 space-y-3">
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

  const senderName = email.from.name || email.from.email;
  const initials = getInitials(senderName);
  const avatarColor = getAvatarColor(senderName);

  return (
    <div className="flex flex-1 flex-col overflow-hidden panel-slide-in">
      {/* Thread toolbar */}
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={goBack}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Back <kbd className="kbd-hint ml-1">Esc</kbd>
          </TooltipContent>
        </Tooltip>

        <div className="flex items-center gap-1 ml-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleArchive}
              >
                <Archive className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Archive <kbd className="kbd-hint ml-1">E</kbd>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleTrash}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Delete <kbd className="kbd-hint ml-1">D</kbd>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleStar}
              >
                <Star
                  className={cn(
                    "h-4 w-4",
                    email.isStarred && "fill-amber-400 text-amber-400",
                  )}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Star <kbd className="kbd-hint ml-1">S</kbd>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => handleReply()}
              >
                <CornerUpLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Reply <kbd className="kbd-hint ml-1">R</kbd>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setForwardOpen(true)}
              >
                <Forward className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Forward</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() =>
                  markRead.mutate({ id: email.id, isRead: !email.isRead })
                }
              >
                Mark as {email.isRead ? "unread" : "read"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={handleTrash}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Email content */}
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl p-6">
          {/* Subject */}
          <h1 className="mb-6 text-xl font-semibold leading-tight text-foreground">
            {email.subject}
          </h1>

          {/* Message */}
          <EmailMessageCard email={email} onReply={() => handleReply(email)} />

          {/* Attachments */}
          {email.attachments && email.attachments.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {email.attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm hover:bg-muted transition-colors cursor-pointer"
                >
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-foreground">{att.filename}</span>
                  <span className="text-muted-foreground text-xs">
                    {formatFileSize(att.size)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Quick reply */}
          <div
            className="mt-6 flex cursor-text items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3 hover:bg-muted/50 transition-colors"
            onClick={() => handleReply()}
          >
            <CornerUpLeft className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm text-muted-foreground">
              Reply to {email.from.name || email.from.email}…{" "}
              <kbd className="kbd-hint">R</kbd>
            </span>
          </div>
        </div>
      </ScrollArea>

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

function EmailMessageCard({
  email,
  onReply,
}: {
  email: EmailMessage;
  onReply: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const senderName = email.from.name || email.from.email;
  const initials = getInitials(senderName);
  const avatarColor = getAvatarColor(senderName);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Message header */}
      <div
        className="flex cursor-pointer items-start gap-3 p-4"
        onClick={() => setExpanded(!expanded)}
      >
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarFallback
            className={cn(avatarColor, "text-white text-xs font-semibold")}
          >
            {initials}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-foreground">
              {senderName}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatEmailDateFull(email.date)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            to {email.to.map((r) => r.name || r.email).join(", ")}
            {email.cc?.length ? (
              <span className="ml-1">
                cc {email.cc.map((r) => r.name || r.email).join(", ")}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-1 ml-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onReply();
            }}
          >
            <CornerUpLeft className="h-3.5 w-3.5" />
          </Button>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Message body */}
      {expanded && (
        <div className="border-t border-border px-4 pb-5 pt-4">
          <div className="email-body-content">
            {email.body.split("\n").map((line, i) => (
              <p key={i} className={line === "" ? "mb-3" : "mb-0"}>
                {line || "\u00a0"}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
