import { useRef } from "react";
import { cn } from "@/lib/utils";
import type { TalkTracks } from "@/hooks/use-talk-tracks";

export interface TalkTracksParticipant {
  speakerLabel: string;
  displayName?: string | null;
  color?: string | null;
}

export interface TalkTracksProps {
  tracks: TalkTracks;
  participants: TalkTracksParticipant[];
  durationMs: number;
  currentMs: number;
  onSeek: (ms: number) => void;
  className?: string;
  barHeight?: number;
}

export function TalkTracksComponent(props: TalkTracksProps) {
  const {
    tracks,
    participants,
    durationMs,
    currentMs,
    onSeek,
    className,
    barHeight = 14,
  } = props;

  const ref = useRef<HTMLDivElement | null>(null);

  const knownLabels = new Set(participants.map((p) => p.speakerLabel));
  const trackLabels = [
    ...participants.map((p) => p.speakerLabel),
    ...Object.keys(tracks).filter((l) => !knownLabels.has(l)),
  ];

  function msFromEvent(clientX: number) {
    const el = ref.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const ratio = rect.width > 0 ? x / rect.width : 0;
    return Math.floor(ratio * durationMs);
  }

  const pct = durationMs > 0 ? (currentMs / durationMs) * 100 : 0;

  return (
    <div
      ref={ref}
      className={cn("relative select-none w-full", className)}
      onMouseDown={(e) => {
        e.preventDefault();
        onSeek(msFromEvent(e.clientX));
        const onMove = (ev: MouseEvent) => onSeek(msFromEvent(ev.clientX));
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }}
    >
      <div className="flex flex-col gap-1">
        {trackLabels.map((label) => {
          const buckets = tracks[label] ?? [];
          const participant = participants.find(
            (p) => p.speakerLabel === label,
          );
          const name = participant?.displayName || label;
          return (
            <div key={label} className="flex items-center gap-2">
              <div className="w-16 shrink-0 text-[10px] text-muted-foreground truncate uppercase tracking-wide font-medium">
                {name}
              </div>
              <div
                className="relative flex-1 rounded-sm bg-muted overflow-hidden"
                style={{ height: barHeight }}
              >
                <TrackCanvas buckets={buckets} />
              </div>
            </div>
          );
        })}
      </div>
      <div
        className="absolute top-0 bottom-0 w-px bg-foreground pointer-events-none"
        style={{ left: `calc(4rem + 0.5rem + ${pct}% - ${pct * 0.01 * 64}px)` }}
      />
    </div>
  );
}

function TrackCanvas({ buckets }: { buckets: number[] }) {
  if (!buckets.length) return null;
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${buckets.length} 1`}
      preserveAspectRatio="none"
      className="absolute inset-0"
    >
      {buckets.map((b, i) => {
        if (b <= 0) return null;
        const opacity = 0.15 + b * 0.85;
        return (
          <rect
            key={i}
            x={i}
            y={0}
            width={1}
            height={1}
            fill="hsl(var(--foreground))"
            opacity={opacity}
          />
        );
      })}
    </svg>
  );
}

export { TalkTracksComponent as TalkTracks };
