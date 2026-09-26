import { useT } from "@agent-native/core/client/i18n";
import type { EmailMessage } from "@shared/types";
import {
  IconArchive,
  IconStarFilled,
  IconCheck,
  IconClock,
  IconMail,
  IconMailOpened,
  IconTrash,
  IconSquare,
  IconSquareCheck,
  IconSend,
  IconX,
  IconThumbUp,
  IconThumbDown,
} from "@tabler/icons-react";
import { memo, useRef, useState, useCallback } from "react";
import { Link } from "react-router";

import { ImportanceFeedbackMenu } from "@/components/email/ImportanceFeedbackMenu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAccountFilter } from "@/hooks/use-account-filter";
import { getLabelStyle } from "@/lib/label-colors";
import { mailLabelDisplayName } from "@/lib/label-display";
import type { ThreadSummary } from "@/lib/threads";
import { cn, formatEmailDate } from "@/lib/utils";

interface EmailListItemProps {
  email: EmailMessage;
  labelNames?: ReadonlyMap<string, string>;
  importanceScore?: number;
  thread?: ThreadSummary;
  isSelected: boolean;
  isFocused: boolean;
  isMultiSelected?: boolean;
  /** Whether archive/snooze/trash row actions apply in the current view.
   *  Passed as booleans instead of `undefined`-vs-closure so handlers stay
   *  referentially stable across rows and renders. */
  canArchive?: boolean;
  canSnooze?: boolean;
  canTrash?: boolean;
  /** Present only for scheduled-send rows; drives the send-now/cancel actions. */
  scheduledJobId?: string | null;
  onSelect: (thread: ThreadSummary) => void;
  onToggleMultiSelect: (e: React.SyntheticEvent, thread: ThreadSummary) => void;
  onStar: (e: React.MouseEvent, thread: ThreadSummary) => void;
  onToggleRead?: (e: React.MouseEvent, thread: ThreadSummary) => void;
  onArchive?: (e: React.MouseEvent, thread: ThreadSummary) => void;
  onSnooze?: (e: React.MouseEvent, thread: ThreadSummary) => void;
  onTrash?: (e: React.MouseEvent, thread: ThreadSummary) => void;
  onImportanceFeedback?: (decision: "important" | "not-important") => void;
  onSendNow?: (e: React.MouseEvent, thread: ThreadSummary) => void;
  onCancelSchedule?: (e: React.MouseEvent, thread: ThreadSummary) => void;
  onHover: (thread: ThreadSummary) => void;
  /** Called after a left-swipe past the threshold (archive). */
  onSwipeArchive?: (thread: ThreadSummary) => void;
  /** Called after a right-swipe past the threshold (snooze). */
  onSwipeSnooze?: (thread: ThreadSummary) => void;
  /** Optional search term to highlight in subject and snippet. */
  highlight?: string;
}

