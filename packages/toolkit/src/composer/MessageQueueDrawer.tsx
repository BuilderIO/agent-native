import { IconCornerDownRight, IconDots, IconTrash } from "@tabler/icons-react";
import type { CSSProperties, ReactNode } from "react";

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

export interface MessageQueueItem {
  id: string;
  text: string;
  images?: readonly string[];
}

export interface MessageQueueItemAction {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: (item: MessageQueueItem) => void;
}

export interface MessageQueueDrawerLabels {
  region: string;
  steer: string;
  steerHint: string;
  remove: string;
  moreActions: string;
}

export type MessageQueueDrawerVariant = "default" | "recessed";

export interface MessageQueueDrawerProps {
  /** Messages waiting to be sent, in the order they will be processed. */
  items: readonly MessageQueueItem[];
  /** Promote one queued message onto the active run's stack. */
  onSteer?: (item: MessageQueueItem) => void;
  /** Remove a message without sending it. */
  onRemove: (item: MessageQueueItem) => void;
  /** Host-owned overflow actions for each queued message. */
  getItemActions?: (
    item: MessageQueueItem,
  ) => readonly MessageQueueItemAction[];
  /** Optional host rendering for the message text. */
  renderText?: (item: MessageQueueItem) => ReactNode;
  labels: MessageQueueDrawerLabels;
  /** Visual treatment for the queue's relationship to the composer. */
  variant?: MessageQueueDrawerVariant;
  /** Prevents queue mutations while a host command is pending. */
  disabled?: boolean;
  className?: string;
}

const RECESSED_QUEUE_MAX_HEIGHT_PX = 160;
const RECESSED_QUEUE_VERTICAL_CHROME_PX = 10;

function recessedQueueHeight(items: readonly MessageQueueItem[]): number {
  if (items.length === 0) return 0;

  const contentHeight = items.reduce(
    (height, item) =>
      height + (item.images && item.images.length > 0 ? 56 : 36),
    RECESSED_QUEUE_VERTICAL_CHROME_PX,
  );
  return Math.min(contentHeight, RECESSED_QUEUE_MAX_HEIGHT_PX);
}

/**
 * Compact queue surface attached to the composer instead of the transcript.
 * The drawer owns presentation; hosts own queue semantics and extra actions.
 */
export function MessageQueueDrawer({
  items,
  onSteer,
  onRemove,
  getItemActions,
  renderText,
  labels,
  variant = "default",
  disabled = false,
  className,
}: MessageQueueDrawerProps) {
  const recessed = variant === "recessed";
  const empty = items.length === 0;
  if (empty && !recessed) return null;

  const recessedStyle = recessed
    ? ({
        "--agent-message-queue-height": `${recessedQueueHeight(items)}px`,
      } as CSSProperties)
    : undefined;

  return (
    <TooltipProvider delayDuration={450}>
      <section
        aria-label={labels.region}
        data-agent-message-queue="true"
        data-agent-message-queue-variant={variant}
        data-empty={empty ? "true" : "false"}
        aria-hidden={empty ? true : undefined}
        style={recessedStyle}
        className={cn(
          recessed
            ? "relative z-0 mx-auto -mb-4 h-[var(--agent-message-queue-height)] w-[calc(100%_-_4rem)] overflow-hidden rounded-xl border border-border/70 bg-muted/55 pb-2.5 opacity-100 shadow-none transition-[height,margin,opacity,transform,border-color,box-shadow] duration-200 ease-[var(--ease-collapse)] data-[empty=true]:pointer-events-none data-[empty=true]:mb-0 data-[empty=true]:translate-y-2 data-[empty=true]:border-0 data-[empty=true]:pb-0 data-[empty=true]:opacity-0 motion-reduce:transition-none"
            : "w-full overflow-hidden rounded-xl border border-border/80 bg-background shadow-sm animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-[var(--ease-drawer)] motion-reduce:animate-none",
          className,
        )}
      >
        <ul
          className={cn(
            "flex max-h-40 flex-col gap-0.5 overflow-y-auto py-1",
            recessed && "h-full",
          )}
        >
          {items.map((item) => {
            const actions = getItemActions?.(item) ?? [];

            return (
              <li
                key={item.id}
                className="group flex min-h-9 min-w-0 items-center gap-2 px-4 py-1.5 text-[13px] leading-4 animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-[var(--ease-collapse)] motion-reduce:animate-none"
              >
                <IconCornerDownRight
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground/50"
                  strokeWidth={1.7}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-foreground">
                    {renderText ? renderText(item) : item.text}
                  </div>
                  {item.images && item.images.length > 0 ? (
                    <div className="mt-1 flex gap-1">
                      {item.images.map((src, index) => (
                        <img
                          key={`${item.id}-image-${index}`}
                          src={src}
                          alt=""
                          className="size-8 rounded-md border border-border/60 object-cover"
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
                  {onSteer ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={disabled}
                          onClick={() => onSteer(item)}
                          className="h-7 gap-1 px-1.5 text-xs font-normal text-muted-foreground hover:text-foreground"
                        >
                          <IconCornerDownRight
                            aria-hidden="true"
                            className="size-3.5"
                            strokeWidth={1.7}
                          />
                          <span>{labels.steer}</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{labels.steerHint}</TooltipContent>
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
                        className="size-7 text-muted-foreground hover:text-foreground"
                      >
                        <IconTrash
                          aria-hidden="true"
                          className="size-3.5"
                          strokeWidth={1.7}
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{labels.remove}</TooltipContent>
                  </Tooltip>
                  {actions.length > 0 ? (
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={disabled}
                              aria-label={labels.moreActions}
                              className="size-7 text-muted-foreground hover:text-foreground"
                            >
                              <IconDots
                                aria-hidden="true"
                                className="size-3.5"
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
                        {actions.map((action) => (
                          <DropdownMenuItem
                            key={action.id}
                            disabled={disabled || action.disabled}
                            onSelect={() => action.onSelect(item)}
                            className={cn(
                              action.destructive &&
                                "text-destructive focus:text-destructive",
                            )}
                          >
                            {action.icon}
                            {action.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </TooltipProvider>
  );
}
