import { Star, Paperclip } from "lucide-react";
import {
  cn,
  formatEmailDate,
  getInitials,
  getAvatarColor,
  truncate,
} from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { EmailMessage } from "@shared/types";

interface EmailListItemProps {
  email: EmailMessage;
  isSelected: boolean;
  isFocused: boolean;
  onSelect: () => void;
  onStar: (e: React.MouseEvent) => void;
}

export function EmailListItem({
  email,
  isSelected,
  isFocused,
  onSelect,
  onStar,
}: EmailListItemProps) {
  const senderName = email.from.name || email.from.email;
  const initials = getInitials(senderName);
  const avatarColor = getAvatarColor(senderName);

  return (
    <div
      role="row"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className={cn(
        "email-list-row group relative flex cursor-pointer items-start gap-3 border-b border-border px-4 py-3 transition-colors",
        isFocused && "focused",
        isSelected ? "bg-primary/8" : "hover:bg-accent/50",
        !email.isRead && "bg-background",
        email.isRead && !isSelected && "bg-muted/20",
      )}
    >
      {/* Unread dot */}
      <div className="mt-1.5 flex w-2 shrink-0 items-center justify-center">
        {!email.isRead && <div className="h-2 w-2 rounded-full bg-primary" />}
      </div>

      {/* Avatar */}
      <Avatar className="mt-0.5 h-8 w-8 shrink-0">
        <AvatarFallback
          className={cn(avatarColor, "text-white text-xs font-semibold")}
        >
          {initials}
        </AvatarFallback>
      </Avatar>

      {/* Content */}
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-sm",
              email.isRead
                ? "font-medium text-foreground/80"
                : "font-semibold text-foreground",
            )}
          >
            {senderName}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatEmailDate(email.date)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <p
            className={cn(
              "truncate text-sm",
              email.isRead
                ? "text-muted-foreground"
                : "font-medium text-foreground/90",
            )}
          >
            {email.subject}
          </p>
        </div>

        <p className="truncate text-xs text-muted-foreground mt-0.5">
          {truncate(email.snippet, 100)}
        </p>
      </div>

      {/* Right side icons */}
      <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
        <button
          onClick={onStar}
          className={cn(
            "opacity-0 group-hover:opacity-100 transition-opacity",
            email.isStarred && "opacity-100",
          )}
        >
          <Star
            className={cn(
              "h-3.5 w-3.5 transition-colors",
              email.isStarred
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground hover:text-amber-400",
            )}
          />
        </button>
        {email.attachments?.length ? (
          <Paperclip className="h-3 w-3 text-muted-foreground" />
        ) : null}
      </div>
    </div>
  );
}
