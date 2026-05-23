import { IconAlertTriangle, IconExternalLink } from "@tabler/icons-react";
import { QueueCard } from "./queue-card";
import type { QueueCard as QueueCardData } from "@/hooks/use-queue";

interface ErrorCardProps {
  card: QueueCardData;
  onSnooze: (until: "tomorrow" | "next-week") => void;
  onMarkDone: () => void;
  onDismiss: () => void;
  onMuteType: () => void;
}

/**
 * Renders an `error-new` card sourced from the Sentry workspace
 * integration. The framework integration isn't registered as a first-party
 * provider yet (v1.0 emits no error cards), but the component is wired so
 * the card surface is ready the moment the aggregator turns it on.
 */
export function ErrorCard({
  card,
  onSnooze,
  onMarkDone,
  onDismiss,
  onMuteType,
}: ErrorCardProps) {
  const href = card.error?.sentryUrl ?? card.ctas[0]?.href;
  return (
    <QueueCard
      cardType={card.type}
      badges={card.badges}
      title={
        <span className="inline-flex items-center gap-2">
          <IconAlertTriangle
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
      primary={href ? { label: "Open in Sentry", href } : undefined}
      onSnooze={onSnooze}
      onMarkDone={onMarkDone}
      onDismiss={onDismiss}
      onMuteType={onMuteType}
    />
  );
}
