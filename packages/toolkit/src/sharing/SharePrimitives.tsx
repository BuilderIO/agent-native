import { IconChevronDown } from "@tabler/icons-react";
import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";

import { ActionButton } from "../design-system/components.js";
import type { ActionButtonProps } from "../design-system/types.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../ui/collapsible.js";
import { cn } from "../utils.js";

export interface ShareTriggerProps extends Pick<
  ActionButtonProps,
  | "aria-label"
  | "aria-expanded"
  | "aria-controls"
  | "className"
  | "disabled"
  | "emphasis"
  | "intent"
  | "onClick"
  | "onPress"
  | "pending"
  | "size"
  | "title"
> {
  label?: ReactNode;
}

/** The shared text-only trigger for resource sharing surfaces. */
export const ShareTrigger = forwardRef<HTMLButtonElement, ShareTriggerProps>(
  function ShareTrigger(
    { label = "Share", "aria-label": ariaLabel, title, ...props },
    ref,
  ) {
    return (
      <ActionButton
        type="button"
        emphasis="outline"
        size="compact"
        elementRef={ref}
        aria-label={ariaLabel ?? (typeof label === "string" ? label : "Share")}
        title={title ?? (typeof label === "string" ? label : undefined)}
        {...props}
      >
        {label}
      </ActionButton>
    );
  },
);
ShareTrigger.displayName = "ShareTrigger";

export interface ShareCopyRowProps {
  value: string;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
  copyLabel?: ReactNode;
  copiedLabel?: ReactNode;
  onCopy: (value: string) => Promise<boolean | void> | boolean | void;
}

/** Compact copy-only row. The underlying URL is deliberately not rendered. */
export function ShareCopyRow({
  value,
  label,
  description,
  disabled = false,
  className,
  copyLabel = "Copy",
  copiedLabel = "Copied",
  onCopy,
}: ShareCopyRowProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const handleCopy = async () => {
    if (disabled) return;
    const result = await onCopy(value);
    if (result === false) return;
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1_400);
  };

  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="min-w-0">
        {label ? <div className="text-sm font-medium">{label}</div> : null}
        {description ? (
          <div className="text-xs text-muted-foreground">{description}</div>
        ) : null}
      </div>
      <ActionButton
        type="button"
        emphasis="outline"
        size="compact"
        disabled={disabled}
        aria-label={copied ? String(copiedLabel) : String(copyLabel)}
        onPress={() => void handleCopy()}
        className="h-9 shrink-0"
      >
        {copied ? copiedLabel : copyLabel}
      </ActionButton>
    </div>
  );
}

export interface ShareAgentsSectionProps {
  children: ReactNode;
  label?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  contentClassName?: string;
}

/** Shared expandable boundary for agent-readable sharing details. */
export function ShareAgentsSection({
  children,
  label = "Share with agents",
  defaultOpen = false,
  open,
  onOpenChange,
  className,
  contentClassName,
}: ShareAgentsSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = open ?? internalOpen;
  const handleOpenChange = (nextOpen: boolean) => {
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn(
        "overflow-hidden rounded-md border border-border",
        className,
      )}
    >
      <CollapsibleTrigger asChild>
        <ShareTrigger
          label={
            <>
              <span className="min-w-0 truncate">{label}</span>
              <IconChevronDown
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  isOpen && "rotate-180",
                )}
              />
            </>
          }
          emphasis="ghost"
          size="default"
          aria-expanded={isOpen}
          className="flex min-h-10 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm font-medium hover:bg-muted/50 focus-visible:ring-inset"
        />
      </CollapsibleTrigger>
      <CollapsibleContent
        className={cn("border-t border-border px-3 py-3", contentClassName)}
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
