import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { RotateCcw, Play, Maximize2 } from "lucide-react";

export interface UIVideoPlayerProps {
  x: number;
  y: number;
  width: number;
  height: number;
  playheadProgress?: number;
}

export function UIVideoPlayer({
  x,
  y,
  width,
  height,
  playheadProgress = 0,
}: UIVideoPlayerProps) {
  const frame = useCurrentFrame();

  // Subtle gradient animation for the mock video content
  const gradientShift = interpolate(frame % 120, [0, 60, 120], [0, 50, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
      }}
    >
      {/* Video container with aspect ratio */}
      <div className="w-full h-full flex flex-col">
        {/* Video area */}
        <div className="flex-1 bg-black rounded-lg overflow-hidden relative group">
          {/* Mock video content - gradient placeholder */}
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at ${50 + gradientShift}% 50%, rgba(99, 102, 241, 0.15), rgba(168, 85, 247, 0.1), rgba(0, 0, 0, 0.95))`,
            }}
          >
            {/* Center play icon when paused */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center">
                <Play className="w-8 h-8 text-white/80 ml-1" />
              </div>
            </div>
          </div>

          {/* Progress bar at bottom */}
          <div className="absolute bottom-0 left-0 right-0 h-[1.5px] bg-white/10 group-hover:h-[2.5px] transition-all">
            <div
              className="h-full bg-primary transition-all"
              style={{
                width: `${playheadProgress * 100}%`,
              }}
            />
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 mt-2 px-1">
          {/* Left controls */}
          <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-secondary/50 transition-colors">
            <RotateCcw className="w-4 h-4 text-foreground/60" />
          </button>
          <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-secondary/50 transition-colors">
            <Play className="w-4 h-4 text-foreground/60" />
          </button>

          {/* Time display */}
          <div className="text-xs font-mono text-muted-foreground tabular-nums">
            0:00.0 / 3.0s
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Speed selector */}
          <select className="text-xs font-mono bg-transparent text-muted-foreground border-none outline-none cursor-pointer hover:text-foreground/80">
            <option>1×</option>
          </select>

          {/* Fullscreen */}
          <button className="w-7 h-7 flex items-center justify-center rounded hover:bg-secondary/50 transition-colors">
            <Maximize2 className="w-4 h-4 text-foreground/60" />
          </button>
        </div>
      </div>
    </div>
  );
}
