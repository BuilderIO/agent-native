import { Camera, Mouse } from "lucide-react";

export interface UITimelineProps {
  x: number;
  y: number;
  width: number;
  height: number;
  playheadProgress?: number;
}

const RULER_HEIGHT = 24;
const TRACK_HEIGHT = 32;
const LABEL_WIDTH = 180;
const RANGE_BAR_HEIGHT = 12;
const CAMERA_COLOR = "#60a5fa";
const CURSOR_COLOR = "#a855f7";

export function UITimeline({
  x,
  y,
  width,
  height,
  playheadProgress = 0,
}: UITimelineProps) {
  const barAreaWidth = width - LABEL_WIDTH;
  const playheadX = LABEL_WIDTH + barAreaWidth * playheadProgress;

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
      {/* Timeline container */}
      <div className="h-full bg-card/40 border-t border-border flex flex-col">
        {/* Ruler */}
        <div
          className="flex border-b border-border bg-card/60"
          style={{ height: RULER_HEIGHT }}
        >
          {/* Empty space for label column */}
          <div
            style={{ width: LABEL_WIDTH }}
            className="border-r border-border flex-shrink-0"
          />

          {/* Ruler ticks and labels */}
          <div className="flex-1 relative">
            {[0, 1, 2, 3].map((sec) => {
              const pct = (sec / 3) * 100;
              return (
                <div
                  key={sec}
                  className="absolute top-0 bottom-0 flex flex-col justify-center"
                  style={{ left: `${pct}%` }}
                >
                  <div className="w-px h-2 bg-border/60 mb-0.5" />
                  <span className="text-[11px] font-mono text-muted-foreground -translate-x-1/2">
                    {sec}.0s
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tracks container */}
        <div className="flex-1 overflow-hidden">
          {/* Camera track */}
          <TrackRow
            label="Camera"
            icon={<Camera className="w-3.5 h-3.5 text-blue-400" />}
            color={CAMERA_COLOR}
            barWidth={barAreaWidth}
            startPct={0}
            endPct={100}
            keyframes={[0, 0.67]}
          />

          {/* Cursor track */}
          <TrackRow
            label="Cursor"
            icon={<Mouse className="w-3.5 h-3.5 text-purple-400" />}
            color={CURSOR_COLOR}
            barWidth={barAreaWidth}
            startPct={0}
            endPct={100}
            keyframes={[0, 0.33, 1]}
          />

          {/* Animation track */}
          <TrackRow
            label="Logo Reveal"
            color="#fbbf24"
            barWidth={barAreaWidth}
            startPct={10}
            endPct={70}
            isAnimation
          />
        </div>

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-primary pointer-events-none z-10"
          style={{
            left: playheadX,
          }}
        >
          {/* Playhead triangle head */}
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2"
            style={{
              width: 0,
              height: 0,
              borderLeft: "5px solid transparent",
              borderRight: "5px solid transparent",
              borderTop: `6px solid rgb(var(--primary))`,
            }}
          />
        </div>

        {/* Range Navigator */}
        <div
          className="border-t border-border bg-muted/20"
          style={{ height: RANGE_BAR_HEIGHT + 16 }}
        >
          <div className="flex h-full items-center px-2 gap-2">
            {/* Left handle (triangle) */}
            <div
              className="w-2 h-3"
              style={{
                borderTop: "6px solid transparent",
                borderBottom: "6px solid transparent",
                borderRight: "8px solid rgb(var(--border))",
              }}
            />

            {/* Active range highlight */}
            <div className="flex-1 h-2 bg-primary/20 rounded-sm border border-primary/30" />

            {/* Right handle (triangle) */}
            <div
              className="w-2 h-3"
              style={{
                borderTop: "6px solid transparent",
                borderBottom: "6px solid transparent",
                borderLeft: "8px solid rgb(var(--border))",
              }}
            />

            {/* Time display */}
            <div className="text-[11px] font-mono text-muted-foreground/60 ml-2">
              0.00s / 3.0s
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackRow({
  label,
  icon,
  color,
  barWidth,
  startPct,
  endPct,
  keyframes,
  isAnimation = false,
}: {
  label: string;
  icon?: React.ReactNode;
  color: string;
  barWidth: number;
  startPct: number;
  endPct: number;
  keyframes?: number[];
  isAnimation?: boolean;
}) {
  return (
    <div
      className="flex items-center border-b border-border/50"
      style={{ height: TRACK_HEIGHT }}
    >
      {/* Label column */}
      <div
        className="flex-shrink-0 px-2 flex items-center gap-2 border-r border-border/50"
        style={{ width: LABEL_WIDTH }}
      >
        {icon || (
          <div
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
          />
        )}
        <span className="text-sm text-foreground/80 truncate">{label}</span>
      </div>

      {/* Bar area */}
      <div className="flex-1 relative h-full flex items-center">
        {/* Track bar */}
        {isAnimation ? (
          <div
            className="absolute h-3 rounded transition-all"
            style={{
              left: `${startPct}%`,
              width: `${endPct - startPct}%`,
              background: `linear-gradient(90deg, rgba(251,191,36,0.15) 0%, rgba(251,191,36,0.25) 50%, rgba(251,191,36,0.15) 100%)`,
              border: `1px solid rgba(251,191,36,0.35)`,
            }}
          />
        ) : null}

        {/* Keyframes (diamonds) */}
        {keyframes?.map((kf, idx) => {
          const xPct = kf * 100;
          return (
            <div
              key={idx}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 flex items-center justify-center cursor-pointer group"
              style={{
                left: `${xPct}%`,
              }}
            >
              <div
                className="w-2 h-2 rotate-45 transition-all group-hover:scale-125"
                style={{
                  backgroundColor: color,
                  boxShadow: `0 0 6px ${color}40`,
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
