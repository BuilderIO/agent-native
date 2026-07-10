import { useActionQuery, useFormatters, useT } from "@agent-native/core/client";
import { useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ClipViewRecord {
  id: string;
  viewerEmail: string | null;
  viewerName: string | null;
  viewedAt: string;
}

export interface ViewedByPopoverProps {
  recordingId: string;
  /** Rendered as the click target — usually the existing "N views" text. */
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps the aggregate view count with a click-to-open popover listing
 * individual view records (who viewed, and when), most recent first.
 * Owner-only data — `list-clip-views` is access-checked server-side, so a
 * non-owner opening this (if ever rendered for them) simply sees an error
 * state, never other viewers' identities.
 */
export function ViewedByPopover({
  recordingId,
  children,
  className,
}: ViewedByPopoverProps) {
  const t = useT();
  const { formatDate, formatRelativeTime } = useFormatters();
  const [open, setOpen] = useState(false);

  const q = useActionQuery<{ views: ClipViewRecord[] }>(
    "list-clip-views",
    { recordingId, limit: 50 },
    { enabled: open },
  );

  const relative = (iso: string) => {
    const date = new Date(iso);
    const diff = (date.getTime() - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 60) return formatRelativeTime(Math.round(diff), "second");
    if (abs < 3600) return formatRelativeTime(Math.round(diff / 60), "minute");
    if (abs < 86400) return formatRelativeTime(Math.round(diff / 3600), "hour");
    if (abs < 604800)
      return formatRelativeTime(Math.round(diff / 86400), "day");
    return formatDate(date);
  };

  const views = q.data?.views ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={cn("cursor-pointer text-start", className)}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("recordingInsights.viewedBy")}
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {q.isLoading ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {t("recordingInsights.loading")}
            </p>
          ) : views.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {t("recordingInsights.noViewsYet")}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {views.map((v) => {
                const label =
                  v.viewerName ||
                  (v.viewerEmail
                    ? v.viewerEmail.split("@")[0]
                    : t("recordingInsights.someone"));
                return (
                  <li
                    key={v.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5"
                  >
                    <Avatar className="h-6 w-6 shrink-0">
                      <AvatarFallback className="text-[10px] bg-primary text-primary-foreground">
                        {initials(v.viewerName || v.viewerEmail || "?")}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-foreground">
                        {label}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {relative(v.viewedAt)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function initials(s: string): string {
  return s
    .split(/\s+|@/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
