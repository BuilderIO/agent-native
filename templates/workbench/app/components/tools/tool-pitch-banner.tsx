import { IconMessage, IconBolt, IconShield } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ToolPitchBannerProps {
  onAskAgent: () => void;
  className?: string;
}

/**
 * Inviting "ask the agent" banner shown at the bottom of the Custom Tools
 * room. Reinforces the soft-customization story: prompt-to-tool, no fork,
 * no PR, no deploy. Subtle accent-tint background — no purple gradients,
 * no sparkle icons.
 */
export function ToolPitchBanner({
  onAskAgent,
  className,
}: ToolPitchBannerProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-accent/20 p-6 sm:p-8",
        className,
      )}
    >
      <div className="relative flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl space-y-3">
          <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
            Don't see what you need? Ask the agent.
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Describe a small tool — a Linear sprint kanban, slowest endpoints
            from Datadog, flaky tests this week — and the agent will build it
            for you. No fork, no PR, no deploy.
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <li className="inline-flex items-center gap-1.5">
              <IconBolt size={13} aria-hidden className="text-foreground/70" />
              Built in seconds
            </li>
            <li className="inline-flex items-center gap-1.5">
              <IconShield
                size={13}
                aria-hidden
                className="text-foreground/70"
              />
              Sandboxed and scoped to you
            </li>
            <li className="inline-flex items-center gap-1.5">
              <IconMessage
                size={13}
                aria-hidden
                className="text-foreground/70"
              />
              Edit by asking again
            </li>
          </ul>
        </div>
        <Button
          onClick={onAskAgent}
          size="lg"
          className="shrink-0 cursor-pointer"
        >
          <IconMessage size={16} aria-hidden />
          Ask the agent
        </Button>
      </div>
    </div>
  );
}
