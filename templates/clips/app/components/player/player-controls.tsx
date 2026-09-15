import { useT } from "@agent-native/core/client/i18n";
import {
  IconPlayerPlayFilled,
  IconPlayerPauseFilled,
  IconPlayerSkipForward,
  IconVolume,
  IconVolumeOff,
  IconMaximize,
  IconMessagePlus,
  IconPictureInPicture,
  IconSubtitles,
  IconRectangle,
} from "@tabler/icons-react";
import { useState, type FocusEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PLAYBACK_SPEED_OPTIONS } from "@/lib/playback-speed";
import { cn } from "@/lib/utils";

import type { CommentPreviewData } from "./playback-comment-overlay";
import { ReactionsTray, type ReactionHandler } from "./reactions-tray";
import { Scrubber, msToClock } from "./scrubber";

export const SPEED_OPTIONS = PLAYBACK_SPEED_OPTIONS;
export const PLAYER_SEEK_STEP_MS = 5_000;

export interface PlayerControlsProps {
  isPlaying: boolean;
  durationMs: number;
  currentMs: number;
  volume: number;
  muted: boolean;
  speed: number;
  captionsOn: boolean;
  hasCaptions: boolean;
  isFullscreen: boolean;
  isPip: boolean;
  theaterMode: boolean;
  comments?: (CommentPreviewData & {
    videoTimestampMs: number;
  })[];
  chapters?: { startMs: number; title: string }[];
  reactions?: { id: string; emoji: string; videoTimestampMs: number }[];
  onMarkerLanesChange?: (lanes: Map<number, number>) => void;
  onPlayPause: () => void;
  onSeek: (ms: number) => void;
  onSeekRelative: (deltaMs: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onSpeedChange: (rate: number) => void;
  onToggleCaptions: () => void;
  onTogglePip: () => void;
  onToggleFullscreen: () => void;
  onToggleTheater?: () => void;
  menuPortalContainer?: HTMLElement | null;
  /**
   * Surfaces the reaction tray and a comment-composer trigger inline in this
   * bar (Loom-style), for contexts — namely fullscreen — where the caller's
   * own reaction/comment row would otherwise be hidden.
   */
  showReactionsAndComment?: boolean;
  enableReactions?: boolean;
  onReact?: ReactionHandler;
  enableComments?: boolean;
  onAddComment?: () => void;
}

export function PlayerControls(props: PlayerControlsProps) {
  const t = useT();
  const {
    isPlaying,
    durationMs,
    currentMs,
    volume,
    muted,
    speed,
    captionsOn,
    hasCaptions,
    isFullscreen,
    isPip,
    theaterMode,
    comments,
    chapters,
    reactions,
    onMarkerLanesChange,
    onPlayPause,
    onSeek,
    onSeekRelative,
    onVolumeChange,
    onToggleMute,
    onSpeedChange,
    onToggleCaptions,
    onTogglePip,
    onToggleFullscreen,
    onToggleTheater,
    menuPortalContainer,
    showReactionsAndComment,
    enableReactions,
    onReact,
    enableComments,
    onAddComment,
  } = props;

  const [volumePopoverOpen, setVolumePopoverOpen] = useState(false);

  const handleVolumeBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocusedElement = event.relatedTarget as Node | null;
    if (!event.currentTarget.contains(nextFocusedElement)) {
      setVolumePopoverOpen(false);
    }
  };

