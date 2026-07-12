import type React from "react";

import type { ContextManifestSegment } from "../../shared/context-xray.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { formatTokens, statusLabel } from "./format.js";

export function SegmentProvenancePopover({
  segment,
  children,
}: {
  segment: ContextManifestSegment;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="space-y-2">
          <div>
            <div className="text-[11px] font-medium uppercase text-muted-foreground">
              Segment
            </div>
            <div className="mt-0.5 break-words text-xs text-foreground">
              {segment.label}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
            <div>
              <span className="block font-medium text-foreground">
                {formatTokens(segment.tokenCount)}
              </span>
              tokens{segment.tokenMethod === "estimate" ? " estimated" : ""}
            </div>
            <div>
              <span className="block font-medium text-foreground">
                {statusLabel(segment)}
              </span>
              current status
            </div>
            <div>
              <span className="block font-medium text-foreground">
                {segment.msgIndex ?? "-"}
              </span>
              message index
            </div>
            <div>
              <span className="block font-medium text-foreground">
                {segment.partIndex ?? "-"}
              </span>
              part index
            </div>
          </div>
          {segment.protected && (
            <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
              This segment is part of the active turn and cannot be evicted yet.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