function renderWithHighlight(text: string, term?: string) {
  if (!term) return text;
  const needle = term.trim();
  if (!needle) return text;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark
        key={i}
        className="rounded-sm bg-amber-400/40 text-foreground px-0.5"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

// Minimum horizontal distance before we lock into a swipe gesture.
const SWIPE_SLOP = 10;
// Distance past which a swipe commits the action.
const SWIPE_COMMIT_THRESHOLD = 80;
// Distance past which the action icon "snaps" to filled state.
const SWIPE_ICON_SNAP = 56;
// Release velocity (px/ms) past which a swipe commits regardless of distance.
const SWIPE_COMMIT_VELOCITY = 0.11;

/** Format participant names for thread display, e.g. "Kaitlyn .. Sam, Andrew" */
function formatParticipants(participants: string[], maxWidth = 3): string {
  if (participants.length <= 1) return participants[0] || "";
  // Extract first names only
  const firstNames = participants.map((p) => p.split(" ")[0]);
  if (firstNames.length <= maxWidth) return firstNames.join(", ");
  // Show first, "..", then last few
  return `${firstNames[0]} .. ${firstNames.slice(-(maxWidth - 1)).join(", ")}`;
}

/** Stable dot colors for distinguishing accounts */
const accountDotColors = [
  "bg-blue-400",
  "bg-emerald-400",
  "bg-amber-400",
  "bg-rose-400",
  "bg-sky-400",
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

export const EmailListItem = memo(function EmailListItem({
  email,
  labelNames,
  importanceScore,
  thread,
  isSelected,
  isFocused,
  isMultiSelected,
  canArchive,
  canSnooze,
  canTrash,
  scheduledJobId,
  onSelect,
  onToggleMultiSelect,
  onStar,
  onToggleRead,
  onArchive,
  onSnooze,
  onTrash,
  onImportanceFeedback,
  onSendNow,
  onCancelSchedule,
  onHover,
  onSwipeArchive,
  onSwipeSnooze,
  highlight,
}: EmailListItemProps) {
  const t = useT();
  const { allAccounts } = useAccountFilter();
  const isMultiAccount = allAccounts.length > 1;

  const showArchive = Boolean(onArchive && canArchive);
  const showSnooze = Boolean(onSnooze && canSnooze);
  const showTrash = Boolean(onTrash && canTrash);
  const showSendNow = Boolean(onSendNow && scheduledJobId);
  const showCancelSchedule = Boolean(onCancelSchedule && scheduledJobId);

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
    // Two-sample window for release-velocity calculation (px/ms). Updated on
    // each touchmove; not an accumulating history.
    lastX: number;
    lastT: number;
    prevX: number;
    prevT: number;
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
      const now = performance.now();
      gestureRef.current = {
        startX: t.clientX,
        startY: t.clientY,
        locked: "none",
        committed: false,
        lastX: t.clientX,
        lastT: now,
        prevX: t.clientX,
        prevT: now,
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
        // Slide the two-sample window forward for release-velocity math.
        g.prevX = g.lastX;
        g.prevT = g.lastT;
        g.lastX = t.clientX;
        g.lastT = performance.now();

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

    const velocity = (g.lastX - g.prevX) / Math.max(1, g.lastT - g.prevT);
    const flungLeft =
      velocity <= -SWIPE_COMMIT_VELOCITY && dragX <= -SWIPE_ICON_SNAP;
    const flungRight =
      velocity >= SWIPE_COMMIT_VELOCITY && dragX >= SWIPE_ICON_SNAP;

    // Left swipe → archive.
    if (
      (dragX <= -SWIPE_COMMIT_THRESHOLD || flungLeft) &&
      onSwipeArchive &&
      thread
    ) {
      g.committed = true;
      // Fly the row off-screen, then hand off to the parent to actually
      // remove it from the list. The snap transition makes this feel fluid
      // instead of an abrupt disappearance.
      setIsDragging(false);
      setDragX(-window.innerWidth);
      setTimeout(() => {
        onSwipeArchive(thread);
        // Parent will unmount us; reset defensively if it doesn't.
        resetSwipe();
      }, 180);
      return;
    }

    // Right swipe → snooze. We don't remove the row — the modal takes over.
    if (
      (dragX >= SWIPE_COMMIT_THRESHOLD || flungRight) &&
      onSwipeSnooze &&
      thread
    ) {
      g.committed = true;
      onSwipeSnooze(thread);
      // Snap back so the row is in place when the modal closes.
      resetSwipe();
      return;
    }

    // Not enough — snap back.
    resetSwipe();
  }, [dragX, onSwipeArchive, onSwipeSnooze, resetSwipe, thread]);

  const handleTouchCancel = useCallback(() => {
    resetSwipe();
    didSwipeRef.current = false;
  }, [resetSwipe]);

  // Suppress click fired at the end of a swipe.
  const handleRowClick = useCallback(() => {
    if (didSwipeRef.current) {
      didSwipeRef.current = false;
      return;
    }
    if (thread) onSelect(thread);
  }, [onSelect, thread]);

  const handleRowHover = useCallback(() => {
    if (thread) onHover(thread);
  }, [onHover, thread]);

  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Action buttons live inside the row. Their Enter/Space events must not
      // also open the conversation or toggle selection.
      if (!thread || e.target !== e.currentTarget) return;
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        onSelect(thread);
      }
      if (e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        onToggleMultiSelect(e, thread);
      }
    },
    [onSelect, onToggleMultiSelect, thread],
  );

  const handleToggleMultiSelectClick = useCallback(
    (e: React.SyntheticEvent) => {
      if (thread) onToggleMultiSelect(e, thread);
    },
    [onToggleMultiSelect, thread],
  );

  const handleStarClick = useCallback(
    (e: React.MouseEvent) => {
      if (thread) onStar(e, thread);
    },
    [onStar, thread],
  );

  const handleToggleReadClick = useCallback(
    (e: React.MouseEvent) => {
      if (thread) onToggleRead?.(e, thread);
    },
    [onToggleRead, thread],
  );

  const handleArchiveClick = useCallback(
    (e: React.MouseEvent) => {
      if (thread) onArchive?.(e, thread);
    },
    [onArchive, thread],
  );

  const handleSnoozeClick = useCallback(
    (e: React.MouseEvent) => {
      if (thread) onSnooze?.(e, thread);
    },
    [onSnooze, thread],
  );

  const handleTrashClick = useCallback(
    (e: React.MouseEvent) => {
      if (thread) onTrash?.(e, thread);
    },
    [onTrash, thread],
  );

  const handleSendNowClick = useCallback(
    (e: React.MouseEvent) => {
      if (thread) onSendNow?.(e, thread);
    },
    [onSendNow, thread],
  );

  const handleCancelScheduleClick = useCallback(
    (e: React.MouseEvent) => {
      if (thread) onCancelSchedule?.(e, thread);
    },
    [onCancelSchedule, thread],
  );

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
        data-mail-email-row
        data-email-id={email.id}
        data-thread-key={email.threadId || email.id}
        aria-selected={isMultiSelected}
        aria-current={isFocused ? "true" : undefined}
        onClick={handleRowClick}
        // `mouseenter` can fire when layout moves under a stationary cursor.
        // `mousemove` only follows the pointer after the user actually moves it,
        // so keyboard navigation keeps ownership during list/header changes.
        onMouseMove={handleRowHover}
        onKeyDown={handleRowKeyDown}
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
          importanceScore !== undefined && "has-importance",
        )}
      >
        {/* Multi-select left border indicator */}
        {isMultiSelected && (
          <div className="absolute start-0 top-0 bottom-0 w-[3px] bg-primary rounded-e" />
        )}

        {/* Selection / unread / account dot */}
        <div className="relative me-2 flex h-full w-5 shrink-0 items-center justify-center">
          <button
            type="button"
            aria-label={t(
              isMultiSelected
                ? "mail.selection.deselectEmail"
                : "mail.selection.selectEmail",
            )}
            onClick={handleToggleMultiSelectClick}
            className={cn(
              "absolute inset-y-0 left-1/2 flex w-6 -translate-x-1/2 items-center justify-center rounded text-muted-foreground transition-opacity hover:text-foreground",
              isMultiSelected
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
            )}
          >
            {isMultiSelected ? (
              <IconSquareCheck className="h-4 w-4 text-primary" />
            ) : (
              <IconSquare className="h-4 w-4" />
            )}
          </button>
          <div
            className={cn(
              "transition-opacity",
              isMultiSelected
                ? "opacity-0"
                : "group-hover:opacity-0 group-focus-within:opacity-0",
            )}
          >
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
        </div>

        {/* Sender name — fixed width column */}
        <span
          className={cn(
            "w-[100px] sm:w-[160px] shrink-0 text-sm sm:text-[13px] truncate me-3",
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
          <div className="flex items-center gap-1 shrink-0 me-2">
            {displayLabels.slice(0, 2).map((labelId) => {
              const style = getLabelStyle(labelId);
              const labelName =
                labelNames?.get(labelId) ??
                labelId.replace(/^label:/, "").replace(/^CATEGORY_/, "");
              const displayName = mailLabelDisplayName(labelName);
              return (
                <span
                  key={labelId}
                  className={cn("label-badge", style.bg, style.text)}
                >
                  {displayName}
                </span>
              );
            })}
          </div>
        )}

        {/* Subject + snippet — fills remaining space */}
        <div className="row-content flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
          <span
            className={cn(
              "text-sm sm:text-[13px] truncate shrink-0 max-w-[75%]",
              isUnread
                ? "font-medium text-foreground"
                : "font-normal text-foreground/90",
            )}
          >
            {renderWithHighlight(email.subject, highlight)}
          </span>
          <span className="text-sm sm:text-[13px] text-muted-foreground/80 truncate">
            {renderWithHighlight(email.snippet, highlight)}
          </span>
        </div>

        <div className="row-action-rail">
          {/* Time — right aligned, hidden when row actions are visible */}
          <span className="row-time text-xs text-muted-foreground tabular-nums sm:text-[12px]">
            {formatEmailDate(email.date)}
          </span>
          {importanceScore !== undefined && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={(event) => event.stopPropagation()}
                  className="email-importance-score ms-2 text-[11px] tabular-nums"
                  style={
                    {
                      "--mail-importance-hue": `${25 + 125 * importanceScore}deg`,
                    } as React.CSSProperties
                  }
                  aria-label={`${t("mail.sort.priority")} ${importanceScore.toFixed(2)}`}
                >
                  {importanceScore.toFixed(2)}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-72 p-3"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-baseline gap-2">
                  <span
                    className="email-importance-score text-xl font-semibold tabular-nums"
                    style={
                      {
                        "--mail-importance-hue": `${25 + 125 * importanceScore}deg`,
                      } as React.CSSProperties
                    }
                  >
                    {importanceScore.toFixed(2)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(
                      importanceScore >= 0.7
                        ? "mail.sort.priorityScoreHigh"
                        : importanceScore >= 0.35
                          ? "mail.sort.priorityScoreMedium"
                          : "mail.sort.priorityScoreLow",
                    )}
                  </span>
                </div>
                <div className="mail-importance-ramp mt-2" aria-hidden />
                <div className="mt-3 grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onImportanceFeedback?.("important")}
                    className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <IconThumbUp className="size-3.5" />
                    {t("mail.aiFilter.importantMode")}
                  </button>
                  <button
                    type="button"
                    onClick={() => onImportanceFeedback?.("not-important")}
                    className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <IconThumbDown className="size-3.5" />
                    {t("mail.aiFilter.notImportantMode")}
                  </button>
                </div>
                <Link
                  to="/settings?section=ai-filter#importance-rules"
                  className="mt-2 flex items-center justify-between px-0.5 pt-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {t("mail.sort.priorityEditRules")}
                </Link>
              </PopoverContent>
            </Popover>
          )}

          {/* Hover actions overlay the preview while the time and score stay fixed. */}
          <div className="hover-actions gap-0.5">
            {onToggleRead && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleToggleReadClick}
                    aria-label={t(
                      isUnread
                        ? "mail.actions.markRead"
                        : "mail.actions.markUnread",
                    )}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {isUnread ? (
                      <IconMailOpened className="h-3.5 w-3.5" />
                    ) : (
                      <IconMail className="h-3.5 w-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {isUnread
                    ? t("mail.actions.markRead")
                    : t("mail.actions.markUnread")}
                </TooltipContent>
              </Tooltip>
            )}
            {showArchive && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleArchiveClick}
                    aria-label={t("mail.actions.archive")}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400"
                  >
                    <IconArchive className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("mail.actions.archive")}</TooltipContent>
              </Tooltip>
            )}
            {showSnooze && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleSnoozeClick}
                    aria-label={t("mail.snooze.snooze")}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400"
                  >
                    <IconClock className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("mail.snooze.snooze")}</TooltipContent>
              </Tooltip>
            )}
            {showSendNow && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleSendNowClick}
                    aria-label={t("mail.sendLater.sendNow")}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <IconSend className="h-3.5 w-3.5 rtl:-scale-x-100" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("mail.sendLater.sendNow")}</TooltipContent>
              </Tooltip>
            )}
            {showCancelSchedule && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleCancelScheduleClick}
                    aria-label={t("mail.sendLater.cancelScheduledSend")}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <IconX className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("mail.sendLater.cancelScheduledSend")}
                </TooltipContent>
              </Tooltip>
            )}
            {showTrash && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleTrashClick}
                    aria-label={t("mail.actions.moveToTrash")}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("mail.actions.moveToTrash")}</TooltipContent>
              </Tooltip>
            )}
            {onImportanceFeedback && (
              <ImportanceFeedbackMenu onFeedback={onImportanceFeedback} />
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleStarClick}
                  aria-label={t(
                    isStarred ? "mail.actions.unstar" : "mail.actions.star",
                  )}
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded transition-colors",
                    isStarred
                      ? "text-amber-400"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent",
                  )}
                >
                  <IconStarFilled className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {t(isStarred ? "mail.actions.unstar" : "mail.actions.star")}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
});
