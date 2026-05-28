import { IconGitPullRequest, IconExternalLink } from "@tabler/icons-react";
import { QueueCard } from "./queue-card";
import type { QueueCard as QueueCardData } from "@/hooks/use-queue";

interface PrCardProps {
  card: QueueCardData;
  onSnooze: (until: "tomorrow" | "next-week") => void;
  onMarkDone: () => void;
  onDismiss: () => void;
  onMuteType: () => void;
}

/**
 * Renders any of the three PR-flavored card types — `pr-to-review`,
 * `my-pr-status-change`, `my-pr-ci-failure`. The shape is identical
 * (badges + title + meta + primary "Open PR" + overflow); the upstream
 * aggregator already encodes the differences via badges + tone + title.
 */
export function PrCard({
  card,
  onSnooze,
  onMarkDone,
  onDismiss,
  onMuteType,
}: PrCardProps) {
  const href = card.pr?.htmlUrl ?? card.ctas[0]?.href;
  const primaryLabel = card.ctas[0]?.label ?? "Open PR";
  return (
    <QueueCard
      cardType={card.type}
      badges={card.badges}
      title={
        <span className="inline-flex items-center gap-2">
          <IconGitPullRequest
            size={16}
            className="shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="truncate">{card.title}</span>
          {href ? (
            <IconExternalLink
              size={12}
              className="ml-1 shrink-0 text-muted-foreground"
              aria-hidden
            />
          ) : null}
        </span>
      }
      subtitle={card.subtitle}
      primary={href ? { label: primaryLabel, href } : { label: primaryLabel }}
      onSnooze={onSnooze}
      onMarkDone={onMarkDone}
      onDismiss={onDismiss}
      onMuteType={onMuteType}
    />
  );
}
