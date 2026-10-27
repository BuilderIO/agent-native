import {
  IconCornerDownRight,
  IconDots,
  IconGripVertical,
  IconTrash,
} from "@tabler/icons-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { Button } from "../ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip.js";
import { cn } from "../utils.js";
import { ComposerNotice } from "./composer-notice.js";
import { useComposerRuntimeAdapters } from "./runtime-adapters.js";

export interface MessageQueueItem {
  id: string;
  text: string;
  images?: readonly string[];
  /**
   * Send now was pressed while a run was working: `sending` waits for the
   * run's next step, `after-reply` sends once the reply finishes.
   */
  status?: "sending" | "after-reply";
}

export interface MessageQueueItemAction {
  id: string;
  label: ReactNode;
  hint?: string;
  /** @deprecated Queue menus are text-only; the icon is not rendered. */
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: (item: MessageQueueItem) => void;
}

export interface MessageQueueDrawerLabels {
  region: string;
  /** @deprecated Use sendNow. */
  steer: string;
  /** @deprecated Use sendNowHint. */
  steerHint: string;
  sendNow?: string;
  sendNowHint?: string;
  remove: string;
  moreActions: string;
  /** Drag handle name and tooltip. */
  dragToReorder?: string;
  moveUp?: string;
  moveDown?: string;
  /** Notice shown when `onReorder` rejects and the order rolls back. */
  reorderFailed?: string;
  /** Live announcement after a move, from its 1-based position. */
  movedToPosition?: (position: number, count: number) => string;
  sending?: string;
  sendsAfterReply?: string;
  stopAndSend?: string;
  stopAndSendHint?: string;
}

export type MessageQueueDrawerVariant = "default" | "recessed";

export interface MessageQueueDrawerProps {
  items: readonly MessageQueueItem[];
  onSteer?: (item: MessageQueueItem) => void;
  /** Stops the current response, then sends the item. Shown in the row menu. */
  onStopAndSend?: (item: MessageQueueItem) => void;
  onRemove: (item: MessageQueueItem) => void;
  getItemActions?: (
    item: MessageQueueItem,
  ) => readonly MessageQueueItemAction[];
  /**
   * Persist a new queue order, every queued id in its new position. The
   * drawer shows the order while this settles and rolls back when it rejects.
   */
  onReorder?: (orderedIds: readonly string[]) => Promise<void> | void;
  renderText?: (item: MessageQueueItem) => ReactNode;
  labels: MessageQueueDrawerLabels;
  variant?: MessageQueueDrawerVariant;
  disabled?: boolean;
  className?: string;
}

// Row heights and the gap between rows are fixed so the recessed drawer can
// animate to an exact block size; change them together with the h-9 / h-16
// row classes and the list's gap-1.
const QUEUE_ROW_PX = 36;
const QUEUE_IMAGE_ROW_PX = 64;
const QUEUE_ROW_GAP_PX = 4;
const QUEUE_INSET_PX = 4;
const RECESSED_QUEUE_MAX_PX = 160;

function queueRowHeight(item: MessageQueueItem): number {
  return item.images && item.images.length > 0
    ? QUEUE_IMAGE_ROW_PX
    : QUEUE_ROW_PX;
}

function queueContentHeight(items: readonly MessageQueueItem[]): number {
  if (items.length === 0) return 0;
  return items.reduce(
    (height, item) => height + queueRowHeight(item),
    QUEUE_INSET_PX * 2 + QUEUE_ROW_GAP_PX * (items.length - 1),
  );
}

function orderItems(
  items: readonly MessageQueueItem[],
  orderedIds: readonly string[] | undefined,
): readonly MessageQueueItem[] {
  if (!orderedIds) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = orderedIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  const placed = new Set(orderedIds);
  return [...ordered, ...items.filter((item) => !placed.has(item.id))];
}

