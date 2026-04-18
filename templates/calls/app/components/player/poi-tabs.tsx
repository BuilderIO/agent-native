import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { formatMs } from "@/lib/timestamp-format";
import type { CallSummary, TrackerHit } from "@/../shared/api";

export type PoiTab = "questions" | "trackers" | "actions" | "filler";

export interface FillerMoment {
  text: string;
  ms: number;
  speakerLabel?: string;
}

export interface PoiTabsProps {
  summary: CallSummary | null | undefined;
  trackerHits: TrackerHit[];
  fillerMoments?: FillerMoment[];
  onSeek: (ms: number) => void;
  value?: PoiTab;
  onValueChange?: (tab: PoiTab) => void;
  className?: string;
}

export function PoiTabs(props: PoiTabsProps) {
  const {
    summary,
    trackerHits,
    fillerMoments,
    onSeek,
    value,
    onValueChange,
    className,
  } = props;

  const questions = summary?.questions ?? [];
  const actions = summary?.actionItems ?? [];

  const grouped = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; color: string; hits: TrackerHit[] }
    >();
    for (const h of trackerHits) {
      const g = map.get(h.trackerId);
      if (g) g.hits.push(h);
      else
        map.set(h.trackerId, {
          id: h.trackerId,
          name: h.trackerName,
          color: h.trackerColor,
          hits: [h],
        });
    }
    return Array.from(map.values()).sort((a, b) => b.hits.length - a.hits.length);
  }, [trackerHits]);

  return (
    <Tabs
      value={value}
      onValueChange={(v) => onValueChange?.(v as PoiTab)}
      defaultValue="questions"
      className={cn("flex flex-col min-h-0", className)}
    >
      <TabsList className="w-full grid grid-cols-4 h-9">
        <TabsTrigger value="questions" className="text-xs gap-1">
          Questions
          {questions.length ? <Count n={questions.length} /> : null}
        </TabsTrigger>
        <TabsTrigger value="trackers" className="text-xs gap-1">
          Trackers
          {trackerHits.length ? <Count n={trackerHits.length} /> : null}
        </TabsTrigger>
        <TabsTrigger value="actions" className="text-xs gap-1">
          Actions
          {actions.length ? <Count n={actions.length} /> : null}
        </TabsTrigger>
        <TabsTrigger value="filler" className="text-xs gap-1">
          Filler
          {fillerMoments?.length ? <Count n={fillerMoments.length} /> : null}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="questions" className="mt-3 overflow-y-auto">
        {questions.length === 0 ? (
          <EmptyState text="No questions detected." />
        ) : (
          <ul className="divide-y divide-border/60">
            {questions.map((q, i) => (
              <Moment
                key={i}
                ms={q.ms}
                speaker={q.askedByLabel}
                text={q.text}
                onSeek={onSeek}
              />
            ))}
          </ul>
        )}
      </TabsContent>

      <TabsContent value="trackers" className="mt-3 overflow-y-auto space-y-3">
        {grouped.length === 0 ? (
          <EmptyState text="No tracker hits." />
        ) : (
          grouped.map((g) => (
            <div key={g.id} className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: g.color || "#888" }}
                />
                <span>{g.name}</span>
                <span className="text-muted-foreground font-normal">
                  · {g.hits.length}
                </span>
              </div>
              <ul className="divide-y divide-border/60 rounded-md border border-border">
                {g.hits.map((h) => (
                  <Moment
                    key={h.id}
                    ms={h.segmentStartMs}
                    speaker={h.speakerLabel ?? undefined}
                    text={h.quote}
                    onSeek={onSeek}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </TabsContent>

      <TabsContent value="actions" className="mt-3 overflow-y-auto">
        {actions.length === 0 ? (
          <EmptyState text="No action items detected." />
        ) : (
          <ul className="divide-y divide-border/60">
            {actions.map((a, i) => (
              <Moment
                key={i}
                ms={a.ms ?? 0}
                speaker={a.owner}
                text={a.text}
                onSeek={onSeek}
                noSeek={a.ms == null}
              />
            ))}
          </ul>
        )}
      </TabsContent>

      <TabsContent value="filler" className="mt-3 overflow-y-auto">
        {!fillerMoments?.length ? (
          <EmptyState text="No filler words flagged." />
        ) : (
          <ul className="divide-y divide-border/60">
            {fillerMoments.map((f, i) => (
              <Moment
                key={i}
                ms={f.ms}
                speaker={f.speakerLabel}
                text={f.text}
                onSeek={onSeek}
              />
            ))}
          </ul>
        )}
      </TabsContent>
    </Tabs>
  );
}

function Moment({
  ms,
  speaker,
  text,
  onSeek,
  noSeek,
}: {
  ms: number;
  speaker?: string;
  text: string;
  onSeek: (ms: number) => void;
  noSeek?: boolean;
}) {
  const inner = (
    <div className="px-3 py-2 text-sm text-left hover:bg-accent/50 flex flex-col">
      <div className="flex items-baseline gap-2">
        {speaker ? (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {speaker}
          </span>
        ) : null}
        {!noSeek ? (
          <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
            {formatMs(ms)}
          </span>
        ) : null}
      </div>
      <span className="text-foreground/90 leading-snug line-clamp-3">
        {text}
      </span>
    </div>
  );
  return (
    <li>
      {noSeek ? (
        inner
      ) : (
        <button
          onClick={() => onSeek(ms)}
          className="block w-full text-left"
        >
          {inner}
        </button>
      )}
    </li>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="text-[10px] rounded-full bg-muted-foreground/15 px-1.5 py-0.5 font-mono tabular-nums">
      {n}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="px-3 py-6 text-xs text-muted-foreground text-center">
      {text}
    </div>
  );
}
