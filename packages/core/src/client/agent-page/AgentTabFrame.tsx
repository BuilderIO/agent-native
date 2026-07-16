import type { ReactNode } from "react";

import { cn } from "../utils.js";

interface AgentTabFrameProps {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Shared settings surface for agent workspace tabs. */
export function AgentTabFrame({
  title,
  description,
  actions,
  children,
  className,
}: AgentTabFrameProps) {
  return (
    <div
      className={cn("mx-auto flex w-full max-w-5xl flex-col gap-6", className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
        {actions}
      </header>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
