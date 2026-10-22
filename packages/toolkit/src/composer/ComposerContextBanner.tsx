import { IconPlus, IconSparkles, IconX } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Button } from "../ui/button.js";
import { cn } from "../utils.js";

interface ComposerContextBannerBaseProps {
  /** Localized name for the banner's content. */
  ariaLabel: string;
  children: ReactNode;
  /** Localized label for the action that opens or adds context. */
  addContextLabel: string;
  onAddContext: () => void;
  /** Optional decorative icon displayed after the add-context label. */
  addContextIcon?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export type ComposerContextBannerProps = ComposerContextBannerBaseProps &
  (
    | { dismissLabel?: never; onDismiss?: never }
    | { dismissLabel: string; onDismiss: () => void }
  );

/** Shared informational banner that hosts can place in `composerContextBannerSlot`. */
export function ComposerContextBanner({
  ariaLabel,
  children,
  addContextLabel,
  onAddContext,
  addContextIcon,
  dismissLabel,
  onDismiss,
  icon,
  className,
}: ComposerContextBannerProps) {
  return (
    <aside
      aria-label={ariaLabel}
      data-agent-composer-slot="context-banner"
      className={cn(
        "agent-composer-context-banner mx-auto mb-2 flex w-full max-w-3xl items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="shrink-0 text-primary">
        {icon ?? <IconSparkles aria-hidden="true" className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      <Button
        className="shrink-0 has-[>span>svg]:px-1.5"
        onClick={onAddContext}
        size="xs"
        type="button"
        variant="outline"
      >
        {addContextLabel}
        <span aria-hidden="true">
          {addContextIcon ?? <IconPlus aria-hidden="true" />}
        </span>
      </Button>
      {onDismiss ? (
        <Button
          aria-label={dismissLabel}
          className="shrink-0"
          onClick={onDismiss}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <IconX aria-hidden="true" />
        </Button>
      ) : null}
    </aside>
  );
}
