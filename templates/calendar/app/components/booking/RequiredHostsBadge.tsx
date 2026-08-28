import { useT } from "@agent-native/core/client/i18n";
import type { BookingHost } from "@shared/api";
import { IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";

// Fast enough to feel immediate on hover, but not so fast that moving the
// mouse across the badge on the way to somewhere else opens it.
const HOVER_OPEN_DELAY_MS = 100;

export function RequiredHostsBadge({
  label,
  ownerLabel,
  ownerEmail,
  hosts,
}: {
  label: string;
  ownerLabel: string;
  ownerEmail?: string;
  hosts: BookingHost[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  function clearHoverTimeout() {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }
  useEffect(() => clearHoverTimeout, []);

  function handleMouseEnter() {
    if (pinned) return;
    clearHoverTimeout();
    hoverTimeoutRef.current = setTimeout(
      () => setOpen(true),
      HOVER_OPEN_DELAY_MS,
    );
  }

  function handleMouseLeave() {
    if (pinned) return;
    clearHoverTimeout();
    setOpen(false);
  }

  function handleClick() {
    clearHoverTimeout();
    setPinned(true);
    setOpen(true);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        clearHoverTimeout();
        if (!next) setPinned(false);
        setOpen(next);
      }}
    >
      <PopoverAnchor asChild>
        <span
          ref={anchorRef}
          role="button"
          tabIndex={0}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="inline-flex cursor-pointer rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              handleClick();
            }
          }}
        >
          {label}
        </span>
      </PopoverAnchor>
      <PopoverContent
        className="w-[calc(100vw-2rem)] max-w-sm p-3 sm:w-80"
        onOpenAutoFocus={(event) => {
          if (!pinned) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          // Radix treats the anchor as "outside" the content, so a click on
          // the badge itself would otherwise dismiss the popover a moment
          // before our own onClick handler runs, undoing the pin. Let our
          // handler own that click instead.
          if (anchorRef.current?.contains(event.target as Node)) {
            event.preventDefault();
          }
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <ul className="space-y-1 text-xs">
            <li className="font-medium text-foreground">
              {ownerEmail ? `${ownerLabel} (${ownerEmail})` : ownerLabel}
            </li>
            {hosts.map((host) => (
              <li key={host.email} className="text-muted-foreground">
                {host.displayName
                  ? `${host.displayName} (${host.email})`
                  : host.email}
              </li>
            ))}
          </ul>
          {pinned && (
            <button
              type="button"
              onClick={() => {
                setPinned(false);
                setOpen(false);
              }}
              aria-label={t("eventDialog.close")}
              className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
