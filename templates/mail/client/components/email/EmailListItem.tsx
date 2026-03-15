import { cn, formatEmailDate, truncate } from "@/lib/utils";
import type { EmailMessage } from "@shared/types";

interface EmailListItemProps {
  email: EmailMessage;
  isSelected: boolean;
  isFocused: boolean;
  onSelect: () => void;
  onStar: (e: React.MouseEvent) => void;
}

// Map common label IDs to display colors
const labelColors: Record<string, { bg: string; text: string }> = {
  automated: { bg: "bg-pink-500/20", text: "text-pink-300" },
  social: { bg: "bg-blue-500/20", text: "text-blue-300" },
  updates: { bg: "bg-yellow-500/20", text: "text-yellow-300" },
  promotions: { bg: "bg-green-500/20", text: "text-green-300" },
  forums: { bg: "bg-purple-500/20", text: "text-purple-300" },
  finance: { bg: "bg-emerald-500/20", text: "text-emerald-300" },
  travel: { bg: "bg-cyan-500/20", text: "text-cyan-300" },
};

function getLabelStyle(labelId: string): { bg: string; text: string } {
  const normalized = labelId.toLowerCase().replace(/^label:/, "");
  if (labelColors[normalized]) return labelColors[normalized];
  // Fallback: hash to a color
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = normalized.charCodeAt(i) + ((hash << 5) - hash);
  }
  const options = Object.values(labelColors);
  return options[Math.abs(hash) % options.length];
}

export function EmailListItem({
  email,
  isSelected,
  isFocused,
  onSelect,
  onStar,
}: EmailListItemProps) {
  const senderName = email.from.name || email.from.email;

  // Filter to user labels only (skip system labels like inbox, sent, etc.)
  const systemLabels = new Set([
    "inbox",
    "sent",
    "drafts",
    "archive",
    "trash",
    "starred",
    "all",
    "important",
    "INBOX",
    "SENT",
    "DRAFT",
    "TRASH",
    "STARRED",
    "IMPORTANT",
    "CATEGORY_PERSONAL",
    "CATEGORY_SOCIAL",
    "CATEGORY_PROMOTIONS",
    "CATEGORY_UPDATES",
    "CATEGORY_FORUMS",
    "UNREAD",
  ]);
  const displayLabels = email.labelIds.filter((l) => !systemLabels.has(l));

  return (
    <div
      role="row"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className={cn(
        "email-list-row group relative flex cursor-pointer items-center h-[38px] px-3 transition-colors",
        isSelected && "selected",
        isFocused && !isSelected && "focused",
        !isSelected && !isFocused && "hover:bg-[hsl(220,5%,13%)]",
      )}
    >
      {/* Unread dot */}
      <div className="w-5 shrink-0 flex items-center justify-center">
        {!email.isRead && (
          <div className="h-[7px] w-[7px] rounded-full bg-primary" />
        )}
      </div>

      {/* Sender name — fixed width, truncated */}
      <span
        className={cn(
          "w-[150px] shrink-0 truncate text-[13px] pr-3",
          email.isRead
            ? "font-normal text-foreground/70"
            : "font-semibold text-foreground",
        )}
      >
        {senderName}
      </span>

      {/* Label badges */}
      {displayLabels.length > 0 && (
        <div className="flex items-center gap-1 shrink-0 mr-2">
          {displayLabels.slice(0, 2).map((labelId) => {
            const style = getLabelStyle(labelId);
            const displayName = labelId
              .replace(/^label:/, "")
              .replace(/^CATEGORY_/, "")
              .toLowerCase();
            return (
              <span
                key={labelId}
                className={cn("label-badge", style.bg, style.text)}
              >
                {truncate(displayName, 16)}
              </span>
            );
          })}
        </div>
      )}

      {/* Subject + snippet — fills remaining space */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
        <span
          className={cn(
            "text-[13px] truncate shrink-0 max-w-[45%]",
            email.isRead
              ? "font-normal text-foreground/70"
              : "font-medium text-foreground",
          )}
        >
          {email.subject}
        </span>
        <span className="text-[13px] text-muted-foreground truncate">
          {email.snippet}
        </span>
      </div>

      {/* Time — right aligned, hidden on hover */}
      <span className="row-time shrink-0 ml-3 text-[12px] text-muted-foreground tabular-nums">
        {formatEmailDate(email.date)}
      </span>

      {/* Hover actions — replace time on hover */}
      <div className="hover-actions items-center gap-0.5 ml-3 shrink-0">
        <button
          onClick={onStar}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded transition-colors",
            email.isStarred
              ? "text-amber-400"
              : "text-muted-foreground hover:text-foreground hover:bg-accent",
          )}
          title="Pin"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M8 1.75a.75.75 0 0 1 .692.462l1.41 3.393 3.664.293a.75.75 0 0 1 .428 1.317l-2.791 2.39.853 3.575a.75.75 0 0 1-1.12.814L8 12.07l-3.136 1.924a.75.75 0 0 1-1.12-.814l.853-3.574-2.79-2.391a.75.75 0 0 1 .427-1.317l3.664-.293 1.41-3.393A.75.75 0 0 1 8 1.75z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
