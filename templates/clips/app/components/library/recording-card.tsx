import { useFeatureFlag } from "@agent-native/core/client/feature-flags";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { UPLOAD_RETRY_RESUME_FLAG } from "@shared/feature-flags";
import { isRetryableUploadInterruption } from "@shared/upload-interruption";
import {
  IconDotsVertical,
  IconLock,
  IconWorld,
  IconUsersGroup,
  IconPlayerPlay,
  IconShare,
  IconFolder,
  IconFolderPlus,
  IconArchive,
  IconTrash,
  IconCheck,
  IconAlertTriangle,
  IconExternalLink,
  IconRefresh,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { ClipsAvatar } from "@/components/clips-avatar";
import { AgentViewCount } from "@/components/player/recording-views-badge";
import { ViewedByPopover } from "@/components/sharing/viewed-by-popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { isDefaultTitle } from "@/hooks/use-auto-title";
import type { RecordingSummary } from "@/hooks/use-library";
import { attemptOpenDesktopApp } from "@/lib/capture-install-options";
import {
  hasRecordingBackup,
  subscribeToRecordingBackupChanges,
} from "@/lib/recording-backup";
import {
  isAtRiskRecordingUpload,
  isStaleRecordingUpload,
} from "@/lib/recording-status";
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
  onToggleSelect?: (id: string, shiftKey: boolean) => void;
  onShare?: (rec: RecordingSummary) => void;
  onMove?: (rec: RecordingSummary, folderId: string | null) => void;
  moveTargets?: BulkMoveTarget[];
  isMovePending?: boolean;
  onCreateFolder?: () => void;
  onArchive?: (rec: RecordingSummary) => void;
  onTrash?: (rec: RecordingSummary) => void;
  onRetry?: (rec: RecordingSummary) => Promise<void>;
  readOnly?: boolean;
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
  onCreateFolder,
  onArchive,
  onTrash,
  onRetry,
  readOnly = false,
}: RecordingCardProps) {
  const t = useT();
  const formatters = useFormatters();
  const uploadRetryEnabled = useFeatureFlag(UPLOAD_RETRY_RESUME_FLAG.key);
  const formatDate = (date: Date) => formatters.formatDate(date);
  const formatRelativeTime = (
    value: number,
    unit: Parameters<typeof formatters.formatRelativeTime>[1],
  ) => formatters.formatRelativeTime(value, unit);
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hasBackup, setHasBackup] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const pendingTrashRef = useRef(false);

  const duration = useMemo(
    () => formatDuration(recording.effectiveDurationMs),
    [recording.effectiveDurationMs],
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
  const atRiskUpload = isAtRiskRecordingUpload(recording);
  const displayFailed = recording.status === "failed" || staleUpload;
  const showPlaybackChrome = !displayFailed && !waitingForStorage;
  const failureReason = staleUpload
    ? (recording.failureReason ??
      t("recordingPage.processingStuck", { status: recording.status }))
    : (recording.failureReason ?? t("clipsFinalRaw.removeFailedClip"));
  const nativeUploadPaused =
    recording.status === "failed" &&
    /native recording|native fullscreen|screencapture|avconvert/i.test(
      recording.failureReason ?? "",
    );
  const retryableStatus =
    (recording.status === "failed" &&
      isRetryableUploadInterruption(recording.failureReason)) ||
    (recording.status === "uploading" && staleUpload);
  const canRetry =
    uploadRetryEnabled &&
    Boolean(onRetry) &&
    retryableStatus &&
    !nativeUploadPaused;

  useEffect(() => {
    if (!canRetry) {
      setHasBackup(false);
      return;
    }
    let cancelled = false;
    const checkForBackup = () => {
      void hasRecordingBackup(recording.id).then((found) => {
        if (!cancelled) setHasBackup(found);
      });
    };
    const unsubscribe = subscribeToRecordingBackupChanges(
      recording.id,
      checkForBackup,
    );
    checkForBackup();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [canRetry, recording.id]);

  const handleRetry = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!onRetry || isRetrying) return;
      setIsRetrying(true);
      try {
        await onRetry(recording);
      } finally {
        setIsRetrying(false);
      }
    },
    [isRetrying, onRetry, recording],
  );
  const canMove = Boolean(onMove && moveTargets.length > 0);
  const canSelect = Boolean(onToggleSelect) && !readOnly;
  const showActions = Boolean(onShare || onMove || onArchive || onTrash);
  const hasDefaultTitle = isDefaultTitle(recording.title);
  const displayTitle = hasDefaultTitle
    ? t("editableTitle.untitled")
    : recording.title;
  const displayOwnerName = recording.ownerName?.trim() || recording.ownerEmail;
  const visibilityLabel = t(`shareUi.visibility.${recording.visibility}.label`);

  const displayThumbnail = useMemo(() => {
    if (hovered && recording.animatedThumbnailUrl)
      return recording.animatedThumbnailUrl;
    return recording.thumbnailUrl;
  }, [hovered, recording.animatedThumbnailUrl, recording.thumbnailUrl]);

  const ownerInitials = useMemo(() => {
    const words = displayOwnerName.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      return `${words[0]?.[0] ?? ""}${words[words.length - 1]?.[0] ?? ""}`.toUpperCase();
    }
    return (words[0] || "?").slice(0, 2).toUpperCase();
  }, [displayOwnerName]);

  const recordingPath = `/r/${recording.id}`;

  const handleLinkClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (
        !onToggleSelect ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (!selectionMode && !event.shiftKey)
      ) {
        return;
      }

      event.preventDefault();
      onToggleSelect(recording.id, event.shiftKey);
    },
    [onToggleSelect, recording.id, selectionMode],
  );

  const handleCheckbox = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleSelect?.(recording.id, e.shiftKey);
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

  const handleOpenDesktopApp = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    attemptOpenDesktopApp();
  }, []);

  const requestTrash = useCallback(() => {
    pendingTrashRef.current = true;
    setMenuOpen(false);
  }, []);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="article"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className={cn(
            "group relative flex flex-col rounded-lg border bg-card overflow-hidden cursor-pointer",
            "border-border/80 hover:border-primary/40",
            "shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-md",
            selected && "border-primary ring-2 ring-primary/30",
          )}
        >
          <Link
            to={recordingPath}
            aria-label={displayTitle}
            onClick={handleLinkClick}
            className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
          />

          {/* Thumbnail */}
          <div className="relative z-10 aspect-video overflow-hidden bg-muted pointer-events-none">
            {displayThumbnail ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <img
                src={displayThumbnail}
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/10 to-primary/5">
                {showPlaybackChrome && (
                  <IconPlayerPlay className="h-10 w-10 text-primary/40" />
                )}
              </div>
            )}

            {/* Play overlay on hover */}
            {showPlaybackChrome && (
              <div
                className={cn(
                  "absolute inset-0 flex items-center justify-center bg-foreground/0 group-hover:bg-foreground/15",
                  "opacity-0 group-hover:opacity-100",
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-background/95 text-primary shadow-lg">
                  <IconPlayerPlay className="h-5 w-5 fill-current" />
                </div>
              </div>
            )}

            {/* Duration badge */}
            {showPlaybackChrome && (
              <div className="absolute bottom-2 end-2 rounded bg-foreground/80 px-1.5 py-0.5 text-[11px] font-medium text-background tabular-nums">
                {duration}
              </div>
            )}

            {/* Selection checkbox */}
            {canSelect && (
              <Checkbox
                checked={selected}
                onClick={handleCheckbox}
                className={cn(
                  "pointer-events-auto absolute start-2 top-2 z-20 size-5 rounded border-background/80 bg-foreground/25 text-background opacity-70 shadow-sm backdrop-blur-sm transition-[background-color,border-color,opacity] hover:bg-foreground/45 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
                  (selectionMode || selected) && "opacity-100",
                  selected &&
                    "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
                )}
              />
            )}

            {/* Status pill for non-ready recordings */}
            {recording.status !== "ready" &&
              !displayFailed &&
              !waitingForStorage && (
                <div className="absolute top-2 end-2 rounded-full bg-foreground/80 px-2 py-0.5 text-[10px] font-medium text-background uppercase tracking-wide">
                  {atRiskUpload
                    ? t("clipsFinalRaw.statusStalled")
                    : recording.status}
                </div>
              )}

            {!displayFailed && !waitingForStorage && atRiskUpload && (
              <div className="absolute inset-x-2 bottom-2 rounded-md border border-amber-500/30 bg-background/95 p-2 text-start shadow-sm backdrop-blur">
                <div className="flex items-start gap-2">
                  <IconAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium text-foreground">
                      {t("clipsFinalRaw.uploadAtRisk")}
                    </div>
                    <div className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                      {t("clipsFinalRaw.uploadAtRiskDetail")}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {(displayFailed || waitingForStorage) && (
              <div
                className={cn(
                  "absolute inset-x-2 bottom-2 rounded-md border bg-background/95 p-2.5 text-start shadow-sm backdrop-blur",
                  waitingForStorage
                    ? "border-primary/30"
                    : "border-destructive/30",
                )}
              >
                <div className="flex items-center gap-2">
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
                    <div className="truncate text-[10px] leading-snug text-muted-foreground">
                      {waitingForStorage
                        ? t("clipsFinalRaw.connectStorageToFinish")
                        : nativeUploadPaused
                          ? t("clipsFinalRaw.retryFromClipsMenu")
                          : failureReason}
                    </div>
                    {nativeUploadPaused ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleOpenDesktopApp}
                        className="pointer-events-auto mt-1.5 h-7 shrink-0 gap-1 px-2 text-[10px] font-medium"
                      >
                        <IconExternalLink className="h-3 w-3" />
                        {t("captureInstall.openDesktopApp")}
                      </Button>
                    ) : canRetry && hasBackup ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleRetry}
                        disabled={isRetrying}
                        className="pointer-events-auto mt-1.5 h-7 shrink-0 gap-1 px-2 text-[10px] font-medium"
                      >
                        <IconRefresh
                          className={cn(
                            "h-3 w-3",
                            isRetrying && "animate-spin",
                          )}
                        />
                        {isRetrying
                          ? t("clipsFinalRaw.retrying")
                          : t("clipsFinalRaw.retry")}
                      </Button>
                    ) : canRetry ? (
                      <div className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                        {t("clipsFinalRaw.retryUnavailableHere")}
                      </div>
                    ) : null}
                  </div>
                  {!waitingForStorage && onTrash && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleRemoveFailed}
                      className="pointer-events-auto h-7 shrink-0 px-2 text-[10px] font-medium"
                    >
                      {t("clipsFinalRaw.remove")}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Body */}
          <div className="relative z-10 flex flex-1 flex-col gap-2 p-4 pointer-events-none">
            <div className="flex items-start gap-3">
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
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <ClipsAvatar
                      email={recording.ownerEmail}
                      alt={displayOwnerName}
                      fallback={ownerInitials}
                      className="h-4 w-4 shrink-0"
                      fallbackClassName="bg-primary/15 text-[8px] text-primary"
                    />
                    <span className="min-w-0 truncate">{displayOwnerName}</span>
                  </span>
                  <span aria-hidden className="text-muted-foreground/60">
                    •
                  </span>
                  <time dateTime={recording.createdAt} className="shrink-0">
                    {relative}
                  </time>
                </div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <PrivacyIcon
                      visibility={recording.visibility}
                      className="shrink-0"
                    />
                    <span>{visibilityLabel}</span>
                  </span>
                  <span aria-hidden className="text-muted-foreground/60">
                    •
                  </span>
                  {recording.viewCount > 0 && !readOnly ? (
                    <ViewedByPopover
                      recordingId={recording.id}
                      className="pointer-events-auto underline-offset-2 hover:underline hover:text-foreground"
                    >
                      {t("clipsFinalRaw.viewsCount", {
                        count: recording.viewCount,
                      })}
                    </ViewedByPopover>
                  ) : (
                    <span>
                      {t("clipsFinalRaw.viewsCount", {
                        count: recording.viewCount,
                      })}
                    </span>
                  )}
                  {recording.agentViewCount > 0 ? (
                    <AgentViewCount
                      count={recording.agentViewCount}
                      label={t("recordingInsights.agentViewsCount", {
                        count: recording.agentViewCount,
                      })}
                    />
                  ) : null}
                </div>
              </div>

              {showActions && (
                <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                  <DropdownMenuTrigger
                    asChild
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="pointer-events-auto order-last h-8 w-8 shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={t("clipsFinalRaw.recordingMenu")}
                    >
                      <IconDotsVertical className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    onClick={(e) => e.stopPropagation()}
                    onCloseAutoFocus={(event) => {
                      if (!pendingTrashRef.current) return;
                      event.preventDefault();
                      pendingTrashRef.current = false;
                      setTimeout(() => onTrash?.(recording), 0);
                    }}
                  >
                    {onShare && (
                      <DropdownMenuItem onSelect={() => onShare(recording)}>
                        <IconShare className="h-4 w-4 me-2" />{" "}
                        {t("recordingPage.share")}
                      </DropdownMenuItem>
                    )}
                    {canMove ? (
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <IconFolder className="h-4 w-4 me-2" />{" "}
                          {t("clipsFinalRaw.moveToFolder")}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-64">
                          <DropdownMenuItem
                            disabled={isMovePending}
                            onSelect={() => {
                              setTimeout(() => onCreateFolder?.(), 0);
                            }}
                          >
                            <IconFolderPlus className="h-4 w-4 me-2" />
                            {t("navigation.newFolder")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
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
                    {(onArchive || onTrash) && <DropdownMenuSeparator />}
                    {onArchive &&
                      (recording.archivedAt ? (
                        <DropdownMenuItem onSelect={() => onArchive(recording)}>
                          <IconCheck className="h-4 w-4 me-2" />{" "}
                          {t("clipsFinalRaw.unarchive")}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => onArchive(recording)}>
                          <IconArchive className="h-4 w-4 me-2" />{" "}
                          {t("navigation.archive")}
                        </DropdownMenuItem>
                      ))}
                    {onTrash && (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault();
                          requestTrash();
                        }}
                        className="text-destructive focus:text-destructive"
                      >
                        <IconTrash className="h-4 w-4 me-2" />{" "}
                        {t("navigation.trash")}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {recording.tags.length > 0 && (
              <div className="flex items-center gap-1 truncate">
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
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem asChild>
          <Link to={recordingPath}>
            <IconPlayerPlay className="h-4 w-4 me-2" />
            {t("clipsFinalRaw.view")}
          </Link>
        </ContextMenuItem>
        {onShare && (
          <ContextMenuItem onSelect={() => onShare(recording)}>
            <IconShare className="h-4 w-4 me-2" />
            {t("recordingPage.share")}
          </ContextMenuItem>
        )}
        {canMove ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <IconFolder className="h-4 w-4 me-2" />
              {t("clipsFinalRaw.moveToFolder")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-64">
              <ContextMenuItem
                disabled={isMovePending}
                onSelect={() => {
                  setTimeout(() => onCreateFolder?.(), 0);
                }}
              >
                <IconFolderPlus className="h-4 w-4 me-2" />
                {t("navigation.newFolder")}
              </ContextMenuItem>
              <ContextMenuSeparator />
              {moveTargets.map((target, index) => (
                <ContextMenuItem
                  key={target.id ?? `context-root-${index}`}
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
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : null}
        {(onArchive || onTrash) && <ContextMenuSeparator />}
        {onArchive &&
          (recording.archivedAt ? (
            <ContextMenuItem onSelect={() => onArchive(recording)}>
              <IconCheck className="h-4 w-4 me-2" />
              {t("clipsFinalRaw.unarchive")}
            </ContextMenuItem>
          ) : (
            <ContextMenuItem onSelect={() => onArchive(recording)}>
              <IconArchive className="h-4 w-4 me-2" />
              {t("navigation.archive")}
            </ContextMenuItem>
          ))}
        {onTrash && (
          <ContextMenuItem
            onSelect={() => {
              setTimeout(() => onTrash(recording), 0);
            }}
            className="text-destructive focus:text-destructive"
          >
            <IconTrash className="h-4 w-4 me-2" />
            {t("navigation.trash")}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
