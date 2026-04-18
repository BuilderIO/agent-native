import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  IconArrowUpRight,
  IconRefresh,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { useActionMutation } from "@agent-native/core/client";
import { formatMs } from "@/lib/timestamp-format";
import type { CallSummary } from "@shared/api";

export interface AiSummaryPanelProps {
  callId: string;
  summary: CallSummary | null | undefined;
  loading?: boolean;
  error?: string | null;
  onSeek: (ms: number) => void;
  onRefetch?: () => void;
  className?: string;
}

export function AiSummaryPanel(props: AiSummaryPanelProps) {
  const { callId, summary, loading, error, onSeek, onRefetch, className } =
    props;

  const regenerate = useActionMutation("regenerate-summary", {
    onSuccess: () => onRefetch?.(),
  });

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card flex flex-col",
        className,
      )}
    >
      <div className="px-4 py-3 flex items-center justify-between border-b border-border">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold tracking-tight">AI Summary</h3>
          {summary?.sentiment ? (
            <SentimentChip sentiment={summary.sentiment} />
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => regenerate.mutate({ callId } as any)}
          disabled={regenerate.isPending}
        >
          <IconRefresh
            className={cn(
              "h-3.5 w-3.5 mr-1",
              regenerate.isPending && "animate-spin",
            )}
          />
          Regenerate
        </Button>
      </div>

      <div className="p-4 space-y-5 overflow-y-auto">
        {loading ? (
          <Skeleton />
        ) : error ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <IconAlertTriangle className="h-4 w-4" />
            {error}
          </div>
        ) : !summary ? (
          <div className="text-sm text-muted-foreground">
            No summary yet. Click Regenerate to create one.
          </div>
        ) : (
          <>
            <Section title="Recap">
              <p className="text-sm leading-relaxed text-foreground/90">
                {summary.recap || "—"}
              </p>
            </Section>

            {summary.keyPoints?.length ? (
              <Section title="Key points">
                <ul className="space-y-1.5">
                  {summary.keyPoints.map((p, i) => (
                    <Bullet
                      key={i}
                      text={p.text}
                      quoteMs={p.quoteMs}
                      onSeek={onSeek}
                    />
                  ))}
                </ul>
              </Section>
            ) : null}

            {summary.nextSteps?.length ? (
              <Section title="Next steps">
                <ul className="space-y-1.5">
                  {summary.nextSteps.map((s, i) => (
                    <Bullet
                      key={i}
                      text={`${s.owner ? `${s.owner}: ` : ""}${s.text}${s.dueAt ? ` (due ${s.dueAt})` : ""}`}
                      quoteMs={s.quoteMs}
                      onSeek={onSeek}
                    />
                  ))}
                </ul>
              </Section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
        {title}
      </h4>
      {children}
    </div>
  );
}

function Bullet({
  text,
  quoteMs,
  onSeek,
}: {
  text: string;
  quoteMs?: number;
  onSeek: (ms: number) => void;
}) {
  return (
    <li className="flex items-start gap-2 text-sm leading-relaxed">
      <span className="mt-1.5 h-1 w-1 rounded-full bg-muted-foreground shrink-0" />
      <span className="flex-1 text-foreground/90">{text}</span>
      {quoteMs != null ? (
        <button
          onClick={() => onSeek(quoteMs)}
          className="shrink-0 text-[11px] font-mono text-muted-foreground hover:text-foreground flex items-center gap-0.5"
          title="Jump to quote"
        >
          {formatMs(quoteMs)}
          <IconArrowUpRight className="h-3 w-3" />
        </button>
      ) : null}
    </li>
  );
}

function SentimentChip({
  sentiment,
}: {
  sentiment: "positive" | "neutral" | "negative";
}) {
  const label =
    sentiment === "positive"
      ? "Positive"
      : sentiment === "negative"
        ? "Negative"
        : "Neutral";
  return (
    <span className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground border border-border rounded-full px-2 py-0.5">
      {label}
    </span>
  );
}

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="h-3 w-20 rounded bg-muted" />
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-4/5 rounded bg-muted" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-24 rounded bg-muted" />
        <div className="h-3 w-3/4 rounded bg-muted" />
        <div className="h-3 w-2/3 rounded bg-muted" />
      </div>
    </div>
  );
}
