import type { ReactNode } from "react";

import { cn } from "../../utils.js";

/**
 * A titled Usage section. `SettingsGroup` plus an action beside the title
 * (the chart's grouping control), and a `raw` body for charts that bring
 * their own card.
 */
export function UsageGroup({
  id,
  title,
  action,
  raw = false,
  children,
}: {
  id?: string;
  title: string;
  action?: ReactNode;
  raw?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-16">
      <header className="mb-2.5 flex min-h-8 flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </header>
      <div
        className={cn(
          "text-card-foreground",
          !raw &&
            "divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card",
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** The bordered surface a chart and its legend sit on. */
export function UsageChartCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-5 py-5 sm:px-6">
      {children}
    </div>
  );
}
