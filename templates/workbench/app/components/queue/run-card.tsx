import { IconActivity } from "@tabler/icons-react";
import { QueueCard } from "./queue-card";
import type { QueueCard as QueueCardData } from "@/hooks/use-queue";

interface RunCardProps {
  card: QueueCardData;
  onSnooze: (until: "tomorrow" | "next-week") => void;
  onMarkDone: () => void;
  onDismiss: () => void;
  onMuteType: () => void;
}

/**
 * Renders a `run-needs-input` card. The primary CTA opens the run detail
 * page in the Run Room (`/runs/:id`) — even when the run is errored, we
 * default to "Open run" because the inspector is the right surface for
 * resume/retry, not the queue card.
 */
export function RunCard({
  card,
  onSnooze,
  onMarkDone,
  onDismiss,
  onMuteType,
}: RunCardProps) {
  const href =
    card.ctas[0]?.href ?? (card.run ? `/runs/${card.run.runId}` : undefined);
  return (
    <QueueCard
      cardType={card.type}
      badges={card.badges}
      title={
        <span className="inline-flex items-center gap-2">
          <IconActivity
            size={16}
            className="shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="truncate">{card.title}</span>
        </span>
      }
      subtitle={card.subtitle}
      primary={{ label: "Open run", href }}
      onSnooze={onSnooze}
      onMarkDone={onMarkDone}
      onDismiss={onDismiss}
      onMuteType={onMuteType}
    />
  );
}
