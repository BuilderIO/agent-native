import type { Icon } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Tabler icon component. */
  icon: Icon;
  title: string;
  description?: string;
  /** Optional CTA — typically a `<Button>`. */
  action?: ReactNode;
  /** Optional secondary link/text rendered below the action. */
  secondary?: ReactNode;
  /** Visual tone — `default` for neutral, `success` for celebratory inbox-zero. */
  tone?: "default" | "success";
  className?: string;
}

/**
 * Reusable empty-state card for Workbench rooms.
 *
 * Inviting, not bare: icon + title + one-sentence description + a primary
 * CTA, optionally with a secondary link below. The `success` tone tints
 * the icon halo emerald for celebratory "inbox zero" states.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondary,
  tone = "default",
  className,
}: EmptyStateProps) {
  return (
    <Card className={cn("border-dashed bg-card/50", className)}>
      <CardContent className="flex flex-col items-center justify-center gap-5 px-6 py-16 text-center">
        <div
          className={cn(
            "flex size-14 items-center justify-center rounded-full",
            tone === "success"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20"
              : "bg-muted text-muted-foreground ring-1 ring-border/60",
          )}
        >
          <Icon size={26} aria-hidden />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          {description ? (
            <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="pt-1">{action}</div> : null}
        {secondary ? (
          <div className="text-xs text-muted-foreground">{secondary}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
