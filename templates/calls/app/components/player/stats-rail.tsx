import { cn } from "@/lib/utils";
import { formatMs } from "@/lib/timestamp-format";
import type { SpeakerParticipant } from "./speaker-avatars";

export interface StatsRailProps {
  participants: SpeakerParticipant[];
  durationMs: number;
  questionsCount?: number;
  interruptionsCount?: number;
  className?: string;
}

export function StatsRail(props: StatsRailProps) {
  const {
    participants,
    durationMs,
    questionsCount = 0,
    interruptionsCount = 0,
    className,
  } = props;

  const talkPctTotal = participants.reduce(
    (acc, p) => acc + (p.talkPct ?? 0),
    0,
  );

  const monologue = participants.reduce<{
    ms: number;
    name: string;
  } | null>((acc, p) => {
    const ms = 0;
    const pms =
      (p as SpeakerParticipant & { longestMonologueMs?: number })
        .longestMonologueMs ?? ms;
    if (!acc || pms > acc.ms)
      return { ms: pms, name: p.displayName || p.speakerLabel };
    return acc;
  }, null);

  const durationMin = Math.max(1, durationMs / 60000);
  const qpm = questionsCount / durationMin;
  const interactivity: "Low" | "Medium" | "High" =
    qpm >= 1.5 ? "High" : qpm >= 0.6 ? "Medium" : "Low";

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-4 space-y-4",
        className,
      )}
    >
      <h3 className="text-sm font-semibold tracking-tight">Call stats</h3>

      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
          Talk ratio
        </div>
        <div className="flex w-full h-2 rounded-full overflow-hidden bg-muted">
          {participants.map((p, i) => {
            const w = Math.max(0, p.talkPct ?? 0);
            if (w <= 0) return null;
            return (
              <div
                key={p.speakerLabel}
                className="h-full"
                style={{
                  width: `${w}%`,
                  backgroundColor: p.color || shadeFor(i),
                }}
                title={`${p.displayName}: ${Math.round(w)}%`}
              />
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
          {participants.map((p, i) => (
            <div
              key={p.speakerLabel}
              className="flex items-center gap-1.5 text-[11px] text-foreground/80"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: p.color || shadeFor(i) }}
              />
              <span className="font-medium">
                {p.displayName || p.speakerLabel}
              </span>
              <span className="font-mono text-muted-foreground tabular-nums">
                {Math.round(p.talkPct ?? 0)}%
              </span>
            </div>
          ))}
          {Math.round(talkPctTotal) < 95 ? (
            <div className="text-[11px] text-muted-foreground">
              {100 - Math.round(talkPctTotal)}% silence
            </div>
          ) : null}
        </div>
      </div>

      <Stat
        label="Longest monologue"
        value={
          monologue && monologue.ms > 0
            ? `${formatMs(monologue.ms)}`
            : "—"
        }
        secondary={monologue && monologue.ms > 0 ? monologue.name : undefined}
      />
      <Stat label="Interactivity" value={interactivity} />
      <Stat label="Questions" value={String(questionsCount)} />
      <Stat label="Interruptions" value={String(interruptionsCount)} />
    </div>
  );
}

function Stat({
  label,
  value,
  secondary,
}: {
  label: string;
  value: string;
  secondary?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </span>
      <div className="flex items-baseline gap-2 min-w-0">
        {secondary ? (
          <span className="text-[11px] text-muted-foreground truncate max-w-[140px]">
            {secondary}
          </span>
        ) : null}
        <span className="font-semibold tabular-nums">{value}</span>
      </div>
    </div>
  );
}

function shadeFor(i: number): string {
  const shades = ["#111111", "#555555", "#888888", "#bbbbbb", "#cccccc"];
  return shades[i % shades.length];
}
