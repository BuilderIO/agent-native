import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  IconDots,
  IconLock,
  IconWorld,
  IconUsersGroup,
  IconPlayerPlay,
  IconShare,
  IconFolder,
  IconArchive,
  IconTrash,
  IconCopy,
  IconEdit,
  IconCheck,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import type { RecordingSummary } from "@/hooks/use-library";
import { isDefaultTitle } from "@/hooks/use-auto-title";

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diff = (date.getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 604800) return rtf.format(Math.round(diff / 86400), "day");
  if (abs < 2629800) return rtf.format(Math.round(diff / 604800), "week");
  if (abs < 31557600) return rtf.format(Math.round(diff / 2629800), "month");
  return rtf.format(Math.round(diff / 31557600), "year");
}

function PrivacyIcon({
  visibility,
  className,
}: {
  visibility: RecordingSummary["visibility"];
  className?: string;
}) {
  if (visibility === "public")
    return <IconWorld className={cn("h-3.5 w-3.5", className)} />;
  if (visibility === "org")
    return <IconUsersGroup className={cn("h-3.5 w-3.5", className)} />;
  return <IconLock className={cn("h-3.5 w-3.5", className)} />;
}

interface RecordingCardProps {
  recording: RecordingSummary;
  selected?: boolean;
  selectionMode?: boolean;
  onToggleSelect?: (id: string) => void;
  onShare?: (rec: RecordingSummary) => void;
  onMove?: (rec: RecordingSummary) => void;
  onAddToSpace?: (rec: RecordingSummary) => void;
  onRename?: (rec: RecordingSummary) => void;
  onDuplicate?: (rec: RecordingSummary) => void;
  onArchive?: (rec: RecordingSummary) => void;
  onTrash?: (rec: RecordingSummary) => void;
}

export function RecordingCard({
  recording,
  selected,
  selectionMode,
  onToggleSelect,
  onShare,
  onMove,
  onAddToSpace,
  onRename,
  onDuplicate,
  onArchive,
  onTrash,
}: RecordingCardProps) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);

  const duration = useMemo(
    () => formatDuration(recording.durationMs),
    [recording.durationMs],
  );
  const relative = useMemo(
    () => formatRelative(recording.createdAt),
    [recording.createdAt],
  );

  const displayThumbnail = useMemo(() => {
    if (hovered && recording.animatedThumbnailUrl)
      return recording.animatedThumbnailUrl;
    return recording.thumbnailUrl;
  }, [hovered, recording.animatedThumbnailUrl, recording.thumbnailUrl]);

  const ownerInitials = useMemo(() => {
    const [local] = recording.ownerEmail.split("@");
    return (local || "?").slice(0, 2).toUpperCase();
  }, [recording.ownerEmail]);

  const handleOpen = useCallback(() => {
    if (selectionMode) {
      onToggleSelect?.(recording.id);
    } else {
      navigate(`/r/${recording.id}`);
    }
  }, [navigate, onToggleSelect, recording.id, selectionMode]);

  const handleCheckbox = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleSelect?.(recording.id);
    },
    [onToggleSelect, recording.id],
  );

  return (
    <div
      role="article"
      onClick={handleOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "group relative flex flex-col rounded-lg border bg-card overflow-hidden cursor-pointer",
        "border-border/80 hover:border-primary/40",
        "shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-md",
        "transition-transform duration-100 ease-out hover:-translate-y-0.5",
        selected && "ring-2 ring-primary border-primary",
      )}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-muted overflow-hidden">
        {displayThumbnail ? (
          // eslint-disable-next-line jsx-a11y/alt-text
          <img
            src={displayThumbnail}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
            <IconPlayerPlay className="h-10 w-10 text-primary/40" />
          </div>
        )}

        {/* Play overlay on hover */}
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/15",
            "opacity-0 group-hover:opacity-100",
          )}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-primary shadow-lg">
            <IconPlayerPlay className="h-5 w-5 fill-current" />
          </div>
        </div>

        {/* Duration badge */}
        <div className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
          {duration}
        </div>

        {/* Selection checkbox */}
        {(selectionMode || hovered || selected) && (
          <div
            onClick={handleCheckbox}
            className="absolute top-2 left-2 flex h-5 w-5 items-center justify-center rounded bg-background/90 border border-border"
          >
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggleSelect?.(recording.id)}
              onClick={(e) => e.stopPropagation()}
              className="h-3.5 w-3.5"
            />
          </div>
        )}

        {/* Status pill for non-ready recordings */}
        {recording.status !== "ready" && (
          <div className="absolute top-2 right-2 rounded-full bg-black/80 px-2 py-0.5 text-[10px] font-medium text-white uppercase tracking-wide">
            {recording.status}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 p-3 space-y-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-sm font-medium text-foreground line-clamp-1">
              {isDefaultTitle(recording.title) ? (
                // Placeholder while the agent drafts a title from the
                // transcript. `useAutoTitleBridge` kicks this off and the
                // polling layer swaps the skeleton for the real title the
                // moment `update-recording` lands.
                <Skeleton
                  aria-label="Generating title"
                  className="h-3.5 w-3/4"
                />
              ) : (
                <span className="truncate">{recording.title}</span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <PrivacyIcon
                visibility={recording.visibility}
                className="shrink-0"
              />
              <span className="capitalize">{recording.visibility}</span>
              <span>•</span>
              <span>
                {recording.viewCount} view{recording.viewCount === 1 ? "" : "s"}
              </span>
              <span>•</span>
              <span>{relative}</span>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Recording menu"
              >
                <IconDots className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem onSelect={() => onShare?.(recording)}>
                <IconShare className="h-4 w-4 mr-2" /> Share
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onMove?.(recording)}>
                <IconFolder className="h-4 w-4 mr-2" /> Move to folder
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAddToSpace?.(recording)}>
                <IconUsersGroup className="h-4 w-4 mr-2" /> Add to space
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onRename?.(recording)}>
                <IconEdit className="h-4 w-4 mr-2" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onDuplicate?.(recording)}>
                <IconCopy className="h-4 w-4 mr-2" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {recording.archivedAt ? (
                <DropdownMenuItem onSelect={() => onArchive?.(recording)}>
                  <IconCheck className="h-4 w-4 mr-2" /> Unarchive
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => onArchive?.(recording)}>
                  <IconArchive className="h-4 w-4 mr-2" /> Archive
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() => onTrash?.(recording)}
                className="text-destructive focus:text-destructive"
              >
                <IconTrash className="h-4 w-4 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          <Avatar className="h-5 w-5">
            <AvatarImage src="" alt={recording.ownerEmail} />
            <AvatarFallback className="text-[9px] bg-primary/15 text-primary">
              {ownerInitials}
            </AvatarFallback>
          </Avatar>
          <span className="text-xs text-muted-foreground truncate">
            {recording.ownerEmail}
          </span>
          {recording.tags.length > 0 && (
            <div className="ml-auto flex items-center gap-1 truncate">
              {recording.tags.slice(0, 2).map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-primary/10 text-primary text-[10px] px-1.5 py-0.5"
                >
                  {t}
                </span>
              ))}
              {recording.tags.length > 2 && (
                <span className="text-[10px] text-muted-foreground">
                  +{recording.tags.length - 2}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