function moveId(
  ids: readonly string[],
  from: number,
  to: number,
): readonly string[] {
  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

function sameOrder(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((id, i) => id === right[i]);
}

interface PendingOrder {
  ids: readonly string[];
  /** The host accepted it; the next items update is the confirmed order. */
  settled: boolean;
}

interface DragState {
  id: string;
  startIndex: number;
  overIndex: number;
  offset: number;
}

interface DragOrigin {
  pointerId: number;
  startY: number;
  rects: readonly { top: number; height: number }[];
}

export function MessageQueueDrawer({
  items,
  onSteer,
  onStopAndSend,
  onRemove,
  getItemActions,
  onReorder,
  renderText,
  labels,
  variant = "default",
  disabled = false,
  className,
}: MessageQueueDrawerProps) {
  const t = useComposerRuntimeAdapters().translate;
  const recessed = variant === "recessed";
  const sendNow = labels.sendNow ?? labels.steer;
  const sendNowHint = labels.sendNowHint ?? labels.steerHint;
  const dragToReorder =
    labels.dragToReorder ??
    t("agentChat.queue.dragToReorder", { defaultValue: "Drag to reorder" });
  const moveUpLabel =
    labels.moveUp ?? t("agentChat.queue.moveUp", { defaultValue: "Move up" });
  const moveDownLabel =
    labels.moveDown ??
    t("agentChat.queue.moveDown", { defaultValue: "Move down" });
  const reorderFailed =
    labels.reorderFailed ??
    t("agentChat.queue.reorderFailed", {
      defaultValue: "Couldn't reorder the queue. Try again.",
    });
  const sendingLabel =
    labels.sending ??
    t("agentChat.queue.sending", { defaultValue: "Sending…" });
  const sendsAfterReplyLabel =
    labels.sendsAfterReply ??
    t("agentChat.queue.sendsAfterReply", {
      defaultValue: "Sends after this reply",
    });
  const stopAndSendLabel =
    labels.stopAndSend ??
    t("agentChat.queue.stopAndSend", { defaultValue: "Stop and send" });
  const stopAndSendHint =
    labels.stopAndSendHint ??
    t("agentChat.queue.stopAndSendHint", {
      defaultValue: "Stops the current response, then sends this message.",
    });
  const movedToPosition =
    labels.movedToPosition ??
    ((position: number, count: number) =>
      t("agentChat.queue.movedToPosition", {
        position,
        count,
        defaultValue: `Moved to position ${position} of ${count}`,
      }));

  const [pendingOrder, setPendingOrder] = useState<PendingOrder | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragOriginRef = useRef<DragOrigin | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const focusHandleIdRef = useRef<string | null>(null);
  const reorderRequestRef = useRef(0);

  const displayItems = orderItems(items, pendingOrder?.ids);
  const displayIds = displayItems.map((item) => item.id);
  const empty = displayItems.length === 0;
  const reorderable = Boolean(onReorder) && displayItems.length > 1;

  // A settled order stays on screen until the host's items catch up, so a
  // confirmed move never flickers back for one render.
  const itemIdsKey = items.map((item) => item.id).join("\n");
  const itemIdsRef = useRef<readonly string[]>([]);
  itemIdsRef.current = items.map((item) => item.id);
  useEffect(() => {
    setPendingOrder((current) => {
      if (!current) return current;
      const itemIds = itemIdsKey ? itemIdsKey.split("\n") : [];
      if (current.settled || sameOrder(itemIds, current.ids)) return null;
      return current;
    });
  }, [itemIdsKey]);

  const [openActionsItemId, setOpenActionsItemId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    const hasOpenActionsItem = items.some(
      (item) =>
        item.id === openActionsItemId &&
        (Boolean(onStopAndSend) ||
          (items.length > 1 &&
            ((getItemActions?.(item).length ?? 0) > 0 || Boolean(onReorder)))),
    );
    if (!hasOpenActionsItem) setOpenActionsItemId(null);
  }, [items, getItemActions, onReorder, onStopAndSend, openActionsItemId]);

  useLayoutEffect(() => {
    const id = focusHandleIdRef.current;
    if (!id) return;
    focusHandleIdRef.current = null;
    rowRefs.current
      .get(id)
      ?.querySelector<HTMLElement>('[data-agent-message-queue-handle="true"]')
      ?.focus();
  });

  const commitOrder = (nextIds: readonly string[], movedId: string) => {
    if (!onReorder) return;
    const request = ++reorderRequestRef.current;
    setReorderError(null);
    setPendingOrder({ ids: nextIds, settled: false });
    setAnnouncement(
      movedToPosition(nextIds.indexOf(movedId) + 1, nextIds.length),
    );
    void Promise.resolve()
      .then(() => onReorder(nextIds))
      .then(
        () => {
          if (request !== reorderRequestRef.current) return;
          setPendingOrder((current) => {
            if (current?.ids !== nextIds) return current;
            return sameOrder(itemIdsRef.current, nextIds)
              ? null
              : { ...current, settled: true };
          });
        },
        () => {
          if (request !== reorderRequestRef.current) return;
          setPendingOrder(null);
          setReorderError(reorderFailed);
          setAnnouncement(reorderFailed);
        },
      );
  };

  const moveBy = (id: string, delta: -1 | 1) => {
    const from = displayIds.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= displayIds.length) return;
    focusHandleIdRef.current = id;
    commitOrder(moveId(displayIds, from, to), id);
  };

  const onHandlePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    id: string,
  ) => {
    if (event.button !== 0 || disabled || !reorderable) return;
    const startIndex = displayIds.indexOf(id);
    if (startIndex < 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    // jsdom and some older WebViews have no pointer capture.
    if ("setPointerCapture" in handle)
      handle.setPointerCapture(event.pointerId);
    dragOriginRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      rects: displayIds.map((rowId) => {
        const rect = rowRefs.current.get(rowId)?.getBoundingClientRect();
        return { top: rect?.top ?? 0, height: rect?.height ?? QUEUE_ROW_PX };
      }),
    };
    setDrag({ id, startIndex, overIndex: startIndex, offset: 0 });
  };

  const onHandlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const origin = dragOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId || !drag) return;
    const { rects } = origin;
    const start = rects.at(drag.startIndex);
    const first = rects.at(0);
    const last = rects.at(-1);
    if (!start || !first || !last) return;
    const offset = Math.min(
      Math.max(event.clientY - origin.startY, first.top - start.top),
      last.top + last.height - (start.top + start.height),
    );
    const center = start.top + start.height / 2 + offset;
    // A row below the origin is passed once the dragged center reaches its
    // center, so a drag clamped at the end still lands in the last slot.
    const overIndex = rects.filter((rect, index) => {
      if (index === drag.startIndex) return false;
      const reach = center - (rect.top + rect.height / 2);
      return index - drag.startIndex > 0 ? reach >= 0 : reach > 0;
    }).length;
    setDrag({ ...drag, offset, overIndex });
  };

  const endDrag = (commit: boolean) => {
    const current = drag;
    dragOriginRef.current = null;
    setDrag(null);
    if (!commit || !current || current.overIndex === current.startIndex) return;
    commitOrder(
      moveId(displayIds, current.startIndex, current.overIndex),
      current.id,
    );
  };

  useEffect(() => {
    if (!drag) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dragOriginRef.current = null;
      setDrag(null);
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [drag]);

  const rowShift = (index: number): number => {
    if (!drag || index === drag.startIndex) return 0;
    const height =
      dragOriginRef.current?.rects[drag.startIndex]?.height ?? QUEUE_ROW_PX;
    const movingDown = drag.overIndex > drag.startIndex;
    const first = Math.min(drag.startIndex, drag.overIndex);
    const last = Math.max(drag.startIndex, drag.overIndex);
    if (index < first || index > last) return 0;
    const step = height + QUEUE_ROW_GAP_PX;
    return movingDown ? -step : step;
  };

  const onRowKeyDown = (
    event: ReactKeyboardEvent<HTMLLIElement>,
    id: string,
  ) => {
    if (!reorderable || disabled) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const onHandle =
      (event.target as HTMLElement).dataset.agentMessageQueueHandle === "true";
    if (!onHandle && !event.altKey) return;
    event.preventDefault();
    moveBy(id, event.key === "ArrowUp" ? -1 : 1);
  };

  if (empty && !recessed) return null;

  const rowActions = (item: MessageQueueItem, index: number) => {
    const hostActions = [
      ...(onStopAndSend
        ? [
            {
              id: "stop-and-send",
              label: stopAndSendLabel,
              hint: stopAndSendHint,
              onSelect: onStopAndSend,
            },
          ]
        : []),
      ...(displayItems.length > 1 ? (getItemActions?.(item) ?? []) : []),
    ];
    if (!reorderable) return hostActions;
    const moves: MessageQueueItemAction[] = [];
    if (index > 0) {
      moves.push({
        id: "move-up",
        label: moveUpLabel,
        onSelect: (selected) => moveBy(selected.id, -1),
      });
    }
    if (index < displayItems.length - 1) {
      moves.push({
        id: "move-down",
        label: moveDownLabel,
        onSelect: (selected) => moveBy(selected.id, 1),
      });
    }
    return [...hostActions, ...moves];
  };
  // The overflow column is reserved whenever any row could have actions, so
  // a second queued message never shifts the first row's controls.
  const reserveActionsColumn =
    Boolean(getItemActions) || Boolean(onReorder) || Boolean(onStopAndSend);
  const contentHeight = queueContentHeight(displayItems);
  const scrollable = contentHeight > RECESSED_QUEUE_MAX_PX;

  const drawerStyle = {
    "--agent-message-queue-radius":
      "var(--agentkit-composer-radius, var(--radius-xl, 0.75rem))",
    "--agent-message-queue-inset": `${QUEUE_INSET_PX / 16}rem`,
    ...(recessed
      ? {
          "--agent-message-queue-height": empty
            ? "0px"
            : `min(${contentHeight}px, ${RECESSED_QUEUE_MAX_PX / 16}rem)`,
        }
      : {}),
  } as CSSProperties;

  return (
    <TooltipProvider delayDuration={450}>
      <section
        aria-label={labels.region}
        data-agent-message-queue="true"
        data-agent-message-queue-variant={variant}
        data-empty={empty ? "true" : "false"}
        data-dragging={drag ? "true" : undefined}
        aria-hidden={empty ? true : undefined}
        style={drawerStyle}
        className={cn(
          // Corners are concentric: rows round at the drawer radius minus the
          // drawer's inset, both read from the composer's radius token.
          "p-[var(--agent-message-queue-inset)] data-[empty=true]:p-0",
          recessed
            ? "rounded-t-[var(--agent-message-queue-radius)] rounded-b-none"
            : "w-full overflow-hidden rounded-[var(--agent-message-queue-radius)] border border-border/80 bg-background shadow-sm animate-in fade-in-0 duration-200 motion-reduce:animate-none",
          className,
        )}
      >
        <ul
          className={cn(
            "m-0 flex list-none flex-col gap-1 p-0",
            scrollable ? "overflow-y-auto" : "overflow-y-hidden",
            !recessed && "max-h-40",
          )}
        >
          {displayItems.map((item, index) => {
            const actions = rowActions(item, index);
            const hasImages = Boolean(item.images && item.images.length > 0);
            const dragging = drag?.id === item.id;
            const shift = dragging ? drag.offset : rowShift(index);

            return (
              <li
                key={item.id}
                ref={(element) => {
                  if (element) rowRefs.current.set(item.id, element);
                  else rowRefs.current.delete(item.id);
                }}
                data-agent-message-queue-row="true"
                data-dragging={dragging ? "true" : undefined}
                onKeyDown={(event) => onRowKeyDown(event, item.id)}
                style={
                  shift ? { transform: `translateY(${shift}px)` } : undefined
                }
                className={cn(
                  "group relative flex min-h-0 min-w-0 shrink-0 gap-1 rounded-[calc(var(--agent-message-queue-radius)-var(--agent-message-queue-inset))] px-1 text-sm leading-5 animate-in fade-in-0 duration-150 motion-reduce:animate-none",
                  hasImages
                    ? "h-16 items-start pt-1 pb-0"
                    : "h-9 items-center py-0",
                  dragging
                    ? "z-10 bg-accent shadow-sm"
                    : "transition-[transform,background-color] duration-150 ease-out hover:bg-accent/50 motion-reduce:transition-none",
                )}
              >
                <span className="relative flex size-6 shrink-0 items-center justify-center text-muted-foreground">
                  <IconCornerDownRight
                    aria-hidden="true"
                    className={cn(
                      "size-4 transition-opacity duration-150 motion-reduce:transition-none",
                      reorderable &&
                        !disabled &&
                        "group-hover:opacity-0 group-focus-within:opacity-0 group-data-[dragging=true]:opacity-0",
                    )}
                    strokeWidth={1.7}
                  />
                  {reorderable ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          data-agent-message-queue-handle="true"
                          aria-label={dragToReorder}
                          aria-keyshortcuts="ArrowUp ArrowDown"
                          disabled={disabled}
                          onPointerDown={(event) =>
                            onHandlePointerDown(event, item.id)
                          }
                          onPointerMove={onHandlePointerMove}
                          onPointerUp={() => endDrag(true)}
                          onPointerCancel={() => endDrag(false)}
                          className={cn(
                            "absolute inset-0 flex touch-none items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity duration-150 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 group-data-[dragging=true]:opacity-100 disabled:hidden motion-reduce:transition-none",
                            dragging ? "cursor-grabbing" : "cursor-grab",
                          )}
                        >
                          <IconGripVertical
                            aria-hidden="true"
                            className="size-4"
                            strokeWidth={1.7}
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{dragToReorder}</TooltipContent>
                    </Tooltip>
                  ) : null}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex h-6 min-w-0 items-center text-sm leading-5 text-foreground">
                    <span className="min-w-0 truncate">
                      {renderText ? renderText(item) : item.text}
                    </span>
                  </div>
                  {hasImages ? (
                    <div className="mt-0.5 flex gap-1">
                      {item.images?.map((src, imageIndex) => (
                        <img
                          key={`${item.id}-image-${imageIndex}`}
                          src={src}
                          alt=""
                          className="size-8 rounded-md border border-border/60 object-cover"
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex h-6 shrink-0 items-center gap-0.5 text-[color:var(--agentkit-text-muted-strong,hsl(var(--muted-foreground)))]">
                  {item.status ? (
                    <span
                      className="flex h-6 items-center px-1.5 text-xs"
                      data-agent-message-queue-status={item.status}
                    >
                      {item.status === "sending"
                        ? sendingLabel
                        : sendsAfterReplyLabel}
                    </span>
                  ) : onSteer ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={disabled}
                          onClick={() => onSteer(item)}
                          className="h-6 gap-1 px-1.5 text-xs font-normal text-inherit hover:text-foreground has-[>svg]:px-1.5"
                        >
                          <IconCornerDownRight
                            aria-hidden="true"
                            className="size-4"
                            strokeWidth={1.7}
                          />
                          <span>{sendNow}</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{sendNowHint}</TooltipContent>
                    </Tooltip>
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={disabled}
                        onClick={() => onRemove(item)}
                        aria-label={labels.remove}
                        className="size-6 text-inherit hover:text-foreground"
                      >
                        <IconTrash
                          aria-hidden="true"
                          className="size-4"
                          strokeWidth={1.7}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{labels.remove}</TooltipContent>
                  </Tooltip>
                  {actions.length > 0 ? (
                    <DropdownMenu
                      open={openActionsItemId === item.id}
                      onOpenChange={(open) =>
                        setOpenActionsItemId((current) =>
                          open ? item.id : current === item.id ? null : current,
                        )
                      }
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={disabled}
                              aria-label={labels.moreActions}
                              className="size-6 text-inherit hover:text-foreground"
                            >
                              <IconDots
                                aria-hidden="true"
                                className="size-4"
                                strokeWidth={1.7}
                              />
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent>{labels.moreActions}</TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent
                        align="end"
                        side="top"
                        sideOffset={4}
                      >
                        {actions.map((action) => {
                          const menuItem = (
                            <DropdownMenuItem
                              key={action.id}
                              disabled={disabled || action.disabled}
                              onSelect={() => action.onSelect(item)}
                              className={cn(
                                action.destructive &&
                                  "text-destructive focus:text-destructive",
                              )}
                            >
                              {action.label}
                            </DropdownMenuItem>
                          );

                          return action.hint ? (
                            <Tooltip key={action.id}>
                              <TooltipTrigger asChild>
                                {menuItem}
                              </TooltipTrigger>
                              <TooltipContent side="right">
                                {action.hint}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            menuItem
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : reserveActionsColumn ? (
                    <span aria-hidden="true" className="invisible size-6" />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {/* A bare live region: the composer owns the stack's role="status". */}
        <span
          className="sr-only"
          aria-live="polite"
          aria-atomic="true"
          data-agent-message-queue-announcement="true"
        >
          {announcement}
        </span>
        {reorderError ? (
          <ComposerNotice
            tone="warning"
            noticeId="message-queue-reorder-failed"
            onDismiss={() => setReorderError(null)}
            dismissLabel={t("agentChat.common.dismiss", {
              defaultValue: "Dismiss",
            })}
          >
            {reorderError}
          </ComposerNotice>
        ) : null}
      </section>
    </TooltipProvider>
  );
}
