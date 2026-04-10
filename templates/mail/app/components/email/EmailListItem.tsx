import { memo, useRef, useState, useCallback } from "react";
import { cn, formatEmailDate, truncate } from "@/lib/utils";
import { IconStarFilled, IconCheck, IconClock } from "@tabler/icons-react";
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
  /** Called after a left-swipe past the threshold (archive). */
  onSwipeArchive?: () => void;
  /** Called after a right-swipe past the threshold (snooze). */
  onSwipeSnooze?: () => void;
}

// Minimum horizontal distance before we lock into a swipe gesture.
const SWIPE_SLOP = 10;
// Distance past which a swipe commits the action.
const SWIPE_COMMIT_THRESHOLD = 80;
// Distance past which the action icon "snaps" to filled state.
const SWIPE_ICON_SNAP = 56;

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
  onSwipeArchive,
  onSwipeSnooze,
}: EmailListItemProps) {
  const { allAccounts } = useAccountFilter();
  const isMultiAccount = allAccounts.length > 1;

  // ── Swipe state ─────────────────────────────────────────────────────────
  // `dragX` drives the row's translateX. `isDragging` disables the snap
  // transition while the finger is on the screen. Refs hold the active gesture
  // so event handlers don't thrash state on every touchmove.
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const gestureRef = useRef<{
    startX: number;
    startY: number;
    // "none" until we know which axis the user is swiping; then "h" or "v".
    locked: "none" | "h" | "v";
    // Set to true once we commit an action — blocks the trailing click.
    committed: boolean;
  } | null>(null);
  const didSwipeRef = useRef(false);

  const canSwipe = Boolean(onSwipeArchive || onSwipeSnooze);

  const resetSwipe = useCallback(() => {
    setDragX(0);
    setIsDragging(false);
    gestureRef.current = null;
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!canSwipe) return;
      const t = e.touches[0];
      gestureRef.current = {
        startX: t.clientX,
        startY: t.clientY,
        locked: "none",
        committed: false,
      };
      didSwipeRef.current = false;
    },
    [canSwipe],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const g = gestureRef.current;
      if (!g) return;
      const t = e.touches[0];
      const dx = t.clientX - g.startX;
      const dy = t.clientY - g.startY;

      // Decide the axis on first meaningful movement. Bias toward vertical
      // so hesitant scrolls don't accidentally start a swipe.
      if (g.locked === "none") {
        if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return;
        if (Math.abs(dx) > Math.abs(dy) * 1.2) {
          g.locked = "h";
          setIsDragging(true);
          didSwipeRef.current = true;
        } else {
          // Vertical scroll — disengage swipe for the rest of this gesture.
          g.locked = "v";
          gestureRef.current = null;
          return;
        }
      }

      if (g.locked === "h") {
        // Only one side may be active at a time.
        if (dx < 0 && !onSwipeArchive) {
          setDragX(0);
          return;
        }
        if (dx > 0 && !onSwipeSnooze) {
          setDragX(0);
          return;
        }
        setDragX(dx);
      }
    },
    [onSwipeArchive, onSwipeSnooze],
  );

  const handleTouchEnd = useCallback(() => {
    const g = gestureRef.current;
    if (!g || g.locked !== "h") {
      resetSwipe();
      return;
    }

    // Left swipe → archive.
    if (dragX <= -SWIPE_COMMIT_THRESHOLD && onSwipeArchive) {
      g.committed = true;
      // Fly the row off-screen, then hand off to the parent to actually
      // remove it from the list. The snap transition makes this feel fluid
      // instead of an abrupt disappearance.
      setIsDragging(false);
      setDragX(-window.innerWidth);
      setTimeout(() => {
        onSwipeArchive();
        // Parent will unmount us; reset defensively if it doesn't.
        resetSwipe();
      }, 180);
      return;
    }

    // Right swipe → snooze. We don't remove the row — the modal takes over.
    if (dragX >= SWIPE_COMMIT_THRESHOLD && onSwipeSnooze) {
      g.committed = true;
      onSwipeSnooze();
      // Snap back so the row is in place when the modal closes.
      resetSwipe();
      return;
    }

    // Not enough — snap back.
    resetSwipe();
  }, [dragX, onSwipeArchive, onSwipeSnooze, resetSwipe]);

  const handleTouchCancel = useCallback(() => {
    resetSwipe();
  }, [resetSwipe]);

  // Suppress click fired at the end of a swipe.
  const handleRowClick = useCallback(() => {
    if (didSwipeRef.current) {
      didSwipeRef.current = false;
      return;
    }
    onSelect();
  }, [onSelect]);

  const isThread = thread && thread.messageCount > 1;
  const senderName = isThread
    ? formatParticipants(thread.participants)
    : email.from.name || email.from.email;
  const isUnread = thread ? thread.hasUnread : !email.isRead;
  const isStarred = thread ? thread.hasStarred : email.isStarred;

  // Filter to user labels only (skip system labels and Gmail auto-categories)
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
    // Gmail auto-categories (lowercase IDs used in the app)
    "updates",
    "promotions",
    "social",
    "forums",
    "personal",
    "note-to-self",
  ]);
  const allLabelIds = thread ? thread.labelIds : email.labelIds;
  const displayLabels = [...new Set(allLabelIds)].filter(
    (l) => !systemLabels.has(l),
  );

  // Progress (0–1+) in each direction — used to scale icon feedback.
  const archiveProgress = dragX < 0 ? Math.min(1, -dragX / SWIPE_ICON_SNAP) : 0;
  const snoozeProgress = dragX > 0 ? Math.min(1, dragX / SWIPE_ICON_SNAP) : 0;
  const showSwipeBackgrounds = canSwipe && dragX !== 0;

  return (
    <div
      className="relative overflow-hidden"
      data-thread-id={email.threadId || email.id}
    >
      {/* Swipe-reveal backgrounds — only rendered while the row is displaced
          so they never flash into the layout for non-touch interactions. */}
      {showSwipeBackgrounds && (
        <>
          {/* Snooze background — revealed under the row when swiping right */}
          <div
            className="pointer-events-none absolute inset-y-0 left-0 flex items-center justify-start pl-6 bg-amber-500"
            style={{ width: Math.max(0, dragX) }}
            aria-hidden
          >
            <div
              className="flex items-center gap-2 text-white"
              style={{
                opacity: 0.4 + snoozeProgress * 0.6,
                transform: `scale(${0.85 + snoozeProgress * 0.25})`,
              }}
            >
              <IconClock className="h-5 w-5" stroke={2.25} />
            </div>
          </div>
          {/* Archive background — revealed under the row when swiping left */}
          <div
            className="pointer-events-none absolute inset-y-0 right-0 flex items-center justify-end pr-6 bg-emerald-600"
            style={{ width: Math.max(0, -dragX) }}
            aria-hidden
          >
            <div
              className="flex items-center gap-2 text-white"
              style={{
                opacity: 0.4 + archiveProgress * 0.6,
                transform: `scale(${0.85 + archiveProgress * 0.25})`,
              }}
            >
              <IconCheck className="h-5 w-5" stroke={2.5} />
            </div>
          </div>
        </>
      )}

      <div
        role="row"
        tabIndex={0}
        onClick={handleRowClick}
        onMouseEnter={onHover}
        onKeyDown={(e) => e.key === "Enter" && onSelect()}
        onTouchStart={canSwipe ? handleTouchStart : undefined}
        onTouchMove={canSwipe ? handleTouchMove : undefined}
        onTouchEnd={canSwipe ? handleTouchEnd : undefined}
        onTouchCancel={canSwipe ? handleTouchCancel : undefined}
        style={
          canSwipe
            ? {
                transform: `translateX(${dragX}px)`,
                transition: isDragging ? "none" : "transform 180ms ease-out",
                touchAction: "pan-y",
                // While the row is displaced we need a solid background so the
                // colored reveal backgrounds don't bleed through. When idle we
                // leave this unset so the .focused / .selected CSS classes can
                // apply their own backgrounds naturally.
                ...(dragX !== 0
                  ? {
                      backgroundColor: isSelected
                        ? "hsl(var(--secondary))"
                        : isFocused
                          ? "hsl(var(--accent))"
                          : isMultiSelected
                            ? "hsl(var(--card))"
                            : "hsl(var(--background))",
                    }
                  : {}),
              }
            : undefined
        }
        className={cn(
          "email-list-row group relative flex cursor-pointer items-center h-[48px] sm:h-[38px] px-3 transition-colors",
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
            "w-[100px] sm:w-[160px] shrink-0 text-sm sm:text-[13px] truncate mr-3",
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
    </div>
  );
});
