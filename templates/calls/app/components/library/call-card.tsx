import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { appBasePath } from "@agent-native/core/client";
import {
  IconDots,
  IconPlayerPlayFilled,
  IconShare,
  IconFolderShare,
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

export interface CallCardParticipant {
  speakerLabel: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  email?: string | null;
  talkPct?: number;
  isInternal?: boolean;
}

export interface CallCardTracker {
  trackerId: string;
  name: string;
  color: string;
  hitCount: number;
}

export interface CallCardData {
  id: string;
  title: string;
  durationMs: number;
  recordedAt?: string | null;
  createdAt: string;
  accountName?: string | null;
  accountLogoUrl?: string | null;
  participants?: CallCardParticipant[];
  topTrackers?: CallCardTracker[];
  status: string;
}

interface CallCardProps {
  call: CallCardData;
  onShare?: (call: CallCardData) => void;
  onMove?: (call: CallCardData) => void;
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

function initialsFor(p: CallCardParticipant): string {
  const source = p.displayName || p.email || p.speakerLabel || "?";
  const [first = "", second = ""] = source.replace(/@.*/, "").split(/[\s._-]+/);
  return (
    first.slice(0, 1) + second.slice(0, 1) || source.slice(0, 2)
  ).toUpperCase();
}

export function CallCard({
  call,
  onShare,
  onMove,
  onRename,
  onArchive,
  onTrash,
  onTrackerClick,
}: CallCardProps) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);

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
  const shownParticipants = participants.slice(0, 3);
  const extraParticipants = Math.max(0, participants.length - 3);

  const talkTotals = useMemo(() => {
    const totals = participants
      .map((p) => ({
        label: p.speakerLabel,
        pct: Math.max(0, Math.min(100, p.talkPct ?? 0)),
        isInternal: !!p.isInternal,
      }))
      .filter((p) => p.pct > 0);
    const sum = totals.reduce((a, b) => a + b.pct, 0);
    if (sum === 0) return [];
    return totals.map((t) => ({ ...t, width: (t.pct / sum) * 100 }));
  }, [participants]);

  const thumbnailUrl = `${appBasePath()}/api/call-thumbnail/${call.id}`;

  function openCall() {
    navigate(`/calls/${call.id}`);
  }

  function stop(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
  }

  return (
    <div
      role="article"
      onClick={openCall}
      onKeyDown={(e) => e.key === "Enter" && openCall()}
      tabIndex={0}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "group relative flex flex-col rounded-lg border border-border bg-card overflow-hidden cursor-pointer outline-none",
        "hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring",
        "hover:shadow-[0_8px_24px_-12px_hsl(var(--foreground)/0.25)]",
      )}
    >
      <div className="relative aspect-video bg-muted overflow-hidden">
        <img
          src={thumbnailUrl}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
          }}
        />
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/25",
            "opacity-0 group-hover:opacity-100",
          )}
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-background text-foreground shadow-lg">
            <IconPlayerPlayFilled className="h-5 w-5 ml-0.5" />
          </div>
        </div>

        <div className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
          {duration}
        </div>

        {call.status !== "ready" && (
          <div className="absolute top-2 left-2 rounded-full bg-black/80 px-2 py-0.5 text-[10px] font-medium text-white uppercase tracking-wide">
            {call.status}
          </div>
        )}

        <div
          className={cn(
            "absolute top-2 right-2 flex items-center gap-1",
            hovered ? "opacity-100" : "opacity-0",
          )}
          onClick={stop}
        >
          <button
            type="button"
            onClick={(e) => {
              stop(e);
              onShare?.(call);
            }}
            className="flex h-7 w-7 items-center justify-center rounded bg-background/95 text-foreground hover:bg-background shadow-sm"
            aria-label="Share call"
          >
            <IconShare className="h-3.5 w-3.5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={stop}
                className="flex h-7 w-7 items-center justify-center rounded bg-background/95 text-foreground hover:bg-background shadow-sm"
                aria-label="Call menu"
              >
                <IconDots className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={stop}>
              <DropdownMenuItem onSelect={() => onShare?.(call)}>
                <IconShare className="h-4 w-4 mr-2" /> Share
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onMove?.(call)}>
                <IconFolderShare className="h-4 w-4 mr-2" /> Move to folder
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

      <div className="flex-1 p-3 space-y-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-foreground line-clamp-1">
              {call.title}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
              {dateLabel} · {duration}
            </div>
          </div>

          {call.accountName && (
            <div className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground max-w-[8rem]">
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
        </div>

        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            {shownParticipants.map((p, i) => (
              <Avatar
                key={`${p.speakerLabel}-${i}`}
                className="h-6 w-6 border-2 border-card"
              >
                {p.avatarUrl ? <AvatarImage src={p.avatarUrl} alt="" /> : null}
                <AvatarFallback className="text-[9px] bg-muted text-muted-foreground">
                  {initialsFor(p)}
                </AvatarFallback>
              </Avatar>
            ))}
            {extraParticipants > 0 && (
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-card bg-muted text-[9px] font-medium text-muted-foreground">
                +{extraParticipants}
              </div>
            )}
          </div>
          {topTrackers.length > 0 && (
            <div className="ml-auto flex items-center gap-1 overflow-hidden">
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
          )}
        </div>

        {talkTotals.length > 0 && (
          <div className="flex h-1 w-full overflow-hidden rounded-full bg-muted">
            {talkTotals.map((t, i) => (
              <div
                key={`${t.label}-${i}`}
                className={cn(
                  "h-full",
                  t.isInternal ? "bg-foreground" : "bg-foreground/40",
                )}
                style={{ width: `${t.width}%` }}
                title={`${t.label} ${t.pct}%`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
