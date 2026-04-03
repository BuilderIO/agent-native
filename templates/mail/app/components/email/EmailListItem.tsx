import { memo } from "react";
import { cn, formatEmailDate, truncate } from "@/lib/utils";
import { IconStarFilled } from "@tabler/icons-react";
import type { EmailMessage } from "@shared/types";
import type { ThreadSummary } from "@/lib/threads";
import { useAccountFilter } from "@/hooks/use-account-filter";

interface EmailListItemProps {
  email: EmailMessage;
  thread?: ThreadSummary;
  isSelected: boolean;
  isFocused: boolean;
  isMultiSelected?: boolean;
  onSelect: () => void;
  onStar: (e: React.MouseEvent) => void;
  onHover: () => void;
}

/** Format participant names for thread display, e.g. "Kaitlyn .. Sam, Andrew" */
function formatParticipants(participants: string[], maxWidth = 3): string {
  if (participants.length <= 1) return participants[0] || "";
  // Extract first names only
  const firstNames = participants.map((p) => p.split(" ")[0]);
  if (firstNames.length <= maxWidth) return firstNames.join(", ");
  // Show first, "..", then last few
  return `${firstNames[0]} .. ${firstNames.slice(-(maxWidth - 1)).join(", ")}`;
}

// Map common label IDs to display colors
const labelColors: Record<string, { bg: string; text: string }> = {
  automated: { bg: "bg-pink-500/20", text: "text-pink-700 dark:text-pink-300" },
  social: { bg: "bg-blue-500/20", text: "text-blue-700 dark:text-blue-300" },
  updates: {
    bg: "bg-yellow-500/20",
    text: "text-yellow-700 dark:text-yellow-300",
  },
  promotions: {
    bg: "bg-green-500/20",
    text: "text-green-700 dark:text-green-300",
  },
  forums: {
    bg: "bg-purple-500/20",
    text: "text-purple-700 dark:text-purple-300",
  },
  finance: {
    bg: "bg-emerald-500/20",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  travel: { bg: "bg-cyan-500/20", text: "text-cyan-700 dark:text-cyan-300" },
};

/** Stable dot colors for distinguishing accounts */
const accountDotColors = [
  "bg-blue-400",
  "bg-emerald-400",
  "bg-amber-400",
  "bg-rose-400",
  "bg-violet-400",
  "bg-cyan-400",
  "bg-orange-400",
  "bg-pink-400",
];

function getAccountColor(
  email: string,
  allAccounts: Array<{ email: string }>,
): string {
  const idx = allAccounts.findIndex((a) => a.email === email);
  return accountDotColors[(idx >= 0 ? idx : 0) % accountDotColors.length];
}

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

export const EmailListItem = memo(function EmailListItem({
  email,
  thread,
  isSelected,
  isFocused,
  isMultiSelected,
  onSelect,
  onStar,
  onHover,
}: EmailListItemProps) {
  const { allAccounts } = useAccountFilter();
  const isMultiAccount = allAccounts.length > 1;

  const isThread = thread && thread.messageCount > 1;
  const senderName = isThread
    ? formatParticipants(thread.participants)
    : email.from.name || email.from.email;
  const isUnread = thread ? thread.hasUnread : !email.isRead;
  const isStarred = thread ? thread.hasStarred : email.isStarred;

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
  const allLabelIds = thread ? thread.labelIds : email.labelIds;
  const displayLabels = [...new Set(allLabelIds)].filter(
    (l) => !systemLabels.has(l),
  );

  return (
    <div
      role="row"
      tabIndex={0}
      onClick={onSelect}
      onMouseEnter={onHover}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className={cn(
        "email-list-row group relative flex cursor-pointer items-center h-[38px] px-3 transition-colors",
        isSelected && "selected",
        isFocused && !isSelected && "focused",
        isMultiSelected && "multi-selected",
      )}
    >
      {/* Multi-select left border indicator */}
      {isMultiSelected && (
        <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary rounded-r" />
      )}

      {/* Unread / account dot */}
      <div className="w-5 shrink-0 flex items-center justify-center">
        {isUnread ? (
          <div className="h-[7px] w-[7px] rounded-full bg-primary" />
        ) : isMultiAccount && email.accountEmail ? (
          <div
            className={cn(
              "h-[5px] w-[5px] rounded-full opacity-50",
              getAccountColor(email.accountEmail, allAccounts),
            )}
          />
        ) : null}
      </div>

      {/* Sender name — fixed width column */}
      <span
        className={cn(
          "w-[160px] shrink-0 text-sm sm:text-[13px] truncate mr-3",
          isUnread
            ? "font-semibold text-foreground"
            : "font-normal text-foreground/90",
        )}
        title={
          isMultiAccount && email.accountEmail
            ? `Account: ${email.accountEmail}`
            : undefined
        }
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
            "text-sm sm:text-[13px] truncate shrink-0 max-w-[45%]",
            isUnread
              ? "font-medium text-foreground"
              : "font-normal text-foreground/90",
          )}
        >
          {email.subject}
        </span>
        <span className="text-sm sm:text-[13px] text-muted-foreground/80 truncate">
          {email.snippet}
        </span>
      </div>

      {/* Time — right aligned, hidden on hover */}
      <span className="row-time shrink-0 ml-3 text-xs sm:text-[12px] text-muted-foreground tabular-nums">
        {formatEmailDate(email.date)}
      </span>

      {/* Hover actions — overlay on top of time */}
      <div className="hover-actions items-center gap-0.5">
        <button
          onClick={onStar}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded transition-colors",
            isStarred
              ? "text-amber-400"
              : "text-muted-foreground hover:text-foreground hover:bg-accent",
          )}
          title="Pin"
        >
          <IconStarFilled className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
});
