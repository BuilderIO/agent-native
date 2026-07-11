import { IconLock, IconPin, IconRotate2, IconX } from "@tabler/icons-react";

import type { ContextManifestSegment } from "../../shared/context-xray.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { cn } from "../utils.js";
import { formatTokens, statusLabel } from "./format.js";
import { SegmentProvenancePopover } from "./SegmentProvenancePopover.js";

export function ContextSegmentRow({
  segment,
  advisory,
  onPin,
  onEvict,
  onRestore,
}: {
  segment: ContextManifestSegment;
  advisory: boolean;
  onPin: () => void;
  onEvict: () => void;
  onRestore: () => void;
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
      <SegmentProvenancePopover segment={segment}>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          aria-label={`Inspect ${segment.label}`}
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
            <span>{formatTokens(segment.tokenCount)}</span>
            {segment.tokenMethod === "estimate" && <span>~</span>}
            <span>·</span>
            <span>{statusLabel(segment)}</span>
            {advisory && <span>· advisory</span>}
          </div>
        </button>
      </SegmentProvenancePopover>
      <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        {segment.protected ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex size-6 items-center justify-center rounded-md text-muted-foreground">
                <IconLock className="h-3.5 w-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent>Protected during active turn</TooltipContent>
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
                    ? "Unpin segment"
                    : "Restore segment"
                }
              >
                <IconRotate2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {segment.status === "pinned" ? "Unpin" : "Restore"}
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
                  aria-label="Pin segment"
                >
                  <IconPin className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Pin</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onEvict}
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-destructive"
                  aria-label="Evict segment"
                >
                  <IconX className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {advisory ? "Record eviction intent" : "Evict"}
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );
}
