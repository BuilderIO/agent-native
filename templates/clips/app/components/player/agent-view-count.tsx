import { IconBotId } from "@tabler/icons-react";

import { ClaudeLogo, CodexLogo } from "@/components/agent-destination-logos";
import { cn } from "@/lib/utils";

/** Compact agent-view indicator retained for library cards and other dense lists. */
export function AgentViewCount({
  count,
  label,
  className,
}: {
  count: number;
  label: string;
  className?: string;
}) {
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1 border-s border-border ps-2 tabular-nums",
        className,
      )}
    >
      <AgentViewerAvatar className="size-5" />
      {count}
    </span>
  );
}

/** Agents use provider logos when the public API identifies the provider. */
export function AgentViewerAvatar({
  agentLabel,
  className,
}: {
  agentLabel?: string | null;
  className?: string;
}) {
  const normalizedLabel = agentLabel?.toLowerCase() ?? "";
  const logo = normalizedLabel.includes("claude") ? (
    <ClaudeLogo className="size-3.5" />
  ) : normalizedLabel.includes("openai") ||
    normalizedLabel.includes("chatgpt") ||
    normalizedLabel.includes("codex") ? (
    <CodexLogo className="size-3.5" />
  ) : (
    <IconBotId className="size-3.5" />
  );

  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
        className,
      )}
    >
      {logo}
    </span>
  );
}
