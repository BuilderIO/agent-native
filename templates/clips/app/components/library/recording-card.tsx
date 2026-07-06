import { useFormatters, useT } from "@agent-native/core/client";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@agent-native/toolkit/ui/avatar";
import { Checkbox } from "@agent-native/toolkit/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
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
  IconCheck,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { isDefaultTitle } from "@/hooks/use-auto-title";
import type { RecordingSummary } from "@/hooks/use-library";
import { isStaleRecordingUpload } from "@/lib/recording-status";
import { isStorageSetupFailureReason } from "@/lib/storage-failures";
import { cn } from "@/lib/utils";

import type { BulkMoveTarget } from "./bulk-action-toolbar";

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
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
  onMove?: (rec: RecordingSummary, folderId: string | null) => void;
  moveTargets?: BulkMoveTarget[];
  isMovePending?: boolean;
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
  moveTargets = [],
  isMovePending = false,
  onArchive,
  onTrash,
}: RecordingCardProps) {
  const navigate = useNavigate();
  const t = useT();
  const { formatDate, formatRelativeTime } = useFormatters();
  const [hovered, setHovered] = useState(false);

  const duration = useMemo(
    () => formatDuration(recording.durationMs),
    [recording.durationMs],
  );
  const relative = useMemo(() => {
    const date = new Date(recording.createdAt);
    const diff = (date.getTime() - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 60) return formatRelativeTime(Math.round(diff), "second");
    if (abs < 3600) return formatRelativeTime(Math.round(diff / 60), "minute");
    if (abs < 86400) return formatRelativeTime(Math.round(diff / 3600), "hour");
    if (abs < 604800)
      return formatRelativeTime(Math.round(diff / 86400), "day");
    return formatDate(date);
  }, [formatDate, formatRelativeTime, recording.createdAt]);
  const waitingForStorage = isStorageSetupFailureReason(
    recording.failureReason,
  );
  const staleUpload = isStaleRecordingUpload(recording);
  const displayFailed = recording.status === "failed" || staleUpload;
  const failureReason = staleUpload
    ? (recording.failureReason ??
      t("recordingPage.processingStuck", { status: recording.status }))
    : (recording.failureReason ?? t("clipsFinalRaw.removeFailedClip"));
  const nativeUploadPaused =
    recording.status === "failed" &&
    /native recording|native fullscreen|screencapture|avconvert/i.test(
      recording.failureReason ?? "",
    );
  const canMove = Boolean(onMove && moveTargets.length > 0);
  const hasDefaultTitle = isDefaultTitle(recording.title);
  const displayTitle = hasDefaultTitle
    ? t("editableTitle.untitled")
    : recording.title;

  const displayThumbnail = useMemo(() => {
    if (hovered && recording.animatedThumbnailUrl)
      return recording.animatedThumbnailUrl;
    return recording.thumbnailUrl;
  }, [hovered, recording.animatedThumbnailUrl, recording.thumbnailUrl]);

  const ownerInitials = useMemo(() => {
    const [local] = recording.ownerEmail.split("@");
    return (local || "?").slice(0, 2).toUpperCase();
  }, [recording.ownerEmail]);

  const recordingPath = `/r/${recording.id}`;

  const handleOpen = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const shouldOpenNewTab =
        event.button === 1 ||
        (event.button === 0 && (event.metaKey || event.ctrlKey));

      if (shouldOpenNewTab) {
        event.preventDefault();
        event.stopPropagation();
        window.open(recordingPath, "_blank", "noopener,noreferrer");
        return;
      }

      if (selectionMode) {
        onToggleSelect?.(recording.id);
      } else {
        navigate(recordingPath);
      }
    },
    [navigate, onToggleSelect, recording.id, recordingPath, selectionMode],
  );

  const handleCheckbox = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleSelect?.(recording.id);
    },
    [onToggleSelect, recording.id],
  );

  const handleRemoveFailed = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onTrash?.(recording);
    },
    [onTrash, recording],
  );

  return (
    <div
      role="article"
      onClick={handleOpen}
      onAuxClick={handleOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "group relative flex flex-col rounded-lg border bg-card overflow-hidden cursor-pointer",
        "border-border/80 hover:border-primary/40",
        "shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-md",
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
        <div className="absolute bottom-2 end-2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
          {duration}
        </div>

        {/* Selection checkbox */}
        {(selectionMode || hovered || selected) && (
          <div
            onClick={handleCheckbox}
            className="absolute top-2 start-2 flex h-5 w-5 items-center justify-center rounded bg-background/90 border border-border"
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
          <div className="absolute top-2 end-2 rounded-full bg-black/80 px-2 py-0.5 text-[10px] font-medium text-white uppercase tracking-wide">
            {waitingForStorage
              ? "storage"
              : staleUpload
                ? "failed"
                : recording.status}
          </div>
        )}

        {(displayFailed || waitingForStorage) && (
          <div
            className={cn(
              "absolute inset-x-2 bottom-2 rounded-md border bg-background/95 p-2 text-start shadow-sm backdrop-blur",
              waitingForStorage ? "border-primary/30" : "border-destructive/30",
            )}
          >
            <div className="flex items-start gap-2">
              <IconAlertTriangle
                className={cn(
                  "mt-0.5 h-3.5 w-3.5 shrink-0",
                  waitingForStorage ? "text-primary" : "text-destructive",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium text-foreground">
                  {waitingForStorage
                    ? t("clipsFinalRaw.waitingForStorage")
                    : nativeUploadPaused
                      ? t("clipsFinalRaw.savedLocally")
                      : t("clipsFinalRaw.uploadFailed")}
                </div>
                <div className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                  {waitingForStorage
                    ? t("clipsFinalRaw.connectStorageToFinish")
                    : nativeUploadPaused
                      ? t("clipsFinalRaw.retryFromClipsMenu")
                      : failureReason}
                </div>
              </div>
              {!waitingForStorage && (
                <button
                  type="button"
                  onClick={handleRemoveFailed}
                  className="rounded border border-border px-1.5 py-0.5 text-[10px] text-foreground hover:bg-accent"
                >
                  {t("clipsFinalRaw.remove")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 p-3 space-y-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {hasDefaultTitle ? (
              <Skeleton
                aria-label={t("editableTitle.generatingTitle")}
                className="h-3.5 w-3/4"
              />
            ) : (
              <div className="min-w-0 truncate select-none text-sm font-medium text-foreground">
                {displayTitle}
              </div>
            )}
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <PrivacyIcon
                visibility={recording.visibility}
                className="shrink-0"
              />
              <span className="capitalize">{recording.visibility}</span>
              <span>•</span>
              <span>
                {t("clipsFinalRaw.viewsCount", {
                  count: recording.viewCount,
                })}
              </span>
              <span>•</span>
              <span>{relative}</span>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={t("clipsFinalRaw.recordingMenu")}
              >
                <IconDots className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem onSelect={() => onShare?.(recording)}>
                <IconShare className="h-4 w-4 me-2" />{" "}
                {t("recordingPage.share")}
              </DropdownMenuItem>
              {canMove ? (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <IconFolder className="h-4 w-4 me-2" />{" "}
                    {t("clipsFinalRaw.moveToFolder")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-64">
                    {moveTargets.map((target, index) => (
                      <DropdownMenuItem
                        key={target.id ?? `root-${index}`}
                        disabled={target.disabled || isMovePending}
                        onSelect={() => onMove?.(recording, target.id)}
                      >
                        <span
                          className="truncate"
                          style={{
                            paddingInlineStart: (target.depth ?? 0) * 12,
                          }}
                        >
                          {target.name}
                        </span>
                        {target.disabled && (
                          <span className="ms-auto text-xs text-muted-foreground">
                            {t("clipsFinalRaw.current")}
                          </span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : null}
              <DropdownMenuSeparator />
              {recording.archivedAt ? (
                <DropdownMenuItem onSelect={() => onArchive?.(recording)}>
                  <IconCheck className="h-4 w-4 me-2" />{" "}
                  {t("clipsFinalRaw.unarchive")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => onArchive?.(recording)}>
                  <IconArchive className="h-4 w-4 me-2" />{" "}
                  {t("navigation.archive")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() => onTrash?.(recording)}
                className="text-destructive focus:text-destructive"
              >
                <IconTrash className="h-4 w-4 me-2" /> {t("folderTree.delete")}
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
            <div className="ms-auto flex items-center gap-1 truncate">
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
