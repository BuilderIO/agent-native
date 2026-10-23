// Copied from Clips' `app/components/player/player-controls.tsx` until the
// player moves to a shared package. Content docks the controls under the
// video and leaves out captions, picture in picture, theater mode, reactions
// and the comment button.
import { useT } from "@agent-native/core/client/i18n";
import type { ClipCommentMarker } from "@shared/clips-peer-contract";
import {
  IconMaximize,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipForward,
  IconVolume,
  IconVolumeOff,
} from "@tabler/icons-react";
import { useCallback, useState, type FocusEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
import { cn } from "@/lib/utils";

import { Scrubber, msToClock } from "./scrubber";

export const SPEED_OPTIONS = [0.5, 0.8, 1, 1.2, 1.5, 1.7, 2, 2.5];
export const PLAYER_SEEK_STEP_MS = 5_000;

export interface PlayerControlsProps {
  isPlaying: boolean;
  durationMs: number;
  currentMs: number;
  volume: number;
  muted: boolean;
  speed: number;
  isFullscreen: boolean;
  comments?: ClipCommentMarker[];
  onPlayPause: () => void;
  onSeek: (ms: number) => void;
  onSeekRelative: (deltaMs: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onSpeedChange: (rate: number) => void;
  onToggleFullscreen: () => void;
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
    isFullscreen,
    comments,
    onPlayPause,
    onSeek,
    onSeekRelative,
    onVolumeChange,
    onToggleMute,
    onSpeedChange,
    onToggleFullscreen,
    menuPortalContainer,
  } = props;

  const [volumePopoverOpen, setVolumePopoverOpen] = useState(false);
  // The controls must hold the markers that rise above the scrubber, so
  // none of them reach up over the video.
  const [markerLaneCount, setMarkerLaneCount] = useState(0);
  const handleMarkerLanes = useCallback((lanes: Map<number, number>) => {
    setMarkerLaneCount(lanes.size ? Math.max(...lanes.values()) + 1 : 0);
  }, []);

  const handleVolumeBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocusedElement = event.relatedTarget as Node | null;
    if (!event.currentTarget.contains(nextFocusedElement)) {
      setVolumePopoverOpen(false);
    }
  };

  const silent = muted || volume === 0;

  return (
    <div
      className={cn(
        "bg-player-control px-3 pb-2",
        markerLaneCount === 0
          ? "pt-2"
          : markerLaneCount === 1
            ? "pt-3"
            : "pt-10",
      )}
    >
      <Scrubber
        hoverPreviews={false}
        currentMs={currentMs}
        durationMs={durationMs}
        onSeek={onSeek}
        comments={comments}
        onMarkerLanesChange={handleMarkerLanes}
      />

      <div className="relative flex min-w-0 items-center gap-1.5 text-player-control-foreground">
        <IconBtn
          onClick={onPlayPause}
          tooltip={isPlaying ? t("clipEmbed.pause") : t("clipEmbed.play")}
          className="size-10 [&_svg]:size-5"
        >
          {isPlaying ? <IconPlayerPauseFilled /> : <IconPlayerPlayFilled />}
        </IconBtn>

        <IconBtn
          onClick={() => onSeekRelative(-PLAYER_SEEK_STEP_MS)}
          tooltip={t("clipEmbed.back")}
        >
          <IconPlayerSkipForward className="rotate-180" />
        </IconBtn>

        <IconBtn
          onClick={() => onSeekRelative(PLAYER_SEEK_STEP_MS)}
          tooltip={t("clipEmbed.forward")}
        >
          <IconPlayerSkipForward />
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
                size="icon-sm"
                onClick={onToggleMute}
                className="shrink-0 text-player-control-foreground hover:bg-player-control-foreground/10 hover:text-player-control-foreground"
                aria-label={
                  silent ? t("clipEmbed.unmute") : t("clipEmbed.mute")
                }
              >
                {silent ? <IconVolumeOff /> : <IconVolume />}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              data-player-ui
              side="bottom"
              align="center"
              sideOffset={8}
              portalled={false}
              className="w-auto border-player-control-foreground/10 bg-player-control/90 p-2 text-player-control-foreground shadow-2xl backdrop-blur-md"
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <div className="flex h-24 w-8 items-center justify-center">
                <Slider
                  aria-label={t("clipEmbed.volume")}
                  orientation="vertical"
                  min={0}
                  max={1}
                  step={0.05}
                  value={[muted ? 0 : volume]}
                  onValueChange={([value]) => onVolumeChange(value ?? 0)}
                  className="h-24 w-2 data-[orientation=vertical]:flex-col [&_[data-orientation=vertical]]:h-full [&_[data-orientation=vertical]]:w-1.5 [&_[role=slider]]:size-3.5"
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <span className="shrink-0 whitespace-nowrap px-1 font-mono text-[10px] leading-none tabular-nums text-player-control-foreground/85 sm:text-[11px]">
          {msToClock(currentMs)}
          <span className="text-player-control-foreground/50">
            /{msToClock(durationMs)}
          </span>
        </span>

        <div className="flex-1" />

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  data-player-ui
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t("clipEmbed.speed")}
                  className="shrink-0 rounded-md px-2 text-xs font-medium tabular-nums text-player-control-foreground hover:bg-player-control-foreground/10 hover:text-player-control-foreground"
                >
                  {speed}x
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t("clipEmbed.speed")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            data-player-ui
            align="end"
            side="bottom"
            className="min-w-[90px]"
            container={menuPortalContainer}
          >
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

        <IconBtn
          onClick={onToggleFullscreen}
          tooltip={
            isFullscreen
              ? t("clipEmbed.exitFullscreen")
              : t("clipEmbed.fullscreen")
          }
        >
          <IconMaximize className={cn(isFullscreen && "rotate-180")} />
        </IconBtn>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  tooltip,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  tooltip: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          data-player-ui
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClick}
          aria-label={tooltip}
          className={cn(
            "shrink-0 text-player-control-foreground hover:bg-player-control-foreground/10 hover:text-player-control-foreground",
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
