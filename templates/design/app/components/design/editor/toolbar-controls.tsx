import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type DesignToolbarOption = {
  key: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export function DesignPenToolIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z" />
      <path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18" />
      <path d="m2.3 2.3 7.286 7.286" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  );
}

export function DesignToolbarTool({
  active,
  label,
  icon,
  options,
  onPrimary,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  options: DesignToolbarOption[];
  onPrimary: () => void;
}) {
  const hasOptionsMenu = options.length > 1;
  // Item 5 (Figma parity): the hover tooltip should show the shortcut for
  // whichever sub-tool is CURRENTLY active (mirroring how the button's own
  // icon/label already track the active sub-tool above), falling back to the
  // first option's shortcut when none of the options is active — e.g. a
  // freshly-mounted toolbar before any tool has been explicitly selected.
  const primaryShortcut =
    options.find((option) => option.active)?.shortcut ?? options[0]?.shortcut;
  return (
    <div className="flex h-8 items-center text-neutral-200">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex size-8 cursor-pointer items-center justify-center rounded-md transition-colors",
              active
                ? // guard:allow-raw-color - fixed dark editor chrome, intentionally theme-independent
                  "bg-[var(--design-editor-accent-color)] text-white"
                : // guard:allow-raw-color - fixed dark editor chrome, intentionally theme-independent
                  "hover:bg-white/10 hover:text-white",
            )}
            onClick={onPrimary}
            aria-label={label}
            aria-pressed={active}
          >
            {icon}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="flex items-center gap-2">
          <span>{label}</span>
          {primaryShortcut ? (
            <span className="text-muted-foreground">{primaryShortcut}</span>
          ) : null}
        </TooltipContent>
      </Tooltip>

      {hasOptionsMenu ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                // guard:allow-raw-color - fixed dark editor chrome, intentionally theme-independent
                "flex h-8 w-4 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-white/10 hover:text-white",
                active && "text-neutral-200",
              )}
              aria-label={`${label} options`}
            >
              <IconChevronDown className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="center"
            sideOffset={12}
            className="w-56 rounded-2xl border-border bg-popover p-2 text-popover-foreground shadow-md"
          >
            {options.map((option) => (
              <DropdownMenuItem
                key={option.key}
                disabled={option.disabled}
                onSelect={option.onSelect}
                className="h-10 rounded-lg text-sm text-popover-foreground focus:bg-accent focus:text-accent-foreground data-[disabled]:text-muted-foreground"
              >
                <span className="mr-2 flex size-5 items-center justify-center text-popover-foreground">
                  {option.active ? (
                    <IconCheck className="size-4" />
                  ) : (
                    option.icon
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.shortcut && (
                  <DropdownMenuShortcut className="ml-3 text-muted-foreground">
                    {option.shortcut}
                  </DropdownMenuShortcut>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function DesignModeTab({
  active,
  disabled,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            // guard:allow-raw-color - fixed dark editor chrome, intentionally theme-independent
            "flex size-8 cursor-pointer items-center justify-center rounded-md text-neutral-300 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40",
            active &&
              // guard:allow-raw-color - fixed dark editor chrome, intentionally theme-independent
              "bg-neutral-950/70 text-[#38bdf8] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_8px_18px_-12px_rgba(0,0,0,0.95)] hover:bg-neutral-950/70 hover:text-[#38bdf8]",
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
