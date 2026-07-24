import { IconHelpCircle } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { cn } from "../utils.js";

interface AgentTabFrameProps {
  title: string;
  description: string;
  helpHref?: string;
  helpLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Shared settings surface for Manage agent page tabs. */
export function AgentTabFrame({
  title,
  description,
  helpHref,
  helpLabel,
  actions,
  children,
  className,
}: AgentTabFrameProps) {
  return (
    <div
      className={cn("mx-auto flex w-full max-w-5xl flex-col gap-6", className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-4 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              {title}
            </h2>
            {helpHref && (
              <a
                href={helpHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={helpLabel ?? `Open ${title} documentation`}
                title={helpLabel ?? `Open ${title} documentation`}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
              >
                <IconHelpCircle className="size-4" />
              </a>
            )}
          </div>
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
