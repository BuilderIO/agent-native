import { trackEvent } from "@agent-native/core/client/analytics";
import { useT } from "@agent-native/core/client/i18n";
import type { ShareButtonVisibility } from "@agent-native/core/client/sharing/useShareButtonController";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { IconCheck, IconChevronDown, IconLink } from "@tabler/icons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type Visibility = ShareButtonVisibility;

export function copyToClipboard(value: string): Promise<boolean> {
  return writeClipboardText(value);
}

const NESTED_LAYER_SELECTOR = [
  "[data-radix-popper-content-wrapper]",
  "[data-radix-menu-content]",
  "[data-radix-select-viewport]",
  "[role='menu']",
  "[role='listbox']",
  "[data-sonner-toaster]",
  "[data-agent-native-share-overlay]",
].join(",");

const OPEN_NESTED_LAYER_SELECTOR = [
  "[data-radix-menu-content][data-state='open']",
  "[role='listbox'][data-state='open']",
].join(",");

function isNestedLayerInteraction(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest(NESTED_LAYER_SELECTOR)) {
    return true;
  }
  return (
    typeof document !== "undefined" &&
    document.querySelector(OPEN_NESTED_LAYER_SELECTOR) !== null
  );
}

export function nestedLayerDismissGuards(): {
  onPointerDownOutside: (
    event: CustomEvent<{ originalEvent: PointerEvent }>,
  ) => void;
  onFocusOutside: (event: CustomEvent<{ originalEvent: FocusEvent }>) => void;
} {
  return {
    onPointerDownOutside: (event) => {
      if (isNestedLayerInteraction(event.detail.originalEvent.target)) {
        event.preventDefault();
      }
    },
    onFocusOutside: (event) => {
      if (isNestedLayerInteraction(event.detail.originalEvent.target)) {
        event.preventDefault();
      }
    },
  };
}

/** The Advanced link under General access, with a summary of what it holds. */
export function ShareAdvancedPopover({
  summary,
  disabled,
  children,
}: {
  summary: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="-ms-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 font-medium transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("shareDialog.advanced")}
            <IconChevronDown className="size-3" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="w-80 max-w-[calc(100vw-2rem)] space-y-3 p-3"
        >
          {children}
        </PopoverContent>
      </Popover>
      <span aria-hidden="true">·</span>
      <span className="min-w-0 truncate">{summary}</span>
    </>
  );
}

export function ShareSectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("text-xs font-medium text-muted-foreground", className)}>
      {children}
    </div>
  );
}

export function CopyButton({
  value,
  children,
  copiedLabel,
  disabled,
  className,
  variant = "secondary",
  resourceType,
  resourceId,
  linkType = "share",
}: {
  value: string;
  children: ReactNode;
  copiedLabel?: ReactNode;
  disabled?: boolean;
  className?: string;
  variant?: "secondary" | "outline" | "default" | "ghost";
  resourceType?: string;
  resourceId?: string;
  linkType?: string;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const handleClick = async () => {
    if (disabled || !value) return;
    const result = await copyToClipboard(value);
    if (result === false) return;
    if (resourceType && resourceId) {
      trackEvent("share_link_copied", {
        resource_type: resourceType,
        resource_id: resourceId,
        link_type: linkType,
      });
    }
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), 1_400);
  };

  return (
    <Button
      type="button"
      variant={variant}
      disabled={disabled || !value}
      onClick={() => void handleClick()}
      className={cn("relative", className)}
    >
      {/* The idle label always occupies the button so the confirmation state
          doesn't resize it; the confirmation is centered on top. */}
      <span
        className={cn("flex items-center gap-2", copied && "invisible")}
        aria-hidden={copied}
      >
        <IconLink size={16} aria-hidden />
        {children}
      </span>
      {copied ? (
        <span className="absolute inset-0 flex items-center justify-center gap-2">
          <IconCheck size={16} aria-hidden className="text-success" />
          {copiedLabel ?? t("shareUi.copied")}
        </span>
      ) : null}
    </Button>
  );
}