  return (
    <div className="px-3 pb-2 pt-10 bg-gradient-to-t from-black/80 via-black/50 to-transparent">
      <Scrubber
        currentMs={currentMs}
        durationMs={durationMs}
        onSeek={onSeek}
        comments={comments}
        chapters={chapters}
        reactions={reactions}
        onMarkerLanesChange={onMarkerLanesChange}
      />

      {/* guard:allow-raw-color -- video controls overlay the dark player scrim itself, not themed app chrome, so text stays white regardless of light/dark mode */}
      <div className="relative flex min-w-0 items-center gap-1.5 text-white">
        <IconBtn
          onClick={onPlayPause}
          tooltip={isPlaying ? "Pause (K)" : "Play (K)"}
          ariaLabel={isPlaying ? "Pause" : "Play"}
          className="size-10 [&_svg]:size-5"
        >
          {isPlaying ? <IconPlayerPauseFilled /> : <IconPlayerPlayFilled />}
        </IconBtn>

        <IconBtn
          onClick={() => onSeekRelative(-PLAYER_SEEK_STEP_MS)}
          tooltip="Back 5 seconds"
          ariaLabel="Back 5 seconds"
        >
          <SkipIcon direction="back" />
        </IconBtn>

        <IconBtn
          onClick={() => onSeekRelative(PLAYER_SEEK_STEP_MS)}
          tooltip="Forward 5 seconds"
          ariaLabel="Forward 5 seconds"
        >
          <SkipIcon direction="forward" />
        </IconBtn>

        <div
          data-player-ui
          className="relative flex shrink-0 items-center"
          onMouseEnter={() => setVolumePopoverOpen(true)}
          onMouseLeave={() => setVolumePopoverOpen(false)}
          onFocus={() => setVolumePopoverOpen(true)}
          onBlur={handleVolumeBlur}
        >
          <Popover open={volumePopoverOpen} onOpenChange={setVolumePopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                data-player-ui
                type="button"
                variant="ghost"
                size="icon"
                onClick={onToggleMute}
                className="text-player-control-foreground hover:bg-player-control-foreground/10 hover:text-player-control-foreground size-8 shrink-0"
                aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
              >
                {muted || volume === 0 ? <IconVolumeOff /> : <IconVolume />}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              data-player-ui
              side="top"
              align="center"
              sideOffset={8}
              portalled={false}
              className="w-auto border-white/10 bg-black/90 p-2 text-white shadow-2xl backdrop-blur-md"
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <div className="flex h-24 w-8 items-center justify-center">
                <Slider
                  aria-label="Volume"
                  orientation="vertical"
                  min={0}
                  max={1}
                  step={0.05}
                  value={[muted ? 0 : volume]}
                  onValueChange={([value]) => onVolumeChange(value ?? 0)}
                  className="h-24 w-2 [&_[data-orientation=vertical]]:h-full [&_[data-orientation=vertical]]:w-1.5 [&_[role=slider]]:size-3.5"
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <span className="shrink-0 whitespace-nowrap px-1 font-mono text-[10px] leading-none tabular-nums text-white/85 sm:text-[11px]">
          {msToClock(currentMs)}
          <span className="text-white/50">/{msToClock(durationMs)}</span>
        </span>

        <div className="flex-1" />

        {hasCaptions ? (
          <div className="hidden sm:block">
            <IconBtn
              onClick={onToggleCaptions}
              active={captionsOn}
              tooltip="Captions (C)"
            >
              <IconSubtitles />
            </IconBtn>
          </div>
        ) : null}

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  data-player-ui
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-player-control-foreground hover:bg-player-control-foreground/10 hover:text-player-control-foreground h-8 shrink-0 rounded-md px-2 text-xs font-medium tabular-nums"
                >
                  {speed}x
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t("playerControls.playbackSpeed")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            data-player-ui
            align="end"
            side="top"
            className="min-w-[90px]"
            container={menuPortalContainer}
          >
            <DropdownMenuLabel>Speed</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {SPEED_OPTIONS.map((rate) => (
              <DropdownMenuItem
                key={rate}
                onSelect={() => onSpeedChange(rate)}
                className={cn(
                  "tabular-nums",
                  rate === speed && "bg-accent font-semibold",
                )}
              >
                {rate}x
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="hidden sm:block">
          <IconBtn
            onClick={onTogglePip}
            active={isPip}
            tooltip="Picture in picture"
          >
            <IconPictureInPicture />
          </IconBtn>
        </div>

        {onToggleTheater ? (
          <div className="hidden sm:block">
            <IconBtn
              onClick={onToggleTheater}
              active={theaterMode}
              tooltip="Theater mode (T)"
            >
              <IconRectangle />
            </IconBtn>
          </div>
        ) : null}

        <IconBtn onClick={onToggleFullscreen} tooltip="Fullscreen (F)">
          <IconMaximize className={cn(isFullscreen && "rotate-180")} />
        </IconBtn>

        {showReactionsAndComment ? (
          <div
            data-player-ui
            className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center justify-center gap-2"
          >
            {enableReactions && onReact ? (
              <div className="pointer-events-auto">
                <ReactionsTray reactions={reactions} onReact={onReact} />
              </div>
            ) : null}

            {enableComments && onAddComment ? (
              <div className="pointer-events-auto">
                <IconBtn
                  onClick={onAddComment}
                  tooltip={t("commentsPanel.commentButton")}
                >
                  <IconMessagePlus />
                </IconBtn>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  tooltip,
  ariaLabel,
  active,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tooltip?: string;
  ariaLabel?: string;
  active?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          data-player-ui
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClick}
          aria-label={ariaLabel ?? tooltip}
          className={cn(
            "size-8 shrink-0",
            active
              ? "bg-player-control-foreground/20 text-player-control-foreground hover:bg-player-control-foreground/25 hover:text-player-control-foreground"
              : "text-player-control-foreground hover:bg-player-control-foreground/10 hover:text-player-control-foreground",
            className,
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function SkipIcon({ direction }: { direction: "back" | "forward" }) {
  return (
    <IconPlayerSkipForward
      className={cn(direction === "back" && "rotate-180")}
    />
  );
}
