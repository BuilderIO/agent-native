import { useState } from "react";
import {
  IconPlayerPlay,
  IconPlayerPause,
  IconVolume,
  IconVolumeOff,
  IconMaximize,
  IconPictureInPicture,
  IconSubtitles,
  IconSettings,
  IconRectangle,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Scrubber, msToClock } from "./scrubber";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export const SPEED_OPTIONS = [0.5, 0.8, 1, 1.2, 1.5, 1.7, 2, 2.5];

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
  onPlayPause: () => void;
  onSeek: (ms: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onSpeedChange: (rate: number) => void;
  onToggleCaptions: () => void;
  onTogglePip: () => void;
  onToggleFullscreen: () => void;
  onToggleTheater?: () => void;
}

export function PlayerControls(props: PlayerControlsProps) {
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
    onPlayPause,
    onSeek,
    onVolumeChange,
    onToggleMute,
    onSpeedChange,
    onToggleCaptions,
    onTogglePip,
    onToggleFullscreen,
    onToggleTheater,
  } = props;

  const [volumeHover, setVolumeHover] = useState(false);

  return (
    <div className="px-3 pb-2 pt-10 bg-gradient-to-t from-black/80 via-black/50 to-transparent">
      <Scrubber
        currentMs={currentMs}
        durationMs={durationMs}
        onSeek={onSeek}
        comments={comments}
        chapters={chapters}
        reactions={reactions}
      />

      <div className="flex items-center gap-1.5 text-white">
        <IconBtn
          onClick={onPlayPause}
          title={isPlaying ? "Pause (K)" : "Play (K)"}
        >
          {isPlaying ? (
            <IconPlayerPause className="h-5 w-5" />
          ) : (
            <IconPlayerPlay className="h-5 w-5" />
          )}
        </IconBtn>

        <div
          className="flex items-center gap-1"
          onMouseEnter={() => setVolumeHover(true)}
          onMouseLeave={() => setVolumeHover(false)}
        >
          <IconBtn onClick={onToggleMute} title="Mute (M)">
            {muted || volume === 0 ? (
              <IconVolumeOff className="h-5 w-5" />
            ) : (
              <IconVolume className="h-5 w-5" />
            )}
          </IconBtn>
          <div
            className={cn(
              "transition-all overflow-hidden",
              volumeHover ? "w-20" : "w-0",
            )}
          >
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
              className="w-full accent-primary cursor-pointer"
            />
          </div>
        </div>

        <span className="text-xs font-mono tabular-nums text-white/90 px-2">
          {msToClock(currentMs)}
          <span className="text-white/50"> / {msToClock(durationMs)}</span>
        </span>

        <div className="flex-1" />

        {hasCaptions ? (
          <IconBtn
            onClick={onToggleCaptions}
            active={captionsOn}
            title="Captions (C)"
          >
            <IconSubtitles className="h-5 w-5" />
          </IconBtn>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="h-8 px-2 rounded-md hover:bg-white/10 text-xs font-medium tabular-nums"
              title="Playback speed"
            >
              {speed}x
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="min-w-[90px]">
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="h-8 w-8 rounded-md hover:bg-white/10 flex items-center justify-center">
              <IconSettings className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            <DropdownMenuLabel>Quality</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>Auto</DropdownMenuItem>
            <DropdownMenuItem disabled>1080p</DropdownMenuItem>
            <DropdownMenuItem disabled>720p</DropdownMenuItem>
            <DropdownMenuItem disabled>480p</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <IconBtn
          onClick={onTogglePip}
          active={isPip}
          title="Picture in picture"
        >
          <IconPictureInPicture className="h-5 w-5" />
        </IconBtn>

        {onToggleTheater ? (
          <IconBtn
            onClick={onToggleTheater}
            active={theaterMode}
            title="Theater mode (T)"
          >
            <IconRectangle className="h-5 w-5" />
          </IconBtn>
        ) : null}

        <IconBtn onClick={onToggleFullscreen} title="Fullscreen (F)">
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
  title,
  active,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "h-8 w-8 rounded-md flex items-center justify-center",
        active ? "bg-white/20 text-white" : "text-white hover:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}
