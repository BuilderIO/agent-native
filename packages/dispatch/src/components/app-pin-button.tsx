import { useT } from "@agent-native/core/client/i18n";
import { IconPin, IconPinFilled } from "@tabler/icons-react";

import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

/** Shown on row hover or focus, always when pinned or on touch screens. */
export function AppPinButton({
  appId,
  name,
  pinned,
  onToggle,
  className,
}: {
  appId: string;
  name: string;
  pinned: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const t = useT();
  const label = t(
    pinned ? "dispatch.pages.unpinApp" : "dispatch.pages.pinApp",
    {
      name,
    },
  );
  const Icon = pinned ? IconPinFilled : IconPin;
  const toggle = () => {
    onToggle();
    // Pinning moves the row to another section, which remounts it; keep
    // keyboard focus on this app's pin button rather than dropping to <body>.
    requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) {
        return;
      }
      document
        .querySelector<HTMLElement>(`[data-pin-app-id="${CSS.escape(appId)}"]`)
        ?.focus();
    });
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={label}
          aria-pressed={pinned}
          data-pinned={pinned}
          data-pin-app-id={appId}
          onClick={toggle}
          className={cn(
            "size-7 shrink-0 p-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[pinned=true]:text-foreground data-[pinned=true]:opacity-100 [@media(pointer:coarse)]:opacity-100",
            className,
          )}
        >
          <Icon size={15} aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
