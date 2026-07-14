import { useT } from "@agent-native/core/client";
import {
  IconPlayerPlay,
  IconPlayerPause,
  IconPlayerSkipForward,
  IconVolume,
  IconVolumeOff,
  IconMaximize,
  IconPictureInPicture,
  IconSubtitles,
  IconRectangle,
} from "@tabler/icons-react";
import { useState, type FocusEvent } from "react";

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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PLAYBACK_SPEED_OPTIONS } from "@/lib/playback-speed";
import { cn } from "@/lib/utils";

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
  comments?: { id: string; videoTimestampMs: number; content: string }[];
  chapters?: { startMs: number; title: string }[];
  reactions?: { id: string; emoji: string; videoTimestampMs: number }[];
  excludedRanges?: { startMs: number; endMs: number }[];
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
    excludedRanges,
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
        excludedRanges={excludedRanges}
      />

      <div className="flex min-w-0 items-center gap-1.5 text-white">
        <IconBtn
          onClick={onPlayPause}
          tooltip={isPlaying ? "Pause (K)" : "Play (K)"}
          ariaLabel={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <IconPlayerPause className="h-5 w-5" />
          ) : (
            <IconPlayerPlay className="h-5 w-5" />
          )}
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
              <button
                data-player-ui
                type="button"
                onClick={onToggleMute}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white hover:bg-white/10"
                aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
              >
                {muted || volume === 0 ? (
                  <IconVolumeOff className="h-5 w-5" />
                ) : (
                  <IconVolume className="h-5 w-5" />
                )}
              </button>
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
                <input
                  aria-label="Volume"
                  aria-orientation="vertical"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                  className="h-2 w-24 -rotate-90 cursor-pointer accent-white"
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
              <IconSubtitles className="h-5 w-5" />
            </IconBtn>
          </div>
        ) : null}

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  data-player-ui
                  className="h-8 shrink-0 rounded-md px-2 text-xs font-medium tabular-nums hover:bg-white/10"
                >
                  {speed}x
                </button>
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
            <IconPictureInPicture className="h-5 w-5" />
          </IconBtn>
        </div>

        {onToggleTheater ? (
          <div className="hidden sm:block">
            <IconBtn
              onClick={onToggleTheater}
              active={theaterMode}
              tooltip="Theater mode (T)"
            >
              <IconRectangle className="h-5 w-5" />
            </IconBtn>
          </div>
        ) : null}

        <IconBtn onClick={onToggleFullscreen} tooltip="Fullscreen (F)">
          <IconMaximize
            className={cn("h-5 w-5", isFullscreen && "rotate-180")}
          />
        </IconBtn>
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
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tooltip?: string;
  ariaLabel?: string;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          data-player-ui
          onClick={onClick}
          aria-label={ariaLabel ?? tooltip}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
            active ? "bg-white/20 text-white" : "text-white hover:bg-white/10",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function SkipIcon({ direction }: { direction: "back" | "forward" }) {
  return (
    <span className="relative flex h-5 w-5 items-center justify-center">
      <IconPlayerSkipForward
        className={cn("h-5 w-5", direction === "back" && "rotate-180")}
      />
      <span className="absolute text-[7px] font-bold leading-none">5</span>
    </span>
  );
}
