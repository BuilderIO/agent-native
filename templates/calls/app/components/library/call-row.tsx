import { useMemo } from "react";
import { useNavigate } from "react-router";
import {
  IconDots,
  IconPlayerPlayFilled,
  IconShare,
  IconArchive,
  IconTrash,
  IconEdit,
  IconBuilding,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TrackerChip } from "./tracker-chip";
import type { CallCardData } from "./call-card";

interface CallRowProps {
  call: CallCardData;
  onShare?: (call: CallCardData) => void;
  onRename?: (call: CallCardData) => void;
  onArchive?: (call: CallCardData) => void;
  onTrash?: (call: CallCardData) => void;
  onTrackerClick?: (trackerId: string) => void;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

function initialsFor(source: string): string {
  const s = source.replace(/@.*/, "");
  const [first = "", second = ""] = s.split(/[\s._-]+/);
  return (
    first.slice(0, 1) + second.slice(0, 1) || s.slice(0, 2)
  ).toUpperCase();
}

export function CallRow({
  call,
  onShare,
  onRename,
  onArchive,
  onTrash,
  onTrackerClick,
}: CallRowProps) {
  const navigate = useNavigate();
  const duration = useMemo(
    () => formatDuration(call.durationMs),
    [call.durationMs],
  );
  const dateLabel = useMemo(
    () => formatDate(call.recordedAt || call.createdAt),
    [call.recordedAt, call.createdAt],
  );

  const participants = call.participants ?? [];
  const topTrackers = call.topTrackers ?? [];
  const shown = participants.slice(0, 4);
  const extra = Math.max(0, participants.length - 4);

  function openCall() {
    navigate(`/calls/${call.id}`);
  }

  function stop(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openCall}
      onKeyDown={(e) => e.key === "Enter" && openCall()}
      className={cn(
        "group flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 cursor-pointer outline-none",
        "hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded bg-muted">
        <img
          src={`/api/call-thumbnail/${call.id}`}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          onError={(e) =>
            ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")
          }
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30">
          <IconPlayerPlayFilled className="h-4 w-4 text-white opacity-0 group-hover:opacity-100" />
        </div>
        <div className="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 py-[1px] text-[9px] font-medium text-white tabular-nums">
          {duration}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate text-sm font-medium text-foreground">
            {call.title}
          </div>
          {call.status !== "ready" && (
            <span className="rounded-full bg-muted px-1.5 py-[1px] text-[9px] font-medium text-muted-foreground uppercase tracking-wide">
              {call.status}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          {dateLabel} · {duration}
        </div>
      </div>

      <div className="hidden md:flex items-center shrink-0">
        <div className="flex -space-x-2">
          {shown.map((p, i) => (
            <Avatar
              key={`${p.speakerLabel}-${i}`}
              className="h-6 w-6 border-2 border-card"
            >
              {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt="" /> : null}
              <AvatarFallback className="text-[9px] bg-muted text-muted-foreground">
                {initialsFor(p.displayName || p.email || p.speakerLabel)}
              </AvatarFallback>
            </Avatar>
          ))}
          {extra > 0 && (
            <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-card bg-muted text-[9px] font-medium text-muted-foreground">
              +{extra}
            </div>
          )}
        </div>
      </div>

      {call.accountName && (
        <div className="hidden lg:inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground shrink-0 max-w-[10rem]">
          {call.accountLogoUrl ? (
            <img
              src={call.accountLogoUrl}
              alt=""
              className="h-3 w-3 rounded-sm object-cover"
            />
          ) : (
            <IconBuilding className="h-3 w-3" />
          )}
          <span className="truncate">{call.accountName}</span>
        </div>
      )}

      <div className="hidden lg:flex items-center gap-1 shrink-0 max-w-[22rem] overflow-hidden">
        {topTrackers.slice(0, 3).map((t) => (
          <TrackerChip
            key={t.trackerId}
            name={t.name}
            color={t.color}
            count={t.hitCount}
            onClick={
              onTrackerClick
                ? (e) => {
                    stop(e);
                    onTrackerClick(t.trackerId);
                  }
                : undefined
            }
          />
        ))}
      </div>

      <div
        className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100"
        onClick={stop}
      >
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            onShare?.(call);
          }}
          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Share call"
        >
          <IconShare className="h-3.5 w-3.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={stop}
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Call menu"
            >
              <IconDots className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={stop}>
            <DropdownMenuItem onSelect={() => onShare?.(call)}>
              <IconShare className="h-4 w-4 mr-2" /> Share
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRename?.(call)}>
              <IconEdit className="h-4 w-4 mr-2" /> Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onArchive?.(call)}>
              <IconArchive className="h-4 w-4 mr-2" /> Archive
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onTrash?.(call)}
              className="text-destructive focus:text-destructive"
            >
              <IconTrash className="h-4 w-4 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
