import { IconLock, IconPin, IconRotate2, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.js";
import { cn } from "../utils.js";
import { formatContextTokens } from "./format.js";
import {
  fallbackContextTranslate,
  type ContextSegmentViewData,
  type ContextTranslate,
} from "./types.js";

function statusLabel(
  segment: ContextSegmentViewData,
  translate: ContextTranslate,
): string {
  if (segment.protected)
    return translate("agentChat.contextXray.status.protected", {
      defaultValue: "Protected",
    });
  if (segment.status === "pinned")
    return translate("agentChat.contextXray.status.pinned", {
      defaultValue: "Pinned",
    });
  if (segment.status === "evicted")
    return translate("agentChat.contextXray.status.evicted", {
      defaultValue: "Evicted",
    });
  if (segment.status === "summarized")
    return translate("agentChat.contextXray.status.summarized", {
      defaultValue: "Summarized",
    });
  return translate("agentChat.contextXray.status.active", {
    defaultValue: "Active",
  });
}

export function SegmentProvenancePopoverView({
  segment,
  children,
  translate = fallbackContextTranslate,
}: {
  segment: ContextSegmentViewData;
  children: ReactNode;
  translate?: ContextTranslate;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="space-y-2">
          <div>
            <div className="text-[11px] font-medium uppercase text-muted-foreground">
              {translate("agentChat.contextXray.segment", {
                defaultValue: "Segment",
              })}
            </div>
            <div className="mt-0.5 break-words text-xs text-foreground">
              {segment.label}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
            <div>
              <span className="block font-medium text-foreground">
                {formatContextTokens(segment.tokenCount)}
              </span>
              {translate("agentChat.contextXray.tokens", {
                defaultValue: "tokens",
              })}
              {segment.tokenMethod === "estimate"
                ? translate("agentChat.contextXray.estimatedPrefix", {
                    defaultValue: " estimated",
                  })
                : ""}
            </div>
            <div>
              <span className="block font-medium text-foreground">
                {statusLabel(segment, translate)}
              </span>
              {translate("agentChat.contextXray.currentStatus", {
                defaultValue: "current status",
              })}
            </div>
            <div>
              <span className="block font-medium text-foreground">
                {segment.msgIndex ?? "-"}
              </span>
              {translate("agentChat.contextXray.messageIndex", {
                defaultValue: "message index",
              })}
            </div>
            <div>
              <span className="block font-medium text-foreground">
                {segment.partIndex ?? "-"}
              </span>
              {translate("agentChat.contextXray.partIndex", {
                defaultValue: "part index",
              })}
            </div>
          </div>
          {segment.protected ? (
            <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
              {translate("agentChat.contextXray.protectedDescription", {
                defaultValue:
                  "This segment is part of the active turn and cannot be evicted yet.",
              })}
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ContextSegmentRowView({
  segment,
  advisory,
  onPin,
  onEvict,
  onRestore,
  translate = fallbackContextTranslate,
}: {
  segment: ContextSegmentViewData;
  advisory: boolean;
  onPin: () => void;
  onEvict: () => void;
  onRestore: () => void;
  translate?: ContextTranslate;
}) {
  const disabled = segment.protected || segment.status === "evicted";
  return (
    <div
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "p") onPin();
        if (event.key === "e" && !disabled) onEvict();
        if (event.key === "u" && segment.status !== "active") onRestore();
      }}
      className={cn(
        "group flex min-h-11 items-center gap-2 rounded-sm px-2 py-1.5 outline-none transition-colors hover:bg-accent/35 focus-visible:bg-accent/35 focus-visible:ring-1 focus-visible:ring-ring",
        segment.status === "evicted" && "opacity-60",
      )}
    >
      <SegmentProvenancePopoverView segment={segment} translate={translate}>
        <button
          type="button"
          className="min-w-0 flex-1 text-start"
          aria-label={translate("agentChat.contextXray.inspect", {
            defaultValue: "Inspect {{name}}",
            name: segment.label,
          })}
        >
          <div
            className={cn(
              "truncate text-[13px] font-medium leading-5 text-foreground",
              segment.status === "evicted" && "line-through",
            )}
          >
            {segment.label}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{formatContextTokens(segment.tokenCount)}</span>
            {segment.tokenMethod === "estimate" ? <span>~</span> : null}
            <span>·</span>
            <span>{statusLabel(segment, translate)}</span>
            {advisory ? (
              <span>
                ·{" "}
                {translate("agentChat.contextXray.advisory", {
                  defaultValue: "advisory",
                })}
              </span>
            ) : null}
          </div>
        </button>
      </SegmentProvenancePopoverView>
      <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        {segment.protected ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex size-6 items-center justify-center rounded-md text-muted-foreground">
                <IconLock className="h-3.5 w-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {translate("agentChat.contextXray.protectedDuringTurn", {
                defaultValue: "Protected during active turn",
              })}
            </TooltipContent>
          </Tooltip>
        ) : segment.status === "evicted" ||
          segment.status === "summarized" ||
          segment.status === "pinned" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onRestore}
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                aria-label={
                  segment.status === "pinned"
                    ? translate("agentChat.contextXray.unpinSegment", {
                        defaultValue: "Unpin segment",
                      })
                    : translate("agentChat.contextXray.restoreSegment", {
                        defaultValue: "Restore segment",
                      })
                }
              >
                <IconRotate2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {segment.status === "pinned"
                ? translate("agentChat.contextXray.unpin", {
                    defaultValue: "Unpin",
                  })
                : translate("agentChat.contextXray.restore", {
                    defaultValue: "Restore",
                  })}
            </TooltipContent>
          </Tooltip>
        ) : (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onPin}
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                  aria-label={translate("agentChat.contextXray.pinSegment", {
                    defaultValue: "Pin segment",
                  })}
                >
                  <IconPin className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {translate("agentChat.contextXray.pin", {
                  defaultValue: "Pin",
                })}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onEvict}
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-destructive"
                  aria-label={translate("agentChat.contextXray.evictSegment", {
                    defaultValue: "Evict segment",
                  })}
                >
                  <IconX className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {advisory
                  ? translate("agentChat.contextXray.recordEvictionIntent", {
                      defaultValue: "Record eviction intent",
                    })
                  : translate("agentChat.contextXray.evict", {
                      defaultValue: "Evict",
                    })}
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}
